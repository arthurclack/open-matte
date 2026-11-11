import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, beforeEach } from 'node:test';
import { softAuthenticator } from './softauth.js';

process.env.ADMIN_PASSWORD ??= 'test-password-123';
process.env.COOKIE_SECURE ??= 'false';

const { openDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

function mediaPlaylist(segments) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-TARGETDURATION:6', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-MAP:URI="init.mp4"'];
  for (let i = 0; i < segments; i++) lines.push('#EXTINF:6.000,', `seg_${i}.m4s`);
  lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}

// A small but complete film folder: two video renditions, two audio
// renditions, a subtitle file and a poster. 17 six-second segments: 102 seconds.
export const FILM_SECONDS = 102;
export function makeFilm(mediaDir, slug, overrides = {}) {
  const dir = path.join(mediaDir, slug);
  const segments = FILM_SECONDS / 6;
  for (const r of ['v_h264_720', 'v_hevc_1080', 'a_en', 'a_fr']) {
    write(path.join(dir, 'hls', r, 'index.m3u8'), mediaPlaylist(segments));
    write(path.join(dir, 'hls', r, 'init.mp4'), 'init');
    for (let i = 0; i < segments; i++) write(path.join(dir, 'hls', r, `seg_${i}.m4s`), `segment ${i}`);
  }
  write(
    path.join(dir, 'hls', 'master.m3u8'),
    [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="en",NAME="English",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="a_en/index.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="fr",NAME="French",DEFAULT=NO,AUTOSELECT=NO,CHANNELS="2",URI="a_fr/index.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=6000000,CODECS="hvc1.1.6.L120.B0,mp4a.40.2",RESOLUTION=1920x1080,VIDEO-RANGE=SDR,AUDIO="audio"',
      'v_hevc_1080/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=3000000,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=1280x720,VIDEO-RANGE=SDR,AUDIO="audio"',
      'v_h264_720/index.m3u8',
      '',
    ].join('\n'),
  );
  write(path.join(dir, 'subtitles', 'en.vtt'), 'WEBVTT\n\n00:01.000 --> 00:02.000\nHello\n');
  write(path.join(dir, 'poster.jpg'), 'not really a jpeg');
  const json = {
    schemaVersion: 1,
    slug,
    title: 'Arrival',
    year: 2016,
    synopsis: 'Linguist meets heptapods.',
    recommendation: 'Watch it with the lights off.',
    poster: 'poster.jpg',
    hls: 'hls/master.m3u8',
    subtitles: [{ language: 'en', label: 'English', file: 'subtitles/en.vtt' }],
    ...overrides,
  };
  write(path.join(dir, 'film.json'), JSON.stringify(json, null, 2));
  return dir;
}

// A film of its own for a test, on a server that is already running: made in the
// media folder, found by a scan and published, as the admin would. Version 2 lends
// one tape per film, so each test that presses Play does it on a film no other test
// in its file plays. Returns the film as the admin's list has it (id, slug, ...).
export async function addFilm(admin, mediaDir, slug, { published = true, ...overrides } = {}) {
  makeFilm(mediaDir, slug, overrides);
  const scan = await admin.post('/api/admin/scan');
  if (scan.status !== 200) throw new Error(`addFilm: scan ${scan.status} ${JSON.stringify(scan.data)}`);
  const film = (await admin.get('/api/admin/films')).data.find((f) => f.slug === slug);
  if (!film) throw new Error(`addFilm: the scan did not find ${slug}`);
  if (!published) return film;
  const r = await admin.patch(`/api/admin/films/${film.id}`, { published: true });
  if (r.status !== 200) throw new Error(`addFilm: publish ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

export function writeFilmJson(dir, patch) {
  const file = path.join(dir, 'film.json');
  const json = { ...JSON.parse(fs.readFileSync(file, 'utf8')), ...patch };
  fs.writeFileSync(file, JSON.stringify(json, null, 2));
}

// Every folder a test makes goes under one root for this process, removed when the
// process exits. node --test runs each test file in a process of its own, so a run
// leaves nothing behind in the system's temp folder, however many servers it starts.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-matte-test-'));
process.on('exit', () => {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // A folder a test left unreadable, say: never a reason to change the run's result.
  }
});

export function tempDir() {
  return fs.mkdtempSync(path.join(tempRoot, 'dir-'));
}

// One film, one test to press Play on it. Version 2 lends one tape per film, so a
// second test pressing Play on a film an earlier test left out would find the shelf
// empty. After every test, each database a server was started on (or a test handed
// to watchPlays) is read for screenings begun since the last look, and the test fails
// if another test in the file already began one on that film. The one exception is a
// journey told over several tests: the ticket the first test played may be played
// again by the tests after it (journey.test.js gives a screening back, then plays
// again). Nothing is taken back or tidied here: a test gets its own film from makeFilm
// (or addFilm, on a server already running). A test that builds its app with
// createApp, not startServer, hands its database to watchPlays itself.
const watched = [];
export function watchPlays(db) {
  watched.push({ db, seen: 0, pressedBy: new Map() });
  return db;
}

export function sharedPlays(testName) {
  const shared = [];
  for (let i = watched.length - 1; i >= 0; i--) {
    const w = watched[i];
    let rows;
    try {
      rows = w.db
        .prepare('SELECT s.id, s.ticket_id AS ticket, f.slug FROM screenings s JOIN films f ON f.id = s.film_id WHERE s.id > ? ORDER BY s.id')
        .all(w.seen);
    } catch {
      // Closed, or an older schema a migration test is working on: nothing to read.
      watched.splice(i, 1);
      continue;
    }
    for (const { id, ticket, slug } of rows) {
      w.seen = id;
      const first = w.pressedBy.get(slug);
      if (first === undefined) w.pressedBy.set(slug, { test: testName, tickets: new Set([ticket]) });
      else if (first.test === testName) first.tickets.add(ticket);
      else if (!first.tickets.has(ticket) && !shared.some((s) => s.slug === slug)) shared.push({ slug, first: first.test });
    }
  }
  return shared;
}

const refuseShared = (shared) => {
  if (shared.length) {
    const list = shared.map(({ slug, first }) => `"${slug}" (first played in "${first}")`).join(', ');
    throw new Error(`Play was pressed on a film another test in this file had already played: ${list}. Give this test a film of its own with makeFilm.`);
  }
};
// Before a test: what the before() hooks played, which counts as a test of its own.
beforeEach((t) => refuseShared(sharedPlays(`what was set up before "${t.fullName ?? t.name}"`)));
afterEach((t) => refuseShared(sharedPlays(t.fullName ?? t.name)));

// No web build unless a test gives one (`webDist`, a folder with an index.html).
export async function startServer({ mediaDir, dataDir = tempDir(), webDist, metadataOptions = { envKey: '' }, backupOptions = {}, mediaOptions, webauthn, limits }) {
  const db = watchPlays(openDb(':memory:'));
  const app = createApp({
    db,
    mediaDir,
    dataDir,
    metadataOptions,
    backupOptions: { backupDir: path.join(dataDir, 'backups'), ...backupOptions },
    mediaOptions,
    webDist: webDist ?? path.join(mediaDir, 'no-web-build'),
    // Passkeys on localhost, as in development, unless a test says otherwise.
    webauthn: webauthn ?? { publicUrl: '', rpId: '', production: false },
    limits,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { app, db, base, dataDir, close: () => new Promise((r) => server.close(r)) };
}

// A browser: a cookie jar plus fetch. A body is sent as JSON, unless a content
// type is given: then it's sent as it is (an image upload, say).
export function browser(base) {
  const jar = new Map();
  async function request(method, url, body, { type: bodyType, headers: extra } = {}) {
    const headers = { ...extra };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['content-type'] = bodyType ?? 'application/json';
    const payload = body === undefined || bodyType ? body : JSON.stringify(body);
    const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const value = pair.slice(i + 1);
      if (/Max-Age=0/.test(c) || value === '') jar.delete(pair.slice(0, i));
      else jar.set(pair.slice(0, i), value);
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  return {
    jar,
    get: (url) => request('GET', url),
    post: (url, body = {}) => request('POST', url, body),
    patch: (url, body = {}) => request('PATCH', url, body),
    // Raw bytes, as the admin's Branding card sends an image.
    upload: (url, bytes, type = 'image/png', headers) => request('POST', url, bytes, { type, headers }),
    send: request,
  };
}

export async function adminBrowser(base) {
  const b = browser(base);
  const r = await b.post('/api/admin/login', { password: ADMIN_PASSWORD });
  if (r.status !== 200) throw new Error(`admin login failed: ${r.status}`);
  return b;
}

// A real PNG of one colour (8-bit RGB), for logo and icon uploads. The server
// only reads its header, but browsers could draw it.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export function pngImage(width, height, [r, g, b] = [232, 176, 74]) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  // Each row: filter type 0, then the pixels.
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const pixels = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------ people and passkeys (milestone 2)
// `admin` is an adminBrowser; `b` is anything with get/post like browser().

export async function newPerson(admin, name, note) {
  const r = await admin.post('/api/admin/people', { name, note });
  if (r.status !== 201) throw new Error(`newPerson: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

// The token is in the address fragment: <origin>/enroll#<token>.
export const linkToken = (link) => new URL(link).hash.slice(1);

// Creates a setup or recovery link. Throws unless it was created.
export async function setupLink(admin, personId, body = {}) {
  const r = await admin.post(`/api/admin/people/${personId}/links`, body);
  if (r.status !== 201) throw new Error(`setupLink: ${r.status} ${JSON.stringify(r.data)}`);
  return { ...r.data, token: linkToken(r.data.link) };
}

// Opens a link in browser b and creates a passkey with `auth` (a softAuthenticator).
// Returns the finish response (or the options response, if that failed).
export async function enroll(b, token, { auth = softAuthenticator(), over } = {}) {
  const opts = await b.post('/api/enroll/options', { token });
  if (opts.status !== 200) return { ...opts, auth, step: 'options' };
  const credential = auth.create(opts.data.options, over);
  const r = await b.post('/api/enroll/finish', { token, credential });
  return { ...r, auth, options: opts.data.options, credential, step: 'finish' };
}

// Signs browser b in with `auth`. `over` forges fields of the assertion.
export async function signIn(b, auth, over) {
  const opts = await b.post('/api/signin/options');
  if (opts.status !== 200) return { ...opts, step: 'options' };
  const credential = auth.get(opts.data.options, over);
  const r = await b.post('/api/signin/finish', { credential });
  return { ...r, credential, options: opts.data.options, step: 'finish' };
}

// Every kind of file a player fetches, for a film made by makeFilm: the master and
// child playlists, init segments, video and audio segments, and subtitles. A copy of
// the journey's list (journey.test.js stays as it is), with every rendition's playlist.
export function playbackFiles(slug) {
  const hls = `/media/${slug}/hls`;
  return [
    `${hls}/master.m3u8`,
    `${hls}/v_h264_720/index.m3u8`,
    `${hls}/v_hevc_1080/index.m3u8`,
    `${hls}/a_en/index.m3u8`,
    `${hls}/a_fr/index.m3u8`,
    `${hls}/v_h264_720/init.mp4`,
    `${hls}/a_en/init.mp4`,
    `${hls}/v_h264_720/seg_3.m4s`,
    `${hls}/v_hevc_1080/seg_0.m4s`,
    `${hls}/a_en/seg_1.m4s`,
    `${hls}/a_fr/seg_0.m4s`,
    `/media/${slug}/subtitles/en.vtt`,
  ];
}
