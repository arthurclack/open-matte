import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { filmArtwork, filmMedia } from './films.js';
import { META_FIELDS } from './scan.js';
import { guessTitleYear, looksLikeReleaseName, normalizeTitle } from './titles.js';

// Film information and artwork from TMDb (The Movie Database), as Jellyfin does.
//
// Precedence, highest first: your edits in the admin, film.json, TMDb. Matching
// on import only fills empty fields; picking a match by hand applies the fields
// you tick. Your recommendation is never touched. Images are downloaded into
// DATA_DIR/artwork, so viewers' browsers never contact TMDb, and the API key
// never leaves the server.

// The fields TMDb can fill.
export const TMDB_FIELDS = ['title', 'originalTitle', 'year', 'runtimeMinutes', 'directors', 'country', 'synopsis', 'contentNote'];

const SIZES = { poster: 'w780', backdrop: 'w1280' };
const THUMBS = { poster: 'w185', backdrop: 'w300' };
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const TMDB_IMAGE_PATH = /^\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/;
export const ARTWORK_FILE = /^(poster|backdrop)-[a-f0-9]{12}\.(?:jpg|png|webp)$/;
const COUNTRY_NAMES = { 'United States of America': 'United States' };

export class MetadataError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const parse = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};
const yearOf = (date) => (/^\d{4}/.test(date || '') ? Number(date.slice(0, 4)) : null);
const unique = (xs) => [...new Set(xs)];

export const filmSources = (film) => parse(film.meta_sources) || {};

// "Rated R", "BBFC 15", "FSK 12 (DE)": the certificate for the viewer's region.
function certification(releaseDates, region) {
  const results = releaseDates?.results || [];
  for (const r of [region, 'US']) {
    const entry = results.find((x) => x.iso_3166_1 === r);
    const cert = entry?.release_dates?.map((d) => d.certification?.trim()).find(Boolean);
    if (cert) return r === 'US' ? `Rated ${cert}` : r === 'GB' ? `BBFC ${cert}` : `${cert} (${r})`;
  }
  return null;
}

export function createMetadata({
  db,
  settings,
  dataDir,
  apiBase = config.tmdbApiBase,
  imageBase = config.tmdbImageBase,
  envKey = config.tmdbApiKey,
  fetchImpl = (...args) => globalThis.fetch(...args),
}) {
  const artworkDir = path.join(dataDir, 'artwork');
  const filmRow = db.prepare('SELECT * FROM films WHERE id = ?');
  const setStatus = db.prepare('UPDATE films SET tmdb_status = ? WHERE id = ?');

  const key = () => envKey || settings.getSecret('tmdbApiKey') || '';
  const language = () => settings.get().metadataLanguage || 'en-US';

  function status() {
    const k = key();
    return { configured: Boolean(k), source: envKey ? 'env' : k ? 'settings' : null, hint: k ? `…${k.slice(-4)}` : null };
  }

  async function request(pathname, params = {}, apiKey = key()) {
    if (!apiKey) throw new MetadataError('not-configured', 'Add a TMDB API key in Settings first.', 409);
    const url = new URL(apiBase + pathname);
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
    const headers = { accept: 'application/json' };
    // v4 "API Read Access Tokens" are JWTs; v3 API keys are 32 hex characters.
    if (apiKey.startsWith('eyJ')) headers.authorization = `Bearer ${apiKey}`;
    else url.searchParams.set('api_key', apiKey);
    let res;
    try {
      res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10000) });
    } catch {
      throw new MetadataError('unreachable', "Couldn't reach TMDB. Try again in a moment.");
    }
    if (res.status === 401) throw new MetadataError('invalid-key', 'TMDB rejected the API key.', 400);
    if (res.status === 404) throw new MetadataError('not-found', 'TMDB has no such film.', 404);
    if (res.status === 429) throw new MetadataError('rate-limited', 'TMDB is limiting requests. Try again shortly.', 503);
    if (!res.ok) throw new MetadataError('tmdb-error', `TMDB answered with an error (${res.status}).`);
    return res.json();
  }

  const thumb = (p, kind) => (p ? `${imageBase}/${THUMBS[kind]}${p}` : null);

  async function verifyKey(apiKey) {
    await request('/configuration', {}, apiKey);
  }

  async function search(query, year) {
    const base = { query, include_adult: 'false', language: language() };
    let data = await request('/search/movie', { ...base, year });
    if (year && !data.results?.length) data = await request('/search/movie', base);
    return (data.results || []).slice(0, 20).map((r) => ({
      tmdbId: r.id,
      title: r.title,
      originalTitle: r.original_title,
      year: yearOf(r.release_date),
      overview: r.overview || '',
      posterThumb: thumb(r.poster_path, 'poster'),
    }));
  }

  function imageChoices(list, primary, kind) {
    const all = [...(list || [])].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    const paths = unique([primary, ...all.map((i) => i.file_path)].filter((p) => p && TMDB_IMAGE_PATH.test(p))).slice(0, 18);
    const byPath = new Map(all.map((i) => [i.file_path, i]));
    return paths.map((p) => ({ path: p, thumb: thumb(p, kind), width: byPath.get(p)?.width ?? null, height: byPath.get(p)?.height ?? null }));
  }

  async function details(tmdbId) {
    const lang = language();
    const d = await request(`/movie/${Number(tmdbId)}`, {
      language: lang,
      append_to_response: 'credits,images,release_dates',
      include_image_language: `${lang.split('-')[0]},null`,
    });
    const raw = {
      title: d.title || null,
      originalTitle: d.original_title && d.original_title !== d.title ? d.original_title : null,
      year: yearOf(d.release_date),
      runtimeMinutes: d.runtime || null,
      directors: unique((d.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name)).join(', ') || null,
      country: (d.production_countries || []).slice(0, 3).map((c) => COUNTRY_NAMES[c.name] || c.name).join(', ') || null,
      synopsis: d.overview || null,
      contentNote: certification(d.release_dates, lang.split('-')[1] || 'US'),
    };
    // TMDb data must pass the same checks as film.json and admin edits.
    const fields = {};
    for (const k of TMDB_FIELDS) {
      const r = META_FIELDS[k].check(raw[k]);
      fields[k] = r.error ? null : r.value;
    }
    return {
      tmdbId: d.id,
      imdbId: d.imdb_id || null,
      fields,
      posters: imageChoices(d.images?.posters, d.poster_path, 'poster'),
      backdrops: imageChoices(d.images?.backdrops, d.backdrop_path, 'backdrop'),
      defaultPoster: d.poster_path || null,
      defaultBackdrop: d.backdrop_path || null,
    };
  }

  async function downloadImage(slug, kind, tmdbPath) {
    if (!TMDB_IMAGE_PATH.test(tmdbPath || '')) throw new MetadataError('bad-image', 'That image is not one TMDB offers for this film.', 400);
    let res;
    try {
      res = await fetchImpl(`${imageBase}/${SIZES[kind]}${tmdbPath}`, { signal: AbortSignal.timeout(30000) });
    } catch {
      throw new MetadataError('unreachable', "Couldn't download the image from TMDB.");
    }
    if (!res.ok) throw new MetadataError('tmdb-error', `TMDB couldn't send the image (${res.status}).`);
    const ext = IMAGE_TYPES[(res.headers.get('content-type') || '').split(';')[0].trim()];
    const buf = Buffer.from(await res.arrayBuffer());
    if (!ext || !buf.length || buf.length > MAX_IMAGE_BYTES) throw new MetadataError('bad-image', 'TMDB sent something that isn’t a usable image.');
    const dir = path.join(artworkDir, slug);
    fs.mkdirSync(dir, { recursive: true });
    const name = `${kind}-${crypto.createHash('sha1').update(tmdbPath).digest('hex').slice(0, 12)}.${ext}`;
    const tmp = path.join(dir, `.${name}.tmp`);
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, path.join(dir, name));
    return name;
  }

  function removeArtworkFile(slug, file) {
    if (!file || !ARTWORK_FILE.test(file)) return;
    fs.rmSync(path.join(artworkDir, slug, file), { force: true });
  }

  // Empty fields can be filled. So can a title that is obviously a file name,
  // or one that differs from TMDb's only in punctuation, accents or capitals
  // ("Paris Texas" from a file name becomes "Paris, Texas").
  function fillable(key, current, value) {
    if (current == null || current === '') return true;
    return key === 'title' && (looksLikeReleaseName(current) || normalizeTitle(current) === normalizeTitle(value));
  }

  // Writes TMDb details to a film.
  //   fields:   which fields to take; with fillOnly, only those that are empty
  //   poster, backdrop: a TMDb image path to download, or undefined to leave artwork alone
  async function applyDetails(film, d, { fields = TMDB_FIELDS, fillOnly = false, poster, backdrop, how }) {
    const artwork = filmArtwork(film);
    const downloads = {};
    for (const [kind, choice, offered] of [['poster', poster, d.posters], ['backdrop', backdrop, d.backdrops]]) {
      if (choice === undefined || choice === null) continue;
      if (!offered.some((i) => i.path === choice)) throw new MetadataError('bad-image', 'That image is not one TMDB offers for this film.', 400);
      downloads[kind] = await downloadImage(film.slug, kind, choice);
    }

    // Re-read: the film may have changed while the images downloaded.
    const fresh = filmRow.get(film.id);
    const sources = filmSources(fresh);
    const sets = [];
    const args = [];
    const changed = [];
    for (const key of fields) {
      if (!TMDB_FIELDS.includes(key)) continue;
      const value = d.fields[key];
      const column = META_FIELDS[key].column;
      if (value == null || (fillOnly && !fillable(key, fresh[column], value))) continue;
      sets.push(`${column} = ?`);
      args.push(value);
      sources[key] = 'tmdb';
      if (fresh[column] !== value) changed.push(key);
    }
    for (const [kind, file] of Object.entries(downloads)) {
      const tmdbPath = kind === 'poster' ? poster : backdrop;
      if (artwork[kind]?.file !== file) removeArtworkFile(film.slug, artwork[kind]?.file);
      artwork[kind] = { file, tmdbPath };
      changed.push(kind);
    }
    const state = { state: 'matched', how, at: Date.now(), title: d.fields.title, year: d.fields.year };
    db.prepare(
      `UPDATE films SET ${[...sets, 'tmdb_id = ?', 'tmdb_status = ?', 'meta_sources = ?', 'artwork = ?', 'updated_at = ?'].join(', ')} WHERE id = ?`,
    ).run(...args, d.tmdbId, JSON.stringify(state), JSON.stringify(sources), JSON.stringify(artwork), Date.now(), film.id);
    return { film: filmRow.get(film.id), changed };
  }

  async function apply(film, { tmdbId, fields, poster, backdrop }) {
    const d = await details(tmdbId);
    return applyDetails(film, d, { fields: fields || TMDB_FIELDS, poster, backdrop, how: 'manual' });
  }

  // Uses the folder's artwork again instead of the downloaded one.
  function resetArtwork(film, kind) {
    const artwork = filmArtwork(film);
    removeArtworkFile(film.slug, artwork[kind]?.file);
    delete artwork[kind];
    db.prepare('UPDATE films SET artwork = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(artwork), Date.now(), film.id);
    return filmRow.get(film.id);
  }

  // Matching on import. Applies a match only when it is unambiguous: one
  // result with the same title and year (or a pinned tmdbId from film.json).
  async function autoIdentify(film) {
    try {
      let tmdbId = film.tmdb_id;
      if (!tmdbId) {
        const guess = looksLikeReleaseName(film.title) ? guessTitleYear(film.title) : { title: film.title, year: null };
        const year = film.year || guess.year;
        const results = await search(guess.title, year);
        const wanted = normalizeTitle(guess.title);
        const sameTitle = results.filter((r) => normalizeTitle(r.title) === wanted || normalizeTitle(r.originalTitle) === wanted);
        let picks = year ? sameTitle.filter((r) => r.year === year) : sameTitle;
        if (year && !picks.length) picks = sameTitle.filter((r) => r.year && Math.abs(r.year - year) === 1);
        if (picks.length !== 1) {
          const state = results.length ? 'needs-choice' : 'not-found';
          setStatus.run(JSON.stringify({ state, at: Date.now(), query: guess.title, year, candidates: results.length }), film.id);
          return;
        }
        tmdbId = picks[0].tmdbId;
      }
      const d = await details(tmdbId);
      const media = filmMedia(film);
      const artwork = filmArtwork(film);
      await applyDetails(film, d, {
        fillOnly: true,
        poster: media.poster || artwork.poster ? undefined : d.defaultPoster,
        backdrop: media.backdrop || artwork.backdrop ? undefined : d.defaultBackdrop,
        how: 'auto',
      });
    } catch (err) {
      setStatus.run(JSON.stringify({ state: 'error', at: Date.now(), message: err.message }), film.id);
    }
  }

  // One lookup at a time, in the background, after scans. Each step catches its
  // own failure, so one bad lookup can't stall the ones queued behind it, and a
  // film already waiting isn't queued twice.
  let chain = Promise.resolve();
  const queued = new Set();
  function queueUnmatched() {
    if (!key()) return chain;
    // Never-tried films, and ones where the last try failed (TMDb down, say).
    const ids = db
      .prepare("SELECT id FROM films WHERE tmdb_status IS NULL OR json_extract(tmdb_status, '$.state') = 'error'")
      .all()
      .map((r) => r.id)
      .filter((id) => !queued.has(id));
    for (const id of ids) {
      queued.add(id);
      chain = chain
        .then(() => {
          const film = filmRow.get(id);
          const state = film && parse(film.tmdb_status)?.state;
          if (film && (!state || state === 'error') && key()) return autoIdentify(film);
          return undefined;
        })
        .catch((err) => console.error(`TMDB lookup for film ${id} failed:`, err))
        .finally(() => queued.delete(id));
    }
    return chain;
  }

  function artworkPath(film, file) {
    const artwork = filmArtwork(film);
    if (!ARTWORK_FILE.test(file) || (artwork.poster?.file !== file && artwork.backdrop?.file !== file)) return null;
    return path.join(artworkDir, film.slug, file);
  }

  return {
    status,
    verifyKey,
    search,
    details,
    apply,
    resetArtwork,
    autoIdentify,
    queueUnmatched,
    idle: () => chain,
    artworkPath,
  };
}
