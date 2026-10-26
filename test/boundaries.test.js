// Trust boundaries: what a valid viewer, a forged request or a file in the
// media folder can make the server do beyond what its own ticket allows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  srv = await startServer({ mediaDir });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  for (const f of (await admin.get('/api/admin/films')).data) {
    films[f.slug] = f.id;
    await admin.patch(`/api/admin/films/${f.id}`, { published: true });
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

const master = (slug) => `/media/${slug}/hls/master.m3u8`;
const status = async (b, url) => (await b.get(url)).status;

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
