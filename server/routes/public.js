import path from 'node:path';
import express from 'express';
import { brandingType } from '../branding.js';
import { filmArtwork, filmMedia } from '../films.js';
import { clientKey } from '../ratelimit.js';
import { faviconSvg } from '../theme.js';
import { TYPES, fileErrorStatus, folderFile, sendBare } from './media.js';

// What anyone may fetch, with no session: the cinema's logo and icon (they're
// on the sign-in page and in link previews), the tab icon in the cinema's
// colours, and the poster of a ticket link's preview. None of them reads or
// writes a session.
export function publicRoutes({ settings, branding, metadata, mediaDir, previews, share, refusalLog }) {
  const router = express.Router();

  // sendFile's errors as a bare status, mapped as /media maps them (media.js):
  // never described, sized or cached as the file, so a current logo whose file
  // has gone is not a 404 cached for a year.
  const sent = (res) => (err) => {
    if (!err || err.code === 'ECONNABORTED' || res.headersSent) return;
    const status = fileErrorStatus(err);
    // A file that is there but can't be read is the server's problem: say so in its log.
    if (status === 500) console.error(err);
    sendBare(res, status);
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
    const type = TYPES[path.extname(downloaded || own || '').toLowerCase()];
    if (!type?.startsWith('image/')) return res.status(404).end();
    const headers = { 'Content-Type': type, 'Cache-Control': 'public, max-age=600' };
    if (downloaded) {
      res.set(headers);
      return res.sendFile(path.basename(downloaded), { root: path.dirname(downloaded), dotfiles: 'deny' }, sent(res));
    }
    if (!own || film.media_status === 'missing') return res.status(404).end();
    // The folder's poster is on the films' share, so it takes its place there
    // like any media request (media.js, createShare): one of the artwork's places,
    // never a player's, and no more of them for one visitor's address than one
    // browser may hold, since there's no session to count by. Not finding it is
    // a 404. A failure goes to the log as a refused media request's does (media.js,
    // createRefusalLog), and like a stranger's: whoever has the address can ask
    // again and again while the share is busy.
    await share.send(res, () => folderFile(mediaDir, film, path.posix.normalize(own)).then((f) => (f.status ? { status: 404 } : f)), {
      client: `address ${clientKey(req.ip)}`,
      clientName: 'address',
      artwork: true,
      headers,
      failed: ({ status, reason }) => status >= 500 && refusalLog.add(`poster ${status} ${reason}`, `poster ${status}: ${reason}`, { stranger: true }),
    });
  });

  return router;
}
