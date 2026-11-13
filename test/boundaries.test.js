// Trust boundaries: what a valid viewer, a forged request or a file in the
// media folder can make the server do beyond what its own ticket allows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { after, before, test } from 'node:test';

// Cookies get Secure from the request, as they do behind Caddy.
process.env.COOKIE_SECURE = 'auto';
const { addFilm, adminBrowser, browser, enroll, makeFilm, setupLink, signIn, startServer, tempDir } = await import('./helpers.js');
const { softAuthenticator } = await import('./softauth.js');
const { sha256 } = await import('../server/sessions.js');

let srv;
let admin;
const films = {};
const mediaDir = tempDir();

before(async () => {
  makeFilm(mediaDir, 'arrival');
  makeFilm(mediaDir, 'paris-texas', { title: 'Paris, Texas' });
  makeFilm(mediaDir, 'stalker', { title: 'Stalker' });
  makeFilm(mediaDir, 'solaris', { title: 'Solaris' });
  makeFilm(mediaDir, 'heat', { title: 'Heat' });
  // Imported, never published.
  makeFilm(mediaDir, 'secret', { title: 'Secret' });
  srv = await startServer({ mediaDir });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  for (const f of (await admin.get('/api/admin/films')).data) {
    films[f.slug] = f.id;
    if (f.slug !== 'secret') await admin.patch(`/api/admin/films/${f.id}`, { published: true });
  }
});
after(() => srv.close());

async function newTicket(slug, fields = {}) {
  const r = await admin.post('/api/admin/tickets', { filmId: films[slug], ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data[0];
}

// A film of its own, published, for a test that presses Play. Returns its slug.
async function ownFilm(slug) {
  films[slug] = (await addFilm(admin, mediaDir, slug)).id;
  return slug;
}

async function holder(ticket) {
  const b = browser(srv.base);
  assert.equal((await b.post('/api/tickets/open', { code: ticket.code })).status, 200);
  return b;
}

async function watching(slug, fields) {
  const ticket = await newTicket(slug, fields);
  const b = await holder(ticket);
  const play = await b.post(`/api/films/${slug}/screenings`);
  assert.equal(play.status, 200, JSON.stringify(play.data));
  return { b, ticket, screeningId: play.data.screeningId };
}

// A request with the browser's cookies and headers of our choosing.
function raw(b, url, { headers = {}, ...init } = {}) {
  const cookie = [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  return fetch(srv.base + url, { ...init, headers: { ...(cookie && { cookie }), ...headers } });
}

// A request with the path exactly as written. fetch() would tidy dot segments
// away first, %2e%2e included, so they would never reach the server.
function rawPath(b, rawUrl) {
  const cookie = [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const { hostname, port } = new URL(srv.base);
  return new Promise((resolve, reject) => {
    http
      .get({ hostname, port, path: rawUrl, headers: cookie ? { cookie } : {} }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      })
      .on('error', reject);
  });
}

// The whole answer to a request, as it comes off the socket, but for its Date
// header: the one line that changes with the clock. To compare two answers byte
// for byte. `cookie` is a browser's cookies (or a made-up one), `from` the
// visitor's address as Caddy would pass it on.
function wire(url, { method = 'GET', body, cookie, from } = {}) {
  const { port } = new URL(srv.base);
  const head = [`${method} ${url} HTTP/1.1`, 'Host: 127.0.0.1', 'Connection: close'];
  if (cookie) head.push(`Cookie: ${cookie}`);
  if (from) head.push(`X-Forwarded-For: ${from}`);
  if (body !== undefined) head.push('Content-Type: application/json', `Content-Length: ${Buffer.byteLength(body)}`);
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.connect(port, '127.0.0.1', () => socket.write(`${head.join('\r\n')}\r\n\r\n${body ?? ''}`));
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('latin1').replace(/^Date: [^\r]*\r\n/im, '')));
    socket.on('error', reject);
  });
}
const cookieOf = (b) => [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ');
// A browser holding a ticket for Arrival and nothing else. It opens the link from
// an address of its own, so the other tests keep 127.0.0.1's tries at opening links.
let arrivalOnly;
async function arrivalHolder() {
  if (arrivalOnly) return arrivalOnly;
  const b = browser(srv.base);
  const r = await b.send('POST', '/api/tickets/open', { code: (await newTicket('arrival')).code }, { headers: { 'x-forwarded-for': '198.51.100.40' } });
  assert.equal(r.status, 200);
  return (arrivalOnly = b);
}

const master = (slug) => `/media/${slug}/hls/master.m3u8`;
const status = async (b, url) => (await b.get(url)).status;
const refusals = async () => (await admin.get('/api/admin/booth')).data.attention.refusals;
// One browser playing Heat, for the tests that need a screening of some film.
let heatViewer;
const watchingHeat = async () => (heatViewer ??= (await watching('heat')).b);

test('a ticket and screening for one film unlock nothing of another', async () => {
  const { b } = await watching('arrival');
  assert.equal(await status(b, master('arrival')), 200);
  for (const url of [master('paris-texas'), '/media/paris-texas/hls/v_h264_720/seg_0.m4s', '/media/paris-texas/subtitles/en.vtt', '/media/paris-texas/poster.jpg']) {
    assert.equal(await status(b, url), 403, url);
  }
  assert.equal(await status(b, '/api/films/paris-texas'), 404);
  assert.equal((await b.post('/api/films/paris-texas/screenings')).status, 404);
  assert.deepEqual((await b.get('/api/me')).data.tickets.map((t) => t.film.slug), ['arrival']);
});

test("another ticket's screening id is refused and left alone", async () => {
  const slug = await ownFilm('mine');
  const mine = await watching(slug);
  const theirs = await watching('paris-texas');
  await theirs.b.post(`/api/screenings/${theirs.screeningId}/heartbeat`, { position: 30 });
  assert.equal((await mine.b.post(`/api/screenings/${theirs.screeningId}/heartbeat`, { position: 99 })).status, 404);
  assert.equal(srv.db.prepare('SELECT position_seconds FROM screenings WHERE id = ?').get(theirs.screeningId).position_seconds, 30);
});

test('a viewer session is not an admin session, even in the admin cookie', async () => {
  const slug = await ownFilm('not-admin');
  const { b, screeningId } = await watching(slug);
  assert.equal(await status(b, '/api/admin/films'), 401);
  assert.equal((await b.post(`/api/admin/screenings/${screeningId}/void`)).status, 401);
  const res = await fetch(`${srv.base}/api/admin/films`, { headers: { cookie: `om_admin=${b.jar.get('om_session')}` } });
  assert.equal(res.status, 401);
});

// The main race of version 2: one tape per film, and the check and the take are one
// step. (test/loans-race.test.js overlaps two writers for real, from two threads.)
test('two links pressed at once: one takes the tape, the other is told it is out', async () => {
  const slug = await ownFilm('two-presses');
  const loans = () => srv.db.prepare('SELECT * FROM loans WHERE film_id = ?').all(films[slug]);
  const [first, second] = [await newTicket(slug), await newTicket(slug)];
  const [laptop, tv] = await Promise.all([holder(first), holder(second)]);
  const presses = await Promise.all([laptop, tv].map((b) => b.post(`/api/films/${slug}/screenings`)));
  assert.deepEqual(presses.map((r) => r.status).sort(), [200, 409]);
  assert.deepEqual(presses.find((r) => r.status === 409).data, { error: 'out' });
  assert.equal(loans().length, 1);
  const won = presses.find((r) => r.status === 200).data;
  assert.deepEqual([loans()[0].screening_id, loans()[0].ended_at], [won.screeningId, null]);

  // A double click in one browser resumes rather than taking anything more.
  const winner = presses[0].status === 200 ? laptop : tv;
  const twice = await Promise.all([1, 2].map(() => winner.post(`/api/films/${slug}/screenings`)));
  assert.deepEqual(twice.map((r) => [r.data.screeningId, r.data.took]), [[won.screeningId, false], [won.screeningId, false]]);
  assert.equal(loans().length, 1);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM screenings WHERE film_id = ?').get(films[slug]).n, 1);
});

// 1.x: of two browsers on one link, the loser was told "playing elsewhere" and could
// take over later. The borrower is the browser that pressed Play first; the other
// sees the tape out, like anyone (docs/version-2.md, question 12).
test('two browsers pressing Play at once on one link: one has the tape, the other sees it out', async () => {
  const slug = await ownFilm('one-link-two-presses');
  const ticket = await newTicket(slug);
  const [laptop, tv] = await Promise.all([holder(ticket), holder(ticket)]);
  const presses = await Promise.all([laptop, tv].map((b) => b.post(`/api/films/${slug}/screenings`)));
  assert.deepEqual(presses.map((r) => r.status).sort(), [200, 409]);
  assert.deepEqual(presses.find((r) => r.status === 409).data, { error: 'out' });
  const [winner, loser] = presses[0].status === 200 ? [laptop, tv] : [tv, laptop];
  const loan = srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(ticket.id);
  assert.equal(loan.session_hash, sha256(winner.jar.get('om_session')));
  assert.equal(await status(winner, master(slug)), 200);
  assert.equal(await status(loser, master(slug)), 403);
  assert.equal((await admin.get(`/api/admin/tickets/${ticket.id}`)).data.screeningsUsed, 1);
});

// 1.x: any browser holding the link took over once the player went quiet. Taking over
// is now among one borrower's own devices: a member signed in on two.
test('a player that goes quiet without saying so frees the screening after the timeout, for the borrower’s other device', async () => {
  const slug = await ownFilm('goes-quiet');
  const person = (await admin.post('/api/admin/people', { name: 'Quiet Quinn' })).data;
  const auth = softAuthenticator();
  const laptop = browser(srv.base);
  assert.equal((await enroll(laptop, (await setupLink(admin, person.id)).token, { auth })).status, 200);
  const tv = browser(srv.base);
  assert.equal((await signIn(tv, auth)).status, 200);
  await newTicket(slug, { personId: person.id });

  const play = await laptop.post(`/api/films/${slug}/screenings`);
  assert.equal(play.status, 200, JSON.stringify(play.data));
  assert.equal(play.data.toBrowser, false, 'a member’s own link lends to the member');
  const { screeningId } = play.data;
  assert.equal((await tv.post(`/api/films/${slug}/screenings`)).data.error, 'playing-elsewhere');
  // The laptop lost its connection: no pause, no pagehide, just no more heartbeats.
  srv.db.prepare('UPDATE screenings SET active_until = ? WHERE id = ?').run(Date.now() - 1, screeningId);
  const takeover = await tv.post(`/api/films/${slug}/screenings`);
  assert.equal(takeover.status, 200);
  assert.deepEqual([takeover.data.screeningId, takeover.data.resumed, takeover.data.took], [screeningId, true, false]);
  assert.equal(await status(laptop, master(slug)), 403);
  assert.equal(await status(tv, master(slug)), 200);
  assert.equal((await laptop.post(`/api/screenings/${screeningId}/heartbeat`, { position: 5 })).data.error, 'playing-elsewhere');
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM loans WHERE film_id = ?').get(films[slug]).n, 1);
});

test('unpublishing stops playback that is under way, and publishing again restores it', async () => {
  const slug = await ownFilm('unpublished');
  const { b, screeningId } = await watching(slug);
  await admin.patch(`/api/admin/films/${films[slug]}`, { published: false });
  assert.equal(await status(b, master(slug)), 403);
  assert.equal((await b.post(`/api/screenings/${screeningId}/heartbeat`, { position: 10 })).data.error, 'unpublished');
  assert.equal(await status(b, `/api/films/${slug}`), 404);
  await admin.patch(`/api/admin/films/${films[slug]}`, { published: true });
  assert.equal(await status(b, master(slug)), 200, 'the screening is still theirs');
});

test('a film whose folder goes missing explains itself instead of breaking the player', async () => {
  const { b } = await watching('stalker');
  fs.rmSync(path.join(mediaDir, 'stalker'), { recursive: true });
  // Before a rescan the server only knows the files are gone.
  assert.equal(await status(b, '/media/stalker/hls/v_h264_720/seg_1.m4s'), 404);
  await admin.post('/api/admin/scan');
  const page = await b.get('/api/films/stalker');
  assert.equal(page.status, 200);
  assert.equal(page.data.access.canPlay, false);
  assert.equal(page.data.access.ticket.state, 'unavailable');
  assert.equal((await b.post('/api/films/stalker/screenings')).data.error, 'unavailable');
});

test('a film whose rescan finds errors explains itself too, and starts no screening', async () => {
  const { b, ticket, screeningId } = await watching('solaris');
  fs.rmSync(path.join(mediaDir, 'solaris', 'hls', 'master.m3u8'));
  const scan = await admin.post('/api/admin/scan');
  assert.equal(scan.data.films.find((f) => f.slug === 'solaris').status, 'error', JSON.stringify(scan.data.films));
  const page = await b.get('/api/films/solaris');
  assert.equal(page.status, 200);
  assert.equal(page.data.access.canPlay, false);
  assert.equal(page.data.access.ticket.state, 'unavailable');
  assert.equal(await status(b, '/media/solaris/hls/v_h264_720/seg_1.m4s'), 403);
  assert.equal((await b.post(`/api/screenings/${screeningId}/heartbeat`, { position: 10 })).data.error, 'unavailable');
  // Not even a fresh browser with the link: a screening here would be one used for nothing.
  const other = await holder(ticket);
  assert.equal((await other.post('/api/films/solaris/screenings')).data.error, 'unavailable');
  assert.equal((await admin.get(`/api/admin/tickets/${ticket.id}`)).data.screeningsUsed, 1);
});

test('a JSON body built to break String() or Number() gets a refusal, not a server error', async () => {
  const slug = await ownFilm('hostile-json');
  const { b, screeningId } = await watching(slug);
  assert.equal((await b.post(`/api/screenings/${screeningId}/heartbeat`, { position: 30 })).status, 200);
  // Objects whose toString and valueOf can't be called, and an array holding one.
  const hostile = [{ toString: 'x' }, { toString: {}, valueOf: {} }, [{ toString: 1 }]];
  for (const v of [...hostile, 12345]) {
    const what = JSON.stringify(v);
    assert.equal((await browser(srv.base).post('/api/tickets/open', { code: v })).status, 404, `code ${what}`);
    assert.equal((await browser(srv.base).post('/api/admin/login', { password: v })).status, 401, `password ${what}`);
  }
  for (const v of hostile) {
    assert.equal((await b.post(`/api/screenings/${screeningId}/heartbeat`, { position: v })).status, 200, `position ${JSON.stringify(v)}`);
  }
  assert.equal(srv.db.prepare('SELECT position_seconds FROM screenings WHERE id = ?').get(screeningId).position_seconds, 30, 'no position was taken from them');
});

test('range requests get the same check as whole files', async () => {
  const slug = await ownFilm('ranges');
  const { b } = await watching(slug);
  const seg = `/media/${slug}/hls/v_h264_720/seg_2.m4s`;
  const part = await raw(b, seg, { headers: { range: 'bytes=0-3' } });
  assert.equal(part.status, 206);
  assert.equal(await part.text(), 'segm');
  assert.equal((await raw(browser(srv.base), seg, { headers: { range: 'bytes=0-3' } })).status, 403);
});

test('media is only cacheable by the viewer’s own browser', async () => {
  const slug = await ownFilm('cacheable');
  const { b } = await watching(slug);
  for (const url of [master(slug), `/media/${slug}/hls/v_h264_720/seg_0.m4s`, `/media/${slug}/subtitles/en.vtt`, `/media/${slug}/poster.jpg`]) {
    assert.match((await raw(b, url)).headers.get('cache-control'), /^private/, url);
  }
});

test('a symlink in a film folder cannot serve a file from outside it', async () => {
  const slug = await ownFilm('symlink');
  const { b } = await watching(slug);
  const secret = path.join(tempDir(), 'secret.m4s');
  fs.writeFileSync(secret, 'not for viewers');
  const dir = path.join(mediaDir, slug, 'hls', 'v_h264_720');
  fs.symlinkSync(secret, path.join(dir, 'leak.m4s'));
  fs.symlinkSync(path.join(dir, 'seg_0.m4s'), path.join(dir, 'alias.m4s'));
  assert.equal(await status(b, `/media/${slug}/hls/v_h264_720/leak.m4s`), 404);
  assert.equal(await status(b, `/media/${slug}/hls/v_h264_720/alias.m4s`), 200, 'links within the folder still work');
});

test('a hidden file is a 404, even behind a symlink', async () => {
  const slug = await ownFilm('hidden-file');
  const { b } = await watching(slug);
  const dir = path.join(mediaDir, slug, 'hls', 'v_h264_720');
  fs.writeFileSync(path.join(dir, '.hidden.m4s'), 'hidden');
  fs.symlinkSync(path.join(dir, '.hidden.m4s'), path.join(dir, 'to-hidden.m4s'));
  assert.equal(await status(b, `/media/${slug}/hls/v_h264_720/.hidden.m4s`), 404);
  assert.equal(await status(b, `/media/${slug}/hls/v_h264_720/to-hidden.m4s`), 404);
});

test('storage errors are 500s, which players retry, not 404s, which they give up on', { skip: process.getuid?.() === 0 && 'root ignores permissions' }, async () => {
  const slug = await ownFilm('storage-error');
  const { b } = await watching(slug);
  const dir = path.join(mediaDir, slug, 'hls', 'v_hevc_1080');
  fs.chmodSync(dir, 0o000);
  try {
    const res = await raw(b, `/media/${slug}/hls/v_hevc_1080/seg_0.m4s`);
    assert.equal(res.status, 500);
    assert.equal(res.headers.get('cache-control'), null, 'an error is never cached');
  } finally {
    fs.chmodSync(dir, 0o755);
  }
});

test('a range past the end of a segment is a 416, not a server error', async () => {
  const slug = await ownFilm('past-the-end');
  const { b } = await watching(slug);
  const res = await raw(b, `/media/${slug}/hls/v_h264_720/seg_1.m4s`, { headers: { range: 'bytes=1000-2000' } });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get('content-range'), 'bytes */9');
  assert.equal(res.headers.get('cache-control'), null);
});

test('browsers may not send mutating API requests from another site', async () => {
  const ticket = await newTicket('arrival');
  const open = (site) =>
    fetch(`${srv.base}/api/tickets/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': site },
      body: JSON.stringify({ code: ticket.code }),
    });
  assert.equal((await open('cross-site')).status, 403);
  assert.equal((await open('same-origin')).status, 200);
});

test('session cookies are HttpOnly and SameSite=Lax, and Secure over HTTPS', async () => {
  const ticket = await newTicket('arrival');
  const open = (headers = {}) =>
    fetch(`${srv.base}/api/tickets/open`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ code: ticket.code }) });
  const plain = (await open()).headers.get('set-cookie');
  assert.match(plain, /HttpOnly/);
  assert.match(plain, /SameSite=Lax/);
  assert.doesNotMatch(plain, /Secure/);
  // Caddy says the visitor came over HTTPS; the server trusts that from a local proxy.
  assert.match((await open({ 'x-forwarded-proto': 'https' })).headers.get('set-cookie'), /; Secure/);
});

test('no such film is refused exactly as a film this browser may not have, and is not logged', async () => {
  const stranger = browser(srv.base);
  const answer = async (url) => {
    const r = await raw(stranger, url);
    const headers = Object.fromEntries(['content-type', 'content-length', 'cache-control', 'etag'].map((h) => [h, r.headers.get(h)]));
    return { status: r.status, headers, body: await r.text() };
  };
  const before = await refusals();
  const files = ['hls/master.m3u8', 'hls/v_h264_720/index.m3u8', 'hls/v_h264_720/init.mp4', 'hls/v_h264_720/seg_0.m4s', 'subtitles/en.vtt', 'poster.jpg', 'guessed.m3u8'];
  for (const file of files) {
    const unknown = await answer(`/media/no-such-film/${file}`);
    assert.equal(unknown.status, 403, file);
    assert.deepEqual(await answer(`/media/secret/${file}`), unknown, `never published: ${file}`);
    assert.deepEqual(await answer(`/media/arrival/${file}`), unknown, `published, no ticket: ${file}`);
  }
  // A kind of file never served is a 404, whatever the film.
  for (const slug of ['no-such-film', 'secret', 'arrival']) assert.equal((await answer(`/media/${slug}/film.json`)).status, 404, slug);
  // The booth hears of the real films' refusals only.
  const now = await refusals();
  assert.equal(now.total - before.total, files.length * 2);
  assert.ok(!JSON.stringify(now).includes('no-such-film'));
});

test("a film's missing folder is only mentioned to a browser that may play it", async () => {
  const was = srv.db.prepare("SELECT media_status FROM films WHERE slug = 'heat'").get().media_status;
  srv.db.prepare("UPDATE films SET media_status = 'missing' WHERE slug = 'heat'").run();
  try {
    for (const url of [master('heat'), '/media/heat/poster.jpg']) {
      assert.equal(await status(browser(srv.base), url), 403, url);
      assert.equal(await status(admin, url), 404, url);
    }
  } finally {
    srv.db.prepare("UPDATE films SET media_status = ? WHERE slug = 'heat'").run(was);
  }
});

// More than one guard stops each of these (folderFile's two checks, and send
// refusing '..' below the film's folder): the test fails once a change leaves
// none of them in place.
test("encoded dots, slashes and absolute paths reach nothing outside the film's own folder", async () => {
  const viewer = await watchingHeat();
  const outside = tempDir();
  const secret = path.join(outside, 'secret.m4s');
  fs.writeFileSync(secret, 'not for viewers');
  // A neighbour whose name starts with the film's.
  const neighbour = path.join(mediaDir, 'heat-extras');
  fs.mkdirSync(neighbour);
  fs.writeFileSync(path.join(neighbour, 'x.m4s'), 'not this film');
  try {
    const out = path.basename(outside);
    const asked = [
      '../paris-texas/hls/master.m3u8',
      '%2e%2e/paris-texas/hls/master.m3u8',
      '%2E%2E/secret/hls/master.m3u8',
      '..%2fparis-texas%2fhls%2fmaster.m3u8',
      'hls/%2e%2e/%2e%2e/paris-texas/hls/v_h264_720/seg_0.m4s',
      '%2e%2e/heat-extras/x.m4s',
      `%2e%2e/%2e%2e/${out}/secret.m4s`,
      `..%2F..%2F${out}%2Fsecret.m4s`,
      // An absolute path, as it is and encoded.
      secret.split(path.sep).map(encodeURIComponent).join('/'),
      encodeURIComponent(secret),
      // Backslashes: separators on Windows, only an odd name here.
      `..%5c..%5c${out}%5csecret.m4s`,
    ];
    for (const p of asked) {
      assert.equal(await rawPath(viewer, `/media/heat/${p}`), 404, `with a screening of Heat: ${p}`);
      assert.equal(await rawPath(admin, `/media/heat/${p}`), 404, `as the admin: ${p}`);
    }
    // Each of them is there, for whoever may have it at its own address.
    for (const url of [master('paris-texas'), master('secret'), '/media/paris-texas/hls/v_h264_720/seg_0.m4s']) assert.equal(await rawPath(admin, url), 200, url);
  } finally {
    fs.rmSync(neighbour, { recursive: true, force: true });
  }
});

test('init and media segments are checked with the server each time, so a film encoded again into its folder never mixes old and new', async () => {
  const viewer = await watchingHeat();
  // As a browser asks about its copy (fetch would add no-cache, which always gets the file).
  const revalidate = (etag) => ({ headers: { 'if-none-match': etag, 'cache-control': 'max-age=0' } });
  const files = ['hls/v_h264_720/init.mp4', 'hls/v_h264_720/seg_4.m4s', 'hls/a_en/init.mp4', 'hls/a_en/seg_4.m4s', 'hls/master.m3u8', 'hls/v_h264_720/index.m3u8', 'subtitles/en.vtt'];
  for (const file of files) {
    const url = `/media/heat/${file}`;
    const first = await raw(viewer, url);
    assert.equal(first.status, 200, url);
    assert.equal(first.headers.get('cache-control'), 'private, no-cache', url);
    // Unchanged, asking again costs a 304.
    assert.equal((await raw(viewer, url, revalidate(first.headers.get('etag')))).status, 304, url);
  }
  // Encoded again into the same folder: the copy the browser has is out of date at once.
  const url = '/media/heat/hls/v_h264_720/seg_4.m4s';
  const old = (await raw(viewer, url)).headers.get('etag');
  fs.writeFileSync(path.join(mediaDir, 'heat', 'hls', 'v_h264_720', 'seg_4.m4s'), 'segment 4, encoded again');
  const fresh = await raw(viewer, url, revalidate(old));
  assert.equal(fresh.status, 200);
  assert.equal(await fresh.text(), 'segment 4, encoded again');
  // The folder's artwork changes its address when it changes (?v=), so it keeps for a day.
  assert.equal((await raw(viewer, '/media/heat/poster.jpg')).headers.get('cache-control'), 'private, max-age=86400');
});

test('downloaded artwork: an error is never cached as the image, and the booth hears of refusals', async () => {
  const viewer = await watchingHeat();
  const file = 'poster-0123456789ab.jpg';
  const url = `/artwork/heat/${file}`;
  const dir = path.join(srv.dataDir, 'artwork', 'heat');
  const row = (r, keys) => Object.fromEntries(keys.map((k) => [k, r[k]]));
  srv.db.prepare("UPDATE films SET artwork = ? WHERE slug = 'heat'").run(JSON.stringify({ poster: { file } }));
  try {
    // Named, but not there: a restore that left the artwork out, say.
    const missing = await raw(viewer, url);
    assert.equal(missing.status, 404);
    for (const h of ['cache-control', 'etag', 'last-modified', 'content-type']) assert.equal(missing.headers.get(h), null, `no ${h}`);
    assert.deepEqual(row((await refusals()).recent[0], ['status', 'kind', 'film']), { status: 404, kind: 'artwork', film: 'heat' });
    // Put back, the same address works at once.
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), 'jpeg');
    const back = await raw(viewer, url);
    assert.equal(back.status, 200);
    assert.equal(back.headers.get('cache-control'), 'private, max-age=604800, immutable');
    // A range past the end is send's own 416, not a server error.
    const past = await raw(viewer, url, { headers: { range: 'bytes=100-200' } });
    assert.equal(past.status, 416);
    assert.equal(past.headers.get('cache-control'), null);
    // Refused to a browser with no ticket, as no such film (see below), and the booth hears of it.
    const before = await refusals();
    assert.equal(await status(browser(srv.base), url), 404);
    const now = await refusals();
    assert.equal(now.total, before.total + 1);
    assert.deepEqual(row(now.recent[0], ['status', 'kind', 'film', 'reason']), { status: 404, kind: 'artwork', film: 'heat', reason: 'no session cookie' });
  } finally {
    srv.db.prepare("UPDATE films SET artwork = NULL WHERE slug = 'heat'").run();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A downloaded poster's name is the start of a hash of its path at TMDb, which
// anyone can look up, and a slug is a folder's name: a refusal that answered
// differently from no such film would say which films are here.
test('downloaded artwork that is refused is answered exactly as no such film, byte for byte, and no file is read for it', async (t) => {
  const file = 'poster-0123456789ab.jpg';
  const artworkDir = path.join(srv.dataDir, 'artwork');
  const setArtwork = srv.db.prepare('UPDATE films SET artwork = ? WHERE slug = ?');
  // Heat is published, Secret never was. Both have the poster, on the disk too.
  for (const slug of ['heat', 'secret']) {
    setArtwork.run(JSON.stringify({ poster: { file } }), slug);
    fs.mkdirSync(path.join(artworkDir, slug), { recursive: true });
    fs.writeFileSync(path.join(artworkDir, slug, file), 'jpeg');
  }
  try {
    const other = await arrivalHolder();
    // Every way of looking at a file on the disk, sending one included.
    const ways = ['stat', 'lstat', 'open', 'access', 'readFile', 'realpath'];
    const looks = [
      ...[...ways, 'createReadStream', 'existsSync', ...ways.map((w) => `${w}Sync`)].map((name) => t.mock.method(fs, name)),
      ...ways.map((name) => t.mock.method(fs.promises, name)),
    ];
    const readings = () => looks.flatMap((m) => m.mock.calls.map((c) => String(c.arguments[0]))).filter((p) => p.startsWith(artworkDir));
    const before = await refusals();
    const since = Date.now();
    // A stranger with no cookie, one with a made-up cookie, and a browser with a ticket for another film.
    const visitors = [{}, { cookie: 'om_session=made-up' }, { cookie: cookieOf(other) }];
    for (const who of visitors) {
      const none = await wire(`/artwork/no-such-film/${file}`, who);
      assert.match(none, /^HTTP\/1\.1 404 Not Found\r\n/);
      for (const h of ['content-type', 'cache-control', 'etag', 'last-modified', 'set-cookie']) assert.doesNotMatch(none, new RegExp(`^${h}:`, 'im'), `no ${h}`);
      assert.equal(await wire(`/artwork/heat/${file}`, who), none, 'published, but not for this browser');
      assert.equal(await wire(`/artwork/secret/${file}`, who), none, 'never published');
      assert.equal(await wire('/artwork/heat/poster-ffffffffffff.jpg', who), none, 'a name that isn’t the film’s');
      assert.equal(await wire(`/artwork/no-such-film/${file}`, { ...who, method: 'HEAD' }), await wire(`/artwork/heat/${file}`, { ...who, method: 'HEAD' }), 'HEAD alike');
    }
    assert.deepEqual(readings(), [], 'nothing on the disk was looked at for any of them');
    // Still refusals for the booth, as the 404s they were answered with: the real films' only.
    const now = await refusals();
    assert.equal(now.total - before.total, visitors.length * 3);
    const rows = now.recent.filter((r) => r.at >= since);
    assert.ok(rows.length > 0 && rows.every((r) => r.status === 404 && r.kind === 'artwork'), JSON.stringify(rows));
    assert.ok(!JSON.stringify(now).includes('no-such-film'));
    // A browser that may see it gets the file, read from the disk as the spies see.
    const allowed = await wire(`/artwork/heat/${file}`, { cookie: cookieOf(await watchingHeat()) });
    assert.match(allowed, /^HTTP\/1\.1 200 OK\r\n/);
    assert.ok(readings().length > 0, 'the spies see a file sent');
  } finally {
    for (const slug of ['heat', 'secret']) setArtwork.run(null, slug);
    fs.rmSync(artworkDir, { recursive: true, force: true });
  }
});

// Loading a session writes when it was last seen, at most every five minutes
// (sessions.js), and another browser signed in as the same person sees that on
// its account page. A session touched only for a film that is here would say
// which films there are, so a refusal touches it just as no such film does.
test('a refused media request touches the browser’s session exactly as one for no such film', async () => {
  const file = 'poster-0123456789ab.jpg';
  const setArtwork = srv.db.prepare('UPDATE films SET artwork = ? WHERE slug = ?');
  setArtwork.run(JSON.stringify({ poster: { file } }), 'secret');
  try {
    const b = await arrivalHolder();
    const hash = sha256(b.jar.get('om_session'));
    // Whether asking for `url` touched the session, last seen an hour before.
    const touches = async (url) => {
      const anHourAgo = Date.now() - 60 * 60 * 1000;
      srv.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(anHourAgo, hash);
      await wire(url, { cookie: cookieOf(b), from: '198.51.100.41' });
      return srv.db.prepare('SELECT last_seen_at FROM sessions WHERE id_hash = ?').get(hash).last_seen_at !== anHourAgo;
    };
    for (const [none, ...refused] of [
      [master('no-such-film'), master('secret'), master('heat')],
      [`/artwork/no-such-film/${file}`, `/artwork/secret/${file}`, '/artwork/secret/poster-ffffffffffff.jpg'],
    ]) {
      const expected = await touches(none);
      assert.equal(expected, true, `a live session is seen whatever it asks for: ${none}`);
      for (const url of refused) assert.equal(await touches(url), expected, url);
    }
  } finally {
    setArtwork.run(null, 'secret');
  }
});

test('over its limit, a client’s downloaded artwork is no such film too, even for a browser that may see it', async () => {
  const file = 'poster-0123456789ab.jpg';
  const dir = path.join(srv.dataDir, 'artwork', 'heat');
  srv.db.prepare("UPDATE films SET artwork = ? WHERE slug = 'heat'").run(JSON.stringify({ poster: { file } }));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), 'jpeg');
  try {
    const cookie = cookieOf(await watchingHeat());
    const from = '198.51.100.20';
    const ask = (url, by = from) => fetch(srv.base + url, { headers: { cookie, 'x-forwarded-for': by } }).then(async (r) => (await r.arrayBuffer(), r.status));
    // 2000 requests that find nothing, in ten minutes from one address: the limit.
    // The posters sent between them don't count, so a household sharing an address
    // loads as many as it likes.
    for (let sent = 0; sent < 2000; sent += 50) {
      const posters = await Promise.all(Array.from({ length: 10 }, () => ask(`/artwork/heat/${file}`)));
      assert.deepEqual(posters, Array(10).fill(200), `posters after ${sent} that found nothing`);
      const guesses = await Promise.all(Array.from({ length: 50 }, (_, i) => ask(`/artwork/no-such-film/${sent + i}.jpg`)));
      assert.ok(guesses.every((s) => s === 404), `after ${sent}`);
    }
    const before = await refusals();
    const none = await wire(`/artwork/no-such-film/${file}`, { cookie, from: '198.51.100.21' });
    assert.equal(await wire(`/artwork/heat/${file}`, { cookie, from }), none, 'answered as no such film');
    // A request that would have been refused is answered the same, and neither is recorded.
    assert.equal(await wire(`/artwork/heat/${file}`, { from }), none, 'a stranger’s');
    assert.equal((await refusals()).total, before.total, 'and neither is recorded');
    // From another address, another client, the stranger's request is a refusal the booth hears of.
    assert.equal(await wire(`/artwork/heat/${file}`, { from: '198.51.100.22' }), none);
    assert.equal((await refusals()).total, before.total + 1);
    assert.equal(await ask(`/artwork/heat/${file}`, '198.51.100.22'), 200);
  } finally {
    srv.db.prepare("UPDATE films SET artwork = NULL WHERE slug = 'heat'").run();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('downloaded artwork counts each IPv6 /48 as well, whichever of its /64s ask', async () => {
  const file = 'poster-0123456789ab.jpg';
  const dir = path.join(srv.dataDir, 'artwork', 'heat');
  srv.db.prepare("UPDATE films SET artwork = ? WHERE slug = 'heat'").run(JSON.stringify({ poster: { file } }));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), 'jpeg');
  try {
    const cookie = cookieOf(await watchingHeat());
    const ask = (url, from) => fetch(srv.base + url, { headers: { cookie, 'x-forwarded-for': from } }).then(async (r) => (await r.arrayBuffer(), r.status));
    // `n` requests from `from` that find nothing.
    const guess = async (from, n) => {
      for (let sent = 0; sent < n; sent += 50) {
        const batch = await Promise.all(Array.from({ length: Math.min(50, n - sent) }, (_, i) => ask(`/artwork/no-such-film/${sent + i}.jpg`, from)));
        assert.ok(batch.every((s) => s === 404), from);
      }
    };
    // Three /64s of one /48 find nothing 5999 times between them, one short of the
    // /48's 6000. The first asks a hundred times past its own 2000, and those don't
    // count towards the /48: the /64's limit turned them away first.
    await guess('2001:db8:a:1::1', 2100);
    await guess('2001:db8:a:2::1', 2000);
    await guess('2001:db8:a:3::1', 1999);
    // A fourth /64 is within both limits: its poster is sent, and counts for nothing.
    assert.equal(await ask(`/artwork/heat/${file}`, '2001:db8:a:4::1'), 200);
    // Its next request that finds nothing is the /48's last.
    assert.equal(await ask('/artwork/no-such-film/last.jpg', '2001:db8:a:4::1'), 404);
    // Now anywhere in that /48 is over, even a browser that may see the poster.
    const none = await wire(`/artwork/no-such-film/${file}`, { cookie, from: '2001:db8:b:1::1' });
    assert.equal(await wire(`/artwork/heat/${file}`, { cookie, from: '2001:db8:a:5::1' }), none, 'answered as no such film');
    assert.equal(await ask(`/artwork/heat/${file}`, '2001:db8:a:4::1'), 404, 'the fourth /64 too');
    // The next /48 is someone else.
    assert.equal(await ask(`/artwork/heat/${file}`, '2001:db8:b:1::1'), 200, 'the next /48 is another client');
  } finally {
    srv.db.prepare("UPDATE films SET artwork = NULL WHERE slug = 'heat'").run();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a film’s page, Play and its media answer a film the browser may not have exactly as no such film, byte for byte', async () => {
  const other = await arrivalHolder();
  // From an address of its own, so its presses of Play leave the other tests theirs.
  const from = '198.51.100.30';
  for (const who of [{ from }, { from, cookie: 'om_session=made-up' }, { from, cookie: cookieOf(other) }]) {
    for (const [url, init] of [
      ['/api/films/%s', {}],
      ['/api/films/%s/screenings', { method: 'POST', body: '{}' }],
      ['/media/%s/hls/master.m3u8', {}],
      ['/media/%s/poster.jpg', {}],
    ]) {
      const none = await wire(url.replace('%s', 'no-such-film'), { ...who, ...init });
      assert.match(none, /^HTTP\/1\.1 40[34] /, url);
      for (const slug of ['secret', 'heat']) assert.equal(await wire(url.replace('%s', slug), { ...who, ...init }), none, `${url} ${slug}`);
    }
  }
});

test('a NUL in a media path is no such file, not a storage error', async () => {
  const viewer = await watchingHeat();
  const before = await refusals();
  for (const url of ['/media/heat/hls/v_h264_720/seg_1%00.m4s', '/media/heat/hls%00/master.m3u8']) assert.equal((await raw(viewer, url)).status, 404, url);
  assert.equal((await refusals()).total, before.total, 'nothing for the booth');
});

// Last: it signs every viewer out.
test('signed-out and expired sessions lose the stream on the very next request', async () => {
  const expired = await ownFilm('expired-session');
  const slug = await ownFilm('signed-out');
  const a = await watching(slug);
  const p = await watching(expired);
  srv.db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash IN (SELECT session_hash FROM screenings WHERE id = ?)').run(Date.now() - 1, p.screeningId);
  assert.equal(await status(p.b, master(expired)), 403);
  assert.equal(await status(a.b, master(slug)), 200);
  await admin.post('/api/admin/sessions/expire-all');
  assert.equal(await status(a.b, master(slug)), 403);
  assert.equal((await a.b.post(`/api/screenings/${a.screeningId}/heartbeat`, { position: 5 })).status, 404);
});
