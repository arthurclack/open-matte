// Tickets for one person, and Your tickets: milestone 2, slice 2. Written from
// docs/history/milestone-2.md ("Access rules", "Route changes", "Slice 2", "Testing"),
// not from the implementation. No viewer browser here ever holds the admin cookie: the
// admin's preview bypasses every person rule, so a pass there would prove nothing.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';
import { addFilm, adminBrowser, browser, enroll, makeFilm, newPerson, playbackFiles, setupLink, signIn, startServer, tempDir } from './helpers.js';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const mediaDir = tempDir();
const dataDir = tempDir();
const master = (slug) => `/media/${slug}/hls/master.m3u8`;
const MASTER = master('arrival');
const segment = (i, slug = 'arrival') => `/media/${slug}/hls/v_h264_720/seg_${i}.m4s`;
// Artwork: each folder's poster, and for Arrival a backdrop downloaded from TMDb.
const BACKDROP = 'backdrop-0123456789ab.jpg';
const ARTWORK = { arrival: ['/media/arrival/poster.jpg', `/artwork/arrival/${BACKDROP}`], heat: ['/media/heat/poster.jpg'] };
// Refused, the folder's artwork is a 403, like the rest of /media; downloaded
// artwork is a 404, exactly as if there were no such film (media.js).
const refusedArtwork = (urls) => urls.map((u) => (u.startsWith('/artwork/') ? 404 : 403));

let srv;
let admin;
const films = {};

before(async () => {
  makeFilm(mediaDir, 'arrival');
  makeFilm(mediaDir, 'heat', { title: 'Heat', year: 1995 });
  srv = await startServer({ mediaDir, dataDir, limits: { scale: 100 } });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  for (const f of (await admin.get('/api/admin/films')).data) films[f.slug] = f.id;
  assert.ok(films.arrival && films.heat);
  for (const id of Object.values(films)) await admin.patch(`/api/admin/films/${id}`, { published: true });
  fs.mkdirSync(path.join(dataDir, 'artwork', 'arrival'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'artwork', 'arrival', BACKDROP), 'jpeg');
  srv.db.prepare('UPDATE films SET artwork = ? WHERE slug = ?').run(JSON.stringify({ backdrop: { file: BACKDROP } }), 'arrival');
});
after(() => srv.close());

// A film of its own, published, for a test that presses Play: with a poster and a
// downloaded backdrop, as Arrival has. Returns its slug.
async function ownFilm(slug) {
  films[slug] = (await addFilm(admin, mediaDir, slug)).id;
  fs.mkdirSync(path.join(dataDir, 'artwork', slug), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'artwork', slug, BACKDROP), 'jpeg');
  srv.db.prepare('UPDATE films SET artwork = ? WHERE slug = ?').run(JSON.stringify({ backdrop: { file: BACKDROP } }), slug);
  ARTWORK[slug] = [`/media/${slug}/poster.jpg`, `/artwork/${slug}/${BACKDROP}`];
  return slug;
}

let counter = 0;
const uniq = (name) => `${name} ${++counter}`;
const fresh = () => browser(srv.base);
const statuses = (b, urls) => Promise.all(urls.map(async (u) => (await b.get(u)).status));
const every = (urls, code) => urls.map(() => code);
const status = async (b, url) => (await b.get(url)).status;
const hashOf = (b) => sha256(b.jar.get('om_session'));
const ticketRow = (id) => srv.db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
const attached = (ticketId) => srv.db.prepare('SELECT COUNT(*) AS n FROM session_tickets WHERE ticket_id = ?').get(ticketId).n;
const eventsOf = (ticketId) => srv.db.prepare('SELECT type, session_hash FROM events WHERE ticket_id = ? ORDER BY id').all(ticketId);
const totals = () =>
  srv.db.prepare(`
    SELECT (SELECT COUNT(*) FROM sessions) AS sessions, (SELECT COUNT(*) FROM session_tickets) AS sessionTickets,
           (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM screenings) AS screenings`).get();
const me = async (b) => {
  const r = await b.get('/api/me');
  assert.equal(r.status, 200);
  return r.data;
};
// This browser's entries under Your tickets for one film.
const listed = async (b, slug = 'arrival') => (await me(b)).tickets.filter((t) => t.film.slug === slug);
const adminTicket = async (id) => (await admin.get(`/api/admin/tickets/${id}`)).data;
// 1.x counted a link's plays (screeningsUsed) and named its state in its own words
// (state: ok, used_up, expired, revoked). Both went from the back office's answer in
// slice 10: a link lends once, so what the tests below read now is its one loan
// (null until Play took the tape on it; its screeningId is the play) and linkState.

// A person with one (synced) passkey, created from a setup link on their phone.
// device() signs another browser in as them with the same passkey.
async function member(name = uniq('Sam')) {
  const p = await newPerson(admin, name);
  const auth = softAuthenticator();
  const phone = fresh();
  const r = await enroll(phone, (await setupLink(admin, p.id)).token, { auth });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const device = async (b = fresh()) => {
    const s = await signIn(b, auth);
    assert.equal(s.status, 200, JSON.stringify(s.data));
    return b;
  };
  return { p, auth, phone, device };
}

async function issue(fields = {}, film = 'arrival') {
  const r = await admin.post('/api/admin/tickets', { filmId: films[film], ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.length, 1);
  return r.data[0];
}
const forPerson = (p, fields = {}, film = 'arrival') => issue({ personId: p.id, ...fields }, film);

async function opened(b, ticket, slug = 'arrival') {
  const r = await b.post('/api/tickets/open', { code: ticket.code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { slug });
  return b;
}
async function play(b, slug = 'arrival') {
  const r = await b.post(`/api/films/${slug}/screenings`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const heartbeat = (b, id, body) => b.post(`/api/screenings/${id}/heartbeat`, body);
const pause = (b, id, position = 10) => heartbeat(b, id, { position, playing: false });

// Nothing of the film for this browser: no page, no Play, no playback file, no
// artwork, and nothing under Your tickets. `page` lists the answers the page may give.
async function refused(b, slug = 'arrival', { page = [404] } = {}) {
  const r = await b.get(`/api/films/${slug}`);
  assert.ok(page.includes(r.status), `page: ${r.status} ${JSON.stringify(r.data)}`);
  assert.equal(r.data.film, undefined, 'the page reveals nothing about the film');
  const p = await b.post(`/api/films/${slug}/screenings`);
  assert.equal(p.status, 404, `Play: ${p.status} ${JSON.stringify(p.data)}`);
  assert.equal(p.data.masterUrl, undefined);
  assert.deepEqual(await statuses(b, playbackFiles(slug)), every(playbackFiles(slug), 403), 'playback files');
  assert.deepEqual(await statuses(b, ARTWORK[slug]), refusedArtwork(ARTWORK[slug]), 'artwork');
  assert.deepEqual(await listed(b, slug), [], 'not under Your tickets');
}

// Everything works: the page, Play, every playback file and the artwork.
async function playsEverything(b, slug = 'arrival') {
  const page = await b.get(`/api/films/${slug}`);
  assert.equal(page.status, 200, JSON.stringify(page.data));
  assert.equal(page.data.access.canPlay, true);
  const s = await play(b, slug);
  assert.deepEqual(await statuses(b, playbackFiles(slug)), every(playbackFiles(slug), 200), 'playback files');
  assert.deepEqual(await statuses(b, ARTWORK[slug]), every(ARTWORK[slug], 200), 'artwork');
  return s;
}

// ====================================================================== issuing
describe('issuing a ticket for one person', () => {
  test('migration 4 is in place', () => {
    const index = srv.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'tickets_person'").get();
    assert.ok(index, 'tickets_person index');
    assert.ok(srv.db.prepare('PRAGMA user_version').get().user_version >= 4);
  });

  test('needs a person who exists and is enabled, and one ticket at a time', async () => {
    const p = await newPerson(admin, uniq('Sam'));
    const dana = await newPerson(admin, uniq('Dana'));
    await admin.post(`/api/admin/people/${dana.id}/disable`);
    const count = () => srv.db.prepare('SELECT COUNT(*) AS n FROM tickets').get().n;
    const before = count();

    const missing = await admin.post('/api/admin/tickets', { filmId: films.arrival, personId: 999999 });
    assert.equal(missing.status, 400);
    assert.equal(missing.data.error, 'person-not-found');

    const disabled = await admin.post('/api/admin/tickets', { filmId: films.arrival, personId: dana.id });
    assert.equal(disabled.status, 409);
    assert.equal(disabled.data.error, 'person-disabled');

    for (const n of [2, 5]) {
      const several = await admin.post('/api/admin/tickets', { filmId: films.arrival, personId: p.id, count: n });
      assert.equal(several.status, 400, `count ${n}`);
    }
    assert.equal(count(), before, 'nothing was issued');

    // Someone with no passkey yet can be issued one (the admin then sends a setup link).
    const t = await forPerson(p);
    assert.deepEqual(t.person, { id: p.id, name: p.name, disabled: false });
    assert.equal(ticketRow(t.id).person_id, p.id);
    const explicit = await forPerson(p, { count: 1 });
    assert.equal(explicit.person.id, p.id);

    const anyone = await issue();
    assert.equal(anyone.person, null);
    assert.equal(ticketRow(anyone.id).person_id, null);
    assert.equal((await issue({ personId: null })).person, null, 'personId null is a ticket for anyone');

    await admin.post(`/api/admin/people/${dana.id}/enable`);
    assert.equal((await forPerson(dana)).person.id, dana.id, 'enabled again, they can be issued tickets');
  });

  test('the admin sees who a ticket is for: list, ticket page, People list, and a disabled badge', async () => {
    const p = await newPerson(admin, uniq('Sam'));
    const t = await forPerson(p, { label: 'For the weekend' });
    const expected = { id: p.id, name: p.name, disabled: false };
    assert.deepEqual((await adminTicket(t.id)).person, expected);
    assert.deepEqual((await admin.get('/api/admin/tickets')).data.find((x) => x.id === t.id).person, expected);
    assert.equal((await admin.get('/api/admin/people')).data.find((x) => x.id === p.id).tickets, 1);

    await admin.post(`/api/admin/people/${p.id}/disable`);
    assert.deepEqual((await adminTicket(t.id)).person, { ...expected, disabled: true });
  });

  test('editing a ticket never changes who it is for', async () => {
    const p = await newPerson(admin, uniq('Sam'));
    const q = await newPerson(admin, uniq('Alex'));
    const t = await forPerson(p);
    const anyone = await issue();
    await admin.patch(`/api/admin/tickets/${t.id}`, { personId: q.id, label: 'renamed' });
    await admin.patch(`/api/admin/tickets/${anyone.id}`, { personId: p.id, label: 'renamed' });
    assert.equal(ticketRow(t.id).person_id, p.id);
    assert.equal(ticketRow(t.id).label, 'renamed');
    assert.equal(ticketRow(anyone.id).person_id, null);
  });

  test('the tickets list filters by ?kind= and ?person=', async () => {
    const p = await newPerson(admin, uniq('Sam'));
    const q = await newPerson(admin, uniq('Alex'));
    const pArrival = await forPerson(p);
    const pHeat = await forPerson(p, {}, 'heat');
    const qArrival = await forPerson(q);
    const anyone = await issue();
    const list = async (query) => {
      const r = await admin.get(`/api/admin/tickets?${query}`);
      assert.equal(r.status, 200, query);
      return r.data;
    };
    const ids = async (query) => (await list(query)).map((t) => t.id).sort((a, b) => a - b);

    const anyones = await list('kind=anyone');
    assert.ok(anyones.length && anyones.every((t) => t.person === null));
    assert.ok(anyones.some((t) => t.id === anyone.id));
    const persons = await list('kind=person');
    assert.ok(persons.every((t) => t.person !== null));
    for (const t of [pArrival, pHeat, qArrival]) assert.ok(persons.some((x) => x.id === t.id));
    assert.ok(!persons.some((x) => x.id === anyone.id));

    assert.deepEqual(await ids(`person=${p.id}`), [pArrival.id, pHeat.id]);
    assert.deepEqual(await ids(`person=${q.id}`), [qArrival.id]);
    assert.deepEqual(await ids(`person=${p.id}&kind=person`), [pArrival.id, pHeat.id]);
    assert.deepEqual(await ids(`person=${p.id}&kind=anyone`), []);
    assert.deepEqual(await ids(`person=${p.id}&film=${films.heat}`), [pHeat.id]);
    const everything = await ids('');
    for (const t of [pArrival, pHeat, qArrival, anyone]) assert.ok(everything.includes(t.id));
  });
});

// ====================================================================== opening the link
describe('opening a ticket for one person', () => {
  test('a browser that is not signed in gets a sign-in page, and nothing is created or recorded', async () => {
    const sam = await member();
    const t = await forPerson(sam.p);
    // A browser with no cookie at all, and an anonymous one holding a link ticket for another film.
    const anonymous = await opened(fresh(), await issue({}, 'heat'), 'heat');
    for (const b of [fresh(), anonymous]) {
      const cookie = b.jar.get('om_session');
      const before = totals();
      const r = await b.post('/api/tickets/open', { code: t.code });
      assert.equal(r.status, 401);
      assert.deepEqual(r.data, { error: 'sign-in-required' }, 'neither the film nor the name');
      assert.deepEqual(r.headers.getSetCookie(), [], 'no cookie');
      assert.equal(b.jar.get('om_session'), cookie);
      assert.deepEqual(totals(), before, 'no session, session_tickets row, screening or event');
      assert.equal(ticketRow(t.id).first_opened_at, null);
      assert.equal(attached(t.id), 0);
      assert.deepEqual(eventsOf(t.id).map((e) => e.type), ['ticket-sent'], 'nothing but its sending, by the admin');
      await refused(b);
    }
    // The page at /t/<code> sends no Referer onwards.
    assert.equal((await fresh().get(`/t/${t.code}`)).headers.get('referrer-policy'), 'no-referrer');
  });

  test('signed in as someone else: "for someone else", and refused everywhere, even while the person plays', async () => {
    const slug = await ownFilm('someone-else');
    const sam = await member();
    const alex = await member(uniq('Alex'));
    const t = await forPerson(sam.p, {}, slug);
    const before = totals();
    const r = await alex.phone.post('/api/tickets/open', { code: t.code });
    assert.equal(r.status, 403);
    assert.deepEqual(r.data, { error: 'ticket-for-someone-else' }, 'neither the film nor the name');
    assert.deepEqual(r.headers.getSetCookie(), []);
    assert.deepEqual(totals(), before, 'nothing created or recorded');
    assert.equal(ticketRow(t.id).first_opened_at, null);
    assert.equal(attached(t.id), 0);
    await refused(alex.phone, slug);

    const { screeningId } = await play(sam.phone, slug);
    await pause(sam.phone, screeningId, 20);
    await refused(alex.phone, slug);
    const hb = await heartbeat(alex.phone, screeningId, { position: 21 });
    assert.equal(hb.status, 404);
    assert.equal((await adminTicket(t.id)).screenings[0].position, 20, "someone else's heartbeat changes nothing");
  });

  test('signed in as the person: the link opens the film, and nothing is attached to the browser', async () => {
    const sam = await member();
    const t = await forPerson(sam.p);
    const cookie = sam.phone.jar.get('om_session');
    const sessionsBefore = totals().sessions;
    const r = await sam.phone.post('/api/tickets/open', { code: t.code });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data, { slug: 'arrival' });
    assert.deepEqual(r.headers.getSetCookie(), [], 'the same session');
    assert.equal(sam.phone.jar.get('om_session'), cookie);
    assert.equal(totals().sessions, sessionsBefore);
    const first = ticketRow(t.id).first_opened_at;
    assert.ok(first, 'opened');
    assert.equal(attached(t.id), 0, 'the account holds it, not the browser');

    await opened(sam.phone, t);
    assert.equal(ticketRow(t.id).first_opened_at, first, 'the first open is kept');
    assert.equal(attached(t.id), 0);
  });

  test('it is under Your tickets on every device the person signs in on, without opening the link', async () => {
    const sam = await member();
    const t = await forPerson(sam.p, { loanDays: 2 });
    const laptop = await sam.device();
    for (const b of [sam.phone, laptop, await sam.device()]) {
      const mine = await listed(b);
      assert.equal(mine.length, 1);
      assert.equal(mine[0].film.title, 'Arrival');
      assert.equal(mine[0].ticket.inAccount, true);
      assert.equal(mine[0].ticket.state, 'ok');
      assert.deepEqual([mine[0].ticket.tape, mine[0].ticket.loanDays], ['in', 2]);
      assert.deepEqual((await me(b)).person, { name: sam.p.name });
    }
    assert.equal(ticketRow(t.id).first_opened_at, null, 'being listed is not being opened');
    assert.equal(attached(t.id), 0);
  });

  test('the first page load through it counts as opened, and the person can play everything', async () => {
    const slug = await ownFilm('first-opened');
    const sam = await member();
    const t = await forPerson(sam.p, {}, slug);
    const laptop = await sam.device();
    const page = await laptop.get(`/api/films/${slug}`);
    assert.equal(page.status, 200, JSON.stringify(page.data));
    assert.equal(page.data.access.via, 'ticket');
    assert.equal(page.data.access.ticket.inAccount, true);
    const first = ticketRow(t.id).first_opened_at;
    assert.ok(first, 'first_opened_at is set by the page');
    assert.ok(eventsOf(t.id).some((e) => e.type === 'opened' && e.session_hash === hashOf(laptop)));
    const openedEvent = (await admin.get(`/api/admin/activity?ticket=${t.id}`)).data.events.find((e) => e.type === 'opened');
    assert.equal(openedEvent.personName, sam.p.name, 'Activity names the person, read from the session');

    const s = await playsEverything(laptop, slug);
    assert.equal(s.resumed, false);
    // The phone sees the page and artwork, but holds no screening.
    assert.equal(await status(sam.phone, `/api/films/${slug}`), 200);
    assert.deepEqual(await statuses(sam.phone, ARTWORK[slug]), every(ARTWORK[slug], 200));
    assert.deepEqual(await statuses(sam.phone, playbackFiles(slug)), every(playbackFiles(slug), 403));

    const a = await adminTicket(t.id);
    // Lent once (1.x: screeningsUsed 1).
    assert.ok(a.loan, 'the link has lent');
    assert.equal(a.browsers, 0, 'a ticket with a person is held by no browser');
    assert.deepEqual(a.browserList, []);
    assert.equal(ticketRow(t.id).first_opened_at, first, 'later page loads keep the first');
    assert.equal(attached(t.id), 0);
  });
});

// ====================================================================== session_tickets is ignored
describe("a session_tickets row for a person's ticket", () => {
  test('inserted by hand, it grants nothing to an anonymous browser or to someone else', async () => {
    const slug = await ownFilm('by-hand');
    const sam = await member();
    const t = await forPerson(sam.p, {}, slug);
    const { screeningId } = await play(sam.phone, slug);
    await heartbeat(sam.phone, screeningId, { position: 15 });
    const anonymous = await opened(fresh(), await issue({}, 'heat'), 'heat');
    const alex = await member(uniq('Alex'));
    try {
      for (const b of [anonymous, alex.phone]) {
        const hash = hashOf(b);
        srv.db.prepare('INSERT INTO session_tickets (session_hash, ticket_id, added_at) VALUES (?, ?, ?)').run(hash, t.id, Date.now());
        // And the screening too, as if this browser had been playing it.
        srv.db.prepare('UPDATE screenings SET session_hash = ? WHERE id = ?').run(hash, screeningId);
        const hb = await heartbeat(b, screeningId, { position: 60 });
        assert.equal(hb.status, 404, 'heartbeat');
        // The row makes it look like a browser that opened the link before the ticket
        // was given, so the page says it was kept (410), and shows nothing of the film.
        await refused(b, slug, { page: [410] });
      }
      assert.equal((await adminTicket(t.id)).screenings[0].position, 15, 'their heartbeats changed nothing');
    } finally {
      srv.db.prepare('DELETE FROM session_tickets WHERE ticket_id = ?').run(t.id);
    }
    // The browser left holding the screening can't play it, so the person takes it back at once.
    const back = await play(sam.phone, slug);
    assert.equal(back.screeningId, screeningId);
    assert.equal(back.resumed, true);
    assert.equal(await status(sam.phone, master(slug)), 200);
  });
});

// ====================================================================== disabling
describe('disabling the person', () => {
  // 1.x: after Enable and a new sign-in the same play resumed. A card turned off brings
  // its tapes back at once, and turning it on again doesn't lend them out again
  // (docs/version-2.md, question 5): the link is spent.
  test('mid-film: the next segment is refused and the tape comes back; Enable signs nobody in, and the link stays spent', async () => {
    const slug = await ownFilm('mid-film');
    const sam = await member();
    const t = await forPerson(sam.p, {}, slug);
    const { screeningId } = await play(sam.phone, slug);
    assert.equal((await heartbeat(sam.phone, screeningId, { position: 30 })).status, 200);
    assert.equal(await status(sam.phone, segment(4, slug)), 200);

    await admin.post(`/api/admin/people/${sam.p.id}/disable`);
    assert.equal(await status(sam.phone, segment(5, slug)), 403, 'the next segment');
    assert.equal((await heartbeat(sam.phone, screeningId, { position: 36 })).status, 404);
    assert.equal((await me(sam.phone)).person, null);
    assert.equal((await sam.phone.post('/api/tickets/open', { code: t.code })).status, 401);
    await refused(sam.phone, slug);
    assert.equal((await adminTicket(t.id)).person.disabled, true);

    await admin.post(`/api/admin/people/${sam.p.id}/enable`);
    assert.equal((await me(sam.phone)).person, null, 'enabling signs nobody back in');
    await refused(sam.phone, slug);

    const loan = srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(t.id);
    assert.equal(loan.ended_how, 'disabled', 'written when the card was turned off, not left for the clock');
    assert.ok(loan.ended_at >= loan.taken_at && loan.ended_at < loan.due_at);

    const s = await signIn(sam.phone, sam.auth);
    assert.equal(s.status, 200, JSON.stringify(s.data));
    const again = await sam.phone.post(`/api/films/${slug}/screenings`);
    assert.deepEqual([again.status, again.data], [409, { error: 'spent' }]);
    const page = (await sam.phone.get(`/api/films/${slug}`)).data.access;
    assert.deepEqual([page.canPlay, page.ticket.state, page.ticket.tape], [false, 'spent', null]);
    // The borrower is told when it went back, and no more than "it was due".
    assert.deepEqual(page.ticket.returned, { at: loan.ended_at, how: 'due' });
    assert.deepEqual(await statuses(sam.phone, playbackFiles(slug)), every(playbackFiles(slug), 403));
    // Its one loan, ended when the card went off, and the link done (1.x: screeningsUsed 1).
    const done = await adminTicket(t.id);
    assert.deepEqual([done.linkState, done.loan.endedHow], ['done', 'disabled']);
    const still = srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(t.id);
    assert.deepEqual([still.ended_at, still.ended_how], [loan.ended_at, 'disabled'], 'turned on again, the loan stays ended');
  });

  test("a disabled person's browser is anonymous, and can still open and play a link ticket", async () => {
    const slug = await ownFilm('disabled-anonymous');
    const sam = await member();
    await admin.post(`/api/admin/people/${sam.p.id}/disable`);
    const link = await issue({}, slug);
    const r = await sam.phone.post('/api/tickets/open', { code: link.code });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await me(sam.phone)).person, null);
    await playsEverything(sam.phone, slug);
  });
});

// ====================================================================== several devices
describe("two of the person's devices", () => {
  test('one at a time: the second waits while the first plays, and takes over after a pause', async () => {
    const slug = await ownFilm('one-at-a-time');
    const sam = await member();
    const t = await forPerson(sam.p, {}, slug);
    const laptop = await sam.device();
    const { screeningId } = await play(sam.phone, slug);
    const blocked = await laptop.post(`/api/films/${slug}/screenings`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.error, 'playing-elsewhere');
    assert.equal(await status(laptop, master(slug)), 403);

    await pause(sam.phone, screeningId, 40);
    const takeover = await play(laptop, slug);
    assert.equal(takeover.screeningId, screeningId);
    assert.equal(takeover.resumed, true);
    assert.equal(takeover.position, 40);
    assert.deepEqual(await statuses(laptop, playbackFiles(slug)), every(playbackFiles(slug), 200));
    assert.equal(await status(sam.phone, master(slug)), 403, 'the phone loses the stream');
    const hb = await heartbeat(sam.phone, screeningId, { position: 41 });
    assert.equal(hb.status, 409);
    assert.equal(hb.data.error, 'playing-elsewhere');
    // Taking over carries on the one loan and its one play (1.x: screeningsUsed 1).
    assert.equal((await adminTicket(t.id)).loan.screeningId, screeningId);
  });

  test('takes over at once when the holding device can no longer play: signed out, or its session expired', async () => {
    for (const how of ['signed out', 'expired']) {
      // A film each: the first member's tape stays theirs when one of their devices signs out.
      const slug = await ownFilm(`takes-over-${how.replace(' ', '-')}`);
      const sam = await member();
      await forPerson(sam.p, {}, slug);
      const laptop = await sam.device();
      const { screeningId } = await play(laptop, slug);
      await heartbeat(laptop, screeningId, { position: 12 });
      assert.equal((await sam.phone.post(`/api/films/${slug}/screenings`)).status, 409, how);
      if (how === 'signed out') await laptop.post('/api/signout');
      else srv.db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(Date.now() - 1, hashOf(laptop));
      const r = await play(sam.phone, slug);
      assert.equal(r.screeningId, screeningId, how);
      assert.equal(r.resumed, true, how);
    }
  });

  test('a limit of one with two Plays at once: one 200, one 409, one screening used', async () => {
    const slug = await ownFilm('limit-of-one');
    const sam = await member();
    const t = await forPerson(sam.p, {}, slug);
    const laptop = await sam.device();
    const rs = await Promise.all([sam.phone, laptop].map((b) => b.post(`/api/films/${slug}/screenings`)));
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409], JSON.stringify(rs.map((r) => r.data)));
    assert.equal(rs.find((r) => r.status === 409).data.error, 'playing-elsewhere');
    const a = await adminTicket(t.id);
    // One loan, and its play the only one (1.x: screeningsUsed 1).
    assert.equal(a.screenings.length, 1);
    assert.equal(a.loan.screeningId, a.screenings[0].id);
  });
});

// ====================================================================== revoke and restore
describe('revoking and restoring a ticket for one person', () => {
  // 1.x: a link could be revoked mid-play and restored, and the same play resumed.
  // Version 2 (version-2.md, "What can happen to a tape"): a link that never lent is
  // cancelled and restored as before; cancelling one that has the tape is taking the
  // tape back, and a link that has lent can't be restored (409 lent-once).
  test('before it has lent: revoke stops it on the next request, and restore gives it back to the person at once, without the link', async () => {
    const slug = await ownFilm('revoke-restore');
    const sam = await member();
    const t = await forPerson(sam.p, {}, slug);
    const laptop = await sam.device();
    assert.equal(await status(sam.phone, `/api/films/${slug}`), 200);

    assert.equal((await admin.post(`/api/admin/tickets/${t.id}/revoke`)).status, 200);
    for (const b of [sam.phone, laptop]) await refused(b, slug);
    // Unknown, revoked and unpublished tickets fail first, as for any ticket.
    for (const b of [sam.phone, fresh()]) {
      const r = await b.post('/api/tickets/open', { code: t.code });
      assert.equal(r.status, 410);
      assert.equal(r.data.error, 'ticket-revoked');
    }

    assert.equal((await admin.post(`/api/admin/tickets/${t.id}/restore`)).status, 200);
    for (const b of [sam.phone, laptop]) {
      assert.equal((await listed(b, slug))[0]?.ticket.inAccount, true);
      assert.equal(await status(b, `/api/films/${slug}`), 200);
    }
    const first = await play(sam.phone, slug);
    assert.equal(first.took, true);
    assert.deepEqual(await statuses(sam.phone, playbackFiles(slug)), every(playbackFiles(slug), 200));
    assert.equal(attached(t.id), 0);
    assert.deepEqual(eventsOf(t.id).map((e) => e.type).filter((type) => /^ticket-(cancelled|restored)$/.test(type)), ['ticket-cancelled', 'ticket-restored']);
  });

  test('with the tape out: revoke takes the tape back, playback stops on the next request, and the link can’t be restored', async () => {
    const slug = await ownFilm('revoke-taken-back');
    const sam = await member();
    const t = await forPerson(sam.p, {}, slug);
    const laptop = await sam.device();
    const { screeningId } = await play(sam.phone, slug);
    await heartbeat(sam.phone, screeningId, { position: 24 });
    assert.equal(await status(sam.phone, segment(4, slug)), 200);

    const revoked = await admin.post(`/api/admin/tickets/${t.id}/revoke`);
    // Cancelled (1.x's state said 'revoked').
    assert.deepEqual([revoked.status, revoked.data.tookBack, revoked.data.linkState], [200, true, 'cancelled']);
    assert.equal(await status(sam.phone, segment(5, slug)), 403, 'the next segment');
    const report = await heartbeat(sam.phone, screeningId, { position: 25 });
    assert.deepEqual([report.status, report.data], [409, { error: 'taken-back' }]);
    for (const b of [sam.phone, laptop]) await refused(b, slug);
    const loan = srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(t.id);
    assert.equal(loan.ended_how, 'taken-back');

    const restored = await admin.post(`/api/admin/tickets/${t.id}/restore`);
    assert.deepEqual([restored.status, restored.data], [409, { error: 'lent-once' }]);
    assert.ok(ticketRow(t.id).revoked_at, 'still cancelled');
    for (const b of [sam.phone, laptop]) await refused(b, slug);
  });
});

// ====================================================================== setup links with a ticket
describe('a setup link that carries a ticket', () => {
  test('options name the film, finishing returns its slug, and the new browser can play', async () => {
    const slug = await ownFilm('setup-link');
    const p = await newPerson(admin, uniq('Robin'));
    const t = await forPerson(p, {}, slug);
    const link = await setupLink(admin, p.id, { ticketId: t.id });
    assert.equal(link.purpose, 'setup');
    assert.equal(srv.db.prepare('SELECT ticket_id FROM person_links WHERE person_id = ?').get(p.id).ticket_id, t.id);

    const b = fresh();
    const opts = await b.post('/api/enroll/options', { token: link.token });
    assert.equal(opts.status, 200, JSON.stringify(opts.data));
    assert.deepEqual(opts.data.film, { slug, title: 'Arrival' });
    const fin = await b.post('/api/enroll/finish', { token: link.token, credential: softAuthenticator().create(opts.data.options) });
    assert.equal(fin.status, 200, JSON.stringify(fin.data));
    assert.equal(fin.data.slug, slug);
    assert.deepEqual(fin.data.person, { name: p.name });
    assert.equal((await listed(b, slug))[0]?.ticket.inAccount, true);
    await playsEverything(b, slug);
    assert.equal(attached(t.id), 0);
  });

  test('a recovery link can carry a ticket too', async () => {
    const sam = await member();
    const t = await forPerson(sam.p, {}, 'heat');
    const link = await setupLink(admin, sam.p.id, { confirmedContact: true, ticketId: t.id });
    assert.equal(link.purpose, 'recovery');
    const b = fresh();
    const opts = await b.post('/api/enroll/options', { token: link.token });
    assert.equal(opts.status, 200, JSON.stringify(opts.data));
    assert.deepEqual(opts.data.film, { slug: 'heat', title: 'Heat' });
    const fin = await b.post('/api/enroll/finish', { token: link.token, credential: softAuthenticator().create(opts.data.options) });
    assert.equal(fin.status, 200, JSON.stringify(fin.data));
    assert.equal(fin.data.slug, 'heat');
  });

  test("another person's ticket, a link ticket, a revoked one or none: 400 bad-ticket, and the waiting link stays", async () => {
    const p = await newPerson(admin, uniq('Kim'));
    const other = await newPerson(admin, uniq('Lee'));
    const good = await forPerson(p);
    const waiting = await setupLink(admin, p.id, { ticketId: good.id });
    const revoked = await forPerson(p);
    await admin.post(`/api/admin/tickets/${revoked.id}/revoke`);
    const bad = {
      "another person's ticket": (await forPerson(other)).id,
      'a ticket for anyone with the link': (await issue()).id,
      'a revoked ticket': revoked.id,
      'no such ticket': 999999,
    };
    for (const [what, ticketId] of Object.entries(bad)) {
      const r = await admin.post(`/api/admin/people/${p.id}/links`, { ticketId });
      assert.equal(r.status, 400, what);
      assert.equal(r.data.error, 'bad-ticket', what);
    }
    const { links } = (await admin.get(`/api/admin/people/${p.id}`)).data;
    assert.equal(links.length, 1, 'no link was made');
    assert.equal(links[0].cancelledAt, null, 'and the waiting one was not cancelled');
    const opts = await fresh().post('/api/enroll/options', { token: waiting.token });
    assert.equal(opts.status, 200, JSON.stringify(opts.data));
    assert.equal(opts.data.film.slug, 'arrival');
  });
});

// ====================================================================== a link ticket and the person's own
// One tape per film: a link for anyone and the member's own link for one film never
// play at once. Of the links a browser may use, the one whose tape it has comes first
// (docs/version-2.md, "What a viewer sees").
describe("a browser with a link ticket and the person's own ticket for one film", () => {
  const loanOf = (ticketId) => srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(ticketId);
  const comeDue = (ticketId) => {
    const l = loanOf(ticketId);
    srv.db.prepare('UPDATE loans SET taken_at = ?, due_at = ? WHERE id = ?').run(Date.now() - 1 - (l.due_at - l.taken_at), Date.now() - 1, l.id);
  };

  test('Play carries on with the tape this browser has out, even when it went out on the link ticket; it is in that browser only', async () => {
    const slug = await ownFilm('both-open');
    const sam = await member();
    const link = await issue({}, slug);
    await opened(sam.phone, link, slug);
    const { screeningId, toBrowser } = await play(sam.phone, slug);
    assert.equal(toBrowser, true, 'a link for anyone lends to the browser, signed in or not');
    await pause(sam.phone, screeningId, 25);
    const own = await forPerson(sam.p, {}, slug);

    const mine = await listed(sam.phone, slug);
    assert.equal(mine.length, 1, 'one entry per film under Your tickets');
    assert.deepEqual([mine[0].ticket.tape, mine[0].ticket.inAccount], ['yours', false], 'the link that has the tape, not their own that waits');
    const again = await play(sam.phone, slug);
    assert.equal(again.screeningId, screeningId);
    assert.equal(again.resumed, true);
    assert.equal(again.position, 25);
    // Their own link never lent; the link's one loan is the play resumed (1.x:
    // screeningsUsed 0 and 1).
    assert.equal((await adminTicket(own.id)).loan, null, "the person's ticket is untouched");
    assert.equal((await adminTicket(link.id)).loan.screeningId, screeningId);
    assert.equal(loanOf(own.id), undefined);

    // Signing in doesn't change whose loan it is: on their other device the tape is out, like anyone's.
    const laptop = await sam.device();
    const elsewhere = (await laptop.get(`/api/films/${slug}`)).data.access;
    assert.deepEqual([elsewhere.canPlay, elsewhere.ticket.state, elsewhere.ticket.tape, elsewhere.ticket.inAccount], [false, 'out', 'out', true]);
    assert.deepEqual((await laptop.post(`/api/films/${slug}/screenings`)).data, { error: 'out' });
    assert.equal(await status(laptop, master(slug)), 403);
  });

  // 1.x: Play here resumed the play another browser had paused on the link.
  test('a tape another browser has out on the link ticket, even paused, is out: Play takes nothing, and their own ticket waits', async () => {
    const slug = await ownFilm('both-paused');
    const sam = await member();
    const link = await issue({}, slug);
    const friend = await opened(fresh(), link, slug);
    const { screeningId } = await play(friend, slug);
    await pause(friend, screeningId, 33);
    await opened(sam.phone, link, slug);
    const own = await forPerson(sam.p, {}, slug);
    const r = await sam.phone.post(`/api/films/${slug}/screenings`);
    assert.deepEqual([r.status, r.data], [409, { error: 'out' }]);
    const page = (await sam.phone.get(`/api/films/${slug}`)).data.access;
    assert.deepEqual([page.ticket.state, page.ticket.tape, page.ticket.dueBack], ['out', 'out', loanOf(link.id).due_at]);
    assert.equal(page.ticket.inAccount, true, 'of two links that are out, the page shows their own');
    assert.equal(await status(sam.phone, master(slug)), 403);
    assert.equal((await play(friend, slug)).position, 33, 'the friend carries on');
    assert.equal(await status(friend, master(slug)), 200);
    // Their own link never lent (1.x: screeningsUsed 0).
    assert.equal((await adminTicket(own.id)).loan, null);
    assert.equal(loanOf(own.id), undefined);
  });

  test("Play carries on with the person's own tape when the link ticket was opened later, and the link waits", async () => {
    const slug = await ownFilm('both-own');
    const sam = await member();
    const link = await issue({}, slug);
    const own = await forPerson(sam.p, {}, slug);
    const { screeningId, toBrowser } = await play(sam.phone, slug);
    assert.equal(toBrowser, false, 'their own link lends to them, on every device');
    await pause(sam.phone, screeningId, 18);
    await opened(sam.phone, link, slug);
    const r = await play(sam.phone, slug);
    assert.equal(r.screeningId, screeningId);
    assert.equal(r.resumed, true);
    // Their own link lent, and the play is its loan's; the link never lent (1.x:
    // screeningsUsed 1 and 0).
    assert.equal((await adminTicket(own.id)).loan.screeningId, screeningId);
    assert.equal((await adminTicket(link.id)).loan, null);
    // With both in one browser and the tape in, Play had taken their own, though the link is older.
    assert.ok(link.id < own.id);
    assert.equal(loanOf(link.id), undefined);
  });

  // 1.x: the friend on the link and the member on their own ticket watched at once.
  test("while another browser has the tape on the link ticket, the person's own ticket can't play; once it is back, Play takes their own", async () => {
    const slug = await ownFilm('both-busy');
    const sam = await member();
    const link = await issue({}, slug);
    const friend = await opened(fresh(), link, slug);
    const { screeningId: theirs } = await play(friend, slug);
    await heartbeat(friend, theirs, { position: 5 });
    await opened(sam.phone, link, slug);
    const own = await forPerson(sam.p, {}, slug);

    assert.deepEqual((await sam.phone.post(`/api/films/${slug}/screenings`)).data, { error: 'out' });
    // Their own link took nothing (1.x: screeningsUsed 0).
    assert.equal((await adminTicket(own.id)).loan, null);
    assert.deepEqual(await statuses(sam.phone, playbackFiles(slug)), every(playbackFiles(slug), 403));
    assert.deepEqual(await statuses(friend, playbackFiles(slug)), every(playbackFiles(slug), 200), 'the friend keeps watching');

    comeDue(link.id);
    const r = await play(sam.phone, slug);
    assert.notEqual(r.screeningId, theirs);
    assert.deepEqual([r.resumed, r.took, r.toBrowser, r.position], [false, true, false, 0]);
    assert.equal(loanOf(own.id).person_id, sam.p.id);
    // Their own link lends now, with this play; the link's one loan was the friend's,
    // and is over (1.x: screeningsUsed 1 on each).
    assert.equal((await adminTicket(own.id)).loan.screeningId, r.screeningId);
    assert.deepEqual([(await adminTicket(link.id)).loan.screeningId, (await adminTicket(link.id)).loan.live], [theirs, false]);
    assert.deepEqual(await statuses(sam.phone, playbackFiles(slug)), every(playbackFiles(slug), 200));
    assert.deepEqual(await statuses(friend, playbackFiles(slug)), every(playbackFiles(slug), 403));
    assert.deepEqual((await friend.post(`/api/films/${slug}/screenings`)).data, { error: 'spent' });
  });

  // 1.x: Play took over the signed-out browser's play, from where it had got to.
  // Nobody inherits a stranger's place: the tape comes back at once, and the link is spent.
  test('when the browser that has the tape on the link ticket signs out, the tape is back at once, and Play takes their own from the start', async () => {
    const slug = await ownFilm('both-gone');
    const sam = await member();
    const link = await issue({}, slug);
    const friend = await opened(fresh(), link, slug);
    const { screeningId } = await play(friend, slug);
    await heartbeat(friend, screeningId, { position: 44 });
    await opened(sam.phone, link, slug);
    const own = await forPerson(sam.p, {}, slug);
    assert.deepEqual((await sam.phone.post(`/api/films/${slug}/screenings`)).data, { error: 'out' });
    await friend.post('/api/signout');
    const page = (await sam.phone.get(`/api/films/${slug}`)).data.access;
    assert.deepEqual([page.canPlay, page.ticket.tape, page.ticket.inAccount], [true, 'in', true], 'in again, with nothing written');
    assert.equal(loanOf(link.id).ended_at, null);
    const r = await play(sam.phone, slug);
    assert.notEqual(r.screeningId, screeningId);
    assert.deepEqual([r.resumed, r.took, r.position, r.toBrowser], [false, true, 0, false]);
    const ended = loanOf(link.id);
    assert.equal(ended.ended_how, 'signed-out');
    assert.ok(ended.ended_at >= ended.taken_at && ended.ended_at < ended.due_at, 'dated when the browser signed out, not when it was due');
    // Their own link lent, from the start; the link is done (1.x: screeningsUsed 1,
    // and state 'used_up').
    assert.equal((await adminTicket(own.id)).loan.screeningId, r.screeningId);
    assert.equal((await adminTicket(link.id)).linkState, 'done');
  });
});

// ====================================================================== the best view wins
// docs/version-2.md, "What a viewer sees": of several links a browser may use for one
// film, the best is chosen by view (yours, in, out, spent, expired), then the person's
// own, then the oldest. The film page, Play and Your tickets all go by it.
describe('a browser with a usable ticket and one that has ended, for one film', () => {
  async function goesByTheUsable(b, usable, ended, endedState, slug) {
    const page = (await b.get(`/api/films/${slug}`)).data.access;
    assert.equal(page.ticket.state, 'ok', `the page shows the usable ticket, not the ${endedState} one`);
    assert.equal(page.canPlay, true);
    assert.deepEqual(
      (await listed(b, slug)).map((t) => t.ticket.state),
      ['ok'],
      'Your tickets lists the film once, by the usable ticket',
    );
    // Play lends on the usable link, and the ended one's loan (none, or the one it had)
    // stays as it was; its linkState is `endedState` (1.x counted plays, screeningsUsed,
    // and named the state in its own words: expired, used_up).
    const before = (await adminTicket(ended.id)).loan?.id ?? null;
    const r = await play(b, slug);
    assert.equal(r.resumed, false);
    assert.equal((await adminTicket(usable.id)).loan.screeningId, r.screeningId, 'Play uses the usable ticket');
    assert.equal((await adminTicket(ended.id)).loan?.id ?? null, before);
    assert.equal((await adminTicket(ended.id)).linkState, endedState);
    assert.deepEqual(await statuses(b, playbackFiles(slug)), every(playbackFiles(slug), 200));
  }

  test('a link that has expired gives way to a newer one sent to replace it', async () => {
    const slug = await ownFilm('expired-link');
    const b = fresh();
    const old = await issue({ label: 'First link', startBy: Date.now() - 1000 }, slug);
    await opened(b, old, slug);
    assert.equal((await b.get(`/api/films/${slug}`)).data.access.ticket.state, 'expired');
    const replacement = await issue({ label: 'Second link' }, slug);
    await opened(b, replacement, slug);
    await goesByTheUsable(b, replacement, old, 'missed', slug);
  });

  // 1.x: "used up", once its one play could no longer be resumed. A link is spent when its tape is back.
  test("the person's own ticket, spent, gives way to a link ticket opened later", async () => {
    const slug = await ownFilm('used-up-own');
    const sam = await member();
    const own = await forPerson(sam.p, {}, slug);
    const { screeningId } = await play(sam.phone, slug);
    srv.db.prepare('UPDATE loans SET taken_at = ?, due_at = ? WHERE screening_id = ?').run(Date.now() - 1 - 3 * 24 * 3600e3, Date.now() - 1, screeningId);
    assert.equal((await sam.phone.get(`/api/films/${slug}`)).data.access.ticket.state, 'spent');
    const link = await issue({ label: 'Another go' }, slug);
    await opened(sam.phone, link, slug);
    // The back office says "done" for a link that has lent and is back (1.x: "used up").
    await goesByTheUsable(sam.phone, link, own, 'done', slug);
  });
});

// ====================================================================== link tickets
describe('a ticket for anyone with the link, with people around', () => {
  // 1.x: "taken over exactly as in milestone 1". The borrower is the browser that
  // pressed Play; any other browser with the link, signed in or not, sees it out.
  test('opens and plays as in milestone 1; a signed-in browser holds it alone, and a second browser never takes over', async () => {
    const slug = await ownFilm('for-anyone');
    const sam = await member();
    const t = await issue({}, slug);
    const anon = fresh();
    const r = await anon.post('/api/tickets/open', { code: t.code });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data, { slug });
    assert.ok(r.headers.getSetCookie().some((c) => c.startsWith('om_session=')), 'a session for this browser');
    assert.equal(attached(t.id), 1);
    assert.ok(ticketRow(t.id).first_opened_at);
    assert.equal((await me(anon)).person, null);
    assert.equal((await listed(anon, slug))[0].ticket.inAccount, false);
    const { screeningId } = await playsEverything(anon, slug);

    // A signed-in person opening it keeps their session, and holds it in this browser only.
    const cookie = sam.phone.jar.get('om_session');
    const mine = await sam.phone.post('/api/tickets/open', { code: t.code });
    assert.equal(mine.status, 200, 'opening works while the tape is out, and takes nothing');
    assert.deepEqual(mine.data, { slug });
    assert.deepEqual(mine.headers.getSetCookie(), []);
    assert.equal(sam.phone.jar.get('om_session'), cookie);
    assert.equal(attached(t.id), 2);
    assert.equal((await listed(sam.phone, slug))[0].ticket.inAccount, false);
    const laptop = await sam.device();
    await refused(laptop, slug);

    // The tape is out with the first browser: no other takes it, or takes over.
    const blocked = await sam.phone.post(`/api/films/${slug}/screenings`);
    assert.deepEqual([blocked.status, blocked.data], [409, { error: 'out' }]);
    // Not after 75 seconds without a report,
    srv.db.prepare('UPDATE screenings SET active_until = ? WHERE id = ?').run(Date.now() - 1, screeningId);
    assert.deepEqual((await sam.phone.post(`/api/films/${slug}/screenings`)).data, { error: 'out' });
    // nor after a pause.
    await pause(anon, screeningId);
    assert.deepEqual((await sam.phone.post(`/api/films/${slug}/screenings`)).data, { error: 'out' });
    assert.equal(await status(sam.phone, master(slug)), 403);
    assert.equal((await heartbeat(sam.phone, screeningId, { position: 1 })).status, 404);
    assert.equal((await play(anon, slug)).screeningId, screeningId);
    assert.equal(await status(anon, master(slug)), 200);
    // One loan, and the play resumed is its own (1.x: screeningsUsed 1).
    assert.equal((await adminTicket(t.id)).loan.screeningId, screeningId);
    assert.equal((await adminTicket(t.id)).person, null);
  });

  // 1.x revoked this link with a play open, restored it, and the play resumed.
  // Version 2: a link that has the tape can't be restored once cancelled (cancelling
  // it takes the tape back, and a link lends once), so the revoke and the restore come
  // before Play here; the take-back is in test/loans.test.js.
  test('revoke stops it; after a restore, browsers must open the link again, signed in or not', async () => {
    const slug = await ownFilm('anyone-revoked');
    const sam = await member();
    const t = await issue({}, slug);
    await opened(sam.phone, t, slug);
    const anon = await opened(fresh(), t, slug);
    assert.equal((await admin.post(`/api/admin/tickets/${t.id}/revoke`)).status, 200);
    for (const b of [anon, sam.phone]) await refused(b, slug);
    assert.equal((await anon.post('/api/tickets/open', { code: t.code })).status, 410);

    assert.equal((await admin.post(`/api/admin/tickets/${t.id}/restore`)).status, 200);
    for (const b of [anon, sam.phone]) assert.equal(await status(b, `/api/films/${slug}`), 404);
    await opened(anon, t, slug);
    await opened(sam.phone, t, slug);
    for (const b of [anon, sam.phone]) assert.equal(await status(b, `/api/films/${slug}`), 200);
    const r = await play(anon, slug);
    assert.equal(r.took, true);

    // With the tape out, cancelling the link takes the tape back, for good.
    assert.equal((await admin.post(`/api/admin/tickets/${t.id}/revoke`)).data.tookBack, true);
    for (const b of [anon, sam.phone]) await refused(b, slug);
    const restored = await admin.post(`/api/admin/tickets/${t.id}/restore`);
    assert.deepEqual([restored.status, restored.data], [409, { error: 'lent-once' }]);
    for (const b of [anon, sam.phone]) assert.equal((await b.post('/api/tickets/open', { code: t.code })).data.error, 'ticket-revoked');
  });
});

// ====================================================================== one film only
describe('one film only', () => {
  test("a person's ticket for one film unlocks nothing of another", async () => {
    const slug = await ownFilm('one-film');
    const sam = await member();
    await forPerson(sam.p, {}, slug);
    await playsEverything(sam.phone, slug);
    await refused(sam.phone, 'heat');
    assert.deepEqual((await me(sam.phone)).tickets.map((x) => x.film.slug), [slug]);
    // And the other way round, on another device.
    const alex = await member(uniq('Alex'));
    await forPerson(alex.p, {}, 'heat');
    await playsEverything(alex.phone, 'heat');
    await refused(alex.phone, slug);
  });
});

// ====================================================================== afterwards
describe('after everything above', () => {
  test("no person's ticket was ever put in a session_tickets row", () => {
    const n = srv.db
      .prepare('SELECT COUNT(*) AS n FROM session_tickets st JOIN tickets t ON t.id = st.ticket_id WHERE t.person_id IS NOT NULL')
      .get().n;
    assert.equal(n, 0);
  });

  test('foreign keys still hold', () => {
    assert.deepEqual(srv.db.prepare('PRAGMA foreign_key_check').all(), []);
  });
});

describe('after review', () => {
  let s;
  let a;
  let filmId;
  before(async () => {
    const H = await import('./helpers.js');
    const dir = H.tempDir();
    H.makeFilm(dir, 'arrival');
    s = { ...(await H.startServer({ mediaDir: dir, limits: { scale: 100 } })), mediaDir: dir };
    a = await H.adminBrowser(s.base);
    await a.post('/api/admin/scan');
    filmId = (await a.get('/api/admin/films')).data[0].id;
    await a.patch(`/api/admin/films/${filmId}`, { published: true });
  });
  after(() => s.close());

  test("a setup link stops naming the film once its ticket is revoked, and names it again once it's restored", async () => {
    const H = await import('./helpers.js');
    const p = await H.newPerson(a, 'Robin');
    const t = (await a.post('/api/admin/tickets', { filmId, personId: p.id })).data[0];
    const link = await H.setupLink(a, p.id, { ticketId: t.id });
    const b = H.browser(s.base);
    assert.equal((await b.post('/api/enroll/options', { token: link.token })).data.film.slug, 'arrival');
    await a.post(`/api/admin/tickets/${t.id}/revoke`);
    assert.equal((await b.post('/api/enroll/options', { token: link.token })).data.film, null);
    await a.post(`/api/admin/tickets/${t.id}/restore`);
    assert.equal((await b.post('/api/enroll/options', { token: link.token })).data.film.slug, 'arrival');
  });

  test("/api/me lists every link ticket this browser holds, even one hidden behind the person's own", async () => {
    const H = await import('./helpers.js');
    const { softAuthenticator } = await import('./softauth.js');
    const p = await H.newPerson(a, 'Sam R');
    await a.post('/api/admin/tickets', { filmId, personId: p.id });
    const linkTicket = (await a.post('/api/admin/tickets', { filmId })).data[0];
    const b = H.browser(s.base);
    const auth = softAuthenticator();
    const link = await H.setupLink(a, p.id);
    assert.equal((await H.enroll(b, link.token, { auth })).status, 200);
    assert.equal((await b.post('/api/tickets/open', { code: linkTicket.code })).status, 200);
    const me = (await b.get('/api/me')).data;
    assert.equal(me.tickets.length, 1, 'one entry per film');
    assert.equal(me.tickets[0].ticket.inAccount, true, "the person's own ticket is the one shown");
    assert.deepEqual(me.linkTickets, ['Arrival'], 'but the link ticket is still reported, for the sign-out warning');
  });

  // 1.x: the link's own expiry against a resume window still open. One clock now.
  test('a tape that has come due reports no loan, and nothing to resume', async () => {
    const H = await import('./helpers.js');
    const film = await H.addFilm(a, s.mediaDir, 'came-due');
    const t = (await a.post('/api/admin/tickets', { filmId: film.id, loanDays: 1 })).data[0];
    const b = H.browser(s.base);
    await b.post('/api/tickets/open', { code: t.code });
    assert.equal((await b.post(`/api/films/${film.slug}/screenings`)).status, 200);
    const open = (await b.get('/api/me')).data.tickets[0].ticket;
    assert.deepEqual([open.state, open.tape, open.loan.position], ['ok', 'yours', 0]);
    assert.equal(open.dueBack, open.loan.takenAt + 24 * 3600e3);
    s.db.prepare('UPDATE loans SET taken_at = ?, due_at = ? WHERE ticket_id = ?').run(Date.now() - 1 - 24 * 3600e3, Date.now() - 1, t.id);
    const ticket = (await b.get('/api/me')).data.tickets[0].ticket;
    assert.equal(ticket.state, 'spent');
    assert.deepEqual([ticket.tape, ticket.loan, ticket.dueBack], [null, null, null]);
    // 1.1.0's expiresAt and openScreening went with its pages (slice 7).
    assert.deepEqual([ticket.expiresAt, ticket.openScreening], [undefined, undefined]);
  });
});
