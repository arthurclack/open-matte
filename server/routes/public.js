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

  // sendFile's errors as a bare status, mapped as /media maps them: a missing or
  // hidden file is a 404 that doesn't say why; send's own refusals (a range past
  // the end, a failed If-Match) keep their 4xx; failing to read the file is a
  // 500. The error isn't the file, so none of the file's headers go with it: it
  // is never described, sized or cached as the file (a current logo whose file
  // has gone must not be a 404 cached for a year).
  const sent = (res) => (err) => {
    if (!err || err.code === 'ECONNABORTED' || res.headersSent) return;
    const s = err.statusCode;
    const status = s === 403 || s === 404 || err.code === 'ENOENT' ? 404 : s >= 400 && s < 500 ? s : 500;
    // A file that is there but can't be read is the server's problem: say so in its log.
    if (status === 500) console.error(err);
    for (const h of ['Content-Type', 'Content-Length', 'Cache-Control', 'ETag', 'Last-Modified', 'Accept-Ranges']) res.removeHeader(h);
    // A 416 says how long the file is, as it should; nothing else does.
    if (status !== 416) res.removeHeader('Content-Range');
    res.status(status).end();
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

  // The film's poster, for a ticket link that previews its film, at the address
  // page.js gives it: /poster/<ticket id>.<mac>, which holds no ticket code
  // (page.js says which tickets preview, and counts this against the same
  // limit). Anything else is a 404 that doesn't say why.
  router.get('/poster/:ref', async (req, res) => {
    const film = previews.poster(req, req.params.ref);
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
