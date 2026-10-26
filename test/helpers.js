import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ADMIN_PASSWORD ??= 'test-password-123';
process.env.COOKIE_SECURE = 'false';

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

export async function startServer({ mediaDir, dataDir = tempDir(), metadataOptions = { envKey: '' }, backupOptions = {} }) {
  const db = openDb(':memory:');
  const app = createApp({
    db,
    mediaDir,
    dataDir,
    metadataOptions,
    backupOptions: { backupDir: path.join(dataDir, 'backups'), ...backupOptions },
    webDist: path.join(mediaDir, 'no-web-build'),
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
