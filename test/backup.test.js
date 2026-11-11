// Daily database backups: what's kept, when they run, and that one restores.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { adminBrowser, browser, makeFilm, pngImage, startServer, tempDir, watchPlays } from './helpers.js';

const { openDb } = await import('../server/db.js');
const { backupsToDelete, createBackups } = await import('../server/backup.js');
const { createApp } = await import('../server/app.js');

const DAY = 24 * 60 * 60 * 1000;
const name = (at) => {
  const d = new Date(at);
  const p = (n) => String(n).padStart(2, '0');
  return `open-matte-${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.db`;
};

test('retention keeps 14 days of dailies and the first backup of each month for a year', () => {
  const start = Date.UTC(2025, 0, 1, 4); // 1 Jan 2025, then daily for 500 days (to 15 May 2026)
  const daily = Array.from({ length: 500 }, (_, i) => name(start + i * DAY));
  const extra = name(start + 499 * DAY + 3600e3); // a second, later backup on the last day
  const doomed = new Set(backupsToDelete([...daily, extra], { keepDays: 14, keepMonths: 12 }));
  const kept = [...daily, extra].filter((n) => !doomed.has(n)).sort();

  const lastDays = [...daily.slice(486, 499), extra]; // the newest of each of the last 14 days
  const firstOfMonths = [];
  for (let m = 0; m < 12; m++) {
    const d = new Date(Date.UTC(2025, 5 + m, 1, 4)); // June 2025 to May 2026
    firstOfMonths.push(name(d.getTime()));
  }
  assert.deepEqual(kept, [...new Set([...firstOfMonths, ...lastDays])].sort());
  assert.ok(doomed.has(daily[499]), 'the earlier of two backups on one day goes');
});

test('a backup runs daily after the set hour, and straight away when one is overdue', () => {
  const backupDir = tempDir();
  const b = createBackups({ db: openDb(':memory:'), dataDir: tempDir(), backupDir, hour: 4 });
  const at = (iso) => Date.parse(iso);
  assert.equal(b.due(at('2026-10-26T02:00:00Z')), true, 'no backups yet: due now');

  fs.writeFileSync(path.join(backupDir, name(at('2026-10-26T01:00:00Z'))), '');
  assert.equal(b.due(at('2026-10-26T03:59:00Z')), false, 'before the hour, with a recent backup');
  assert.equal(b.due(at('2026-10-26T04:00:00Z')), true, 'the daily one at the hour');

  fs.writeFileSync(path.join(backupDir, name(at('2026-10-26T04:01:00Z'))), '');
  assert.equal(b.due(at('2026-10-26T23:00:00Z')), false, 'already done today');
  assert.equal(b.due(at('2026-10-27T04:30:00Z')), true, 'next day');
  assert.equal(b.due(at('2026-10-27T05:02:00Z')), true, 'over 25 hours since the last: overdue');
});

test('a backup is a checked, complete copy that restores into a working server; artwork and logos are only ever added, so an older backup restores with its own logo', async () => {
  const mediaDir = tempDir();
  makeFilm(mediaDir, 'arrival');
  const srv = await startServer({ mediaDir });
  // A failed check mustn't leave the server running, or the run never ends.
  const logoBytes = pngImage(240, 80);
  let logo;
  let backupDir;
  let first;
  try {
    const admin = await adminBrowser(srv.base);
    await admin.post('/api/admin/scan');
    const filmId = (await admin.get('/api/admin/films')).data[0].id;
    await admin.post('/api/admin/tickets', { filmId, label: 'Sam', screeningLimit: 2 });

    // Some downloaded artwork to carry along, and a logo and tab icon uploaded in Settings.
    const { dataDir } = srv;
    fs.mkdirSync(path.join(dataDir, 'artwork', 'arrival'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'artwork', 'arrival', 'poster-0123456789ab.jpg'), 'jpeg');
    logo = await admin.upload('/api/admin/branding/logo', logoBytes);
    assert.equal(logo.status, 200, JSON.stringify(logo.data));
    const icon = await admin.upload('/api/admin/branding/icon', pngImage(64, 64));
    assert.equal(icon.status, 200, JSON.stringify(icon.data));
    const brandingFiles = [logo.data.logo.url, icon.data.icon.url].map((u) => path.basename(u)).sort();
    // Files still being written are left out (they start with a dot).
    fs.writeFileSync(path.join(dataDir, 'artwork', 'arrival', '.poster-ba9876543210.jpg.tmp'), 'half a jpeg');
    fs.writeFileSync(path.join(dataDir, 'branding', '.logo-0123456789abcdef.png.tmp'), 'half a png');

    const made = await admin.post('/api/admin/backups');
    assert.equal(made.status, 201, JSON.stringify(made.data));
    backupDir = made.data.dir;
    const file = path.join(backupDir, made.data.backup.name);
    assert.ok(made.data.backup.size > 0);
    assert.deepEqual(fs.readdirSync(path.join(backupDir, 'artwork', 'arrival')), ['poster-0123456789ab.jpg']);
    assert.deepEqual(fs.readdirSync(path.join(backupDir, 'branding')).sort(), brandingFiles);
    for (const f of brandingFiles) assert.deepEqual(fs.readFileSync(path.join(backupDir, 'branding', f)), fs.readFileSync(path.join(dataDir, 'branding', f)));
    assert.deepEqual(fs.readdirSync(dataDir).filter((f) => f.startsWith('.backup-')), [], 'no snapshot left behind');
    assert.equal((await admin.get('/api/admin/backups')).data.backups[0].name, made.data.backup.name);
    // Kept aside: backups are named to the second, so another one this second would take its place.
    first = path.join(tempDir(), 'first.db');
    fs.copyFileSync(file, first);

    // A new logo, and new artwork in place of the old, then another backup. Backups
    // only add to those folders: the first backup's logo and artwork are still there
    // beside the new ones, though the data folder has only the new.
    const newer = await admin.upload('/api/admin/branding/logo', pngImage(240, 80, [1, 2, 3]));
    assert.equal(newer.status, 200, JSON.stringify(newer.data));
    const newerFile = path.basename(newer.data.logo.url);
    assert.ok(!brandingFiles.includes(newerFile));
    assert.equal(fs.existsSync(path.join(dataDir, 'branding', path.basename(logo.data.logo.url))), false, 'the old logo is gone from the data folder');
    fs.rmSync(path.join(dataDir, 'artwork', 'arrival', 'poster-0123456789ab.jpg'));
    fs.writeFileSync(path.join(dataDir, 'artwork', 'arrival', 'poster-ba9876543210.jpg'), 'another jpeg');
    const again = await admin.post('/api/admin/backups');
    assert.equal(again.status, 201, JSON.stringify(again.data));
    assert.deepEqual(fs.readdirSync(path.join(backupDir, 'branding')).sort(), [...brandingFiles, newerFile].sort());
    assert.deepEqual(fs.readdirSync(path.join(backupDir, 'artwork', 'arrival')).sort(), ['poster-0123456789ab.jpg', 'poster-ba9876543210.jpg']);
  } finally {
    await srv.close();
  }

  // Restore the first backup: a fresh server on a copy of it, with the branding
  // folder put back beside it, has the films, the tickets and the first logo.
  const restoredDir = tempDir();
  fs.copyFileSync(first, path.join(restoredDir, 'open-matte.db'));
  fs.cpSync(path.join(backupDir, 'branding'), path.join(restoredDir, 'branding'), { recursive: true });
  const db = openDb(path.join(restoredDir, 'open-matte.db'));
  const app = createApp({ db: watchPlays(db), mediaDir, dataDir: restoredDir, backupOptions: { backupDir: null }, webDist: tempDir() });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const restored = await adminBrowser(`http://127.0.0.1:${server.address().port}`);
    const films = (await restored.get('/api/admin/films')).data;
    assert.deepEqual(films.map((f) => f.slug), ['arrival']);
    const tickets = (await restored.get('/api/admin/tickets')).data;
    assert.deepEqual(tickets.map((t) => [t.label, t.screeningLimit]), [['Sam', 2]]);
    const restoredLogo = (await restored.get('/api/admin/settings')).data.logo;
    assert.deepEqual(restoredLogo, logo.data.logo);
    const res = await fetch(`http://127.0.0.1:${server.address().port}${restoredLogo.url}`);
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), logoBytes);
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});

test('backups need the admin, and say clearly when they are turned off', async () => {
  const srv = await startServer({ mediaDir: tempDir(), backupOptions: { backupDir: null } });
  try {
    assert.equal((await browser(srv.base).post('/api/admin/backups')).status, 401);
    const admin = await adminBrowser(srv.base);
    assert.equal((await admin.get('/api/admin/backups')).data.enabled, false);
    const r = await admin.post('/api/admin/backups');
    assert.equal(r.status, 409);
    assert.match(r.data.error, /turned off/);
  } finally {
    await srv.close();
  }
});

test('two backups asked for at once share one run', async () => {
  const backupDir = tempDir();
  const b = createBackups({ db: openDb(':memory:'), dataDir: tempDir(), backupDir });
  const [x, y] = await Promise.all([b.run(), b.run()]);
  assert.equal(x.name, y.name);
  assert.equal(fs.readdirSync(backupDir).filter((f) => f.endsWith('.db')).length, 1);
});

test("a second backup on the same day, or that night's daily one, doesn't replace the one you made before an update", () => {
  const at = (iso) => Date.parse(iso);
  const dailies = ['2026-11-01T04:00:00Z', '2026-11-02T04:00:00Z', '2026-11-03T04:00:00Z'].map((d) => name(at(d)));
  const beforeUpdate = name(at('2026-11-03T15:30:12Z')); // Back up now, then update A
  const beforeHotfix = name(at('2026-11-03T16:05:00Z')); // Back up now, then hotfix B
  const all = [...dailies, beforeUpdate, beforeHotfix];
  const keep = { keepDays: 14, keepMonths: 12 };
  assert.deepEqual(backupsToDelete(all, { ...keep, now: at('2026-11-03T16:05:00Z') }), [], 'all made in the last three days');
  const nextDaily = name(at('2026-11-04T04:00:00Z'));
  assert.deepEqual(backupsToDelete([...all, nextDaily], { ...keep, now: at('2026-11-04T04:00:00Z') }), [], "the night's daily one");
  // Three days on, only the newest of that day is kept (and the month's first).
  const later = ['2026-11-05T04:00:00Z', '2026-11-06T04:00:00Z', '2026-11-07T04:00:00Z'].map((d) => name(at(d)));
  const doomed = backupsToDelete([...all, nextDaily, ...later], { ...keep, now: at('2026-11-07T04:00:00Z') });
  assert.deepEqual(doomed.sort(), [dailies[2], beforeUpdate].sort());

  // Fewer days kept than three: every backup of those days, and no more.
  const one = { keepDays: 1, keepMonths: 0 };
  assert.deepEqual(backupsToDelete([dailies[2], beforeUpdate, beforeHotfix], { ...one, now: at('2026-11-04T03:59:00Z') }), []);
  const a = backupsToDelete([dailies[2], beforeUpdate, beforeHotfix, nextDaily], { ...one, now: at('2026-11-04T16:05:00Z') });
  assert.deepEqual(a.sort(), [dailies[2], beforeUpdate, beforeHotfix].sort());
});

test('the newest backup is never deleted, whatever is kept', () => {
  const names = ['2026-10-01T04:00:00Z', '2026-11-02T04:00:00Z', '2026-11-03T04:00:00Z'].map((d) => name(Date.parse(d)));
  const doomed = backupsToDelete(names, { keepDays: 0, keepMonths: 0, now: Date.parse('2026-11-20T04:00:00Z') });
  assert.deepEqual(doomed.sort(), names.slice(0, 2).sort());
});

test('a backup deletes the old ones the rules no longer keep, and nothing else in the folder', async () => {
  const backupDir = tempDir();
  const now = Date.parse('2026-11-04T04:00:30Z');
  // A daily backup at 04:00 on each of the 40 days before.
  const daily = (i) => name(Date.parse('2026-11-03T04:00:00Z') - i * DAY);
  const old = Array.from({ length: 40 }, (_, i) => daily(i));
  for (const n of [...old, 'notes.txt', 'open-matte.db']) fs.writeFileSync(path.join(backupDir, n), 'old');
  const b = createBackups({ db: openDb(':memory:'), dataDir: tempDir(), backupDir, keepDays: 14, keepMonths: 12, now: () => now });
  const made = await b.run();
  assert.equal(made.name, 'open-matte-2026-11-04-040030.db');
  // Today's, the newest of each of the 13 days before, and the first of September and October.
  const kept = [made.name, ...Array.from({ length: 13 }, (_, i) => daily(i)), daily(39), name(Date.parse('2026-10-01T04:00:00Z'))];
  assert.equal(daily(39), 'open-matte-2026-09-25-040000.db');
  assert.deepEqual(fs.readdirSync(backupDir).sort(), [...kept, 'notes.txt', 'open-matte.db'].sort());
});

test('the daily backup starts a minute after the server, then runs once a day after the set hour', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let clock = Date.parse('2026-11-04T03:00:00Z');
  const b = createBackups({ db: openDb(':memory:'), dataDir: tempDir(), backupDir: tempDir(), hour: 4, now: () => clock });
  const files = () => b.list().map((x) => x.name);
  await b.start();
  t.mock.timers.tick(59 * 1000);
  assert.equal(b.status().running, false, 'not in the first minute');
  t.mock.timers.tick(1000);
  assert.equal(b.status().running, true, 'none yet: one a minute after the start');
  await b.run(); // waits for the one already running
  assert.deepEqual(files(), ['open-matte-2026-11-04-030000.db']);

  clock = Date.parse('2026-11-04T03:50:00Z');
  t.mock.timers.tick(15 * 60 * 1000);
  assert.equal(b.status().running, false, 'before the hour, with a backup from today');
  clock = Date.parse('2026-11-04T04:05:00Z');
  t.mock.timers.tick(15 * 60 * 1000);
  assert.equal(b.status().running, true, 'the daily one, at the first check after 04:00');
  await b.run();
  clock = Date.parse('2026-11-04T04:20:00Z');
  t.mock.timers.tick(15 * 60 * 1000);
  assert.equal(b.status().running, false, 'only once that day');
  assert.deepEqual(files(), ['open-matte-2026-11-04-040500.db', 'open-matte-2026-11-04-030000.db']);
});

test('starting clears what a backup stopped halfway left behind, and only that', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const dataDir = tempDir();
  const backupDir = tempDir();
  const write = (dir, names) => names.forEach((n) => fs.writeFileSync(path.join(dir, n), 'a copy of the database'));
  const keptData = ['open-matte.db', '.backup-notes', '.backup-1-1793678400000.db.txt'];
  const keptBackups = ['open-matte-2026-11-03-040012.db', '.open-matte-2026-11-03.db.partial'];
  write(dataDir, [...keptData, '.backup-1-1793678400000.db', '.backup-4242-1793678400000.db']);
  write(backupDir, [...keptBackups, '.open-matte-2026-11-04-040003.db.partial']);
  const b = createBackups({ db: openDb(':memory:'), dataDir, backupDir });
  await b.start();
  assert.deepEqual(fs.readdirSync(dataDir).sort(), keptData.sort());
  assert.deepEqual(fs.readdirSync(backupDir).sort(), keptBackups.sort());
});

// docs/deploying.md: trying a restore on your computer copies the same folders from
// the backups as restoring on the server does, so posters and the logo show.
const DEPLOYING = new URL('../docs/deploying.md', import.meta.url);
test('the local restore test in the docs copies what the server restore copies', { skip: !fs.existsSync(DEPLOYING) && 'docs/ is not here (the server image has none)' }, () => {
  const doc = fs.readFileSync(DEPLOYING, 'utf8');
  const blocks = [...doc.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  const server = blocks.find((b) => b.includes('cp /srv/open-matte/backups/') && b.includes('docker compose start app'));
  const local = blocks.find((b) => b.includes('~/restore-test/data') && b.includes('npm run dev'));
  const folders = [...server.matchAll(/^cp -r \/srv\/open-matte\/backups\/(\w+)\/\. \/srv\/open-matte\/data\/\1$/gm)].map((m) => m[1]);
  assert.deepEqual(folders, ['artwork', 'branding']);
  for (const folder of folders) assert.match(local, new RegExp(`^cp -r ~/open-matte-backups/${folder} ~/restore-test/data/$`, 'm'), folder);
  assert.ok(local.indexOf('cp -r') < local.indexOf('npm run dev'), 'copied before the server starts');
  // Fetched from the server first: the copy made before an update is the .db alone.
  const fetch = local.split('\n').find((line) => line.startsWith('scp -r '));
  assert.ok(fetch && local.indexOf(fetch) < local.indexOf('cp -r'), 'the folders are fetched before they are copied');
  const fetched = fetch.split(' ').slice(2, -1);
  assert.deepEqual(fetched, folders.map((f) => `my-server:/srv/open-matte/backups/${f}`));
  assert.equal(fetch.split(' ').at(-1), '~/open-matte-backups/');
});
