import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { filmMedia } from '../films.js';
import { VIEWER_COOKIE, deviceLabel } from '../sessions.js';

// Why a media request was refused, for the server log. No IP addresses: just
// enough to tell a missing cookie from a missing ticket or screening.
function denialReason(req, who, access, film) {
  if (!who.viewer) return (req.headers.cookie || '').includes(`${VIEWER_COOKIE}=`) ? 'session expired or unknown' : 'no session cookie';
  const a = access.filmAccess(who, film);
  if (!a.canView) return 'no usable ticket for this film in this browser (or not signed in as its person)';
  if (a.via === 'member') return 'shown to members, but no ticket for this film in this browser';
  if (!a.canPlay) return `ticket ${a.status?.state}`;
  return 'no screening held by this browser';
}

// What kind of file a refused request was for, from its extension.
const KINDS = {
  '.m3u8': 'playlist',
  '.vtt': 'subtitles',
  ...Object.fromEntries(['.m4s', '.mp4', '.m4a', '.m4v', '.cmfv', '.cmfa', '.ts', '.aac'].map((e) => [e, 'segment'])),
  ...Object.fromEntries(['.jpg', '.jpeg', '.png', '.webp', '.avif'].map((e) => [e, 'artwork'])),
};

// Refused media requests, remembered in memory for the projection booth: the
// last `keep`, and how many of each reason since the server started. Playback
// help sends nothing, so these are all the server knows of playback going
// wrong. Only what's here is kept: no address, cookie, session, ticket, person,
// path or user agent, just the coarse client label the log line uses.
export function createRefusals({ keep = 50, now = () => Date.now() } = {}) {
  const since = now();
  const recent = [];
  const byReason = {};
  let total = 0;

  function add({ status, reason, kind, film, client }) {
    total++;
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    recent.unshift({ at: now(), status, reason, kind, film, client });
    recent.length = Math.min(recent.length, keep);
  }

  // Newest first.
  const view = (n = keep) => ({ since, total, byReason: { ...byReason }, recent: recent.slice(0, n) });

  return { add, view };
}

// `code` is the error code of a failed read, whose message (the reason) names
// the file's full path: the booth gets the code alone.
function logDenied(req, status, reason, { refusals, film, ext, code }) {
  const ua = req.get('user-agent') || '';
  const client = /AppleCoreMedia/.test(ua) ? `Apple media player (${deviceLabel(ua).split(' on ')[1]})` : deviceLabel(ua);
  console.warn(`media ${status}: ${req.path} - ${reason} - ${client}${req.headers.range ? ` - range ${req.headers.range}` : ''}`);
  const kept = status >= 500 ? `couldn't read the file${code ? ` (${code})` : ''}` : reason;
  refusals?.add({ status, reason: kept, kind: KINDS[ext] ?? 'other', film: film.slug, client });
}

export const TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.m4v': 'video/mp4',
  '.cmfv': 'video/mp4',
  '.cmfa': 'audio/mp4',
  '.ts': 'video/mp2t',
  '.aac': 'audio/aac',
  '.vtt': 'text/vtt; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

// A file in a film's folder, by its path there: { root, file } to pass to
// sendFile, or { status, reason } when it can't be served (no reason: nothing
// worth logging). Where the file really is must be inside the folder too, so a
// symlink can't serve something from elsewhere on the server.
export async function folderFile(mediaDir, film, rel) {
  const root = path.join(mediaDir, film.slug);
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return { status: 404 };
  let real;
  let realRoot;
  try {
    [real, realRoot] = await Promise.all([fsp.realpath(file), fsp.realpath(root)]);
  } catch (err) {
    // Anything but a missing file (permissions, network storage briefly
    // unavailable) is the server's problem, and players retry those.
    const missing = ['ENOENT', 'ENOTDIR', 'ENAMETOOLONG'].includes(err.code);
    return missing ? { status: 404, reason: 'file missing from the film folder' } : { status: 500, reason: err.message, code: err.code };
  }
  if (!real.startsWith(realRoot + path.sep)) return { status: 404, reason: 'symlink to a file outside the film folder' };
  return { root: realRoot, file: path.relative(realRoot, real) };
}

// /media/<slug>/<path>. Every request is checked against the viewer's session:
// artwork needs whatever lets you see the film page (a ticket, or being signed
// in, for a film shown to members); master and child playlists, init and media
// segments, audio and subtitles need a screening that this browser holds.
// Knowing a file path is not enough.
export function mediaRoutes({ db, sessions, access, mediaDir, metadata, refusals }) {
  const router = express.Router();
  const filmBySlug = db.prepare('SELECT * FROM films WHERE slug = ?');

  router.get('/media/:slug/*rest', async (req, res) => {
    const film = filmBySlug.get(req.params.slug);
    const rel = path.posix.normalize([].concat(req.params.rest).join('/'));
    const ext = path.extname(rel).toLowerCase();
    if (!film || !TYPES[ext] || film.media_status === 'missing') return res.status(404).end();
    const about = { refusals, film, ext };

    const who = { viewer: sessions.load(req, 'viewer'), admin: sessions.load(req, 'admin') };
    const media = filmMedia(film);
    const isArtwork = rel === media.poster || rel === media.backdrop;
    const allowed = isArtwork ? access.filmAccess(who, film).canView : access.mayStream(who, film);
    if (!allowed) {
      logDenied(req, 403, denialReason(req, who, access, film), about);
      return res.status(403).end();
    }

    const found = await folderFile(mediaDir, film, rel);
    if (found.status) {
      if (found.reason) logDenied(req, found.status, found.reason, { ...about, code: found.code });
      return res.status(found.status).end();
    }

    res.set('Content-Type', TYPES[ext]);
    // Playlists may change when a film is re-imported; segment files don't.
    // Either way, only the viewer's own browser may cache them.
    res.set('Cache-Control', ext === '.m3u8' || ext === '.vtt' ? 'private, no-cache' : 'private, max-age=86400');
    res.sendFile(found.file, { root: found.root, dotfiles: 'deny' }, (err) => {
      // Done, or the viewer went away mid-download (seeking, closing the tab).
      if (!err || err.code === 'ECONNABORTED' || res.headersSent) return;
      // send's own refusals (a range past the end, a hidden file) keep their
      // 4xx; failing to read the file is a 500, which players retry.
      const hidden = err.statusCode === 403;
      const status = hidden || err.code === 'ENOENT' ? 404 : err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      logDenied(req, status, hidden ? 'hidden file' : status === 404 ? 'file missing from the film folder' : err.message, { ...about, code: err.code });
      // The error isn't the file: don't describe or cache it as if it were.
      for (const h of ['Content-Type', 'Content-Length', 'Cache-Control']) res.removeHeader(h);
      res.status(status).end();
    });
  });

  // /artwork/<slug>/<file>: posters and backdrops downloaded from TMDb.
  // Same rule as the folder's artwork: whatever shows you the page.
  router.get('/artwork/:slug/:file', (req, res) => {
    const film = filmBySlug.get(req.params.slug);
    const file = film && metadata.artworkPath(film, req.params.file);
    if (!file) return res.status(404).end();
    const who = { viewer: sessions.load(req, 'viewer'), admin: sessions.load(req, 'admin') };
    if (!access.filmAccess(who, film).canView) return res.status(403).end();
    // The file name changes whenever the image does.
    res.set('Cache-Control', 'private, max-age=604800, immutable');
    res.sendFile(file, (err) => {
      if (err && !res.headersSent) res.status(err.statusCode === 404 || err.code === 'ENOENT' ? 404 : 500).end();
    });
  });

  return router;
}
