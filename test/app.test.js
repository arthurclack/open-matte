// Serving the web app: every page path gets index.html, API and media paths don't.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { tempDir } from './helpers.js';

const { openDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { config } = await import('../server/config.js');

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

test("page paths get the app, titled with the cinema's name", async () => {
  // This app has no data folder of its own: serving pages mustn't make one in ./data.
  const branding = path.join(config.dataDir, 'branding');
  const existed = fs.existsSync(branding);
  for (const p of ['/', '/index.html', '/arrival', '/t/abc123', '/admin', '/admin/tickets/4']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
    const html = await res.text();
    assert.match(html, /<title>Open Matte<\/title>/, p);
    assert.doesNotMatch(html, /<title>app<\/title>/, p);
    // The stub has no </head>: the cinema's tags follow the title, in whatever order.
    const tags = html.slice(html.indexOf('<title>Open Matte</title>') + '<title>Open Matte</title>'.length);
    assert.match(tags, /^\s*<(?:meta|link|style|script)\b/, p);
    assert.match(tags, /<meta name="theme-color" content="#0d0c0f"/, p);
    assert.match(tags, /<script\b(?=[^>]*\bid="site-data")(?=[^>]*\btype="application\/json")[^>]*>/, p);
  }
  assert.equal(fs.existsSync(branding), existed);
});

test('assets are served and cached for good', async () => {
  const res = await fetch(`${base}/assets/app.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /immutable/);
});

test("a file the build doesn't have is a 404, not the app", async () => {
  // A part of the app from before a deploy: the page must be told it's gone, not be
  // handed index.html to run as a script.
  for (const p of ['/assets/Player-OLDHASH.js', '/assets/index-OLDHASH.css', '/assets/nope/deep.js']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(res.headers.get('content-type') ?? '', /html/, p);
    assert.doesNotMatch(await res.text(), /<title>/, p);
  }
});

test('nothing the API answers is kept in a cache', async () => {
  // Answers, refusals and errors alike: on a shared computer, the next person mustn't
  // read the last one's from the browser's cache.
  const answers = [
    await fetch(`${base}/api/me`),
    await fetch(`${base}/api/admin/session`),
    await fetch(`${base}/api/nope`),
    await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"no"}' }),
    await fetch(`${base}/api/signout`, { method: 'POST', body: 'not json' }),
  ];
  assert.deepEqual(
    answers.map((r) => r.status),
    [200, 401, 404, 401, 415],
  );
  for (const r of answers) assert.equal(r.headers.get('cache-control'), 'no-store', r.url);
  // Pages are still revalidated rather than never stored, so Back stays quick.
  assert.equal((await fetch(`${base}/`)).headers.get('cache-control'), 'no-cache');
});

test('unknown API and media paths are not the app', async () => {
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  // No such film is refused as any film you may not have (boundaries.test.js).
  const media = await fetch(`${base}/media/nope/master.m3u8`);
  assert.equal(media.status, 403);
  assert.equal(await media.text(), '');
  assert.equal((await fetch(`${base}/media/nope/notes.txt`)).status, 404);
});
