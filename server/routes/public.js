import path from 'node:path';
import express from 'express';
import { brandingType } from '../branding.js';
import { filmArtwork, filmMedia } from '../films.js';
import { faviconSvg } from '../theme.js';
import { TYPES, folderFile } from './media.js';

// What anyone may fetch, with no session: the cinema's logo and icon (they're
// on the sign-in page and in link previews), the tab icon in the cinema's
// colours, and the poster of a ticket link's preview. None of them reads or
// writes a session.
export function publicRoutes({ settings, branding, metadata, mediaDir, previews }) {
  const router = express.Router();

  // sendFile's errors as a bare status: the error isn't the file, so don't describe or cache it as if it were.
  const sent = (res) => (err) => {
    if (!err || err.code === 'ECONNABORTED' || res.headersSent) return;
    for (const h of ['Content-Type', 'Cache-Control']) res.removeHeader(h);
    res.status(err.statusCode === 404 || err.code === 'ENOENT' ? 404 : 500).end();
  };

  // Only the current logo and icon. Their names change whenever the image does.
  router.get('/branding/:file', (req, res) => {
    const file = branding.filePath(req.params.file);
    if (!file) return res.status(404).end();
    res.set('Content-Type', brandingType(file));
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(path.basename(file), { root: path.dirname(file) }, sent(res));
  });

  // Ahead of the web build's own copy, which has Open Matte's colours.
  router.get('/favicon.svg', (req, res) => {
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'no-cache');
    res.send(Buffer.from(faviconSvg(settings.get())));
  });

  // The film's poster, for a ticket link that previews its film (page.js says
  // which do, and counts this against the same limit). Anything else is a 404
  // that doesn't say why.
  router.get('/t/:code/poster', async (req, res) => {
    const film = previews(req, req.params.code)?.film;
    if (!film) return res.status(404).end();
    // As on the film's page: TMDb's poster when there is one, else the folder's,
    // found the way /media finds it.
    const downloaded = metadata.artworkPath(film, filmArtwork(film).poster?.file ?? '');
    const own = filmMedia(film).poster;
    let found = null;
    if (downloaded) found = { root: path.dirname(downloaded), file: path.basename(downloaded) };
    else if (own && film.media_status !== 'missing') found = await folderFile(mediaDir, film, path.posix.normalize(own));
    const type = TYPES[path.extname(downloaded || own || '').toLowerCase()];
    if (!found?.file || !type?.startsWith('image/')) return res.status(404).end();
    res.set('Content-Type', type);
    res.set('Cache-Control', 'public, max-age=600');
    res.sendFile(found.file, { root: found.root, dotfiles: 'deny' }, sent(res));
  });

  return router;
}
