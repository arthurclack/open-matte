// Daily database backups: what's kept, when they run, and that one restores.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { adminBrowser, browser, makeFilm, startServer, tempDir } from './helpers.js';

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

test('a backup is a checked, complete copy, and restores into a working server', async () => {
  const mediaDir = tempDir();
  makeFilm(mediaDir, 'arrival');
  const srv = await startServer({ mediaDir });
  const admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  const filmId = (await admin.get('/api/admin/films')).data[0].id;
  await admin.post('/api/admin/tickets', { filmId, label: 'Sam', screeningLimit: 2 });

  // Some downloaded artwork to carry along.
  const dataDir = path.dirname(srv.app.locals.backups.status().dir);
  fs.mkdirSync(path.join(dataDir, 'artwork', 'arrival'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'artwork', 'arrival', 'poster-0123456789ab.jpg'), 'jpeg');

  const made = await admin.post('/api/admin/backups');
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const backupDir = made.data.dir;
  const file = path.join(backupDir, made.data.backup.name);
  assert.ok(made.data.backup.size > 0);
  assert.ok(fs.existsSync(path.join(backupDir, 'artwork', 'arrival', 'poster-0123456789ab.jpg')));
  assert.deepEqual(fs.readdirSync(dataDir).filter((f) => f.startsWith('.backup-')), [], 'no snapshot left behind');
  assert.equal((await admin.get('/api/admin/backups')).data.backups[0].name, made.data.backup.name);
  await srv.close();

  // Restore: a fresh server on a copy of the backup has the films and tickets.
  const restoredDir = tempDir();
  fs.copyFileSync(file, path.join(restoredDir, 'open-matte.db'));
  const db = openDb(path.join(restoredDir, 'open-matte.db'));
  const app = createApp({ db, mediaDir, dataDir: restoredDir, backupOptions: { backupDir: null }, webDist: tempDir() });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const restored = await adminBrowser(`http://127.0.0.1:${server.address().port}`);
    const films = (await restored.get('/api/admin/films')).data;
    assert.deepEqual(films.map((f) => f.slug), ['arrival']);
    const tickets = (await restored.get('/api/admin/tickets')).data;
    assert.deepEqual(tickets.map((t) => [t.label, t.screeningLimit]), [['Sam', 2]]);
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
