// The admin API's guard rails, from the review before going public: the password's
// rate limit and the admin's own session, settings that are only settings, switches
// and text that are what they say, Reset to film.json, which browsers count as
// holding a ticket, and Sign out every viewer.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

// Cookies get Secure from the request, as they do behind Caddy.
process.env.COOKIE_SECURE = 'auto';
const { ADMIN_PASSWORD, adminBrowser, browser, enroll, makeFilm, newPerson, setupLink, startServer, tempDir, writeFilmJson } = await import('./helpers.js');
const { ADMIN_KEY_COST } = await import('../server/sessions.js');
// The admin page's rule for which fields Reset to film.json would change. The web
// app's source isn't in the server's image, where docs/deploying.md runs the tests
// on the server's own Node: there the checks of that rule are left out, and the
// server's side of Reset is still tested.
const EDITS = new URL('../web/src/admin/filmEdits.js', import.meta.url);
const { editedHere } = fs.existsSync(EDITS) ? await import(EDITS) : {};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// The admin's session lasts ADMIN_SESSION_HOURS, 12 unless it's set.
const ADMIN_HOURS = Number(process.env.ADMIN_SESSION_HOURS || 12);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
// How the server finds an admin session: its token keyed with scrypt of the admin
// password and the install's salt (sessions.js).
// The key is slow to make on purpose: once per salt.
const adminKeys = new Map();
const adminHash = (b) => {
  const salt = JSON.parse(srv.db.prepare("SELECT value FROM settings WHERE key = 'secret.adminKeySalt'").get().value);
  if (!adminKeys.has(salt)) adminKeys.set(salt, crypto.scryptSync(ADMIN_PASSWORD, salt, 32, ADMIN_KEY_COST));
  return crypto.createHmac('sha256', adminKeys.get(salt)).update(b.jar.get('om_admin')).digest('hex');
};
const viewerHash = (b) => sha256(b.jar.get('om_session'));

// ====================================================================== the admin password
describe('the admin password (default limits)', () => {
  let s;
  before(async () => {
    s = await startServer({ mediaDir: tempDir() });
  });
  after(() => s.close());
  // From `ip`, as Caddy passes it on.
  const login = (ip, password) => browser(s.base).send('POST', '/api/admin/login', { password }, { headers: { 'x-forwarded-for': ip } });

  test('10 tries per client in 15 minutes; after that even the right password is refused', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await login('203.0.113.30', 'not the password')).status, 401, String(i));
    const r = await login('203.0.113.30', ADMIN_PASSWORD);
    assert.equal(r.status, 429);
    assert.equal(r.data.error, 'too-many-requests');
    const wait = Number(r.headers.get('retry-after'));
    assert.ok(wait > 0 && wait <= 15 * 60, `Retry-After ${wait}`);
    assert.deepEqual(r.headers.getSetCookie(), [], 'no session for a refused try');
    assert.equal((await login('203.0.113.31', ADMIN_PASSWORD)).status, 200, 'another client is unaffected');
  });

  test('an IPv6 client counts by its /64', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await login(`2001:db8:7:8::${(i + 1).toString(16)}`, 'not the password')).status, 401, String(i));
    assert.equal((await login('2001:db8:7:8:ffff::1', ADMIN_PASSWORD)).status, 429, 'another address in the same /64');
    assert.equal((await login('2001:db8:7:9::1', ADMIN_PASSWORD)).status, 200, 'the next /64 is another client');
  });
});

// ====================================================================== everything else
const mediaDir = tempDir();
let srv;
let admin;
const films = {};

before(async () => {
  makeFilm(mediaDir, 'arrival');
  makeFilm(mediaDir, 'draft', { title: 'Draft' });
  // Many browsers open links here, all from one address.
  srv = await startServer({ mediaDir, limits: { scale: 100 } });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  for (const f of (await admin.get('/api/admin/films')).data) films[f.slug] = f.id;
  await admin.patch(`/api/admin/films/${films.arrival}`, { published: true });
});
after(() => srv.close());

let counter = 0;
const uniq = (name) => `${name} ${++counter}`;
const fresh = () => browser(srv.base);
const film = async (id) => (await admin.get(`/api/admin/films/${id}`)).data;
const adminTicket = async (id) => (await admin.get(`/api/admin/tickets/${id}`)).data;
const listedTicket = async (id) => (await admin.get(`/api/admin/tickets?film=${films.arrival}`)).data.find((t) => t.id === id);
const ticketCount = () => srv.db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n;

async function issue(fields = {}) {
  const r = await admin.post('/api/admin/tickets', { filmId: films.arrival, ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data[0];
}

async function opened(ticket, b = fresh()) {
  const r = await b.post('/api/tickets/open', { code: ticket.code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return b;
}

describe("the admin's session", () => {
  const signIn = (headers = {}) =>
    fetch(`${srv.base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ password: ADMIN_PASSWORD }) });

  test(`its cookie is HttpOnly and SameSite=Lax, lasts ${ADMIN_HOURS} hours, and is Secure over HTTPS`, async () => {
    const plain = (await signIn()).headers.get('set-cookie');
    assert.match(plain, new RegExp(`^om_admin=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ADMIN_HOURS * 3600}$`));
    // Caddy says the visitor came over HTTPS; the server trusts that from a local proxy.
    assert.match((await signIn({ 'x-forwarded-proto': 'https' })).headers.get('set-cookie'), /; HttpOnly; SameSite=Lax; .*; Secure$/);
    const b = await adminBrowser(srv.base);
    const row = srv.db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(adminHash(b));
    assert.equal(row.kind, 'admin');
    assert.equal(row.expires_at - row.created_at, ADMIN_HOURS * HOUR, 'the server ends it when the cookie does');
  });

  test('signing out ends it on the server: a copy of the cookie stops working', async () => {
    const b = await adminBrowser(srv.base);
    const copy = fresh();
    copy.jar.set('om_admin', b.jar.get('om_admin'));
    assert.equal((await copy.get('/api/admin/session')).status, 200);
    const hash = adminHash(b);

    const out = await b.post('/api/admin/logout');
    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie'), /^om_admin=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0$/);
    assert.equal(b.jar.has('om_admin'), false, 'the cookie is cleared');
    assert.ok(srv.db.prepare('SELECT revoked_at FROM sessions WHERE id_hash = ?').get(hash).revoked_at, 'the session is ended');
    for (const url of ['/api/admin/session', '/api/admin/films', '/api/admin/settings']) assert.equal((await copy.get(url)).status, 401, url);
    assert.equal((await admin.get('/api/admin/session')).status, 200, 'another admin browser stays signed in');
  });

  test('an expired admin session is refused', async () => {
    const b = await adminBrowser(srv.base);
    assert.equal((await b.get('/api/admin/films')).status, 200);
    srv.db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(Date.now() - 1, adminHash(b));
    assert.equal((await b.get('/api/admin/films')).status, 401);
    assert.equal((await b.get('/api/admin/session')).status, 401);
  });
});

// ====================================================================== settings
describe('settings', () => {
  const GOOD_KEY = 'good-key-0123';
  let s;
  let a;
  // TMDb, as far as checking a key goes.
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.searchParams.get('api_key') !== GOOD_KEY) return Response.json({ status_message: 'Invalid API key' }, { status: 401 });
    return u.pathname === '/3/configuration' ? Response.json({ images: {} }) : Response.json({}, { status: 404 });
  };
  before(async () => {
    // No films, so saving a key looks nothing up.
    s = await startServer({ mediaDir: tempDir(), metadataOptions: { envKey: '', apiBase: 'http://tmdb.test/3', fetchImpl } });
    a = await adminBrowser(s.base);
  });
  after(() => s.close());
  const settingKeys = () => s.db.prepare('SELECT key FROM settings').all().map((r) => r.key);
  const INHERITED = ['toString', 'constructor', 'hasOwnProperty', 'valueOf', 'propertyIsEnumerable', 'toLocaleString'];

  test('only settings can be changed: names every object inherits, typos and the logo are refused, and nothing is saved', async () => {
    const before = (await a.get('/api/admin/settings')).data;
    const patches = [
      { toString: 42 },
      { constructor: 'junk' },
      { hasOwnProperty: 'cinemaName' },
      { valueOf: 1 },
      { propertyIsEnumerable: 'x' },
      { toLocaleString: 'x' },
      { cinemaNme: 'A typo' },
      // The upload routes set these, and nothing else.
      { logo: null },
      { cinemaName: 'Never saved', icon: { file: 'icon-0123456789abcdef.png', width: 64, height: 64 } },
    ];
    for (const patch of patches) {
      const r = await a.patch('/api/admin/settings', patch);
      assert.equal(r.status, 400, JSON.stringify(patch));
      assert.match(r.data.error, /^Not a setting you can change here: /);
    }
    // __proto__ only becomes a key of its own in JSON text: in an object literal it sets the prototype.
    const proto = await a.send('PATCH', '/api/admin/settings', '{"__proto__":{"cinemaName":"Proto"}}', { type: 'application/json' });
    assert.equal(proto.status, 400, JSON.stringify(proto.data));
    assert.match(proto.data.error, /^Not a setting you can change here: __proto__$/);

    assert.deepEqual((await a.get('/api/admin/settings')).data, before, 'nothing changed');
    for (const key of [...INHERITED, '__proto__', 'cinemaNme']) assert.ok(!settingKeys().includes(key), key);
    const site = (await fresh().get('/api/site')).data;
    for (const key of [...INHERITED, '__proto__']) assert.equal(Object.hasOwn(site, key), false, key);
  });

  test('rows in the table that aren\'t settings never reach visitors', async () => {
    // As an install that took such a row before the check was there would have it.
    const add = s.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const key of ['constructor', 'toString']) add.run(key, JSON.stringify('junk'));
    try {
      const site = (await fresh().get('/api/site')).data;
      const settings = (await a.get('/api/admin/settings')).data;
      for (const key of ['constructor', 'toString']) {
        assert.equal(Object.hasOwn(site, key), false, `/api/site ${key}`);
        assert.equal(Object.hasOwn(settings, key), false, `/api/admin/settings ${key}`);
      }
      assert.equal(site.cinemaName, 'Open Matte');
    } finally {
      s.db.prepare("DELETE FROM settings WHERE key IN ('constructor', 'toString')").run();
    }
  });

  test('a setting still saves, with a TMDB key alongside', async () => {
    const r = await a.patch('/api/admin/settings', { cinemaName: 'The Ritz', tmdbApiKey: GOOD_KEY });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.cinemaName, 'The Ritz');
    assert.equal(r.data.tmdb.configured, true);
    assert.equal(Object.hasOwn(r.data, 'tmdbApiKey'), false, 'the key itself is never sent back');
    assert.ok(!settingKeys().includes('tmdbApiKey'), 'the key is kept apart, as a secret');
  });

  test('a TMDB key is text: anything else is refused, not taken as removing the key', async () => {
    assert.equal((await a.patch('/api/admin/settings', { tmdbApiKey: GOOD_KEY })).status, 200);
    for (const value of [12345, true, false, [GOOD_KEY], { key: GOOD_KEY }]) {
      const r = await a.patch('/api/admin/settings', { tmdbApiKey: value });
      assert.equal(r.status, 400, JSON.stringify(value));
      assert.equal(r.data.error, 'A TMDB key is text');
      assert.deepEqual((await a.get('/api/admin/settings')).data.tmdb, { configured: true, source: 'settings', hint: '…0123' }, JSON.stringify(value));
    }
    // Removing it: an empty key, as Settings sends, or null.
    for (const value of ['', null]) {
      const r = await a.patch('/api/admin/settings', { tmdbApiKey: value });
      assert.equal(r.status, 200, JSON.stringify(value));
      assert.equal(r.data.tmdb.configured, false, JSON.stringify(value));
      assert.equal((await a.patch('/api/admin/settings', { tmdbApiKey: GOOD_KEY })).status, 200);
    }
  });
});

// ====================================================================== what the admin sends
describe('switches and text are what they say', () => {
  test('publishing and showing to members take true or false: "false" is refused, not read as true', async () => {
    for (const value of ['false', 'no', 'true', 1, 0, null]) {
      for (const key of ['published', 'memberVisible']) {
        const r = await admin.patch(`/api/admin/films/${films.draft}`, { [key]: value });
        assert.equal(r.status, 400, `${key} ${JSON.stringify(value)}`);
        assert.equal(r.data.error, `${key} must be true or false`);
      }
    }
    const f = await film(films.draft);
    assert.equal(f.published, false);
    assert.equal(f.memberVisible, false);
    const shown = await admin.patch(`/api/admin/films/${films.draft}`, { memberVisible: true });
    assert.equal(shown.status, 200);
    assert.equal(shown.data.memberVisible, true);
    assert.equal((await admin.patch(`/api/admin/films/${films.draft}`, { memberVisible: false })).data.memberVisible, false);
  });

  test('keepable takes true or false, when issuing, saving or releasing a ticket', async () => {
    const before = ticketCount();
    for (const value of ['false', 'yes', 1]) {
      const r = await admin.post('/api/admin/tickets', { filmId: films.arrival, claimable: value });
      assert.equal(r.status, 400, JSON.stringify(value));
      assert.equal(r.data.error, 'claimable must be true or false');
    }
    assert.equal(ticketCount(), before, 'nothing issued');
    const t = await issue({ claimable: false });
    assert.equal((await admin.patch(`/api/admin/tickets/${t.id}`, { claimable: 'no' })).status, 400);
    assert.equal((await admin.post(`/api/admin/tickets/${t.id}/holder`, { personId: null, claimable: 'yes' })).status, 400);
    assert.equal((await adminTicket(t.id)).claimable, false);
    assert.equal((await admin.patch(`/api/admin/tickets/${t.id}`, { claimable: true })).data.claimable, true);
  });

  test("a ticket's label is text", async () => {
    const before = ticketCount();
    for (const label of [{ name: 'Sam' }, ['Sam'], 42, true]) {
      const r = await admin.post('/api/admin/tickets', { filmId: films.arrival, label });
      assert.equal(r.status, 400, JSON.stringify(label));
      assert.equal(r.data.error, 'The label must be text');
    }
    assert.equal(ticketCount(), before, 'nothing issued');
    const t = await issue({ label: '  For Sam  ' });
    assert.equal(t.label, 'For Sam');
    assert.equal((await admin.patch(`/api/admin/tickets/${t.id}`, { label: { name: 'Dana' } })).status, 400);
    assert.equal((await adminTicket(t.id)).label, 'For Sam');
    assert.equal((await admin.patch(`/api/admin/tickets/${t.id}`, { label: '' })).data.label, null, 'empty clears it');
  });

  test('a search for film information is one piece of text', async () => {
    const r = await admin.get(`/api/admin/films/${films.arrival}/metadata/search?q=Arrival&q=Heat`);
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'The search must be text');
  });

  test('a body that isn\'t JSON gets a code, not the parser\'s message', async () => {
    const r = await admin.send('PATCH', `/api/admin/films/${films.draft}`, '{"published": tru', { type: 'application/json' });
    assert.equal(r.status, 400);
    assert.deepEqual(r.data, { error: 'bad-json' });
  });

  test('giving a ticket to someone disabled or missing answers with a code the page puts in words', async () => {
    const t = await issue();
    const p = await newPerson(admin, uniq('Dana'));
    await admin.post(`/api/admin/people/${p.id}/disable`);
    const disabled = await admin.post(`/api/admin/tickets/${t.id}/holder`, { personId: p.id });
    assert.equal(disabled.status, 409);
    assert.deepEqual(disabled.data, { error: 'person-disabled' });
    // The address is fine; it's the request that names nobody: 400, not 404.
    const missing = await admin.post(`/api/admin/tickets/${t.id}/holder`, { personId: 999999 });
    assert.equal(missing.status, 400);
    assert.deepEqual(missing.data, { error: 'person-not-found' });
    assert.equal((await adminTicket(t.id)).person, null, 'still for anyone with the link');
  });
});

// ====================================================================== Reset to film.json
describe('Reset to film.json', () => {
  // TMDb, for one film: what auto-matching finds for Arrival (2016).
  const ARRIVAL = {
    id: 329865, title: 'Arrival', original_title: 'Arrival', release_date: '2016-11-10', runtime: 116,
    overview: 'A linguist is recruited.', production_countries: [{ iso_3166_1: 'US', name: 'United States of America' }],
    credits: { crew: [{ job: 'Director', name: 'Denis Villeneuve' }] }, images: { posters: [], backdrops: [] },
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] }] }, poster_path: null, backdrop_path: null,
  };
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/3/search/movie') return Response.json({ results: [{ id: ARRIVAL.id, title: 'Arrival', original_title: 'Arrival', release_date: ARRIVAL.release_date }] });
    if (u.pathname === `/3/movie/${ARRIVAL.id}`) return Response.json(ARRIVAL);
    return Response.json({}, { status: 404 });
  };
  const FROM_TMDB = { directors: 'Denis Villeneuve', country: 'United States', synopsis: 'A linguist is recruited.', contentNote: 'Rated PG-13' };
  const KEYS = ['title', 'originalTitle', 'year', 'runtimeMinutes', 'directors', 'country', 'synopsis', 'recommendation', 'contentNote'];
  let s;
  let a;
  let id;
  const dir = tempDir();
  const get = async () => (await a.get(`/api/admin/films/${id}`)).data;
  const reset = (body) => a.post(`/api/admin/films/${id}/reset-metadata`, body);
  const pick = (f, keys) => Object.fromEntries(keys.map((k) => [k, f[k]]));
  // The fields the page offers to reset, where the page's rule is here to ask.
  const pageOffers = (f, expected, message) => editedHere && assert.deepEqual(KEYS.filter((k) => editedHere(f, k)), expected, message);

  before(async () => {
    // What scripts/encode.mjs writes: no director, synopsis or recommendation yet.
    makeFilm(dir, 'arrival', { directors: null, synopsis: null, recommendation: null });
    s = await startServer({ mediaDir: dir, metadataOptions: { envKey: 'key', apiBase: 'http://tmdb.test/3', imageBase: 'http://tmdb.test/t/p', fetchImpl } });
    a = await adminBrowser(s.base);
    await a.post('/api/admin/scan');
    await s.app.locals.metadata.idle();
    id = (await a.get('/api/admin/films')).data[0].id;
  });
  after(() => s.close());

  test("what TMDB filled in isn't an edit, so there's nothing to reset", async () => {
    const f = await get();
    assert.equal(f.tmdbStatus.state, 'matched');
    assert.deepEqual(pick(f, Object.keys(FROM_TMDB)), FROM_TMDB);
    for (const k of Object.keys(FROM_TMDB)) assert.equal(f.metaSources[k], 'tmdb', k);
    // The page's rule: the button shows only when a field is edited here.
    pageOffers(f, []);
  });

  test('it puts back your edits and leaves what TMDB filled in, through later scans too', async () => {
    const edit = await a.patch(`/api/admin/films/${id}`, { title: 'Arrivl', recommendation: 'See it big.', country: 'Canada' });
    assert.equal(edit.status, 200, JSON.stringify(edit.data));
    // Editing a value TMDB gave makes it yours, so it's an edit like the others.
    pageOffers(edit.data, ['title', 'country', 'recommendation']);

    const r = await reset({});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.title, 'Arrival');
    assert.equal(r.data.recommendation, null, "film.json's value, which is none");
    assert.equal(r.data.country, null, 'your edit is gone, and film.json had nothing there');
    const kept = Object.fromEntries(Object.entries(FROM_TMDB).filter(([k]) => k !== 'country'));
    assert.deepEqual(pick(r.data, Object.keys(kept)), kept, 'what TMDB filled in stays');
    for (const k of Object.keys(kept)) assert.equal(r.data.metaSources[k], 'tmdb', k);
    pageOffers(r.data, [], 'nothing left to reset');

    await a.post('/api/admin/scan');
    await s.app.locals.metadata.idle();
    assert.deepEqual(pick(await get(), Object.keys(kept)), kept, 'and a rescan keeps it');
    // Friends see it too.
    const viewer = browser(s.base);
    const t = (await a.post('/api/admin/tickets', { filmId: id })).data[0];
    await a.patch(`/api/admin/films/${id}`, { published: true });
    assert.equal((await viewer.post('/api/tickets/open', { code: t.code })).status, 200);
    assert.equal((await viewer.get('/api/films/arrival')).data.film.synopsis, FROM_TMDB.synopsis);
  });

  test('`fields` narrows it, and must be a list of field names', async () => {
    assert.equal((await a.patch(`/api/admin/films/${id}`, { title: 'Arrivl', year: 2000 })).status, 200);
    for (const fields of [5, 'title year', 'title', {}, ['title', 'nope'], ['constructor'], [1]]) {
      const r = await reset({ fields });
      assert.equal(r.status, 400, JSON.stringify(fields));
      assert.match(r.data.error, /^fields must be a list of these: title, /);
    }
    assert.deepEqual(pick(await get(), ['title', 'year']), { title: 'Arrivl', year: 2000 }, 'nothing reset');
    const one = await reset({ fields: ['title'] });
    assert.equal(one.status, 200);
    assert.deepEqual(pick(one.data, ['title', 'year']), { title: 'Arrival', year: 2000 });
    // Naming a field TMDB filled in doesn't reset it: it isn't an edit.
    assert.equal((await reset({ fields: ['synopsis', 'year'] })).data.synopsis, FROM_TMDB.synopsis);
    assert.deepEqual(pick(await get(), ['title', 'year']), { title: 'Arrival', year: 2016 });
    // null, like leaving it out, is every field.
    assert.equal((await a.patch(`/api/admin/films/${id}`, { title: 'Arrivl', year: 2000 })).status, 200);
    assert.deepEqual(pick((await reset({ fields: null })).data, ['title', 'year']), { title: 'Arrival', year: 2016 });
  });

  test("a value you take with Find details over film.json's own is your edit, so Reset puts film.json's back", async () => {
    const scan = async () => {
      const r = await a.post('/api/admin/scan');
      await s.app.locals.metadata.idle();
      return r.data.films.find((f) => f.slug === 'arrival');
    };
    // film.json gets a synopsis of its own, which replaces the one TMDB filled in.
    writeFilmJson(path.join(dir, 'arrival'), { synopsis: 'Linguist meets heptapods.' });
    await scan();
    assert.equal((await get()).synopsis, 'Linguist meets heptapods.');
    // Find details…, synopsis and country ticked: TMDB's replaces film.json's
    // synopsis, and fills the country film.json leaves empty.
    const r = await a.post(`/api/admin/films/${id}/metadata/apply`, { tmdbId: ARRIVAL.id, fields: ['synopsis', 'country'] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(pick(r.data.film, ['synopsis', 'country']), pick(FROM_TMDB, ['synopsis', 'country']));
    assert.equal(r.data.film.metaSources.synopsis, undefined, 'yours');
    assert.equal(r.data.film.metaSources.country, 'tmdb', "TMDB's");
    pageOffers(r.data.film, ['synopsis']);
    // film.json then drops its synopsis: the scan keeps the one you took, and says
    // Reset to film.json takes the file's version. It does.
    writeFilmJson(path.join(dir, 'arrival'), { synopsis: null });
    assert.deepEqual((await scan()).conflicts.map((c) => c.field), ['synopsis']);
    assert.equal((await get()).synopsis, FROM_TMDB.synopsis);
    const back = await reset({});
    assert.equal(back.status, 200);
    assert.deepEqual(pick(back.data, ['synopsis', 'country']), { synopsis: null, country: FROM_TMDB.country });
  });
});

// ====================================================================== the browsers holding a ticket
describe("a ticket's browsers are the ones still signed in", () => {
  test('signing out, or a session expiring, takes a browser off the count and the list', async () => {
    const t = await issue({ claimable: true });
    const x = await opened(t);
    const y = await opened(t);
    const z = await opened(t);
    const counts = async () => {
      const d = await adminTicket(t.id);
      const l = await listedTicket(t.id);
      assert.equal(l.browsers, d.browsers, 'Tickets counts as the ticket page does');
      assert.equal(l.waitingBrowsers, d.waitingBrowsers, 'Tickets counts as the ticket page does');
      return { browsers: d.browsers, waiting: d.waitingBrowsers, listed: d.browserList.length };
    };
    assert.deepEqual(await counts(), { browsers: 3, waiting: 0, listed: 3 });

    assert.equal((await x.post('/api/signout')).status, 200);
    assert.deepEqual(await counts(), { browsers: 2, waiting: 0, listed: 2 }, 'x signed out');
    srv.db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(Date.now() - 1, viewerHash(z));
    assert.deepEqual(await counts(), { browsers: 1, waiting: 0, listed: 1 }, "z's session expired");

    // Given to someone: the browsers left are waiting for it, and get it back on a release.
    const p = await newPerson(admin, uniq('Sam'));
    assert.equal((await admin.post(`/api/admin/tickets/${t.id}/holder`, { personId: p.id })).status, 200);
    assert.deepEqual(await counts(), { browsers: 0, waiting: 1, listed: 1 });
    assert.equal((await y.post('/api/signout')).status, 200);
    assert.deepEqual(await counts(), { browsers: 0, waiting: 0, listed: 0 }, 'y signed out too');

    // Released: nobody is left to get it back, as the page now says.
    assert.equal((await admin.post(`/api/admin/tickets/${t.id}/holder`, { personId: null })).status, 200);
    assert.deepEqual(await counts(), { browsers: 0, waiting: 0, listed: 0 });
    for (const b of [x, y, z]) assert.equal((await b.get('/api/films/arrival')).status, 404, 'none of them can use it');
  });

  test("a browser signed in as someone who's disabled doesn't count", async () => {
    const t = await issue();
    const b = await opened(t);
    const p = await newPerson(admin, uniq('Kim'));
    // Setting up a passkey signs this browser in, and the ticket comes along.
    const r = await enroll(b, (await setupLink(admin, p.id)).token);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await adminTicket(t.id)).browsers, 1);
    // Disabling signs them out as well; this checks the count doesn't rely on that alone.
    srv.db.prepare('UPDATE people SET disabled_at = ? WHERE id = ?').run(Date.now(), p.id);
    const d = await adminTicket(t.id);
    assert.equal(d.browsers, 0);
    assert.deepEqual(d.browserList, []);
    assert.equal((await b.get('/api/films/arrival')).status, 404, 'and indeed it can no longer use it');
  });
});

// ====================================================================== Sign out every viewer
// Last: it signs every viewer out.
describe('Sign out every viewer', () => {
  test('signs out the browsers still signed in, and counts only those', async () => {
    srv.db.prepare("UPDATE sessions SET revoked_at = ? WHERE kind = 'viewer' AND revoked_at IS NULL").run(Date.now());
    const t = await issue();
    const live = await opened(t);
    const gone = [await opened(t), await opened(t)];
    // Expired weeks ago, and not yet deleted by the clean-up.
    for (const b of gone) srv.db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(Date.now() - 20 * DAY, viewerHash(b));

    const r = await admin.post('/api/admin/sessions/expire-all');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { expired: 1 });
    const revokedAt = (b) => srv.db.prepare('SELECT revoked_at FROM sessions WHERE id_hash = ?').get(viewerHash(b)).revoked_at;
    assert.ok(revokedAt(live), 'the live one is signed out');
    for (const b of gone) assert.equal(revokedAt(b), null, 'an expired one is left as it ended');
    assert.equal((await live.get('/api/films/arrival')).status, 404);
    assert.equal((await admin.get('/api/admin/session')).status, 200, 'the admin is not a viewer');
    assert.deepEqual((await admin.post('/api/admin/sessions/expire-all')).data, { expired: 0 }, 'nobody left to sign out');
  });
});
