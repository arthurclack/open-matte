// A films' folder on network storage that stops answering stalls playback, not
// the site. Node reads files on a small pool of threads, and a file operation on
// storage that doesn't answer holds its thread until it does. Here a FIFO with
// nothing writing to it stands in for such a file: opening it waits, holding a
// thread, until something writes to it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import express from 'express';

const { adminBrowser, browser, makeFilm, startServer, tempDir } = await import('./helpers.js');
const { createShare, shareLimits } = await import('../server/routes/media.js');

// Node's default unless the run sets it (the Docker image does).
const POOL = Number(process.env.UV_THREADPOOL_SIZE) || 4;
const TIMEOUT_MS = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A request that gives up after `ms`: { status, ms } or { status: null } for no answer.
async function timed(url, { headers, ms = 3000 } = {}) {
  const t = Date.now();
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
    await r.arrayBuffer();
    return { status: r.status, ms: Date.now() - t };
  } catch {
    return { status: null, ms: Date.now() - t };
  }
}

describe('a share that stops answering', { skip: process.platform === 'win32' && 'no FIFOs' }, () => {
  const mediaDir = tempDir();
  const webDist = tempDir();
  const fifos = [];
  let srv;
  let admin;
  let cookie;

  // Something writes to each FIFO at last: the storage answers again. Opening
  // without waiting fails at once for a FIFO nobody is reading.
  const answerAgain = () => {
    for (const f of fifos) {
      try {
        fs.closeSync(fs.openSync(f, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK));
      } catch {
        // Nobody was waiting on this one.
      }
    }
  };

  before(async () => {
    makeFilm(mediaDir, 'arrival');
    fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>app</title>');
    fs.mkdirSync(path.join(webDist, 'assets'));
    fs.writeFileSync(path.join(webDist, 'assets', 'app.js'), 'console.log(1)');
    // One player here stands in for many viewers, so it may hold every place.
    srv = await startServer({ mediaDir, webDist, mediaOptions: { timeoutMs: TIMEOUT_MS, perClient: POOL } });
    admin = await adminBrowser(srv.base);
    await admin.post('/api/admin/scan');
    const film = (await admin.get('/api/admin/films')).data[0];
    await admin.patch(`/api/admin/films/${film.id}`, { published: true });
    const ticket = (await admin.post('/api/admin/tickets', { filmId: film.id })).data[0];
    const viewer = browser(srv.base);
    await viewer.post('/api/tickets/open', { code: ticket.code });
    assert.equal((await viewer.post('/api/films/arrival/screenings')).status, 200);
    cookie = [...viewer.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    // As many files that don't answer as Node has threads.
    for (let i = 0; i < POOL; i++) {
      const f = path.join(mediaDir, 'arrival', 'hls', 'v_h264_720', `stalled_${i}.m4s`);
      execFileSync('mkfifo', [f]);
      fifos.push(f);
    }
  });
  after(async () => {
    answerAgain();
    await srv?.close();
  });

  test('players get a 503 within the time allowed, and the pages, scripts and API still answer', async () => {
    const media = (file) => `${srv.base}/media/arrival/hls/v_h264_720/${file}`;
    assert.equal((await timed(media('seg_0.m4s'), { headers: { cookie } })).status, 200, 'before');

    // A player asks for every one of them at once.
    const stalled = await Promise.all(fifos.map((f) => timed(media(path.basename(f)), { headers: { cookie }, ms: 5000 })));
    for (const r of stalled) {
      assert.equal(r.status, 503, JSON.stringify(stalled));
      assert.ok(r.ms < TIMEOUT_MS + 1500, `answered after ${r.ms} ms`);
    }

    // The rest of the site still has threads to read files with.
    for (const url of ['/assets/app.js', '/', '/admin', '/api/site']) assert.equal((await timed(srv.base + url)).status, 200, url);
    const booth = await admin.get('/api/admin/booth');
    assert.equal(booth.status, 200);
    assert.equal(booth.data.server.disk.data.error, null, 'the data folder answers');
    // While the stalled ones still hold the films' places, another segment waits its time, then gets a 503 too.
    assert.equal((await timed(media('seg_1.m4s'), { headers: { cookie } })).status, 503);
    // The booth says what happened, as for any media request that failed.
    const reasons = booth.data.attention.refusals.recent.filter((r) => r.status === 503).map((r) => r.reason);
    assert.ok(reasons.some((r) => /no answer from the films' folder/.test(r)), JSON.stringify(reasons));
    assert.ok(reasons.some((r) => /busy with other requests/.test(r)), JSON.stringify(reasons));

    // The storage answers again: so does playback.
    answerAgain();
    let r;
    for (let i = 0; i < 30; i++) {
      r = await timed(media('seg_2.m4s'), { headers: { cookie } });
      if (r.status === 200) break;
      await sleep(100);
    }
    assert.equal(r.status, 200, 'playback is back');
  });
});

describe('the places on the films’ share (createShare)', () => {
  let server;
  let base;
  let share;
  let answer;
  let stuck;
  const problems = [];
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'seg.m4s'), 'segment');

  before(async () => {
    share = createShare({ inFlight: 1, timeoutMs: 200 });
    stuck = new Promise((resolve) => (answer = resolve));
    const app = express();
    const failed = (p) => problems.push(p);
    // Finding the file never answers, until the test says so.
    app.get('/stuck', (req, res) => share.send(res, () => stuck, { failed }));
    app.get('/file', (req, res) => share.send(res, async () => ({ root: dir, file: 'seg.m4s' }), { headers: { 'Content-Type': 'video/iso.segment' }, failed }));
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((r) => server.close(r)));

  test('more requests than places wait their turn, so a burst from healthy storage is all served', async () => {
    const all = await Promise.all(Array.from({ length: 12 }, () => fetch(`${base}/file`).then(async (r) => [r.status, await r.text()])));
    assert.deepEqual(all, Array.from({ length: 12 }, () => [200, 'segment']));
  });

  test('a request the share never answers gets a 503, and keeps its place until the share answers', async () => {
    const first = await timed(`${base}/stuck`);
    assert.equal(first.status, 503);
    assert.ok(first.ms >= 190 && first.ms < 1500, `${first.ms} ms`);
    assert.match(problems.at(-1).reason, /no answer from the films' folder within 0.2 seconds/);
    // Its thread would still be taken: the next request waits its time, then gets a 503 too.
    const second = await timed(`${base}/file`);
    assert.equal(second.status, 503);
    assert.match(problems.at(-1).reason, /waited 0.2 seconds/);
    // The share answers at last, and the place is free again.
    answer({ status: 404 });
    await sleep(10);
    const third = await fetch(`${base}/file`);
    assert.equal(third.status, 200);
    assert.equal(await third.text(), 'segment');
  });
});

// A viewer who asks for big files and then reads slowly, or not at all, keeps a
// place on the share for as long as its connection stays open. However many it
// opens, it takes no more than its own share of them, and one that stops
// reading loses its connection, and its place.
describe('one browser, or one address, can’t take every place on the films’ share', () => {
  // Bigger than any socket's buffers, so a reader that stops keeps the file
  // open. Sparse, so it takes no room on the disk.
  const BIG = 64 * 1024 * 1024;
  const servers = [];
  const sockets = [];
  after(async () => {
    for (const s of sockets) s.destroy();
    await Promise.all(servers.map((s) => s.close()));
  });

  // A server with one published film whose poster and one segment are big, and
  // `viewers` browsers, each holding a screening of its own ticket. Also the
  // address of the poster in the first ticket link's preview.
  async function cinema(mediaOptions, viewers = 2) {
    const mediaDir = tempDir();
    const webDist = tempDir();
    makeFilm(mediaDir, 'arrival');
    for (const f of ['hls/v_h264_720/big.m4s', 'poster.jpg']) {
      const file = path.join(mediaDir, 'arrival', f);
      fs.writeFileSync(file, '');
      fs.truncateSync(file, BIG);
    }
    fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><html><head><title>app</title></head><body></body></html>');
    const srv = await startServer({ mediaDir, webDist, mediaOptions });
    servers.push(srv);
    const admin = await adminBrowser(srv.base);
    await admin.post('/api/admin/scan');
    const film = (await admin.get('/api/admin/films')).data[0];
    await admin.patch(`/api/admin/films/${film.id}`, { published: true });
    const cookies = [];
    let poster;
    for (let i = 0; i < viewers; i++) {
      const ticket = (await admin.post('/api/admin/tickets', { filmId: film.id, screeningLimit: null })).data[0];
      if (i === 0) poster = /property="og:image" content="[^"]*?(\/poster\/[^"]+)"/.exec(await (await fetch(`${srv.base}/t/${ticket.code}`)).text())[1];
      const viewer = browser(srv.base);
      await viewer.post('/api/tickets/open', { code: ticket.code });
      assert.equal((await viewer.post('/api/films/arrival/screenings')).status, 200);
      cookies.push([...viewer.jar].map(([k, v]) => `${k}=${v}`).join('; '));
    }
    return { srv, cookies, poster };
  }

  // Asks for a file and reads only the start of the answer: its status line,
  // or null if the server cuts the connection first. The socket stays open.
  // `from` is the visitor's address, as Caddy would pass it on.
  function stall(base, file, cookie, from) {
    return new Promise((resolve) => {
      const socket = net.connect(new URL(base).port, '127.0.0.1', () => {
        socket.write(`GET ${file} HTTP/1.1\r\nHost: 127.0.0.1\r\n${cookie ? `Cookie: ${cookie}\r\n` : ''}${from ? `X-Forwarded-For: ${from}\r\n` : ''}\r\n`);
      });
      sockets.push(socket);
      socket.once('data', (chunk) => {
        socket.pause();
        resolve({ socket, status: Number(chunk.toString('latin1').split(' ')[1]) });
      });
      socket.once('error', () => resolve({ socket, status: null }));
    });
  }
  // How many of them got a 200 and are being sent the file.
  const sending = (stalled) => stalled.filter((s) => s.status === 200).length;

  test('a browser that opens many slow downloads leaves the other viewers their places', async () => {
    const { srv, cookies } = await cinema({ inFlight: 4, artwork: 1, perClient: 2, timeoutMs: 1000, idleMs: 60_000 });
    const [greedy, other] = cookies;
    // Started together: two are sent, and the others wait for one of those to finish.
    const stalled = Promise.all(Array.from({ length: 6 }, () => stall(srv.base, '/media/arrival/hls/v_h264_720/big.m4s', greedy)));
    await sleep(200);
    const t = Date.now();
    const r = await timed(`${srv.base}/media/arrival/hls/v_h264_720/seg_0.m4s`, { headers: { cookie: other } });
    assert.equal(r.status, 200, 'another viewer still plays');
    assert.ok(Date.now() - t < 900, 'without waiting for a place');
    const done = await stalled;
    assert.equal(sending(done), 2, JSON.stringify(done.map((s) => s.status)));
    // The rest waited their time behind the browser's own, and got a 503.
    assert.deepEqual(done.map((s) => s.status).sort(), [200, 200, 503, 503, 503, 503]);
  });

  test('posters, which anyone can ask for by a link preview’s address, never take the players’ places', async () => {
    const { srv, cookies, poster } = await cinema({ inFlight: 2, artwork: 1, perClient: 4, timeoutMs: 1000, idleMs: 60_000 }, 1);
    // No session: a stranger with the preview's poster address.
    const stalled = Promise.all(Array.from({ length: 4 }, () => stall(srv.base, poster)));
    await sleep(200);
    const r = await timed(`${srv.base}/media/arrival/hls/v_h264_720/seg_0.m4s`, { headers: { cookie: cookies[0] } });
    assert.equal(r.status, 200, 'the viewer still plays');
    assert.equal(sending(await stalled), 1, 'one poster at a time');
  });

  test('one browser’s posters take all but one of the artwork’s places at most, and leave its player one of its own', async () => {
    // As in the Docker image: 16 places, 4 of them for artwork, 4 for one browser.
    const { srv, cookies } = await cinema({ inFlight: 16, artwork: 4, perClient: 4, timeoutMs: 3000, idleMs: 60_000 });
    const [greedy, other] = cookies;
    const poster = '/media/arrival/poster.jpg';
    // Five big posters at once, read slowly: three are sent, two wait for those.
    const stalled = Promise.all(Array.from({ length: 5 }, () => stall(srv.base, poster, greedy)));
    await sleep(200);
    // The posters waiting behind the browser's other posters hold none of its places,
    // so they hold three of its four, waiting or not, and its player still plays.
    let t = Date.now();
    const own = await timed(`${srv.base}/media/arrival/hls/v_h264_720/seg_0.m4s`, { headers: { cookie: greedy } });
    assert.equal(own.status, 200, 'the same browser’s segment');
    assert.ok(Date.now() - t < 1500, 'without waiting for a place');
    // And another viewer's poster still has places of its own.
    t = Date.now();
    const theirs = await timed(srv.base + poster, { headers: { cookie: other } });
    assert.equal(theirs.status, 200, 'another viewer’s poster');
    assert.ok(Date.now() - t < 1500, 'without waiting for a place');
    const done = await stalled;
    assert.deepEqual(done.map((s) => s.status).sort(), [200, 200, 200, 503, 503]);
    const rows = srv.app.locals.refusals.view().recent.filter((r) => r.status === 503).map((r) => [r.reason, r.count]);
    assert.deepEqual(rows, [['waited 3 seconds behind 3 other posters and backdrops from the same browser', 2]]);
  });

  test('so does one address asking for a link preview’s poster', async () => {
    const { srv, poster } = await cinema({ inFlight: 16, artwork: 4, perClient: 4, timeoutMs: 1000, idleMs: 60_000 }, 1);
    const stalled = Promise.all(Array.from({ length: 4 }, () => stall(srv.base, poster, null, '203.0.113.50')));
    await sleep(200);
    const t = Date.now();
    const r = await timed(srv.base + poster, { headers: { 'x-forwarded-for': '203.0.113.51' } });
    assert.equal(r.status, 200, 'someone else’s preview');
    assert.ok(Date.now() - t < 900, 'without waiting for a place');
    assert.equal(sending(await stalled), 3, 'three of the four at a time');
  });

  test('a download nobody reads is cut off, and its place goes to the next viewer', async () => {
    const { srv, cookies } = await cinema({ inFlight: 1, artwork: 1, perClient: 1, timeoutMs: 3000, idleMs: 300 });
    const [stopped, other] = cookies;
    const held = await stall(srv.base, '/media/arrival/hls/v_h264_720/big.m4s', stopped);
    assert.equal(held.status, 200);
    // The only place is taken: this waits, until the reader that stopped loses it.
    const r = await timed(`${srv.base}/media/arrival/hls/v_h264_720/seg_0.m4s`, { headers: { cookie: other }, ms: 5000 });
    assert.equal(r.status, 200, 'served once the place is free');
    assert.ok(r.ms < 2500, `after ${r.ms} ms`);
    // The server closed that connection: reading on, it ends before the file does.
    let bytes = 0;
    held.socket.on('data', (c) => (bytes += c.length));
    held.socket.resume();
    await new Promise((resolve) => held.socket.once('close', resolve));
    assert.ok(bytes < BIG, `${bytes} bytes`);
  });
});

test('the Docker image gives Node threads enough that the films take half at most', { skip: !fs.existsSync(new URL('../Dockerfile', import.meta.url)) && 'no Dockerfile here (the server image has none)' }, () => {
  const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  const pool = Number(/^\s*UV_THREADPOOL_SIZE=(\d+)/m.exec(dockerfile)?.[1]);
  assert.ok(pool >= 16, `UV_THREADPOOL_SIZE=${pool}`);
  const { inFlight, artwork, perClient } = shareLimits(pool);
  assert.ok(inFlight >= 8, 'room for several viewers at once');
  assert.ok(inFlight <= pool / 2, 'half the threads left for the rest of the site');
  assert.ok(perClient >= 3, 'a player gets its video, audio and subtitles at once');
  assert.ok(perClient * 2 <= inFlight, 'one browser takes a few at most');
  assert.ok(artwork <= inFlight / 4, 'posters leave the players most of them');
  assert.ok(artwork >= 4, 'one browser’s posters, all but one of them at most, load three at a time and leave the others one');
  // And with Node's default of four, or fewer: one browser still leaves one for the others.
  assert.deepEqual(shareLimits(4), { ...shareLimits(4), inFlight: 2, artwork: 1, perClient: 1 });
  assert.equal(shareLimits(1).inFlight, 1);
});
