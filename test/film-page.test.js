// What the film page is told, so that what it says is true: until when a screening
// can really be resumed, and why the player stopped when the browser was signed out.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { addFilm, adminBrowser, browser, enroll, makeFilm, newPerson, setupLink, startServer, tempDir } from './helpers.js';

const HOUR = 60 * 60 * 1000;
let srv;
let admin;
let filmId;
const mediaDir = tempDir();

before(async () => {
  makeFilm(mediaDir, 'arrival');
  srv = await startServer({ mediaDir });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  filmId = (await admin.get('/api/admin/films')).data[0].id;
  await admin.patch(`/api/admin/films/${filmId}`, { published: true });
});
after(() => srv.close());

// A film of its own for each test that presses Play.
const ownFilm = (slug) => addFilm(admin, mediaDir, slug);

async function ticket(fields = {}) {
  const r = await admin.post('/api/admin/tickets', { filmId, screeningLimit: null, ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data[0];
}

async function opened(t) {
  const b = browser(srv.base);
  assert.equal((await b.post('/api/tickets/open', { code: t.code })).status, 200);
  return b;
}

async function play(b, slug = 'arrival') {
  const r = await b.post(`/api/films/${slug}/screenings`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.screeningId;
}

const heartbeat = (b, id) => b.post(`/api/screenings/${id}/heartbeat`, { position: 30 });

describe('until when an open screening can be resumed', () => {
  // The admin's ticket page: its open screening, and each line of its Screenings.
  const adminSays = async (t) => {
    const r = (await admin.get(`/api/admin/tickets/${t.id}`)).data;
    return [r.openScreening.resumableUntil, ...r.screenings.map((s) => s.resumableUntil)];
  };

  test('a ticket that expires before the resume window ends: until it expires, on the page, on Your tickets and in the admin', async () => {
    // The default window is 48 hours; this ticket lasts a day from first play.
    const t = await ticket({ daysAfterFirstPlay: 1 });
    const b = await opened(t);
    await play(b);
    const page = (await b.get('/api/films/arrival')).data.access.ticket;
    assert.ok(page.expiresAt, 'the ticket has an expiry once played');
    assert.equal(page.openScreening.resumableUntil, page.expiresAt);
    const shelf = (await b.get('/api/me')).data.tickets.find((x) => x.film.slug === 'arrival').ticket;
    assert.equal(shelf.openScreening.resumableUntil, page.expiresAt);
    assert.deepEqual(await adminSays(t), [page.expiresAt, page.expiresAt]);
  });

  test('a ticket that lasts longer than the resume window: until the window ends', async () => {
    const film = await ownFilm('long-ticket');
    const t = await ticket({ filmId: film.id, daysAfterFirstPlay: 30 });
    const b = await opened(t);
    const id = await play(b, film.slug);
    const page = (await b.get(`/api/films/${film.slug}`)).data.access.ticket;
    const { resumable_until: until } = srv.db.prepare('SELECT resumable_until FROM screenings WHERE id = ?').get(id);
    assert.equal(page.openScreening.resumableUntil, until);
    assert.ok(page.expiresAt - until > 20 * 24 * HOUR);
    assert.deepEqual(await adminSays(t), [until, until]);
  });
});

describe('the player is told when its browser was signed out', () => {
  test('signing out, then a progress report: signed-out', async () => {
    const film = await ownFilm('signed-out');
    const b = await opened(await ticket({ filmId: film.id }));
    const id = await play(b, film.slug);
    assert.equal((await heartbeat(b, id)).status, 200);
    assert.equal((await b.post('/api/signout')).status, 200);
    const r = await heartbeat(b, id);
    assert.equal(r.status, 404);
    assert.equal(r.data.error, 'signed-out');
  });

  test('Sign out every viewer, with the old cookie still sent: signed-out', async () => {
    const film = await ownFilm('everyone-out');
    const b = await opened(await ticket({ filmId: film.id }));
    const id = await play(b, film.slug);
    await admin.post('/api/admin/sessions/expire-all');
    assert.ok(b.jar.has('om_session'), 'the browser still sends its cookie');
    const r = await heartbeat(b, id);
    assert.equal(r.status, 404);
    assert.equal(r.data.error, 'signed-out');
  });

  test('the person disabled while watching their own ticket: signed-out', async () => {
    const sam = await newPerson(admin, 'Sam');
    const phone = browser(srv.base);
    assert.equal((await enroll(phone, (await setupLink(admin, sam.id)).token)).status, 200);
    const film = await ownFilm('disabled');
    await ticket({ filmId: film.id, personId: sam.id });
    const id = await play(phone, film.slug);
    assert.equal((await heartbeat(phone, id)).status, 200);
    await admin.post(`/api/admin/people/${sam.id}/disable`);
    const r = await heartbeat(phone, id);
    assert.equal(r.status, 404);
    assert.equal(r.data.error, 'signed-out');
  });

  test("a browser still signed in, sending another browser's screening: not-found, as before", async () => {
    const film = await ownFilm('another-browser');
    const theirs = await opened(await ticket({ filmId: film.id }));
    const id = await play(theirs, film.slug);
    const mine = await opened(await ticket({ filmId: film.id }));
    const r = await heartbeat(mine, id);
    assert.equal(r.status, 404);
    assert.equal(r.data.error, 'not-found');
  });
});
