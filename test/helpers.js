import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

export function writeFilmJson(dir, patch) {
  const file = path.join(dir, 'film.json');
  const json = { ...JSON.parse(fs.readFileSync(file, 'utf8')), ...patch };
  fs.writeFileSync(file, JSON.stringify(json, null, 2));
}

export function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'open-matte-test-'));
}

export async function startServer({ mediaDir, dataDir = tempDir(), metadataOptions = { envKey: '' }, backupOptions = {}, webauthn, limits }) {
  const db = openDb(':memory:');
  const app = createApp({
    db,
    mediaDir,
    dataDir,
    metadataOptions,
    backupOptions: { backupDir: path.join(dataDir, 'backups'), ...backupOptions },
    webDist: path.join(mediaDir, 'no-web-build'),
    // Passkeys on localhost, as in development, unless a test says otherwise.
    webauthn: webauthn ?? { publicUrl: '', rpId: '', production: false },
    limits,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { app, db, base, close: () => new Promise((r) => server.close(r)) };
}

// A browser: a cookie jar plus fetch.
export function browser(base) {
  const jar = new Map();
  async function request(method, url, body) {
    const headers = {};
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
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
  };
}

export async function adminBrowser(base) {
  const b = browser(base);
  const r = await b.post('/api/admin/login', { password: ADMIN_PASSWORD });
  if (r.status !== 200) throw new Error(`admin login failed: ${r.status}`);
  return b;
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
