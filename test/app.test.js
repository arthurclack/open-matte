// Serving the web app: every page path gets index.html, API and media paths don't.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { tempDir } from './helpers.js';

const { openDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

let server;
let base;

before(async () => {
  const webDist = tempDir();
  fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>app</title>');
  fs.mkdirSync(path.join(webDist, 'assets'));
  fs.writeFileSync(path.join(webDist, 'assets', 'app.js'), 'console.log(1)');
  const app = createApp({ db: openDb(':memory:'), mediaDir: tempDir(), webDist });
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

test('page paths get the app', async () => {
  for (const p of ['/', '/arrival', '/t/abc123', '/admin', '/admin/tickets/4']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
    assert.match(await res.text(), /<title>app<\/title>/, p);
  }
});

test('assets are served and cached for good', async () => {
  const res = await fetch(`${base}/assets/app.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /immutable/);
});

test('unknown API and media paths are not the app', async () => {
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  assert.equal((await fetch(`${base}/media/nope/master.m3u8`)).status, 404);
});
