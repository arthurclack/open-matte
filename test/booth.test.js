// The projection booth: milestone 3, slice 4. Written from docs/history/milestone-3.md
// (slice 4), not from the implementation. One admin request answering what needs
// attention (links nobody has used, tickets close to their start-by date, media
// requests the server refused) and whether the server is well, each check saying what
// it checked. Refusals are kept in memory only, with nothing that identifies anyone.
// The off-server copy, with BACKUP_COPY_DIR set, is in booth-copy.test.js.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';

delete process.env.BACKUP_COPY_DIR;
const { addFilm, adminBrowser, browser, enroll, makeFilm, newPerson, playbackFiles, setupLink, startServer, tempDir } = await import('./helpers.js');
const { MIGRATIONS } = await import('../server/db.js');
const { createRefusals } = await import('../server/routes/media.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const UA = {
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  player: 'AppleCoreMedia/1.0.0.22F76 (iPhone; U; CPU OS 18_5 like Mac OS X; en_us)',
};
const IP = '203.0.113.7';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Every object inside a value, and every value that isn't one.
function* objects(v) {
  if (!v || typeof v !== 'object') return;
  if (!Array.isArray(v)) yield v;
  for (const x of Object.values(v)) yield* objects(x);
}
const leaves = (v) => (v && typeof v === 'object' ? Object.values(v).flatMap(leaves) : [v]);
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const counts = (db) => Object.fromEntries(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(({ name }) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all().map((r) => ({ ...r }))]),
);

describe('the projection booth', () => {
  const mediaDir = tempDir();
  let srv;
  let admin;
  let filmId;
  const fresh = () => browser(srv.base);
  const booth = async () => {
    const r = await admin.get('/api/admin/booth');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
  const issue = async (fields = {}) => {
    const r = await admin.post('/api/admin/tickets', { filmId, ...fields });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data[0];
  };

  before(async () => {
    makeFilm(mediaDir, 'arrival');
    srv = await startServer({ mediaDir, limits: { scale: 100 } });
    admin = await adminBrowser(srv.base);
    await admin.post('/api/admin/scan');
    filmId = (await admin.get('/api/admin/films')).data[0].id;
    await admin.patch(`/api/admin/films/${filmId}`, { published: true });
  });
  after(() => srv.close());

  test('admin only, and reading it records nothing', async () => {
    assert.equal((await fresh().get('/api/admin/booth')).status, 401);
    const viewer = fresh();
    await viewer.post('/api/tickets/open', { code: (await issue()).code });
    assert.equal((await viewer.get('/api/admin/booth')).status, 401, 'a viewer’s cookie is not the admin’s');

    const before1 = counts(srv.db);
    const first = await booth();
    await booth();
    assert.deepEqual(counts(srv.db), before1, 'no event, session, link or anything else written');
    assert.equal((await booth()).attention.refusals.total, first.attention.refusals.total, 'reading it is not a refusal');
  });

  test('attention and the server, in one object', async () => {
    const b = await booth();
    for (const key of ['links', 'tickets', 'refusals']) assert.ok(key in b.attention, `attention.${key}`);
    for (const key of ['media', 'disk', 'backups', 'retention', 'version']) assert.ok(key in b.server, `server.${key}`);
    assert.deepEqual(Object.keys(b.attention.refusals).sort(), ['byReason', 'recent', 'since', 'total']);
  });

  test('setup and recovery links still waiting, and links that expired unused in the last week', async () => {
    const now = Date.now();
    const link = async (name, body) => {
      const p = await newPerson(admin, name);
      return { p, ...(await setupLink(admin, p.id, body)) };
    };
    const waiting = await link('Waiting');
    const opened = await link('Opened');
    assert.equal((await fresh().post('/api/enroll/options', { token: opened.token })).status, 200);
    // Set up already, now with a recovery link.
    const recovering = await link('Recovering');
    assert.equal((await enroll(fresh(), recovering.token, { auth: softAuthenticator() })).status, 200);
    const recovery = await setupLink(admin, recovering.p.id, { confirmedContact: true, hours: 24 });
    assert.equal(recovery.purpose, 'recovery');
    // Expired two days ago; expired ten days ago; used; cancelled.
    const expired = await link('Expired');
    srv.db.prepare('UPDATE person_links SET created_at = ?, expires_at = ? WHERE person_id = ?').run(now - 5 * DAY, now - 2 * DAY, expired.p.id);
    const longAgo = await link('Long ago');
    srv.db.prepare('UPDATE person_links SET created_at = ?, expires_at = ? WHERE person_id = ?').run(now - 13 * DAY, now - 10 * DAY, longAgo.p.id);
    const used = await link('Used');
    assert.equal((await enroll(fresh(), used.token, { auth: softAuthenticator() })).status, 200);
    const cancelled = await link('Cancelled');
    assert.equal((await admin.post(`/api/admin/people/${cancelled.p.id}/links/cancel`)).status, 200);

    const row = (personId) => srv.db.prepare('SELECT * FROM person_links WHERE person_id = ? ORDER BY id DESC LIMIT 1').get(personId);
    const entry = (p) => {
      const l = row(p.id);
      return { personId: p.id, personName: p.name, purpose: l.purpose, createdAt: l.created_at, expiresAt: l.expires_at, openedAt: l.opened_at };
    };
    // However the two lists are laid out, every link in them names its person and when it expires.
    const links = [...objects((await booth()).attention.links)].filter((o) => 'personId' in o && 'expiresAt' in o);
    const fields = ['personId', 'personName', 'purpose', 'createdAt', 'expiresAt', 'openedAt'];
    const byName = (a, b) => a.personName.localeCompare(b.personName);
    const at = Date.now();
    assert.deepEqual(links.filter((l) => l.expiresAt > at).map((l) => pick(l, fields)).sort(byName), [entry(opened.p), entry(recovering.p), entry(waiting.p)]);
    assert.deepEqual(links.filter((l) => l.expiresAt <= at).map((l) => pick(l, fields)).sort(byName), [entry(expired.p)]);
    assert.ok(row(opened.p.id).opened_at, 'the opened link says when it was opened');
  });

  test('tickets never played whose start-by date is within three days either side', async () => {
    const now = Date.now();
    const p = await newPerson(admin, 'Starter');
    const near = {
      soon: await issue({ label: 'Soon', startBy: now + DAY }),
      forStarter: await issue({ label: 'For Starter', startBy: now + 2 * DAY, personId: p.id }),
      justPassed: await issue({ label: 'Just passed', startBy: now - DAY }),
    };
    await issue({ label: 'Later', startBy: now + 5 * DAY });
    await issue({ label: 'Long passed', startBy: now - 5 * DAY });
    await issue({ label: 'No date' });
    const revoked = await issue({ label: 'Revoked', startBy: now + DAY });
    assert.equal((await admin.post(`/api/admin/tickets/${revoked.id}/revoke`)).status, 200);
    // Played: on a film of its own, so Arrival's tape stays in for the tests below.
    const other = await addFilm(admin, mediaDir, 'played');
    const played = await issue({ label: 'Played', startBy: now + DAY, filmId: other.id });
    const b = fresh();
    await b.post('/api/tickets/open', { code: played.code });
    assert.equal((await b.post('/api/films/played/screenings')).status, 200);

    const listed = [...objects((await booth()).attention.tickets)].filter((o) => 'startBy' in o && 'label' in o);
    const expected = Object.values(near).map((t) => ({
      id: t.id,
      label: t.label,
      film: { id: filmId, title: 'Arrival' },
      person: t.person ? { id: p.id, name: 'Starter' } : null,
      startBy: t.startBy,
    }));
    const byId = (a, b) => a.id - b.id;
    assert.deepEqual(listed.map((t) => ({ ...pick(t, ['id', 'label', 'startBy']), film: pick(t.film, ['id', 'title']), person: t.person && pick(t.person, ['id', 'name']) })).sort(byId), expected.sort(byId));
  });

  test('refused media requests: counted by reason, repeats sharing a row, the latest shown, and nothing that identifies anyone', async () => {
    const ticket = await issue({ label: 'Refusals' });
    const holder = fresh();
    await holder.post('/api/tickets/open', { code: ticket.code });
    const token = holder.jar.get('om_session');
    const stale = fresh();
    stale.jar.set('om_session', crypto.randomBytes(32).toString('base64url'));
    const [master, child, , , , , , segment, , other, , subtitles] = playbackFiles('arrival');
    const poster = '/media/arrival/poster.jpg';
    const get = (b, url, ua = UA.safari) => b.send('GET', url, undefined, { headers: { 'user-agent': ua, 'x-forwarded-for': IP, range: 'bytes=0-99' } });

    const start = await booth();
    // Twelve refusals, oldest first: [browser, url, kind, client, reason].
    const NO_COOKIE = /no session cookie/;
    const STALE = /expired or unknown/;
    const NO_SCREENING = /no screening/;
    const asked = [
      [fresh(), poster, 'artwork', UA.safari, NO_COOKIE],
      [fresh(), poster, 'artwork', UA.safari, NO_COOKIE],
      [fresh(), master, 'playlist', UA.safari, NO_COOKIE],
      [fresh(), subtitles, 'subtitles', UA.safari, NO_COOKIE],
      [stale, segment, 'segment', UA.player, STALE],
      [stale, child, 'playlist', UA.player, STALE],
      [stale, other, 'segment', UA.player, STALE],
      [holder, master, 'playlist', UA.safari, NO_SCREENING],
      [holder, child, 'playlist', UA.player, NO_SCREENING],
      [holder, segment, 'segment', UA.player, NO_SCREENING],
      [holder, segment, 'segment', UA.player, NO_SCREENING],
      [holder, subtitles, 'subtitles', UA.player, NO_SCREENING],
    ];
    for (const [b, url, , ua] of asked) assert.equal((await get(b, url, ua)).status, 403, url);

    const { refusals } = (await booth()).attention;
    assert.equal(refusals.total, start.attention.refusals.total + asked.length);
    assert.equal(refusals.since, start.attention.refusals.since, 'since the server started');
    assert.ok(refusals.since <= Date.now());
    // By reason: each of the three reasons went up by as many as were asked for.
    const grew = (re) => Object.entries(refusals.byReason).filter(([r]) => re.test(r)).reduce((n, [r, k]) => n + k - (start.attention.refusals.byReason[r] ?? 0), 0);
    for (const re of [NO_COOKIE, STALE, NO_SCREENING]) assert.equal(grew(re), asked.filter((a) => a[4] === re).length, String(re));
    assert.equal(Object.values(refusals.byReason).reduce((a, b) => a + b, 0), refusals.total);

    // One row for each kind of refusal (the same reason, kind of file and client),
    // newest first, counting its repeats: the two poster requests, the stale browser's
    // two segments and the holder's two are one row each.
    const key = (kind, ua, re) => `${kind} | ${ua === UA.player ? 'Apple media player (iPhone)' : 'Safari on iPhone'} | ${re}`;
    const rows = [];
    for (const [, , kind, ua, re] of asked) {
      const k = key(kind, ua, re);
      const i = rows.findIndex((r) => r.k === k);
      const row = i < 0 ? { k, count: 0 } : rows.splice(i, 1)[0];
      row.count++;
      rows.unshift(row);
    }
    assert.equal(rows.length, 9);
    const reasonOf = (reason) => [NO_COOKIE, STALE, NO_SCREENING].find((re) => re.test(reason));
    assert.deepEqual(
      refusals.recent.slice(0, rows.length).map((r) => ({ k: `${r.kind} | ${r.client} | ${reasonOf(r.reason)}`, count: r.count })),
      rows,
    );
    assert.ok(refusals.recent.length <= 10, 'the latest ten at most');
    for (const r of refusals.recent) {
      for (const k of Object.keys(r)) assert.ok(['at', 'status', 'reason', 'kind', 'film', 'client', 'count'].includes(k), `unexpected field ${k}`);
      assert.equal(r.status, 403);
      assert.equal(r.film, 'arrival');
      assert.ok(r.at >= start.attention.refusals.since && r.at <= Date.now());
    }
    // No address, cookie, session, ticket, path, range or full user agent anywhere.
    const json = JSON.stringify(refusals);
    for (const secret of [IP, '127.0.0.1', token, sha256(token), stale.jar.get('om_session'), ticket.code, 'Refusals', '/media/', 'hls/', 'seg_', '.m3u8', '.vtt', 'poster.jpg', 'bytes=', UA.safari, UA.player, 'Mozilla']) {
      assert.ok(!json.includes(secret), `the refusals mention ${secret}`);
    }
  });

  // Never who has it: the browser gets the same empty 403 whichever link has the
  // tape, and the reason is only ever written here and in the server's log.
  test('a tape that is out: the refusal says so here, the same for a link that is waiting and for the borrower’s own link in another browser, and the browser is told nothing', async () => {
    const film = await addFilm(admin, mediaDir, 'tape-out');
    const lent = await issue({ label: 'Lent', filmId: film.id });
    const borrower = fresh();
    await borrower.post('/api/tickets/open', { code: lent.code });
    assert.equal((await borrower.post('/api/films/tape-out/screenings')).status, 200);
    const sameLink = fresh();
    await sameLink.post('/api/tickets/open', { code: lent.code });
    const waiting = fresh();
    await waiting.post('/api/tickets/open', { code: (await issue({ label: 'Waiting', filmId: film.id })).code });
    const segment = '/media/tape-out/hls/v_h264_720/seg_2.m4s';
    const start = await booth();
    const answers = [];
    for (const b of [sameLink, waiting]) {
      const r = await b.send('GET', segment, undefined, { headers: { 'user-agent': UA.safari } });
      answers.push([r.status, r.data, r.headers.get('content-type'), r.headers.get('content-length')]);
    }
    assert.deepEqual(answers[0], [403, '', null, '0'], 'an empty 403');
    assert.deepEqual(answers[1], answers[0], 'the same for both kinds of out');
    const { refusals } = (await booth()).attention;
    const reason = 'the tape is out with someone else';
    assert.equal((refusals.byReason[reason] ?? 0) - (start.attention.refusals.byReason[reason] ?? 0), 2);
    const row = refusals.recent.find((r) => r.reason === reason);
    assert.deepEqual(pick(row, ['status', 'kind', 'film', 'client', 'count']), { status: 403, kind: 'segment', film: 'tape-out', client: 'Safari on iPhone', count: 2 }, 'one row: nothing tells the two apart');
    assert.ok(!JSON.stringify(refusals).includes('Lent'), 'never the link, or who has it');
    assert.equal((await borrower.get(segment)).status, 200);
  });

  test("requests with no session, however many and however varied, can't push a viewer's refusal out of the latest ten", async () => {
    const ticket = await issue({ label: 'Crowded out' });
    const holder = fresh();
    await holder.post('/api/tickets/open', { code: ticket.code });
    const segment = '/media/arrival/hls/v_h264_720/seg_2.m4s';
    const get = (b, url, ua) => b.send('GET', url, undefined, { headers: { 'user-agent': ua } });
    assert.equal((await get(holder, segment, UA.safari)).status, 403);
    const start = await booth();

    // A script tries every kind of file, as a dozen different browsers, again and
    // again: with no cookie, then with one it made up.
    const agents = ['curl/8.7.1', UA.safari, UA.player, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0', 'Mozilla/5.0 (Linux; Android 15) Chrome/141.0.0.0 Mobile Safari/537.36'];
    const files = [...playbackFiles('arrival'), '/media/arrival/poster.jpg', '/media/arrival/guessed.m3u8'];
    const STRANGERS = ['no session cookie', 'session expired or unknown'];
    const counted = (r) => STRANGERS.reduce((n, reason) => n + (r.byReason[reason] ?? 0), 0);
    let sent = 0;
    for (const cookie of [null, 'om_session=made-up']) {
      for (const ua of agents) {
        for (const url of files) {
          const r = await fresh().send('GET', url, undefined, { headers: { 'user-agent': ua, ...(cookie && { cookie }) } });
          assert.equal(r.status, 403, url);
          sent++;
        }
      }
    }
    const { refusals } = (await booth()).attention;
    // Every one counted...
    assert.equal(refusals.total, start.attention.refusals.total + sent);
    assert.equal(counted(refusals) - counted(start.attention.refusals), sent);
    assert.ok(refusals.byReason['session expired or unknown'] > 0, 'the made-up cookie is told apart');
    // ...but only a few rows of them, and the holder's refusal is still there, counted once.
    const theirs = refusals.recent.filter((r) => STRANGERS.includes(r.reason));
    assert.ok(theirs.length <= 5, `${theirs.length} rows of requests with no session`);
    const mine = refusals.recent.filter((r) => /no screening/.test(r.reason) && r.client === 'Safari on iPhone' && r.kind === 'segment');
    assert.equal(mine.length, 1, JSON.stringify(refusals.recent));
    assert.ok(theirs.some((r) => r.count > 1), 'their repeats share rows');
  });

  test('the backups: whether on, the newest file written, and the last error; no copy configured without BACKUP_COPY_DIR', async () => {
    const r = await admin.post('/api/admin/backups');
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const { backups } = (await booth()).server;
    assert.equal(backups.enabled, true);
    assert.ok(leaves(backups).includes(r.data.backup.name), 'the newest backup’s name');
    assert.ok(leaves(backups).includes(r.data.backup.at), 'and when it was written');
    const copy = [...objects((await booth()).server)].find((o) => 'configured' in o);
    assert.ok(copy, 'the off-server copy');
    assert.equal(copy.configured, false);
  });

  test('the clean-up of old records, as Settings shows it', async () => {
    let { retention } = (await booth()).server;
    assert.deepEqual(retention.settings, { retainProgressDays: 30, retainEventsDays: 365, retainSessionsDays: 30 });
    assert.ok('lastRun' in retention && 'lastError' in retention);
    assert.equal(retention.lastRun, null, 'not yet since the server started');
    const run = await admin.post('/api/admin/retention/run', {});
    assert.equal(run.status, 200);
    ({ retention } = (await booth()).server);
    assert.deepEqual(retention.lastRun, run.data.lastRun);
  });

  test('the version running: Open Matte, Node, SQLite, the schema, and when the server started', async () => {
    const { version } = (await booth()).server;
    const values = leaves(version);
    const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'));
    const sqlite = new DatabaseSync(':memory:').prepare('SELECT sqlite_version() AS v').get().v;
    for (const v of [pkg.version, process.version, sqlite, MIGRATIONS.length]) assert.ok(values.includes(v), `${v} in ${JSON.stringify(version)}`);
    const processStart = Date.now() - process.uptime() * 1000 - 1000;
    assert.ok(values.some((v) => typeof v === 'number' && v >= processStart && v <= Date.now()), 'when the server started');
  });

  test('disk space for the data and media folders', async () => {
    const { disk } = (await booth()).server;
    let total = null;
    try {
      const s = fs.statfsSync(srv.dataDir);
      total = s.blocks * s.bsize;
    } catch {
      // Not supported here: the booth says null.
    }
    if (total === null) return assert.ok(leaves(disk).every((v) => v === null || typeof v === 'string'));
    assert.ok(leaves(disk).includes(total), `the data folder's ${total} bytes in ${JSON.stringify(disk)}`);
    assert.ok(leaves(disk).filter((v) => typeof v === 'number').every((v) => v >= 0));
  });

  test('the media folder, readable', async () => {
    const { media } = (await booth()).server;
    assert.ok(!media.error, JSON.stringify(media));
    assert.ok(!Object.values(media).includes(false), JSON.stringify(media));
  });
});

describe('when things are wrong', () => {
  test('a missing media folder is reported, not thrown', async () => {
    const mediaDir = path.join(tempDir(), 'not-mounted');
    const srv = await startServer({ mediaDir });
    try {
      const admin = await adminBrowser(srv.base);
      const r = await admin.get('/api/admin/booth');
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const { media } = r.data.server;
      assert.equal(typeof media.error, 'string');
      assert.ok(media.error.length > 0);
      assert.ok(Object.values(media).includes(false), JSON.stringify(media));
      assert.doesNotMatch(JSON.stringify(r.data), /\\n\s+at /, 'never a stack');
      assert.ok(r.data.server.version, 'the rest still answers');
    } finally {
      await srv.close();
    }
  });

  test('a backup that failed says why', async () => {
    const dataDir = tempDir();
    const notAFolder = path.join(dataDir, 'backups-is-a-file');
    fs.writeFileSync(notAFolder, 'not a folder');
    const mediaDir = tempDir();
    const srv = await startServer({ mediaDir, dataDir, backupOptions: { backupDir: notAFolder } });
    try {
      const admin = await adminBrowser(srv.base);
      assert.notEqual((await admin.post('/api/admin/backups')).status, 201);
      const { lastError } = (await admin.get('/api/admin/backups')).data;
      assert.ok(lastError?.message);
      const { backups } = (await admin.get('/api/admin/booth')).data.server;
      assert.ok(JSON.stringify(backups).includes(lastError.message), JSON.stringify(backups));
    } finally {
      await srv.close();
    }
  });
});

describe('the refusals the booth keeps (createRefusals)', () => {
  let clock = 1000;
  const now = () => clock++;
  const refusal = (over = {}) => ({ status: 403, reason: 'no screening held by this browser', kind: 'segment', film: 'arrival', client: 'Safari on iPhone', ...over });
  const NO_COOKIE = 'no session cookie';

  test('a repeat adds to its row and moves it to the top; anything different is a row of its own', () => {
    const r = createRefusals({ now });
    r.add(refusal());
    r.add(refusal({ kind: 'playlist' }));
    r.add(refusal({ film: 'heat' }));
    r.add(refusal({ client: 'Chrome on Mac' }));
    r.add(refusal({ status: 404, reason: 'file missing from the film folder' }));
    r.add(refusal());
    const { total, byReason, recent } = r.view();
    assert.equal(total, 6);
    assert.deepEqual(byReason, { 'no screening held by this browser': 5, 'file missing from the film folder': 1 });
    assert.equal(recent.length, 5);
    assert.deepEqual(recent[0], { ...refusal(), at: clock - 1, count: 2 });
    assert.deepEqual(recent.slice(1).map((x) => x.count), [1, 1, 1, 1]);
    // The view is a copy: what the booth sends doesn't change under it.
    r.add(refusal());
    assert.equal(recent[0].count, 2);
  });

  test('requests from strangers, with no live session, keep to their own few rows', () => {
    const r = createRefusals({ keep: 10, strangers: 3, now });
    r.add(refusal());
    // No cookie, or one that names no session: whatever the reason, a stranger's.
    const reasons = [NO_COOKIE, 'session expired or unknown'];
    for (let i = 0; i < 40; i++) r.add(refusal({ reason: reasons[i % 2], client: `Browser ${i % 8}`, kind: ['playlist', 'segment', 'artwork'][i % 3], stranger: true }));
    const { total, byReason, recent } = r.view();
    assert.equal(total, 41);
    assert.equal(byReason[NO_COOKIE] + byReason['session expired or unknown'], 40);
    assert.equal(recent.filter((x) => reasons.includes(x.reason)).length, 3);
    assert.deepEqual(recent.at(-1), { ...refusal(), at: recent.at(-1).at, count: 1 }, 'the viewer’s refusal is still there');
    assert.equal(recent.length, 4);
    assert.ok(recent.every((x) => !('stranger' in x)), 'the booth is sent the rows as they were');
  });

  test('the latest rows, newest first, up to keep', () => {
    const r = createRefusals({ keep: 3, now });
    for (const film of ['a', 'b', 'c', 'd']) r.add(refusal({ film }));
    assert.deepEqual(r.view().recent.map((x) => x.film), ['d', 'c', 'b']);
    assert.deepEqual(r.view(2).recent.map((x) => x.film), ['d', 'c']);
    assert.equal(r.view().total, 4);
  });
});
