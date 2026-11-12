// What the film page is told, so that what it says is true: when the tape is due
// back, the one date everything goes by, and why the player stopped when the browser
// was signed out.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { addFilm, adminBrowser, browser, enroll, makeFilm, newPerson, setupLink, startServer, tempDir } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
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
  const r = await admin.post('/api/admin/tickets', { filmId, ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data[0];
}

async function opened(t) {
  const b = browser(srv.base);
  assert.equal((await b.post('/api/tickets/open', { code: t.code })).status, 200);
  return b;
}

async function pressed(b, slug = 'arrival') {
  const r = await b.post(`/api/films/${slug}/screenings`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const play = async (b, slug) => (await pressed(b, slug)).screeningId;

const heartbeat = (b, id) => b.post(`/api/screenings/${id}/heartbeat`, { position: 30 });

// 1.x had two clocks: the link's own expiry ("days after the first play") and the
// window to come back to a play, and each place showed whichever came first. There is
// one now: the time the tape is due back.
describe('when the tape is due back: one date, wherever it is shown', () => {
  // The admin's ticket page, still in 1.x's fields: the link's expiry, its open
  // screening, and each line of its Screenings.
  const adminSays = async (t) => {
    const r = (await admin.get(`/api/admin/tickets/${t.id}`)).data;
    return [r.expiresAt, r.openScreening.resumableUntil, ...r.screenings.map((s) => s.resumableUntil)];
  };
  // The friend's film page and their front page: the date, and 1.1.0's two fields for it.
  const friendSays = async (b, slug) => {
    const page = (await b.get(`/api/films/${slug}`)).data.access.ticket;
    const shelf = (await b.get('/api/me')).data.tickets.find((x) => x.film.slug === slug).ticket;
    return [page, shelf].flatMap((t) => [t.dueBack, t.expiresAt, t.openScreening.resumableUntil]);
  };

  test('a link sent with its own days: due that many days after Play, on the page, on Your tickets and in the admin', async () => {
    const t = await ticket({ loanDays: 1 });
    const b = await opened(t);
    const { takenAt, dueBack, resumableUntil } = await pressed(b);
    assert.equal(dueBack, takenAt + DAY);
    assert.equal(resumableUntil, dueBack);
    assert.deepEqual(await friendSays(b, 'arrival'), Array(6).fill(dueBack));
    assert.deepEqual(await adminSays(t), [dueBack, dueBack, dueBack]);
  });

  test('the date is the loan’s: with the shop’s days it is 3 days after Play, and if it is moved, every place says the new one', async () => {
    const film = await ownFilm('long-ticket');
    // 1.x's "30 days after the first play" is still sent by its form, and is ignored.
    const t = await ticket({ filmId: film.id, daysAfterFirstPlay: 30 });
    const b = await opened(t);
    const { screeningId: id, takenAt, dueBack } = await pressed(b, film.slug);
    assert.equal(dueBack, takenAt + 3 * DAY);
    assert.deepEqual(await friendSays(b, film.slug), Array(6).fill(dueBack));
    assert.deepEqual(await adminSays(t), [dueBack, dueBack, dueBack]);

    // What Play wrote on the screening is never read again: the loan says when it's due.
    const later = dueBack + DAY;
    srv.db.prepare('UPDATE loans SET due_at = ? WHERE screening_id = ?').run(later, id);
    assert.equal(srv.db.prepare('SELECT resumable_until FROM screenings WHERE id = ?').get(id).resumable_until, dueBack);
    assert.deepEqual(await friendSays(b, film.slug), Array(6).fill(later));
    assert.deepEqual(await adminSays(t), [later, later, later]);
    assert.equal((await pressed(b, film.slug)).dueBack, later);
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
