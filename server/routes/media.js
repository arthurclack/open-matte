import path from 'node:path';
import express from 'express';
import { filmMedia } from '../films.js';
import { VIEWER_COOKIE, deviceLabel } from '../sessions.js';

// Why a media request was refused, for the server log. No IP addresses: just
// enough to tell a missing cookie from a missing ticket or screening.
function denialReason(req, who, access, film) {
  if (!who.viewer) return (req.headers.cookie || '').includes(`${VIEWER_COOKIE}=`) ? 'session expired or unknown' : 'no session cookie';
  const a = access.filmAccess(who, film);
  if (!a.canView) return 'no ticket for this film in this browser';
  if (!a.canPlay) return `ticket ${a.status?.state}`;
  return 'no screening held by this browser';
}

function logDenied(req, status, reason) {
  const ua = req.get('user-agent') || '';
  const client = /AppleCoreMedia/.test(ua) ? `Apple media player (${deviceLabel(ua).split(' on ')[1]})` : deviceLabel(ua);
  console.warn(`media ${status}: ${req.path} - ${reason} - ${client}${req.headers.range ? ` - range ${req.headers.range}` : ''}`);
}

const TYPES = {
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

// /media/<slug>/<path>. Every request is checked against the viewer's session:
// artwork needs a ticket that lets you see the film page; master and child
// playlists, init and media segments, audio and subtitles need a screening
// that this browser holds. Knowing a file path is not enough.
export function mediaRoutes({ db, sessions, access, mediaDir, metadata }) {
  const router = express.Router();
  const filmBySlug = db.prepare('SELECT * FROM films WHERE slug = ?');

  router.get('/media/:slug/*rest', (req, res) => {
    const film = filmBySlug.get(req.params.slug);
    const rel = path.posix.normalize([].concat(req.params.rest).join('/'));
    const ext = path.extname(rel).toLowerCase();
    if (!film || !TYPES[ext] || film.media_status === 'missing') return res.status(404).end();

    const who = { viewer: sessions.load(req, 'viewer'), admin: sessions.load(req, 'admin') };
    const media = filmMedia(film);
    const isArtwork = rel === media.poster || rel === media.backdrop;
    const allowed = isArtwork ? access.filmAccess(who, film).canView : access.mayStream(who, film);
    if (!allowed) {
      logDenied(req, 403, denialReason(req, who, access, film));
      return res.status(403).end();
    }

    const root = path.join(mediaDir, film.slug);
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) return res.status(404).end();

    res.set('Content-Type', TYPES[ext]);
    // Playlists may change when a film is re-imported; segment files don't.
    // Either way, only the viewer's own browser may cache them.
    res.set('Cache-Control', ext === '.m3u8' || ext === '.vtt' ? 'private, no-cache' : 'private, max-age=86400');
    res.sendFile(file, { dotfiles: 'deny' }, (err) => {
      if (!err || res.headersSent) return;
      const status = err.statusCode === 404 || err.code === 'ENOENT' ? 404 : 500;
      logDenied(req, status, status === 404 ? 'file missing from the film folder' : err.message);
      res.status(status).end();
    });
  });

  // /artwork/<slug>/<file>: posters and backdrops downloaded from TMDb.
  // Same rule as the folder's artwork: you need a ticket that shows the page.
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
