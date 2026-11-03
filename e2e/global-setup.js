// Once per `npm run e2e`: the film, a fresh data folder, the web build, the
// server, and through the admin API a published film and a cinema name. The
// journeys find all of it in process.env (E2E_*), which Playwright passes on to
// its workers. The admin password is made here for this run only: it is never
// written to a file or printed.
import { fork, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE, FILM, ensureFilm, hasFfmpeg } from './film.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CINEMA_NAME = 'Harbour Lights Picturehouse';

// The newest file under these, by modification time.
function newest(paths) {
  let latest = 0;
  const visit = (p) => {
    if (!fs.existsSync(p)) return;
    const stat = fs.statSync(p);
    if (stat.isDirectory()) for (const name of fs.readdirSync(p)) visit(path.join(p, name));
    else latest = Math.max(latest, stat.mtimeMs);
  };
  paths.forEach(visit);
  return latest;
}

// Builds dist/ when it's missing or older than the web source.
function ensureBuild() {
  const dist = path.join(ROOT, 'dist', 'index.html');
  const sources = ['web', 'vite.config.js', 'package-lock.json'].map((p) => path.join(ROOT, p));
  if (fs.existsSync(dist) && fs.statSync(dist).mtimeMs >= newest(sources)) return;
  console.log('e2e: building the web app (dist is missing or older than web/)');
  const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('npm run build failed');
}

// A fresh folder for this run's data, under e2e/.cache. Older runs' folders go.
function runFolder() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const name of fs.readdirSync(CACHE)) {
    if (name.startsWith('run-')) fs.rmSync(path.join(CACHE, name), { recursive: true, force: true });
  }
  const dir = path.join(CACHE, `run-${Date.now()}-${process.pid}`);
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  return dir;
}

function startServer({ dataDir, mediaDir, password, log }) {
  const out = fs.openSync(log, 'a');
  const child = fork(path.join(ROOT, 'e2e', 'server.js'), [], {
    cwd: ROOT,
    // Only what the server needs: nothing from the developer's own .env.
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      NODE_ENV: 'development',
      ADMIN_PASSWORD: password,
      DATA_DIR: dataDir,
      MEDIA_DIR: mediaDir,
      WEB_DIST: path.join(ROOT, 'dist'),
      BACKUP_DIR: 'off',
      PUBLIC_URL: '',
      WEBAUTHN_RP_ID: '',
      TMDB_API_KEY: '',
    },
    stdio: ['ignore', out, out, 'ipc'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The e2e server didn't start; see ${log}`)), 20_000);
    child.once('message', ({ port }) => {
      clearTimeout(timer);
      resolve({ child, port });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`The e2e server exited (${code}); see ${log}`));
    });
  });
}

// The admin API, as global setup uses it. The journeys have their own (fixtures.js).
async function adminCall(base, cookie, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

export default async function globalSetup() {
  if (!hasFfmpeg()) {
    // Every journey skips with this reason (fixtures.js).
    process.env.E2E_SKIP = 'ffmpeg and ffprobe are needed to make the test film: install ffmpeg (brew install ffmpeg) and run again.';
    console.warn(`e2e: ${process.env.E2E_SKIP}`);
    return undefined;
  }

  const film = ensureFilm();
  ensureBuild();
  const run = runFolder();
  const password = crypto.randomBytes(24).toString('base64url');
  const log = path.join(run, 'server.log');
  const { child, port } = await startServer({ dataDir: path.join(run, 'data'), mediaDir: film.mediaDir, password, log });
  const base = `http://localhost:${port}`;

  const teardown = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      child.kill('SIGTERM');
    });

  try {
    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!login.ok) throw new Error(`admin login failed: ${login.status}`);
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');

    const scan = await adminCall(base, cookie, 'POST', '/api/admin/scan', {});
    const scanned = scan.films.find((f) => f.slug === FILM.slug);
    if (!scanned || scanned.status === 'error') throw new Error(`the test film didn't scan cleanly: ${JSON.stringify(scanned ?? scan)}`);
    const listed = (await adminCall(base, cookie, 'GET', '/api/admin/films')).find((f) => f.slug === FILM.slug);
    await adminCall(base, cookie, 'PATCH', `/api/admin/films/${listed.id}`, { published: true });
    await adminCall(base, cookie, 'PATCH', '/api/admin/settings', { cinemaName: CINEMA_NAME });

    Object.assign(process.env, {
      E2E_BASE_URL: base,
      E2E_ADMIN_PASSWORD: password,
      E2E_ADMIN_COOKIE: cookie,
      E2E_FILM_ID: String(listed.id),
      E2E_FILM_SLUG: FILM.slug,
      E2E_FILM_TITLE: listed.title,
      E2E_CINEMA_NAME: CINEMA_NAME,
      E2E_CODECS: film.codecs.join(','),
      E2E_SERVER_LOG: log,
    });
  } catch (err) {
    await teardown();
    throw err;
  }
  return teardown;
}
