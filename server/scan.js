import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { tx } from './db.js';

// The import contract: one folder per film in the media directory, described
// by a film.json. See docs/import-format.md.

export const SCHEMA_VERSION = 1;
// Film folders become URLs (your-domain/<folder>), so these names are taken.
export const RESERVED_SLUGS = new Set(['admin', 'api', 'media', 't', 'assets', 'signin', 'enroll', 'tickets', 'about', 'help']);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];

// ------------------------------------------------------------------ film.json fields

const text = (max) => (v) => {
  if (v == null) return { value: null };
  if (typeof v !== 'string') return { error: 'must be text' };
  const t = v.trim();
  if (t.length > max) return { error: `must be at most ${max} characters` };
  return { value: t || null };
};
const integer = (min, max) => (v) => {
  if (v == null) return { value: null };
  if (!Number.isInteger(v) || v < min || v > max) return { error: `must be a whole number from ${min} to ${max}` };
  return { value: v };
};
const names = (v) => {
  if (v == null) return { value: null };
  if (typeof v === 'string') return text(500)(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return text(500)(v.map((x) => x.trim()).filter(Boolean).join(', '));
  return { error: 'must be text or a list of names' };
};

// Editable metadata: film.json key → database column and validator.
export const META_FIELDS = {
  title: { column: 'title', check: text(200) },
  originalTitle: { column: 'original_title', check: text(200) },
  year: { column: 'year', check: integer(1870, 2200) },
  runtimeMinutes: { column: 'runtime_minutes', check: integer(1, 2000) },
  directors: { column: 'directors', check: names },
  country: { column: 'country', check: text(200) },
  synopsis: { column: 'synopsis', check: text(5000) },
  recommendation: { column: 'recommendation', check: text(10000) },
  contentNote: { column: 'content_note', check: text(1000) },
};
const MEDIA_KEYS = new Set(['poster', 'backdrop', 'hls', 'subtitles']);
const OTHER_KEYS = new Set(['schemaVersion', 'slug', 'tmdbId']);

// ------------------------------------------------------------------ playlists

// Parses `KEY=value,KEY="quoted, value"` attribute lists.
export function parseAttributes(s) {
  const out = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : m[2];
  return out;
}

export function parseMaster(src) {
  const lines = src.split(/\r?\n/).map((l) => l.trim());
  if (lines[0] !== '#EXTM3U') throw new Error('is not an M3U8 playlist');
  const variants = [];
  const media = [];
  let isMediaPlaylist = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXTINF')) isMediaPlaylist = true;
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const a = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
      let j = i + 1;
      while (j < lines.length && (!lines[j] || lines[j].startsWith('#'))) j++;
      const [w, h] = (a.RESOLUTION || '').split('x').map(Number);
      variants.push({
        uri: lines[j] || '',
        bandwidth: Number(a.BANDWIDTH) || null,
        averageBandwidth: Number(a['AVERAGE-BANDWIDTH']) || null,
        width: w || null,
        height: h || null,
        codecs: a.CODECS ? a.CODECS.split(',').map((c) => c.trim()) : [],
        videoRange: a['VIDEO-RANGE'] || 'SDR',
        frameRate: Number(a['FRAME-RATE']) || null,
        audio: a.AUDIO || null,
      });
      i = j;
    } else if (line.startsWith('#EXT-X-MEDIA:')) {
      const a = parseAttributes(line.slice('#EXT-X-MEDIA:'.length));
      media.push({
        type: a.TYPE,
        groupId: a['GROUP-ID'],
        name: a.NAME,
        language: a.LANGUAGE || null,
        default: a.DEFAULT === 'YES',
        channels: a.CHANNELS || null,
        characteristics: a.CHARACTERISTICS || null,
        uri: a.URI || null,
      });
    }
  }
  return { variants, media, isMediaPlaylist };
}

export function parseMediaPlaylist(src) {
  const lines = src.split(/\r?\n/).map((l) => l.trim());
  let duration = 0;
  let map = null;
  let ended = false;
  const segments = [];
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MAP:')) map = parseAttributes(line.slice('#EXT-X-MAP:'.length)).URI || null;
    else if (line.startsWith('#EXTINF:')) duration += Number.parseFloat(line.slice(8)) || 0;
    else if (line === '#EXT-X-ENDLIST') ended = true;
    else if (line && !line.startsWith('#')) segments.push(line);
  }
  return { duration, map, ended, segments };
}

export function describeCodec(c) {
  const k = c.split('.')[0].toLowerCase();
  const names = { avc1: 'H.264', avc3: 'H.264', hvc1: 'HEVC', hev1: 'HEVC', av01: 'AV1', vp09: 'VP9', mp4a: 'AAC', 'ec-3': 'E-AC-3', 'ac-3': 'AC-3', opus: 'Opus', flac: 'FLAC' };
  return names[k] || c;
}
const isVideoCodec = (c) => /^(avc[13]|hvc1|hev1|av01|vp09)/i.test(c);

// ------------------------------------------------------------------ helpers

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
function languageLabel(code) {
  try {
    return languageNames.of(code) || code;
  } catch {
    return code;
  }
}

// Changes whenever the file does, so artwork URLs only change when the image does.
function fileVersion(abs) {
  try {
    const st = fs.statSync(abs);
    return `${Math.round(st.mtimeMs).toString(36)}-${st.size.toString(36)}`;
  } catch {
    return null;
  }
}

// Files can vanish mid-scan: rsync writes temporary files during an upload and
// renames them a moment later.
function folderSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    try {
      total += fs.statSync(path.join(entry.parentPath, entry.name)).size;
    } catch {
      // Gone since the listing.
    }
  }
  return total;
}

const prettify = (slug) => slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ------------------------------------------------------------------ one film

// Checks one film folder against the import contract. Never throws for content
// problems: errors (the film can't be played) and warnings (it can, but
// something is off) are collected for the scan report.
//
// `previous` is what the last scan recorded ({ signature, sizeBytes }): when the
// playlists and segment folders haven't changed, the folder's size is reused
// rather than measured file by file again, which is slow on network storage.
export function inspectFilm(dir, slug, previous = null) {
  const errors = [];
  const warnings = [];
  const media = { hls: null, poster: null, backdrop: null, subtitles: [], variants: [], audio: [], durationSeconds: null, sizeBytes: 0 };
  let tmdbId = null;
  const inside = (p) => p.startsWith(dir + path.sep);
  const rel = (abs) => path.relative(dir, abs).split(path.sep).join('/');

  // What the folder's contents looked like: playlists and how full each segment folder is.
  const signature = [];
  const noteFile = (abs) => {
    try {
      const st = fs.statSync(abs);
      signature.push(`${rel(abs)}:${st.mtimeMs}:${st.size}`);
    } catch {
      // A missing file is reported elsewhere.
    }
  };

  // One directory listing per folder, instead of a check per segment file.
  const listings = new Map();
  const listing = (d) => {
    if (!listings.has(d)) {
      let names;
      try {
        names = new Set(fs.readdirSync(d));
      } catch {
        names = new Set();
      }
      listings.set(d, names);
      signature.push(`${rel(d)}/:${names.size}`);
    }
    return listings.get(d);
  };
  const exists = (p) => listing(path.dirname(p)).has(path.basename(p));

  const done = (meta = null) => {
    media.signature = crypto.createHash('sha1').update(signature.join('|')).digest('hex').slice(0, 16);
    media.sizeBytes = previous?.signature === media.signature && previous.sizeBytes != null ? previous.sizeBytes : folderSize(dir);
    return { slug, status: errors.length ? 'error' : warnings.length ? 'warning' : 'ok', errors, warnings, meta, media, tmdbId };
  };

  // A path from film.json: relative, inside the folder, an existing file.
  function filePath(value, field, exts) {
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(`${field} must be a relative file path`);
      return null;
    }
    const rel = value.trim();
    const norm = path.posix.normalize(rel);
    if (rel.includes('\\') || path.posix.isAbsolute(rel) || norm.startsWith('../') || norm === '..' || !inside(path.resolve(dir, norm))) {
      errors.push(`${field}: "${rel}" must be a path inside the film folder`);
      return null;
    }
    if (exts && !exts.includes(path.extname(norm).toLowerCase())) {
      errors.push(`${field}: "${rel}" must end in ${exts.join(', ')}`);
      return null;
    }
    const abs = path.resolve(dir, norm);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      errors.push(`${field}: "${rel}" does not exist`);
      return null;
    }
    return norm;
  }

  // ---- film.json
  const jsonPath = path.join(dir, 'film.json');
  let json;
  if (!fs.existsSync(jsonPath)) {
    // Without film.json, fall back to the standard layout so a folder fresh
    // from the encoder can still be previewed. Details can be filled in later.
    if (!fs.existsSync(path.join(dir, 'hls', 'master.m3u8'))) {
      errors.push('film.json is missing, and there is no hls/master.m3u8 to fall back on');
      return done();
    }
    warnings.push('No film.json: using the folder name as the title and the standard file layout');
    const found = (names) => names.find((n) => fs.existsSync(path.join(dir, n)));
    const subDir = path.join(dir, 'subtitles');
    json = {
      schemaVersion: SCHEMA_VERSION,
      title: prettify(slug),
      hls: 'hls/master.m3u8',
      poster: found(IMAGE_EXTS.map((e) => `poster${e}`)),
      backdrop: found(IMAGE_EXTS.map((e) => `backdrop${e}`)),
      subtitles: fs.existsSync(subDir)
        ? fs
            .readdirSync(subDir)
            .filter((f) => /^[a-z]{2,3}(-[A-Za-z0-9]+)?(\.[a-z]+)*\.vtt$/.test(f))
            .map((f) => ({ language: f.split('.')[0], file: `subtitles/${f}`, forced: f.includes('.forced.') }))
        : [],
    };
  } else {
    noteFile(jsonPath);
    try {
      json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (err) {
      errors.push(`film.json is not valid JSON: ${err.message}`);
      return done();
    }
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    errors.push('film.json must contain a JSON object');
    return done();
  }
  if (json.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`film.json: schemaVersion must be ${SCHEMA_VERSION} (found ${JSON.stringify(json.schemaVersion)})`);
    return done();
  }
  if (json.slug != null && json.slug !== slug) errors.push(`film.json: slug "${json.slug}" doesn't match the folder name "${slug}"`);
  if (json.tmdbId != null) {
    if (Number.isInteger(json.tmdbId) && json.tmdbId > 0) tmdbId = json.tmdbId;
    else errors.push("film.json: tmdbId must be a whole number (the number in the film's TMDB address)");
  }
  for (const key of Object.keys(json)) {
    if (!(key in META_FIELDS) && !MEDIA_KEYS.has(key) && !OTHER_KEYS.has(key)) warnings.push(`film.json: unknown field "${key}" was ignored`);
  }

  let meta = {};
  for (const [key, { check }] of Object.entries(META_FIELDS)) {
    const r = check(json[key]);
    if (r.error) errors.push(`film.json: ${key} ${r.error}`);
    else meta[key] = r.value;
  }
  if (!meta.title) errors.push('film.json: title is required');
  if (errors.length) meta = null;

  // ---- artwork
  if (json.poster != null) media.poster = filePath(json.poster, 'poster', IMAGE_EXTS);
  else warnings.push('No poster in film.json');
  if (json.backdrop != null) media.backdrop = filePath(json.backdrop, 'backdrop', IMAGE_EXTS);
  if (media.poster) media.posterVersion = fileVersion(path.resolve(dir, media.poster));
  if (media.backdrop) media.backdropVersion = fileVersion(path.resolve(dir, media.backdrop));

  // ---- subtitles
  if (json.subtitles != null && !Array.isArray(json.subtitles)) errors.push('film.json: subtitles must be a list');
  const listed = new Set();
  for (const [i, s] of (Array.isArray(json.subtitles) ? json.subtitles : []).entries()) {
    const field = `subtitles[${i}]`;
    if (!s || typeof s !== 'object') {
      errors.push(`${field} must be an object`);
      continue;
    }
    if (typeof s.language !== 'string' || !LANG_RE.test(s.language)) {
      errors.push(`${field}.language must be a language code such as "en" or "pt-BR"`);
      continue;
    }
    const file = filePath(s.file, `${field}.file`, ['.vtt']);
    if (!file) continue;
    const head = fs.readFileSync(path.resolve(dir, file), 'utf8').slice(0, 16).replace(/^﻿/, '');
    if (!head.startsWith('WEBVTT')) {
      errors.push(`${field}: ${file} is not a WebVTT file (it must start with WEBVTT)`);
      continue;
    }
    if (listed.has(file)) warnings.push(`${field}: ${file} is listed twice`);
    listed.add(file);
    const forced = s.forced === true;
    const label = typeof s.label === 'string' && s.label.trim() ? s.label.trim() : `${languageLabel(s.language)}${forced ? ' (forced)' : ''}`;
    media.subtitles.push({ file, language: s.language, label, forced, default: s.default === true });
  }
  if (media.subtitles.filter((s) => s.default).length > 1) warnings.push('More than one subtitle track is marked default');
  for (const sub of ['.', 'subtitles']) {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) {
      const rel = path.posix.join(sub === '.' ? '' : sub, f);
      if (f.toLowerCase().endsWith('.vtt') && !listed.has(rel)) warnings.push(`${rel} isn't listed in film.json, so viewers won't see it`);
    }
  }

  // ---- HLS
  if (json.hls == null) {
    errors.push('film.json: hls is required (the path to the master playlist)');
    return done(meta);
  }
  media.hls = filePath(json.hls, 'hls', ['.m3u8']);
  if (!media.hls) return done(meta);

  let master;
  noteFile(path.resolve(dir, media.hls));
  try {
    master = parseMaster(fs.readFileSync(path.resolve(dir, media.hls), 'utf8'));
  } catch (err) {
    errors.push(`${media.hls} ${err.message}`);
    return done(meta);
  }
  if (master.isMediaPlaylist || master.variants.length === 0) {
    errors.push(`${media.hls} is a media playlist; hls must point to a master playlist that lists renditions`);
    return done(meta);
  }

  const masterDir = path.dirname(path.resolve(dir, media.hls));

  // Every playlist, init segment and media segment must exist, so a half-finished
  // rsync shows up here rather than halfway through someone's evening.
  function checkPlaylist(uri, what) {
    if (!uri || /^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('/')) {
      errors.push(`${what}: "${uri}" must be a relative path`);
      return null;
    }
    const abs = path.resolve(masterDir, uri);
    if (!inside(abs)) {
      errors.push(`${what}: "${uri}" points outside the film folder`);
      return null;
    }
    if (!exists(abs)) {
      errors.push(`${what}: ${rel(abs)} is missing`);
      return null;
    }
    noteFile(abs);
    const pl = parseMediaPlaylist(fs.readFileSync(abs, 'utf8'));
    if (!pl.ended) errors.push(`${what}: ${rel(abs)} is not a complete video-on-demand playlist (no #EXT-X-ENDLIST)`);
    if (!pl.segments.length) errors.push(`${what}: ${rel(abs)} lists no segments`);
    const base = path.dirname(abs);
    const files = new Set(pl.segments);
    if (pl.map) files.add(pl.map);
    const missing = [...files].filter((f) => {
      const p = path.resolve(base, f.split('?')[0]);
      return !inside(p) || !exists(p);
    });
    if (missing.length) errors.push(`${what}: ${missing.length} of ${files.size} segment files are missing (first: ${missing[0]})`);
    return pl;
  }

  for (const v of master.variants) {
    const videoCodec = v.codecs.find(isVideoCodec) || null;
    const label = `${v.height ? `${v.height}p` : 'Rendition'} ${videoCodec ? describeCodec(videoCodec) : ''}${v.videoRange !== 'SDR' ? ` ${v.videoRange}` : ''}`.trim();
    if (!v.codecs.length) warnings.push(`${label} (${v.uri}) has no CODECS attribute, so players can't tell in advance whether they support it`);
    if (videoCodec && /^hev1/i.test(videoCodec)) warnings.push(`${label} is tagged hev1; Safari needs hvc1 (ffmpeg: -tag:v hvc1)`);
    const pl = checkPlaylist(v.uri, label);
    if (pl && videoCodec && /^(hvc1|hev1|av01)/i.test(videoCodec) && !pl.map) {
      warnings.push(`${label} uses MPEG-TS segments; Open Matte expects fMP4 (CMAF) segments for HEVC and AV1`);
    }
    if (pl && media.durationSeconds == null) media.durationSeconds = Math.round(pl.duration);
    media.variants.push({ ...v, videoCodec, label, fmp4: pl ? Boolean(pl.map) : null });
  }

  for (const m of master.media) {
    if (m.type === 'AUDIO') {
      if (m.uri) checkPlaylist(m.uri, `Audio "${m.name}"`);
      media.audio.push(m);
    } else if (m.type === 'SUBTITLES') {
      warnings.push(`The master playlist contains a subtitle rendition ("${m.name}"); Open Matte only shows the .vtt files listed in film.json`);
    }
  }
  const groups = new Set(media.audio.map((a) => a.groupId));
  for (const v of media.variants) {
    if (v.audio && !groups.has(v.audio)) errors.push(`${v.label} refers to audio group "${v.audio}", which the master playlist doesn't define`);
  }
  if (media.audio.length && !media.audio.some((a) => a.default)) warnings.push('No audio rendition is marked DEFAULT=YES');

  if (!media.variants.some((v) => /^avc/i.test(v.videoCodec || '') && v.videoRange === 'SDR')) {
    warnings.push(
      'No H.264 SDR rendition. HEVC playback depends on the browser, operating system, hardware decoder and exact encoding, so without an H.264 fallback some viewers will not be able to play this film',
    );
  }
  if (media.variants.some((v) => v.videoRange !== 'SDR') && !media.variants.some((v) => v.videoRange === 'SDR')) {
    warnings.push('Only HDR renditions. Add tone-mapped SDR versions for screens without HDR');
  }

  if (meta && meta.runtimeMinutes == null && media.durationSeconds) meta.runtimeMinutes = Math.max(1, Math.round(media.durationSeconds / 60));
  return done(meta);
}

// ------------------------------------------------------------------ the whole library

const same = (a, b) => (a ?? null) === (b ?? null);

// Looks at every folder in the media directory. Synchronous: it runs in a
// worker thread (see scanMedia), so slow storage never blocks the server.
export function inspectMediaDir(mediaDir, previous = {}) {
  const found = { results: [], skipped: [], unavailable: null };
  let entries;
  try {
    entries = fs.readdirSync(mediaDir, { withFileTypes: true });
  } catch (err) {
    found.unavailable = err.code === 'ENOENT' ? 'The media folder does not exist' : `The media folder can't be read (${err.code || err.message})`;
    return found;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const looksLikeFilm = ['film.json', 'hls/master.m3u8'].some((f) => fs.existsSync(path.join(mediaDir, entry.name, f)));
    if (!SLUG_RE.test(entry.name) || RESERVED_SLUGS.has(entry.name)) {
      // Other things kept in the media folder (an Archive, say) aren't worth mentioning.
      if (!looksLikeFilm) continue;
    }
    if (!SLUG_RE.test(entry.name)) {
      found.skipped.push({ name: entry.name, reason: 'Folder names must use lowercase letters, digits and hyphens (they become the URL)' });
    } else if (RESERVED_SLUGS.has(entry.name)) {
      found.skipped.push({ name: entry.name, reason: 'This name is reserved for the site itself' });
    } else {
      try {
        found.results.push(inspectFilm(path.join(mediaDir, entry.name), entry.name, previous[entry.name]));
      } catch (err) {
        // One unreadable folder (permissions, a flaky network drive) mustn't stop
        // the scan. The film is reported and left as it was.
        found.results.push({ slug: entry.name, failed: true, status: 'error', errors: [`Couldn't read the folder (${err.code || err.message}). Nothing was changed for this film.`], warnings: [] });
      }
    }
  }
  return found;
}

function inspectInWorker(mediaDir, previous) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./scan-worker.js', import.meta.url), { workerData: { mediaDir, previous } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`The scan stopped unexpectedly (exit code ${code})`));
    });
  });
}

// Brings the films table in line with the media directory.
//
// Media (playlists, artwork, subtitles) always follows the folder. Metadata is
// merged field by field against what film.json said last time: a field you
// haven't edited in the admin follows film.json; a field you have edited is
// kept, and if film.json also changed it, the scan reports a conflict.
//
// The folders are inspected in a worker thread; only the database update runs
// here. One scan at a time per database: a second request joins the running one.
const running = new WeakMap();
export function scanMedia(db, mediaDir) {
  if (!running.has(db)) {
    running.set(
      db,
      runScan(db, mediaDir).finally(() => running.delete(db)),
    );
  }
  return running.get(db);
}

async function runScan(db, mediaDir) {
  const scannedAt = Date.now();
  const previous = {};
  for (const row of db.prepare('SELECT slug, media FROM films').all()) {
    try {
      const m = JSON.parse(row.media || 'null');
      if (m?.signature) previous[row.slug] = { signature: m.signature, sizeBytes: m.sizeBytes };
    } catch {
      // Old or damaged media JSON: the folder is measured afresh.
    }
  }
  return applyScan(db, await inspectInWorker(mediaDir, previous), scannedAt);
}

export function applyScan(db, found, scannedAt = Date.now()) {
  const report = { films: [], removed: [], skipped: found.skipped, unavailable: found.unavailable, scannedAt };
  const existing = new Map(db.prepare('SELECT * FROM films').all().map((f) => [f.slug, f]));
  if (report.unavailable) return report;
  // An empty folder where films used to be is far more likely to be storage
  // that isn't mounted than a library deleted on purpose. Change nothing.
  const available = [...existing.values()].some((f) => f.media_status !== 'missing');
  if (!found.results.length && !found.skipped.length && available) {
    report.unavailable = 'The media folder is empty. If your films are on network storage, it may not be mounted right now. Nothing was marked missing.';
    return report;
  }
  const results = found.results;

  const now = report.scannedAt;

  tx(db, () => {
    for (const r of results) {
      const row = existing.get(r.slug);
      if (r.failed) {
        report.films.push({ slug: r.slug, title: row?.title ?? r.slug, status: 'error', errors: r.errors, warnings: [], added: false, updated: [], conflicts: [] });
        continue;
      }
      // A poster downloaded from TMDb makes a missing one in the folder beside the point.
      let tmdbPoster = false;
      try {
        tmdbPoster = Boolean(JSON.parse(row?.artwork || 'null')?.poster);
      } catch {
        // Unreadable artwork JSON: treat as none.
      }
      const warnings = tmdbPoster ? r.warnings.filter((w) => !w.startsWith('No poster in film.json')) : r.warnings;
      const status = r.errors.length ? 'error' : warnings.length ? 'warning' : 'ok';
      const entry = { slug: r.slug, status, errors: r.errors, warnings, added: !row, updated: [], conflicts: [] };
      const scanReport = JSON.stringify({ errors: r.errors, warnings });

      if (!row) {
        // New films are always unpublished.
        const meta = r.meta || { title: prettify(r.slug) };
        const cols = Object.values(META_FIELDS).map((f) => f.column);
        const vals = Object.keys(META_FIELDS).map((k) => meta[k] ?? null);
        db.prepare(
          `INSERT INTO films (slug, ${cols.join(', ')}, imported_meta, tmdb_id, media_status, media, scan_report, scanned_at, created_at, updated_at)
           VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(r.slug, ...vals, JSON.stringify(meta), r.tmdbId, r.status, JSON.stringify(r.media), scanReport, now, now, now);
        entry.title = meta.title;
      } else {
        const sets = ['media_status = ?', 'media = ?', 'scan_report = ?', 'scanned_at = ?'];
        const args = [status, JSON.stringify(r.media), scanReport, now];
        if (r.meta) {
          const before = row.imported_meta ? JSON.parse(row.imported_meta) : {};
          const sources = row.meta_sources ? JSON.parse(row.meta_sources) : {};
          for (const [key, { column }] of Object.entries(META_FIELDS)) {
            const prev = before[key];
            const next = r.meta[key];
            const cur = row[column];
            if (same(next, prev) || same(cur, next)) continue;
            // A value TMDb filled in gives way to one you've now put in film.json.
            const fromTmdb = sources[key] === 'tmdb' && next != null;
            if (same(cur, prev) || fromTmdb) {
              sets.push(`${column} = ?`);
              args.push(next ?? null);
              entry.updated.push(key);
              delete sources[key];
            } else {
              entry.conflicts.push({ field: key, kept: cur, fileValue: next ?? null });
            }
          }
          sets.push('imported_meta = ?', 'meta_sources = ?');
          args.push(JSON.stringify(r.meta), JSON.stringify(sources));
        }
        // A tmdbId in film.json pins the match, unless one has been chosen already.
        if (r.tmdbId && !row.tmdb_id) sets.push('tmdb_id = ?'), args.push(r.tmdbId);
        if (entry.updated.length) sets.push('updated_at = ?'), args.push(now);
        db.prepare(`UPDATE films SET ${sets.join(', ')} WHERE id = ?`).run(...args, row.id);
        entry.title = entry.updated.includes('title') ? r.meta.title : row.title;
      }
      report.films.push(entry);
    }

    const seen = new Set(results.map((r) => r.slug));
    for (const [slug, row] of existing) {
      if (seen.has(slug)) continue;
      if (row.media_status !== 'missing') {
        db.prepare(`UPDATE films SET media_status = 'missing', scan_report = ?, scanned_at = ? WHERE id = ?`).run(
          JSON.stringify({ errors: ['The film folder no longer exists'], warnings: [] }), now, row.id,
        );
      }
      report.removed.push({ slug, title: row.title, published: Boolean(row.published) });
    }
  });

  return report;
}
