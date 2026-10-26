// Film information and artwork from TMDb, against a fake TMDb server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { adminBrowser, browser, makeFilm, startServer, tempDir, writeFilmJson } from './helpers.js';

const GOOD_KEY = 'good-key-0123';
const GOOD_TOKEN = 'eyJgood.token.value';

const SEARCH = {
  arrival: [
    { id: 329865, title: 'Arrival', original_title: 'Arrival', release_date: '2016-11-10', overview: 'A linguist works with the military.', poster_path: '/arrival.jpg' },
    { id: 999, title: 'The Arrival', original_title: 'The Arrival', release_date: '1996-05-31', overview: 'Aliens again.', poster_path: null },
  ],
  'hedwig and the angry inch': [
    { id: 13403, title: 'Hedwig and the Angry Inch', original_title: 'Hedwig and the Angry Inch', release_date: '2001-07-20', overview: 'A rock musical.', poster_path: '/hedwig.jpg' },
  ],
  'paris texas': [
    { id: 655, title: 'Paris, Texas', original_title: 'Paris, Texas', release_date: '1984-05-19', overview: 'A drifter.', poster_path: '/paris.jpg' },
  ],
  twins: [
    { id: 1, title: 'Twins', original_title: 'Twins', release_date: '1988-12-09', overview: 'Comedy.', poster_path: '/twins.jpg' },
    { id: 2, title: 'Twins', original_title: 'Twins', release_date: '1988-03-01', overview: 'Another.', poster_path: null },
  ],
};

const DETAILS = {
  329865: {
    id: 329865, imdb_id: 'tt2543164', title: 'Arrival', original_title: 'Arrival', release_date: '2016-11-10', runtime: 116,
    overview: 'Taking place after alien crafts land around the world, an expert linguist is recruited.',
    production_countries: [{ iso_3166_1: 'US', name: 'United States of America' }],
    credits: { crew: [{ job: 'Director', name: 'Denis Villeneuve' }, { job: 'Writer', name: 'Eric Heisserer' }] },
    images: { posters: [{ file_path: '/arrival.jpg', vote_average: 5 }], backdrops: [{ file_path: '/arrival-bg.jpg', vote_average: 5 }] },
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13', type: 3 }] }] },
    poster_path: '/arrival.jpg', backdrop_path: '/arrival-bg.jpg',
  },
  13403: {
    id: 13403, title: 'Hedwig and the Angry Inch', original_title: 'Hedwig and the Angry Inch', release_date: '2001-07-20', runtime: 95,
    overview: 'A transgender punk-rock singer tours the US with her band.',
    production_countries: [{ iso_3166_1: 'US', name: 'United States of America' }],
    credits: { crew: [{ job: 'Director', name: 'John Cameron Mitchell' }] },
    images: { posters: [{ file_path: '/hedwig.jpg', vote_average: 6 }, { file_path: '/hedwig-alt.jpg', vote_average: 4 }], backdrops: [{ file_path: '/hedwig-bg.jpg' }] },
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'R', type: 3 }] }] },
    poster_path: '/hedwig.jpg', backdrop_path: '/hedwig-bg.jpg',
  },
  655: {
    id: 655, title: 'Paris, Texas', original_title: 'Paris, Texas', release_date: '1984-05-19', runtime: 145, overview: 'A drifter walks out of the desert.',
    production_countries: [{ iso_3166_1: 'DE', name: 'Germany' }, { iso_3166_1: 'FR', name: 'France' }],
    credits: { crew: [{ job: 'Director', name: 'Wim Wenders' }] }, images: { posters: [], backdrops: [] }, release_dates: { results: [] },
    poster_path: null, backdrop_path: null,
  },
  1: {
    id: 1, title: 'Twins', original_title: 'Twins', release_date: '1988-12-09', runtime: 107, overview: 'Separated at birth.',
    production_countries: [], credits: { crew: [{ job: 'Director', name: 'Ivan Reitman' }] },
    images: { posters: [{ file_path: '/twins.jpg' }, { file_path: '/twins-alt.jpg' }], backdrops: [] },
    release_dates: { results: [] }, poster_path: '/twins.jpg', backdrop_path: null,
  },
};

// A stand-in for api.themoviedb.org and image.tmdb.org.
function fakeTmdb() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push(url);
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname.startsWith('/t/p/')) {
      const file = url.pathname.split('/').pop();
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      return res.end(`JPEG ${url.pathname.split('/')[3]} ${file}`);
    }
    const key = url.searchParams.get('api_key');
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (key !== GOOD_KEY && bearer !== GOOD_TOKEN) return json(401, { status_message: 'Invalid API key' });
    if (url.pathname === '/3/configuration') return json(200, { images: {} });
    if (url.pathname === '/3/search/movie') {
      const q = url.searchParams.get('query').toLowerCase();
      const year = url.searchParams.get('year');
      let results = SEARCH[q] || [];
      if (year) results = results.filter((r) => r.release_date.startsWith(year));
      return json(200, { results });
    }
    const m = url.pathname.match(/^\/3\/movie\/(\d+)$/);
    if (m && DETAILS[m[1]]) return json(200, DETAILS[m[1]]);
    return json(404, { status_message: 'Not found' });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

let tmdb;
let srv;
let admin;
const mediaDir = tempDir();
const dataDir = tempDir();
const films = {};

const film = async (slug) => (await admin.get(`/api/admin/films/${films[slug]}`)).data;

before(async () => {
  tmdb = await fakeTmdb();
  // A film named after its release file, with no year and no poster.
  makeFilm(mediaDir, 'hedwig', { title: 'Hedwig.and.the.Angry.Inch.2001.1080p.BluRay.x264', year: undefined, poster: undefined, synopsis: undefined, recommendation: 'Mine, all mine.' });
  fs.rmSync(path.join(mediaDir, 'hedwig', 'poster.jpg'));
  makeFilm(mediaDir, 'arrival');
  makeFilm(mediaDir, 'twins', { title: 'Twins', year: 1988 });
  makeFilm(mediaDir, 'paris-texas', { title: 'Paris Texas', year: 1984 });
  srv = await startServer({ mediaDir, dataDir, metadataOptions: { apiBase: `${tmdb.base}/3`, imageBase: `${tmdb.base}/t/p`, envKey: '' } });
  admin = await adminBrowser(srv.base);
});
after(async () => {
  await srv.close();
  tmdb.server.close();
});

describe('setting up', () => {
  test('without a key, lookups say how to set one up', async () => {
    await admin.post('/api/admin/scan');
    for (const f of (await admin.get('/api/admin/films')).data) films[f.slug] = f.id;
    assert.equal((await admin.get('/api/admin/metadata')).data.configured, false);
    const r = await admin.get(`/api/admin/films/${films.twins}/metadata/search?q=Twins`);
    assert.equal(r.status, 409);
    assert.match(r.data.error, /Add a TMDB API key/);
    assert.equal((await film('hedwig')).tmdbStatus, null, 'nothing is tried without a key');
  });

  test('a key TMDb rejects is not saved', async () => {
    const r = await admin.patch('/api/admin/settings', { tmdbApiKey: 'nope' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /rejected/);
    assert.equal((await admin.get('/api/admin/settings')).data.tmdb.configured, false);
  });

  test('a save with an invalid field changes nothing, not even the key', async () => {
    const r = await admin.patch('/api/admin/settings', { tmdbApiKey: GOOD_KEY, metadataLanguage: 'english' });
    assert.equal(r.status, 400);
    assert.equal((await admin.get('/api/admin/settings')).data.tmdb.configured, false);
  });

  test('a v4 read token works and is sent as a bearer header', async () => {
    const r = await admin.patch('/api/admin/settings', { tmdbApiKey: GOOD_TOKEN });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.tmdb.configured, true);
    await admin.patch('/api/admin/settings', { tmdbApiKey: '' });
    assert.equal((await admin.get('/api/admin/settings')).data.tmdb.configured, false);
  });

  test('a working key is saved but never shown again', async () => {
    const r = await admin.patch('/api/admin/settings', { tmdbApiKey: GOOD_KEY });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.tmdb, { configured: true, source: 'settings', hint: '…0123' });
    for (const url of ['/api/admin/settings', '/api/site']) {
      assert.ok(!JSON.stringify((await admin.get(url)).data).includes(GOOD_KEY), url);
    }
    assert.equal((await browser(srv.base).get('/api/site')).data.tmdbCredit, true);
  });
});

describe('matching on import', () => {
  before(async () => {
    // Saving the key queued the unmatched films; wait for the lookups.
    await srv.app.locals.metadata.idle();
  });

  test('a film named after its file is matched, cleaned up and given artwork', async () => {
    const f = await film('hedwig');
    assert.equal(f.tmdbStatus.state, 'matched');
    assert.equal(f.tmdbStatus.how, 'auto');
    assert.equal(f.tmdbId, 13403);
    assert.equal(f.title, 'Hedwig and the Angry Inch');
    assert.equal(f.year, 2001);
    assert.equal(f.directors, 'John Cameron Mitchell');
    assert.equal(f.country, 'United States');
    assert.equal(f.contentNote, 'Rated R');
    assert.match(f.synopsis, /punk-rock/);
    assert.equal(f.recommendation, 'Mine, all mine.', 'the recommendation is never touched');
    assert.equal(f.metaSources.title, 'tmdb');
    assert.equal(f.artworkSource.poster, 'tmdb');
    assert.equal(f.mediaStatus, 'ok', 'no poster in the folder is no longer worth a warning');
    assert.match(f.posterUrl, /^\/artwork\/hedwig\/poster-[a-f0-9]{12}\.jpg$/);
    const file = path.join(dataDir, 'artwork', 'hedwig', f.posterUrl.split('/').pop());
    assert.equal(fs.readFileSync(file, 'utf8'), 'JPEG w780 hedwig.jpg');
  });

  test('matching fills gaps but keeps what film.json said and the folder’s own poster', async () => {
    const f = await film('arrival');
    assert.equal(f.tmdbStatus.state, 'matched');
    assert.equal(f.synopsis, 'Linguist meets heptapods.');
    assert.equal(f.title, 'Arrival');
    assert.equal(f.directors, 'Denis Villeneuve');
    assert.equal(f.artworkSource.poster, 'folder');
    assert.equal(f.artworkSource.backdrop, 'tmdb', 'the folder has no backdrop, so TMDb’s is used');
  });

  test('a title that only lost its punctuation gets TMDb’s spelling', async () => {
    const f = await film('paris-texas');
    assert.equal(f.title, 'Paris, Texas');
    assert.equal(f.country, 'Germany, France');
    assert.equal(f.directors, 'Wim Wenders');
  });

  test('once TMDb has supplied a poster, scans stop warning that the folder has none', async () => {
    const report = (await admin.post('/api/admin/scan')).data;
    const hedwig = report.films.find((f) => f.slug === 'hedwig');
    assert.deepEqual(hedwig.warnings, []);
    assert.equal(hedwig.status, 'ok');
    assert.equal((await film('hedwig')).mediaStatus, 'ok');
  });

  test('two films with the same title and year are left for you to choose', async () => {
    const f = await film('twins');
    assert.equal(f.tmdbStatus.state, 'needs-choice');
    assert.equal(f.tmdbStatus.candidates, 2);
    assert.equal(f.tmdbId, null);
    assert.equal(f.directors, null);
  });
});

describe('choosing by hand', () => {
  test('search lists candidates with poster thumbnails', async () => {
    const r = await admin.get(`/api/admin/films/${films.twins}/metadata/search?q=Twins&year=1988`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.results.map((x) => x.tmdbId), [1, 2]);
    assert.equal(r.data.results[0].posterThumb, `${tmdb.base}/t/p/w185/twins.jpg`);
  });

  test('applying takes only the ticked fields and the chosen poster', async () => {
    const preview = await admin.get(`/api/admin/films/${films.twins}/metadata/1`);
    assert.deepEqual(preview.data.posters.map((p) => p.path), ['/twins.jpg', '/twins-alt.jpg']);
    assert.equal(preview.data.current.directors, null);

    const r = await admin.post(`/api/admin/films/${films.twins}/metadata/apply`, { tmdbId: 1, fields: ['directors', 'runtimeMinutes'], poster: '/twins-alt.jpg' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.film.directors, 'Ivan Reitman');
    assert.equal(r.data.film.runtimeMinutes, 107);
    assert.equal(r.data.film.synopsis, 'Linguist meets heptapods.', 'unticked fields stay');
    assert.equal(r.data.film.tmdbStatus.how, 'manual');
    assert.match(r.data.film.posterUrl, /^\/artwork\/twins\/poster-/);
  });

  test('images TMDb does not offer for that film are refused', async () => {
    const r = await admin.post(`/api/admin/films/${films.twins}/metadata/apply`, { tmdbId: 1, fields: [], poster: '/hedwig.jpg' });
    assert.equal(r.status, 400);
  });

  test('going back to the folder’s artwork removes the download', async () => {
    const before = await film('arrival');
    const file = path.join(dataDir, 'artwork', 'arrival', before.backdropUrl.split('/').pop());
    assert.ok(fs.existsSync(file));
    const r = await admin.post(`/api/admin/films/${films.arrival}/artwork/reset`, { kind: 'backdrop' });
    assert.equal(r.data.artworkSource.backdrop, null);
    assert.equal(r.data.backdropUrl, null);
    assert.ok(!fs.existsSync(file));
  });
});

describe('who wins', () => {
  test('your edit replaces a TMDb value, and rescans keep it', async () => {
    const r = await admin.patch(`/api/admin/films/${films.hedwig}`, { synopsis: 'My own synopsis.' });
    assert.equal(r.data.metaSources.synopsis, undefined);
    await admin.post('/api/admin/scan');
    assert.equal((await film('hedwig')).synopsis, 'My own synopsis.');
  });

  test('a value added to film.json replaces one TMDb filled in', async () => {
    writeFilmJson(path.join(mediaDir, 'hedwig'), { directors: 'J. C. Mitchell' });
    const report = (await admin.post('/api/admin/scan')).data;
    assert.ok(report.films.find((f) => f.slug === 'hedwig').updated.includes('directors'));
    const f = await film('hedwig');
    assert.equal(f.directors, 'J. C. Mitchell');
    assert.equal(f.metaSources.directors, undefined);
  });

  test('a tmdbId in film.json pins the match', async () => {
    makeFilm(mediaDir, 'first-contact', { title: 'Something Else Entirely', year: 2016, tmdbId: 329865 });
    await admin.post('/api/admin/scan');
    await srv.app.locals.metadata.idle();
    const all = (await admin.get('/api/admin/films')).data;
    const f = all.find((x) => x.slug === 'first-contact');
    assert.equal(f.tmdbId, 329865);
    assert.equal(f.tmdbStatus.state, 'matched');
    assert.equal(f.title, 'Something Else Entirely', 'a real title from film.json is kept');
  });
});

describe('downloaded artwork is protected like the folder’s', () => {
  test('only ticket holders and the admin can load it', async () => {
    const f = await film('hedwig');
    await admin.patch(`/api/admin/films/${f.id}`, { published: true });
    const stranger = browser(srv.base);
    assert.equal((await stranger.get(f.posterUrl)).status, 403);

    const ticket = (await admin.post('/api/admin/tickets', { filmId: f.id })).data[0];
    const guest = browser(srv.base);
    await guest.post('/api/tickets/open', { code: ticket.code });
    const page = (await guest.get('/api/films/hedwig')).data;
    assert.equal(page.film.posterUrl, f.posterUrl);
    const img = await guest.get(f.posterUrl);
    assert.equal(img.status, 200);
    assert.equal(img.data, 'JPEG w780 hedwig.jpg');
    assert.equal((await guest.get('/artwork/hedwig/poster-000000000000.jpg')).status, 404);
    assert.equal((await guest.get('/artwork/hedwig/..%2F..%2Fopen-matte.db')).status, 404);
  });

  test('viewers never talk to TMDb: no key or TMDb address in what they receive', async () => {
    const guestPage = JSON.stringify((await admin.get('/api/films/hedwig')).data);
    assert.ok(!guestPage.includes(tmdb.base));
    assert.ok(!guestPage.includes(GOOD_KEY));
  });
});

describe('the lookup queue', () => {
  test('a lookup that fails outright does not stall the queue, and films are not queued twice', async () => {
    const { createMetadata } = await import('../server/metadata.js');
    const { createSettings } = await import('../server/settings.js');
    const { openDb } = await import('../server/db.js');
    const { scanMedia } = await import('../server/scan.js');
    const db = openDb(':memory:');
    const dir = tempDir();
    makeFilm(dir, 'zzz-one', { title: 'Zzz One' });
    makeFilm(dir, 'zzz-two', { title: 'Zzz Two' });
    await scanMedia(db, dir);

    // Recording each lookup's outcome fails, as a locked database would make it.
    const flaky = { prepare: (sql) => (sql.startsWith('UPDATE films SET tmdb_status') ? { run() { throw new Error('database is locked'); } } : db.prepare(sql)) };
    const metadata = createMetadata({ db: flaky, settings: createSettings(db), dataDir: tempDir(), apiBase: `${tmdb.base}/3`, imageBase: `${tmdb.base}/t/p`, envKey: GOOD_KEY });

    const searches = () => tmdb.requests.filter((u) => u.pathname === '/3/search/movie').map((u) => u.searchParams.get('query'));
    const before = searches().length;
    const quiet = console.error;
    console.error = () => {};
    try {
      metadata.queueUnmatched();
      metadata.queueUnmatched(); // both films are already waiting
      await metadata.idle(); // resolves even though every step failed
    } finally {
      console.error = quiet;
    }
    const made = searches().slice(before);
    assert.deepEqual([...new Set(made)], ['Zzz One', 'Zzz Two'], 'the second film was still looked up');
    assert.equal(made.length, 4, 'two searches per film (with and without the year), not eight');
  });
});
