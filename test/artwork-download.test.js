// Downloading a poster from TMDb's image host: only from that host, no further
// than the size limit, judged by its bytes, and failing with a clear message.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { makeFilm, pngImage, tempDir } from './helpers.js';

const { openDb } = await import('../server/db.js');
const { createMetadata, MetadataError } = await import('../server/metadata.js');
const { createSettings } = await import('../server/settings.js');
const { scanMedia } = await import('../server/scan.js');

const MB = 1024 * 1024;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00]), Buffer.from('a poster')]);

// Writes `total` bytes, as fast as the reader takes them, and stops when the
// reader goes away. Resolves with how much was written.
function pour(res, total) {
  const chunk = Buffer.alloc(MB, 0xff);
  return new Promise((resolve) => {
    let sent = 0;
    let closed = false;
    res.on('close', () => {
      closed = true;
      resolve(sent);
    });
    const next = () => {
      while (!closed && sent < total) {
        sent += chunk.length;
        if (!res.write(chunk)) return res.once('drain', next);
      }
      if (!closed) res.end();
    };
    next();
  });
}

const images = {
  // Says 40 MB up front, then sends almost nothing.
  '/big.jpg': (res) => {
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(40 * MB) });
    res.write(JPEG);
  },
  // No length given: 40 MB, for as long as anyone reads.
  '/endless.jpg': (res) => {
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    res.write(JPEG);
    poured.push(pour(res, 40 * MB));
  },
  // The connection drops halfway through.
  '/cut.jpg': (res) => {
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': '1000' });
    res.write(JPEG);
    setTimeout(() => res.socket.destroy(), 50);
  },
  // A PNG, though the header says JPEG.
  '/png.jpg': (res) => {
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    res.end(pngImage(4, 4));
  },
  '/text.jpg': (res) => {
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    res.end('<html>not an image</html>');
  },
  // Sent on elsewhere.
  '/moved.jpg': (res) => {
    res.writeHead(302, { location: '/t/p/w780/png.jpg' });
    res.end();
  },
};
const poured = [];

let server;
let base;
let metadata;
let film;
let dataDir;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const image = url.pathname.match(/^\/t\/p\/w\d+(\/.+)$/);
    if (image && images[image[1]]) return images[image[1]](res);
    if (url.pathname === '/3/movie/1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: 1, title: 'Arrival', images: { posters: Object.keys(images).map((p) => ({ file_path: p })), backdrops: [] } }));
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const db = openDb(':memory:');
  const mediaDir = tempDir();
  makeFilm(mediaDir, 'arrival');
  await scanMedia(db, mediaDir);
  film = db.prepare("SELECT * FROM films WHERE slug = 'arrival'").get();
  dataDir = tempDir();
  metadata = createMetadata({ db, settings: createSettings(db), dataDir, apiBase: `${base}/3`, imageBase: `${base}/t/p`, envKey: 'a-key' });
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const choose = (poster) => metadata.apply(film, { tmdbId: 1, fields: [], poster });
const failsWith = (code) => (err) => err instanceof MetadataError && err.code === code;

test('an image announced as too big is refused before its body is read', { timeout: 10000 }, async () => {
  await assert.rejects(choose('/big.jpg'), failsWith('bad-image'));
});

test('an image of no stated size is read no further than the limit', { timeout: 20000 }, async () => {
  await assert.rejects(choose('/endless.jpg'), failsWith('bad-image'));
  const sent = await poured[0];
  assert.ok(sent < 40 * MB, `the download stopped early (${sent / MB} MB of 40 sent)`);
});

test('a connection that drops mid-image says the image couldn’t be downloaded', { timeout: 10000 }, async () => {
  await assert.rejects(choose('/cut.jpg'), (err) => failsWith('unreachable')(err) && /Couldn't download the image/.test(err.message));
});

test('the bytes decide what the image is, not the header', async () => {
  const { film: after } = await choose('/png.jpg');
  const poster = JSON.parse(after.artwork).poster.file;
  assert.match(poster, /^poster-[a-f0-9]{12}\.png$/);
  assert.deepEqual(fs.readFileSync(path.join(dataDir, 'artwork', 'arrival', poster)), pngImage(4, 4));
  await assert.rejects(choose('/text.jpg'), failsWith('bad-image'));
});

test('a redirect is not followed', async () => {
  await assert.rejects(choose('/moved.jpg'), failsWith('unreachable'));
});
