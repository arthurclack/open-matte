// scripts/upgrade-preview.mjs: what upgrading a shop to version 2 would do, printed
// from a copy of a backup, with the backup itself left exactly as it was.
// docs/version-2.md, "Upgrading an existing shop": step 2, and the table under it.
// The shop is the one the migration suite upgrades (schema7.js).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.js';

// scripts/ isn't in the server's image, where docs/deploying.md runs the tests on
// the server's own Node: there these are skipped, not failed.
const MODULE = new URL('../scripts/upgrade-preview.mjs', import.meta.url);
const SCRIPT = fileURLToPath(MODULE);
const present = fs.existsSync(MODULE);
const skip = present ? false : 'scripts/ is not here (the server image has none)';
// Importing it must not run it: main only runs when the file is executed.
const { formatReport, previewUpgrade } = present ? await import(MODULE) : {};
const { MIGRATIONS, openDb } = await import('../server/db.js');
const { DAY, HOUR, fillShop, schemaSevenDb } = await import('./schema7.js');

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// Everything about a folder that a careless tool would change: each file's name,
// bytes, size and the time it was last written.
const snapshot = (dir) =>
  fs.readdirSync(dir).sort().map((name) => {
    const s = fs.statSync(path.join(dir, name));
    return { name, sha256: sha256(path.join(dir, name)), size: s.size, mtimeMs: s.mtimeMs };
  });

// A backup as the server writes one: a single file, made with VACUUM INTO, in a
// folder of its own. `spoil` changes the shop before it is backed up.
function backupOfShop(now, spoil) {
  const live = path.join(tempDir(), 'open-matte.db');
  const db = schemaSevenDb(live);
  const ids = fillShop(db, now);
  spoil?.(db, ids);
  const file = path.join(tempDir(), 'open-matte-2026-11-11-153012.db');
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  db.close();
  return { file, dir: path.dirname(file), ...ids };
}

describe('the upgrade preview', { skip }, () => {
  let now;
  let shop;
  let F;
  let T;
  let report;

  before(() => {
    // Taken here, not when the file loads: the shop has browsers "playing now".
    now = Date.now();
    shop = backupOfShop(now);
    ({ F, T } = shop);
    report = previewUpgrade(shop.file);
  });

  const nameOf = (id) => Object.keys(T).find((k) => T[k] === id) ?? `link ${id}`;
  const names = (rows) => rows.map((r) => nameOf(r.link.id)).sort();
  const row = (rows, name) => rows.find((r) => r.link.id === T[name]);

  test('the file it is given is untouched: the same bytes, the same date, and nothing beside it', () => {
    const { file, dir } = backupOfShop(now);
    const before = snapshot(dir);
    assert.deepEqual(before.map((f) => f.name), [path.basename(file)]);

    const r = run(file);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Tapes out after the upgrade: 13/);
    assert.deepEqual(snapshot(dir), before, 'no byte or date changed, and no -wal, -shm or journal was left beside it');
    previewUpgrade(file);
    assert.deepEqual(snapshot(dir), before, 'nor when it is called as a function');

    // Still the schema 7 backup it was: 1.1.0 would open it, and the upgrade is still to do.
    const raw = new DatabaseSync(file, { readOnly: true });
    assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 7);
    assert.ok(!raw.prepare('PRAGMA table_info(tickets)').all().some((c) => c.name === 'loan_days'));
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('loans', 'responses')").get().n, 0);
    raw.close();
    assert.deepEqual(snapshot(dir), before);
  });

  test('a backup that can only be read, in a folder that can only be read, is previewed all the same', () => {
    // As the backups folder is mounted for the preview on a server (read-only).
    const { file, dir } = backupOfShop(now);
    const before = snapshot(dir);
    fs.chmodSync(file, 0o444);
    fs.chmodSync(dir, 0o555);
    try {
      const r = run(file);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Tapes out after the upgrade: 13/);
      assert.deepEqual(snapshot(dir), before);
    } finally {
      fs.chmodSync(dir, 0o755);
      fs.chmodSync(file, 0o644);
    }
  });

  test('so is a plain copy of the database file, which SQLite could not even open where it lies', () => {
    // Not a backup the server wrote but data/open-matte.db itself, copied with the
    // server stopped: closed cleanly, so one file, and still marked as keeping a
    // -wal beside it. Opening that as a database means writing beside it, which a
    // folder that can only be read refuses: only the copy is ever opened.
    const file = path.join(tempDir(), 'open-matte.db');
    const dir = path.dirname(file);
    const db = schemaSevenDb(file);
    fillShop(db, now);
    db.close();
    const before = snapshot(dir);
    assert.deepEqual(before.map((f) => f.name), ['open-matte.db'], 'closed cleanly: one file');
    assert.deepEqual([...fs.readFileSync(file).subarray(18, 20)], [2, 2], 'and its header says write-ahead log');
    fs.chmodSync(file, 0o444);
    fs.chmodSync(dir, 0o555);
    try {
      const r = run(file);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Tapes out after the upgrade: 13/);
      assert.deepEqual(snapshot(dir), before);
    } finally {
      fs.chmodSync(dir, 0o755);
      fs.chmodSync(file, 0o644);
    }
  });

  test('the copy it works on is deleted, whatever happens', () => {
    const tmpDir = tempDir();
    assert.equal(previewUpgrade(shop.file, { tmpDir }).out.length, 13);
    assert.deepEqual(fs.readdirSync(tmpDir), [], 'after a preview');
    const broken = backupOfShop(now, (db) => db.exec('CREATE TABLE loans (note TEXT)'));
    assert.ok(previewUpgrade(broken.file, { tmpDir }).failed);
    assert.deepEqual(fs.readdirSync(tmpDir), [], 'after an upgrade that fails');
    const notOne = path.join(tempDir(), 'notes.db');
    fs.writeFileSync(notOne, 'not a database at all, but long enough to be read as one would be');
    assert.throws(() => previewUpgrade(notOne, { tmpDir }), /not an Open Matte database/);
    assert.deepEqual(fs.readdirSync(tmpDir), [], 'after a file that is no database');
  });

  test('it says which schema the backup is at and which the upgrade takes it to', () => {
    assert.equal(report.file, shop.file);
    assert.deepEqual([report.from, report.to], [7, MIGRATIONS.length]);
    assert.ok(report.at >= now && report.at <= Date.now());
  });

  test("who keeps which tape: each film's loan, its link, its borrower and when it is due back", () => {
    assert.deepEqual(names(report.out), ['broken', 'crowdPlaying', 'fortnight', 'givenBack', 'kept', 'otherDevice', 'pairBen', 'rankLive', 'signedIn', 'solo', 'sooner', 'startByPassed', 'tieEarlier']);
    // One tape per film.
    assert.equal(new Set(report.out.map((o) => o.film.slug)).size, report.out.length);
    // A link for anyone: the browser, by its device. The position is kept.
    const solo = row(report.out, 'solo');
    assert.deepEqual(solo.film, { title: 'Solo', slug: 'solo', onShelf: true });
    assert.deepEqual(solo.link, { id: T.solo, label: 'Sam', for: null, cancelled: false });
    assert.deepEqual(solo.borrower, { person: null, device: 'Safari on iPhone', signedInAs: null });
    assert.deepEqual([solo.takenAt, solo.dueAt, solo.positionSeconds], [now - 3 * HOUR, now + 45 * HOUR, 1800]);
    // Still the browser when a member is signed in there, and the report can say who.
    assert.deepEqual(row(report.out, 'signedIn').borrower, { person: null, device: 'Edge on Windows', signedInAs: 'Dee' });
    // A member's link: the member, whichever device they played on.
    assert.deepEqual(row(report.out, 'pairBen').borrower, { person: 'Ben', device: 'Safari on iPad' });
    assert.deepEqual(row(report.out, 'otherDevice').borrower, { person: 'Ada', device: 'Chrome on Mac' });
    assert.equal(row(report.out, 'pairBen').link.for, 'Ben');
    // Due at the link's expiry when that is sooner than the play's time to come back.
    assert.equal(row(report.out, 'sooner').dueAt, now + 12 * HOUR);
  });

  test('who is cut off: part-way through a film whose tape goes to someone else', () => {
    assert.deepEqual(names(report.cutOff), ['crowdAda', 'crowdPaused', 'pairAnyone', 'tieLater']);
    // Each is on a film whose tape is out on another link.
    for (const c of report.cutOff) assert.ok(report.out.some((o) => o.film.slug === c.film.slug && o.link.id !== c.link.id), nameOf(c.link.id));
    const ada = row(report.cutOff, 'crowdAda');
    assert.deepEqual(ada.who, { person: 'Ada', device: 'Safari on iPhone' });
    assert.deepEqual([ada.positionSeconds, ada.lastHeardAt, ada.playingNow, ada.loanDays], [1200, now - 5 * 1000, false, 14]);
    assert.deepEqual(row(report.cutOff, 'pairAnyone').who, { person: null, device: 'Chrome on Windows', signedInAs: null });
    assert.equal(row(report.cutOff, 'crowdPaused').loanDays, 3, "the shop's default");
    // Nobody who couldn't have carried on in 1.x is called cut off: a browser signed
    // out, a card turned off, a film off the shelf, a cancelled link.
    for (const name of ['signedOut', 'expired', 'left', 'gone', 'cardOff', 'cardOffBrowser', 'rankCy', 'offShelf', 'cancelled']) assert.equal(row(report.cutOff, name), undefined, name);
  });

  test('which links are spent once their loan ends, though 1.x would have let them play again (question 15)', () => {
    assert.deepEqual(names(report.spentEarly), ['broken', 'crowdPlaying', 'fortnight', 'givenBack', 'kept', 'pairBen', 'rankLive']);
    for (const s of report.spentEarly) assert.ok(report.out.includes(s), 'each of them has its tape now');
    // As often as you like for 14 days, started yesterday: due back tomorrow.
    assert.deepEqual(row(report.spentEarly, 'fortnight').spentEarly, { playsLeft: null, until: now - 26 * HOUR + 14 * DAY });
    assert.equal(row(report.spentEarly, 'fortnight').dueAt, now + 22 * HOUR);
    // Three plays, one open and one given back, which doesn't count: two were left.
    assert.deepEqual(row(report.spentEarly, 'givenBack').spentEarly, { playsLeft: 2, until: null });
    // A link sent with one play gets exactly what 1.x gave it, and so does one whose days end with its loan.
    for (const name of ['solo', 'signedIn', 'otherDevice', 'sooner', 'startByPassed', 'tieEarlier']) assert.equal(row(report.out, name).spentEarly, null, name);
  });

  test('which links are spent: used up, or past their days after the first play, cancelled or not', () => {
    assert.deepEqual(names(report.spent), ['finishedGivenBack', 'offShelfUsedUp', 'past', 'pastDays', 'pastDaysCancelled', 'pastDaysGivenBack', 'usedUp', 'usedUpCancelled', 'usedUpGaveOneBack', 'usedUpNobody']);
    assert.deepEqual(Object.fromEntries(report.spent.map((s) => [nameOf(s.link.id), s.why])), {
      finishedGivenBack: 'past-its-days',
      usedUp: 'used-up',
      usedUpCancelled: 'used-up',
      usedUpGaveOneBack: 'used-up',
      usedUpNobody: 'used-up',
      offShelfUsedUp: 'used-up',
      past: 'past-its-days',
      pastDays: 'past-its-days',
      pastDaysCancelled: 'past-its-days',
      pastDaysGivenBack: 'past-its-days',
    });
    assert.deepEqual(report.spent.filter((s) => s.link.cancelled).map((s) => nameOf(s.link.id)).sort(), ['pastDaysCancelled', 'usedUpCancelled']);
    assert.equal(row(report.spent, 'offShelfUsedUp').film.onShelf, false);
    for (const s of report.spent) assert.ok(s.endedAt <= now, nameOf(s.link.id));
  });

  test('which links lend once more, and for how long', () => {
    assert.deepEqual(names(report.lendOnceMore), ['cardOff', 'cardOffBrowser', 'expired', 'gone', 'left', 'metStartBy', 'noLimit', 'noLimitWeek', 'offShelf', 'oneOfTwoGivenBack', 'onlyGivenBack', 'playsLeft', 'rankCy', 'signedOut']);
    assert.deepEqual(
      Object.fromEntries(['playsLeft', 'noLimitWeek', 'noLimit', 'onlyGivenBack', 'metStartBy'].map((n) => [n, row(report.lendOnceMore, n).loanDays])),
      { playsLeft: 30, noLimitWeek: 7, noLimit: 3, onlyGivenBack: 3, metStartBy: 3 },
    );
    // A play nobody could carry on is not a loan, and its link is not spent.
    assert.equal(row(report.lendOnceMore, 'signedOut').open, true);
    assert.equal(row(report.lendOnceMore, 'noLimit').open, false);
  });

  test('which loan lengths are capped at 30 days', () => {
    assert.deepEqual(Object.fromEntries(report.capped.map((c) => [nameOf(c.link.id), [c.said, c.loanDays]])), { shelfKeepable: [3650, 30], shelfCancelled: [45, 30], playsLeft: [3650, 30] });
  });

  test('every link is in one list or counted, and none in two', () => {
    const listed = [...report.out, ...report.cutOff, ...report.spent, ...report.lendOnceMore].map((r) => r.link.id);
    assert.equal(new Set(listed).size, listed.length);
    assert.deepEqual(report.counts, { films: Object.keys(F).length, links: Object.keys(T).length, neverPlayed: 11, cancelled: 2 });
    assert.equal(listed.length + report.counts.neverPlayed + report.counts.cancelled, report.counts.links);
    // A link nobody played whose start-by passed while another link's play was open
    // waits once upgraded, and has that time back: counted among those never played,
    // and named nowhere (docs/version-2.md, the Upgrading table).
    assert.ok(!listed.includes(T.soloWaited));
  });

  test('it agrees with the upgrade itself, run on another copy', () => {
    const copy = path.join(tempDir(), 'open-matte.db');
    fs.copyFileSync(shop.file, copy);
    const db = openDb(copy);
    const loans = db.prepare('SELECT ticket_id, due_at, ended_at FROM loans ORDER BY ticket_id').all();
    db.close();
    assert.deepEqual(report.out.map((o) => [o.link.id, o.dueAt]).sort((a, b) => a[0] - b[0]), loans.filter((l) => l.ended_at == null).map((l) => [l.ticket_id, l.due_at]));
    assert.deepEqual(report.spent.map((s) => [s.link.id, s.endedAt]).sort((a, b) => a[0] - b[0]), loans.filter((l) => l.ended_at != null).map((l) => [l.ticket_id, l.ended_at]));
  });

  test('the printed report names films, links and borrowers, says what it is as of, and never prints a link itself', () => {
    const text = formatReport(report);
    assert.equal(run(shop.file).stdout.replace(/As of this backup[^\n]*\n/, ''), `${text}\n`.replace(/As of this backup[^\n]*\n/, ''), 'what the script prints');
    assert.ok(text.includes(shop.file));
    assert.match(text, /Schema 7 now; the upgrade takes it to schema 8\./);
    assert.match(text, /As of this backup, by this computer's clock: .+\(.+\)\./);
    assert.match(text, /decides by the clock when the server starts, so a Play pressed in between can change it/);
    assert.match(text, /only read, to copy it/);
    for (const title of ['Tapes out after the upgrade: 13', 'Plays cut off: 4', 'Links spent early: 7', 'Links already spent: 10', 'Links that lend once more: 14', 'Loan lengths capped at 30 days: 3']) {
      assert.ok(text.includes(`\n${title}\n`), title);
    }
    assert.match(text, new RegExp(`\\n  Solo: link ${T.solo} "Sam", out to a browser \\(Safari on iPhone\\), 30 min in, due back .+\\n`));
    assert.match(text, new RegExp(`\\n  The Pair: link ${T.pairBen} "Ben", out to Ben, 40 min in, due back .+\\n`));
    assert.match(text, new RegExp(`\\n  Signed In: link ${T.signedIn}, out to a browser \\(Edge on Windows\\), signed in as Dee, `));
    assert.match(text, new RegExp(`\\n  The Crowd: link ${T.crowdAda} "Ada again", Ada, 20 min in, last heard from .+\\n`));
    assert.match(text, new RegExp(`\\n  A Fortnight: link ${T.fortnight} "Jo", due back .+; in 1\\.x it had no limit on plays until .+\\n`));
    assert.match(text, new RegExp(`\\n  Given Back: link ${T.givenBack}, due back .+; in 1\\.x it had 2 more plays\\n`));
    assert.match(text, new RegExp(`\\n  Done: link ${T.usedUp} "Once", used up\\n`));
    assert.match(text, new RegExp(`\\n  Done: link ${T.pastDaysCancelled}, for Ada \\(cancelled\\), past its days after the first play\\n`));
    assert.match(text, new RegExp(`\\n  Off the Shelf \\(off the shelf\\): link ${T.offShelfUsedUp}, used up\\n`));
    assert.match(text, new RegExp(`\\n  Done: link ${T.playsLeft} "Three goes", for 30 days\\n`));
    assert.match(text, new RegExp(`\\n  The Shelf: link ${T.shelfKeepable}, said 3650 days after the first play\\n`));
    assert.match(text, /\nLinks never played: 11 of 54\n  Each waits for its first Play and lends once: for the days it said after the first play, at most 30, or else for 3 days\.\n/);
    assert.match(text, /\nCancelled links that were not spent: 2\n  They stay cancelled\.\n/);
    assert.ok(!new RegExp(`link ${T.soloWaited}\\b`).test(text) && !text.includes('"Waited"'), 'the link whose start-by passed during an open play is not named');
    // A link's code is the link: whoever reads the report over a shoulder gets none.
    const raw = new DatabaseSync(shop.file, { readOnly: true });
    const codes = raw.prepare('SELECT code FROM tickets').all().map((t) => t.code);
    const hashes = raw.prepare('SELECT id_hash FROM sessions').all().map((s) => s.id_hash);
    raw.close();
    assert.equal(codes.length, 54);
    for (const secret of [...codes, ...hashes]) assert.ok(!text.includes(secret), secret);
  });

  test('a quiet shop: nothing out, nobody cut off, and it says so', () => {
    const live = path.join(tempDir(), 'open-matte.db');
    const db = schemaSevenDb(live);
    db.prepare("INSERT INTO films (slug, title, published, media_status, created_at, updated_at) VALUES ('arrival', 'Arrival', 1, 'ok', ?, ?)").run(now, now);
    db.prepare("INSERT INTO tickets (code, film_id, label, created_at) VALUES ('abcdefghjkmnp', 1, 'Sam', ?)").run(now);
    db.close();
    const quiet = previewUpgrade(live);
    assert.deepEqual([quiet.out, quiet.cutOff, quiet.spentEarly, quiet.spent, quiet.lendOnceMore, quiet.capped], [[], [], [], [], [], []]);
    assert.deepEqual(quiet.counts, { films: 1, links: 1, neverPlayed: 1, cancelled: 0 });
    const text = formatReport(quiet);
    for (const title of ['Tapes out after the upgrade', 'Plays cut off', 'Links spent early', 'Links already spent', 'Links that lend once more', 'Loan lengths capped at 30 days']) {
      assert.ok(text.includes(`\n${title}: none\n`), title);
    }
    assert.match(text, /\nLinks never played: 1 of 1\n/);
    assert.ok(!text.includes('Cancelled links'));
  });

  test('an upgrade that would fail is reported as one, and the backup is still untouched', () => {
    // The plan's failing fixture: a schema 7 file that already has a table called loans.
    const { file, dir } = backupOfShop(now, (db) => db.exec('CREATE TABLE loans (note TEXT)'));
    const before = snapshot(dir);
    const failed = previewUpgrade(file);
    assert.match(failed.failed, /table loans already exists/);
    assert.deepEqual([failed.from, failed.stays], [7, 7], 'the copy rolled back whole');
    assert.equal(failed.out, undefined);
    const r = run(file);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /The upgrade would fail:\n  .*table loans already exists/);
    assert.match(r.stdout, /Nothing would change: the database would stay at schema 7/);
    assert.deepEqual(snapshot(dir), before);
  });

  test('a database already upgraded has nothing to preview, and is left alone too', () => {
    const file = path.join(tempDir(), 'open-matte-2026-12-01-040000.db');
    const db = openDb(path.join(tempDir(), 'open-matte.db'));
    db.exec(`VACUUM INTO '${file}'`);
    db.close();
    const before = snapshot(path.dirname(file));
    const r = run(file);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`already at schema ${MIGRATIONS.length}, which has loans: there is nothing to preview`));
    assert.deepEqual(snapshot(path.dirname(file)), before);
  });

  test('a database from newer code, a file that is no database, no file and no argument are each refused', () => {
    const newer = path.join(tempDir(), 'newer.db');
    openDb(newer).close();
    const raw = new DatabaseSync(newer);
    raw.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    raw.close();
    const notOne = path.join(tempDir(), 'notes.db');
    fs.writeFileSync(notOne, 'not a database at all, but long enough to be read as one would be');
    const empty = path.join(tempDir(), 'empty.db');
    fs.writeFileSync(empty, '');
    // Matched a line at a time: Node 22 and 24 warn on stderr that SQLite is experimental.
    const cases = [
      [[newer], 1, /written by a newer Open Matte \(schema \d+; this code knows \d+\)/],
      [[notOne], 1, /not an Open Matte database/],
      [[empty], 1, /not an Open Matte database/],
      [[path.join(tempDir(), 'missing.db')], 1, /No such file: /],
      [[tempDir()], 1, /No such file: /],
      [[], 2, /^Usage: node scripts\/upgrade-preview\.mjs /m],
      [[notOne, empty], 2, /^Usage: /m],
      [['--force'], 2, /^Usage: /m],
    ];
    for (const [args, status, message] of cases) {
      const r = run(...args);
      assert.equal(r.status, status, args.join(' '));
      assert.match(r.stderr, message, args.join(' '));
      assert.equal(r.stdout, '', args.join(' '));
    }
    assert.equal(fs.readFileSync(empty, 'utf8'), '', 'an empty file is not made into a database');
    assert.equal(fs.readFileSync(notOne, 'utf8'), 'not a database at all, but long enough to be read as one would be');
  });

  test('a database a server still has open is refused: its latest changes are in another file', () => {
    const live = path.join(tempDir(), 'open-matte.db');
    const db = schemaSevenDb(live);
    fillShop(db, now);
    // Left open, as a running server has it: the -wal file is beside it.
    try {
      assert.ok(fs.existsSync(`${live}-wal`));
      const before = snapshot(path.dirname(live));
      const tmpDir = tempDir();
      assert.throws(() => previewUpgrade(live, { tmpDir }), /a database in use, not a backup: its latest changes are in open-matte\.db-wal beside it\. Preview a backup instead\./);
      assert.deepEqual(fs.readdirSync(tmpDir), [], 'it was not even copied');
      // Nor through a link to it from another folder, where nothing is beside the link.
      const link = path.join(tempDir(), 'open-matte-backup.db');
      fs.symlinkSync(live, link);
      assert.throws(() => previewUpgrade(link, { tmpDir }), /a database in use, not a backup: its latest changes are in open-matte\.db-wal beside the file this link leads to, .+open-matte\.db\. Preview a backup instead\./);
      const r = run(link);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /a database in use, not a backup/);
      assert.equal(r.stdout, '');
      assert.deepEqual(fs.readdirSync(tmpDir), []);
      assert.deepEqual(fs.readdirSync(path.dirname(link)), ['open-matte-backup.db']);
      assert.deepEqual(snapshot(path.dirname(live)), before);
    } finally {
      db.close();
    }
  });

  test('a link to a backup is previewed as the backup is, and named as it was given', () => {
    const link = path.join(tempDir(), 'latest.db');
    fs.symlinkSync(shop.file, link);
    const before = snapshot(shop.dir);
    const linked = previewUpgrade(link);
    assert.equal(linked.file, link);
    assert.deepEqual([linked.out.length, linked.counts], [report.out.length, report.counts]);
    assert.deepEqual(snapshot(shop.dir), before);
    assert.deepEqual(fs.readdirSync(path.dirname(link)), ['latest.db']);
  });
});
