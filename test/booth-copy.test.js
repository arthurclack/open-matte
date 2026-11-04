// The projection booth's off-server copy: milestone 3, slice 4. Written from
// docs/history/milestone-3.md (slice 4), not from the implementation. With
// BACKUP_COPY_DIR set (an environment setting, read when the server starts, so this
// file has a process of its own), the booth reports the newest open-matte-*.db file
// there and when it was written, as "Copy seen at", and never writes to the folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-matte-copy-'));
process.env.BACKUP_COPY_DIR = copyDir;
const { adminBrowser, startServer, tempDir } = await import('./helpers.js');

const DAY = 24 * 60 * 60 * 1000;
// Whole seconds, so a file's time is the same in every unit it might be reported in.
const now = Math.floor(Date.now() / 1000) * 1000;
const NEWEST = 'open-matte-2026-11-02-040312.db';
const files = {
  'open-matte-2026-10-30-040301.db': now - 4 * DAY,
  [NEWEST]: now - DAY,
  'open-matte-2026-11-01-040255.db': now - 2 * DAY,
  // Newer, but not backups.
  'notes.db': now,
  '.open-matte-2026-11-03-040000.db.partial': now,
};

function* objects(v) {
  if (!v || typeof v !== 'object') return;
  if (!Array.isArray(v)) yield v;
  for (const x of Object.values(v)) yield* objects(x);
}
const leaves = (v) => (v && typeof v === 'object' ? Object.values(v).flatMap(leaves) : [v]);
const listing = () => fs.readdirSync(copyDir).sort().map((name) => [name, fs.statSync(path.join(copyDir, name)).mtimeMs]);

let srv;
let admin;
before(async () => {
  for (const [name, at] of Object.entries(files)) {
    fs.writeFileSync(path.join(copyDir, name), 'a copy');
    fs.utimesSync(path.join(copyDir, name), new Date(at), new Date(at));
  }
  fs.mkdirSync(path.join(copyDir, 'artwork'));
  srv = await startServer({ mediaDir: tempDir() });
  admin = await adminBrowser(srv.base);
});
after(async () => {
  await srv.close();
  // Made before helpers.js (and its temp root) loads, so it's removed here.
  fs.rmSync(copyDir, { recursive: true, force: true });
});

test('the newest open-matte-*.db file in BACKUP_COPY_DIR, and its time', async () => {
  const before1 = listing();
  const r = await admin.get('/api/admin/booth');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const copy = [...objects(r.data.server)].find((o) => 'configured' in o);
  assert.ok(copy, `the off-server copy in ${JSON.stringify(r.data.server)}`);
  assert.equal(copy.configured, true);
  const values = leaves(copy);
  assert.ok(values.includes(NEWEST), JSON.stringify(copy));
  const at = files[NEWEST];
  assert.ok(values.includes(at) || values.includes(new Date(at).toISOString()), `its time, ${at}, in ${JSON.stringify(copy)}`);
  for (const name of Object.keys(files).filter((n) => n !== NEWEST)) assert.ok(!values.includes(name), `not ${name}`);
  assert.deepEqual(listing(), before1, 'the folder is only read');
});

test('a newer copy is seen on the next read', async () => {
  const name = 'open-matte-2026-11-03-040309.db';
  fs.writeFileSync(path.join(copyDir, name), 'a newer copy');
  fs.utimesSync(path.join(copyDir, name), new Date(now), new Date(now));
  const copy = [...objects((await admin.get('/api/admin/booth')).data.server)].find((o) => 'configured' in o);
  assert.ok(leaves(copy).includes(name), JSON.stringify(copy));
});
