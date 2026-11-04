// Trust boundaries: what a valid viewer, a forged request or a file in the
// media folder can make the server do beyond what its own ticket allows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';

// Cookies get Secure from the request, as they do behind Caddy.
process.env.COOKIE_SECURE = 'auto';
const { adminBrowser, browser, makeFilm, startServer, tempDir } = await import('./helpers.js');

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
  const mine = await watching('arrival');
  const theirs = await watching('paris-texas');
  await theirs.b.post(`/api/screenings/${theirs.screeningId}/heartbeat`, { position: 30 });
  assert.equal((await mine.b.post(`/api/screenings/${theirs.screeningId}/heartbeat`, { position: 99 })).status, 404);
  assert.equal(srv.db.prepare('SELECT position_seconds FROM screenings WHERE id = ?').get(theirs.screeningId).position_seconds, 30);
});

test('a viewer session is not an admin session, even in the admin cookie', async () => {
  const { b, screeningId } = await watching('arrival');
  assert.equal(await status(b, '/api/admin/films'), 401);
  assert.equal((await b.post(`/api/admin/screenings/${screeningId}/void`)).status, 401);
  const res = await fetch(`${srv.base}/api/admin/films`, { headers: { cookie: `om_admin=${b.jar.get('om_session')}` } });
  assert.equal(res.status, 401);
});

test('two presses of Play at once take one screening between them', async () => {
  const ticket = await newTicket('arrival', { screeningLimit: 1 });
  const [laptop, tv] = await Promise.all([holder(ticket), holder(ticket)]);
  const presses = await Promise.all([laptop, tv].map((b) => b.post('/api/films/arrival/screenings')));
  assert.deepEqual(presses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(presses.find((r) => r.status === 409).data.error, 'playing-elsewhere');

  // A double click in one browser resumes rather than starting another.
  const winner = presses[0].status === 200 ? laptop : tv;
  const twice = await Promise.all([1, 2].map(() => winner.post('/api/films/arrival/screenings')));
  assert.deepEqual(twice.map((r) => r.data.screeningId), [presses.find((r) => r.status === 200).data.screeningId, presses.find((r) => r.status === 200).data.screeningId]);
  assert.equal((await admin.get(`/api/admin/tickets/${ticket.id}`)).data.screeningsUsed, 1);
});

test('a player that goes quiet without saying so frees the screening after the timeout', async () => {
  const { b: laptop, ticket, screeningId } = await watching('arrival');
  const tv = await holder(ticket);
  assert.equal((await tv.post('/api/films/arrival/screenings')).data.error, 'playing-elsewhere');
  // The laptop lost its connection: no pause, no pagehide, just no more heartbeats.
  srv.db.prepare('UPDATE screenings SET active_until = ? WHERE id = ?').run(Date.now() - 1, screeningId);
  const takeover = await tv.post('/api/films/arrival/screenings');
  assert.equal(takeover.status, 200);
  assert.equal(takeover.data.screeningId, screeningId);
  assert.equal(await status(laptop, master('arrival')), 403);
});

test('unpublishing stops playback that is under way, and publishing again restores it', async () => {
  const { b, screeningId } = await watching('paris-texas');
  await admin.patch(`/api/admin/films/${films['paris-texas']}`, { published: false });
  assert.equal(await status(b, master('paris-texas')), 403);
  assert.equal((await b.post(`/api/screenings/${screeningId}/heartbeat`, { position: 10 })).data.error, 'unpublished');
  assert.equal(await status(b, '/api/films/paris-texas'), 404);
  await admin.patch(`/api/admin/films/${films['paris-texas']}`, { published: true });
  assert.equal(await status(b, master('paris-texas')), 200, 'the screening is still theirs');
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
  const { b, ticket, screeningId } = await watching('solaris', { screeningLimit: 2 });
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
  const { b, screeningId } = await watching('arrival');
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
  const { b } = await watching('arrival');
  const seg = '/media/arrival/hls/v_h264_720/seg_2.m4s';
  const part = await raw(b, seg, { headers: { range: 'bytes=0-3' } });
  assert.equal(part.status, 206);
  assert.equal(await part.text(), 'segm');
  assert.equal((await raw(browser(srv.base), seg, { headers: { range: 'bytes=0-3' } })).status, 403);
});

test('media is only cacheable by the viewer’s own browser', async () => {
  const { b } = await watching('arrival');
  for (const url of [master('arrival'), '/media/arrival/hls/v_h264_720/seg_0.m4s', '/media/arrival/subtitles/en.vtt', '/media/arrival/poster.jpg']) {
    assert.match((await raw(b, url)).headers.get('cache-control'), /^private/, url);
  }
});

test('a symlink in a film folder cannot serve a file from outside it', async () => {
  const { b } = await watching('arrival');
  const secret = path.join(tempDir(), 'secret.m4s');
  fs.writeFileSync(secret, 'not for viewers');
  const dir = path.join(mediaDir, 'arrival', 'hls', 'v_h264_720');
  fs.symlinkSync(secret, path.join(dir, 'leak.m4s'));
  fs.symlinkSync(path.join(dir, 'seg_0.m4s'), path.join(dir, 'alias.m4s'));
  assert.equal(await status(b, '/media/arrival/hls/v_h264_720/leak.m4s'), 404);
  assert.equal(await status(b, '/media/arrival/hls/v_h264_720/alias.m4s'), 200, 'links within the folder still work');
});

test('a hidden file is a 404, even behind a symlink', async () => {
  const { b } = await watching('arrival');
  const dir = path.join(mediaDir, 'arrival', 'hls', 'v_h264_720');
  fs.writeFileSync(path.join(dir, '.hidden.m4s'), 'hidden');
  fs.symlinkSync(path.join(dir, '.hidden.m4s'), path.join(dir, 'to-hidden.m4s'));
  assert.equal(await status(b, '/media/arrival/hls/v_h264_720/.hidden.m4s'), 404);
  assert.equal(await status(b, '/media/arrival/hls/v_h264_720/to-hidden.m4s'), 404);
});

test('storage errors are 500s, which players retry, not 404s, which they give up on', { skip: process.getuid?.() === 0 && 'root ignores permissions' }, async () => {
  const { b } = await watching('arrival');
  const dir = path.join(mediaDir, 'arrival', 'hls', 'v_hevc_1080');
  fs.chmodSync(dir, 0o000);
  try {
    const res = await raw(b, '/media/arrival/hls/v_hevc_1080/seg_0.m4s');
    assert.equal(res.status, 500);
    assert.equal(res.headers.get('cache-control'), null, 'an error is never cached');
  } finally {
    fs.chmodSync(dir, 0o755);
  }
});

test('a range past the end of a segment is a 416, not a server error', async () => {
  const { b } = await watching('arrival');
  const res = await raw(b, '/media/arrival/hls/v_h264_720/seg_1.m4s', { headers: { range: 'bytes=1000-2000' } });
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
    // Refused to a browser with no ticket, like the folder's artwork, and the booth hears of it.
    const before = await refusals();
    assert.equal(await status(browser(srv.base), url), 403);
    const now = await refusals();
    assert.equal(now.total, before.total + 1);
    assert.deepEqual(row(now.recent[0], ['status', 'kind', 'film', 'reason']), { status: 403, kind: 'artwork', film: 'heat', reason: 'no session cookie' });
  } finally {
    srv.db.prepare("UPDATE films SET artwork = NULL WHERE slug = 'heat'").run();
    fs.rmSync(dir, { recursive: true, force: true });
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
  const a = await watching('arrival');
  const p = await watching('paris-texas');
  srv.db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash IN (SELECT session_hash FROM screenings WHERE id = ?)').run(Date.now() - 1, p.screeningId);
  assert.equal(await status(p.b, master('paris-texas')), 403);
  assert.equal(await status(a.b, master('arrival')), 200);
  await admin.post('/api/admin/sessions/expire-all');
  assert.equal(await status(a.b, master('arrival')), 403);
  assert.equal((await a.b.post(`/api/screenings/${a.screeningId}/heartbeat`, { position: 5 })).status, 404);
});
