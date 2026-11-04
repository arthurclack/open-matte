// A stand-in for TMDB, on this machine, for the journeys: e2e/server.js points the
// app's TMDB addresses here, on 127.0.0.1, which is another origin from the app's
// localhost, as TMDB's image server is in real life. It knows one film, found by
// searching for THUMBNAIL_QUERY, with a poster; every other search finds nothing, so
// the test films are never matched. Any key works.
import http from 'node:http';
import zlib from 'node:zlib';

export const THUMBNAIL_QUERY = 'Stand-in Thumbnail';

// A real PNG of one colour, 2 by 3 pixels, so a browser can draw it.
function png() {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(3, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.from([0, 74, 176, 232, 74, 176, 232]);
  const pixels = zlib.deflateSync(Buffer.concat([row, row, row]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}
const POSTER = png();

const FILM = { id: 900001, title: 'A Stand-in Thumbnail', original_title: 'A Stand-in Thumbnail', release_date: '1999-05-01', overview: 'Found only by the journeys.', poster_path: '/e2e-poster.png' };

export function startTmdb() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://tmdb.test');
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/3/configuration') return json(200, {});
    if (url.pathname === '/3/search/movie') {
      const found = (url.searchParams.get('query') ?? '').includes(THUMBNAIL_QUERY);
      return json(200, { page: 1, results: found ? [FILM] : [], total_results: found ? 1 : 0 });
    }
    if (/^\/t\/p\/\w+\/e2e-poster\.png$/.test(url.pathname)) {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': POSTER.length });
      return res.end(POSTER);
    }
    json(404, { status_message: 'not found' });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}
