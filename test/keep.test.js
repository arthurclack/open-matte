// Keeping a ticket: milestone 2, slice 3. Written from docs/history/milestone-2.md
// ("Keeping a ticket", "Changes to server/access.js", "Route changes", "Slice 3"), not
// from the implementation. No viewer browser here ever holds the admin cookie: the
// admin's preview bypasses every person rule, so a pass there would prove nothing.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';
import { adminBrowser, browser, enroll, makeFilm, newPerson, playbackFiles, setupLink, signIn, startServer, tempDir } from './helpers.js';

const mediaDir = tempDir();
const MASTER = '/media/arrival/hls/master.m3u8';
const segment = (i) => `/media/arrival/hls/v_h264_720/seg_${i}.m4s`;

let srv;
let admin;
const films = {};

before(async () => {
  makeFilm(mediaDir, 'arrival');
  makeFilm(mediaDir, 'heat', { title: 'Heat', year: 1995 });
  makeFilm(mediaDir, 'solaris', { title: 'Solaris' });
  srv = await startServer({ mediaDir, limits: { scale: 100 } });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  for (const f of (await admin.get('/api/admin/films')).data) films[f.slug] = f.id;
  for (const id of Object.values(films)) await admin.patch(`/api/admin/films/${id}`, { published: true });
  // Solaris is also shown to members.
  await admin.patch(`/api/admin/films/${films.solaris}`, { memberVisible: true });
});
after(() => srv.close());

let counter = 0;
const uniq = (name) => `${name} ${++counter}`;
const fresh = () => browser(srv.base);
const statuses = (b, urls) => Promise.all(urls.map(async (u) => (await b.get(u)).status));
const every = (urls, code) => urls.map(() => code);
const status = async (b, url) => (await b.get(url)).status;
const ticketRow = (id) => srv.db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
const screeningRow = (id) => srv.db.prepare('SELECT * FROM screenings WHERE id = ?').get(id);
const me = async (b) => {
  const r = await b.get('/api/me');
  assert.equal(r.status, 200);
  return r.data;
};
const listed = async (b, slug = 'arrival') => (await me(b)).tickets.filter((t) => t.film.slug === slug);
const adminTicket = async (id) => (await admin.get(`/api/admin/tickets/${id}`)).data;
const page = (b, slug = 'arrival') => b.get(`/api/films/${slug}`);
const keep = (b, slug = 'arrival') => b.post(`/api/films/${slug}/keep`);
const holder = (id, body) => admin.post(`/api/admin/tickets/${id}/holder`, body);

// A person with one passkey, signed in on their phone. device() signs another
// browser in as them (a browser that opened links first carries those over).
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
  return { p, phone, device };
}

async function issue(fields = {}, slug = 'arrival') {
  const r = await admin.post('/api/admin/tickets', { filmId: films[slug], ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data[0];
}
const keepable = (fields = {}, slug = 'arrival') => issue({ claimable: true, ...fields }, slug);

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
const pause = (b, id, position) => heartbeat(b, id, { position, playing: false });

async function kept(b, slug = 'arrival') {
  const r = await keep(b, slug);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ticket.inAccount, true);
  return r.data.ticket;
}

// A browser that opened the link and lost the ticket: told it was kept, everywhere
// it asks, and nothing of the film plays.
async function lostIt(b, ticket, slug = 'arrival') {
  const p = await page(b, slug);
  assert.equal(p.status, 410, `page: ${p.status} ${JSON.stringify(p.data)}`);
  assert.equal(p.data.error, 'ticket-kept');
  assert.equal(p.data.film, undefined);
  const o = await b.post('/api/tickets/open', { code: ticket.code });
  assert.equal(o.status, 410, `open: ${o.status} ${JSON.stringify(o.data)}`);
  assert.equal(o.data.error, 'ticket-kept');
  assert.ok([404, 409].includes((await b.post(`/api/films/${slug}/screenings`)).status), 'Play');
  assert.deepEqual(await statuses(b, playbackFiles(slug)), every(playbackFiles(slug), 403), 'playback files');
  assert.deepEqual(await listed(b, slug), [], 'gone from Your tickets');
}

// ====================================================================== the switch
describe('Let them keep it', () => {
  test('migration 6: claimable and claimed_at, with their CHECKs', () => {
    assert.ok(srv.db.prepare('PRAGMA user_version').get().user_version >= 6);
    const film = films.heat;
    const insert = (cols, vals) => srv.db.prepare(`INSERT INTO tickets (code, film_id, created_at, ${cols}) VALUES (?, ?, ?, ${vals.map(() => '?').join(', ')})`);
    const code = () => crypto.randomBytes(8).toString('hex');
    const pid = srv.db.prepare(`INSERT INTO people (name, webauthn_user_id, created_at) VALUES (?, ?, ?)`).run(uniq('Check'), code(), Date.now()).lastInsertRowid;
    assert.throws(() => insert('person_id, claimable', [1, 1]).run(code(), film, Date.now(), pid, 1), /CHECK/, 'a ticket for a person is never keepable');
    assert.throws(() => insert('claimed_at', [1]).run(code(), film, Date.now(), Date.now()), /CHECK/, 'only a ticket with a person can have been kept');
    assert.throws(() => insert('claimable', [1]).run(code(), film, Date.now(), 2), /CHECK/);
    const id = insert('claimable', [1]).run(code(), film, Date.now(), 1).lastInsertRowid;
    assert.throws(() => srv.db.prepare('UPDATE tickets SET person_id = ? WHERE id = ?').run(pid, id), /CHECK/, 'keeping must clear claimable');
  });

  test('issuing: off by default, only for anyone with the link', async () => {
    const plain = await issue();
    assert.equal(plain.claimable, false);
    assert.equal(ticketRow(plain.id).claimable, 0);
    const box = await keepable();
    assert.equal(box.claimable, true);
    assert.equal(box.claimedAt, null);
    const { p } = await member();
    const refused = await admin.post('/api/admin/tickets', { filmId: films.arrival, personId: p.id, claimable: true });
    assert.equal(refused.status, 400);
    assert.equal((await admin.post('/api/admin/tickets', { filmId: films.arrival, personId: p.id, claimable: false })).status, 201);
    const several = await admin.post('/api/admin/tickets', { filmId: films.arrival, claimable: true, count: 3 });
    assert.equal(several.status, 201);
    assert.ok(several.data.every((t) => t.claimable));
  });

  test('editing: switched on and off for a ticket for anyone, never for a ticket for a person', async () => {
    const t = await issue();
    assert.equal((await admin.patch(`/api/admin/tickets/${t.id}`, { claimable: true })).data.claimable, true);
    assert.equal((await admin.patch(`/api/admin/tickets/${t.id}`, { claimable: false })).data.claimable, false);
    assert.equal((await admin.patch(`/api/admin/tickets/${t.id}`, { label: 'renamed' })).data.claimable, false, 'other edits leave it alone');
    const { p } = await member();
    const mine = await issue({ personId: p.id });
    assert.equal((await admin.patch(`/api/admin/tickets/${mine.id}`, { claimable: true })).status, 400);
    assert.equal(ticketRow(mine.id).claimable, 0);
  });

  test('a ticket without the box never offers keeping, and keeping it is refused', async () => {
    const { device } = await member();
    const b = await device(await opened(fresh(), await issue()));
    const pg = await page(b);
    assert.equal(pg.data.access.canKeep, false);
    const r = await keep(b);
    assert.equal(r.status, 409);
    assert.equal(r.data.error, 'cannot-keep');
  });

  test('a friend with no account still plays a keepable ticket, and is offered keeping', async () => {
    const t = await keepable();
    const b = await opened(fresh(), t);
    const pg = await page(b);
    assert.equal(pg.status, 200);
    assert.equal(pg.data.access.canPlay, true);
    assert.equal(pg.data.access.canKeep, true, 'the page offers Sign in and keep it');
    await play(b);
    assert.deepEqual(await statuses(b, playbackFiles('arrival')), every(playbackFiles('arrival'), 200));
    const r = await keep(b);
    assert.equal(r.status, 401, 'keeping needs a sign-in');
    assert.equal(r.data.error, 'sign-in-required');
    assert.equal(ticketRow(t.id).person_id, null);
  });
});

// ====================================================================== keeping
describe('keeping', () => {
  test('needs this browser to hold the ticket, in the ok state', async () => {
    const t = await keepable();
    const { phone } = await member();
    // Signed in, but this browser never opened the link.
    assert.equal((await keep(phone)).status, 409);

    const expired = await keepable({ startBy: Date.now() - 1000 });
    const { device } = await member();
    const b = await device(await opened(fresh(), expired));
    assert.equal((await page(b)).data.access.ticket.state, 'expired');
    assert.equal((await page(b)).data.access.canKeep, false);
    assert.equal((await keep(b)).status, 409, 'an expired ticket can’t be kept');

    const usedUp = await keepable({ screeningLimit: 1 }, 'heat');
    const c = await device(await opened(fresh(), usedUp, 'heat'));
    await play(c, 'heat');
    srv.db.prepare('UPDATE screenings SET resumable_until = ? WHERE ticket_id = ?').run(Date.now() - 1, usedUp.id);
    assert.equal((await keep(c, 'heat')).data.error, 'cannot-keep', 'nor a used-up one');

    const revoked = await keepable({}, 'heat');
    const d = await device(await opened(fresh(), revoked, 'heat'));
    await admin.post(`/api/admin/tickets/${revoked.id}/revoke`);
    assert.equal((await keep(d, 'heat')).status, 409, 'nor a revoked one');
    for (const x of [t, expired, usedUp, revoked]) assert.equal(ticketRow(x.id).person_id, null);
  });

  test('the row afterwards, and every other browser that opened the link loses it at once', async () => {
    const t = await keepable({ screeningLimit: 3, daysAfterFirstPlay: 7 });
    const friend = await opened(fresh(), t);
    const { p, device } = await member();
    const b = await device(await opened(fresh(), t));
    const before = Date.now();
    const k = await kept(b);
    assert.equal(k.state, 'ok');
    const row = ticketRow(t.id);
    assert.equal(row.person_id, p.id);
    assert.equal(row.claimable, 0);
    assert.ok(row.claimed_at >= before);
    await lostIt(friend, t);
    // The keeper's own browser and their other devices have it, in the account.
    const pg = await page(b);
    assert.equal(pg.data.access.ticket.inAccount, true);
    assert.equal(pg.data.access.canKeep, false);
    const third = await device();
    assert.equal((await listed(third)).length, 1, "Sam's third device lists it without opening the link");
    await play(third);
    assert.equal(await status(third, MASTER), 200);
    // A stranger who gets the link now finds a ticket for one person.
    assert.equal((await fresh().post('/api/tickets/open', { code: t.code })).status, 401);
    const a = await adminTicket(t.id);
    assert.equal(a.person.id, p.id);
    assert.equal(a.claimable, false);
    assert.equal(a.claimedAt, row.claimed_at);
    assert.equal(a.browsers, 0);
    assert.equal(a.waitingBrowsers, 2, 'the friend and the keeper’s browser opened the link');
    assert.equal(a.browserList.length, 2);
  });

  test('another person who opened the link is told it was kept', async () => {
    const t = await keepable();
    const sam = await member();
    const alex = await member(uniq('Alex'));
    const alexBrowser = await alex.device(await opened(fresh(), t));
    await kept(await sam.device(await opened(fresh(), t)));
    await lostIt(alexBrowser, t);
    // Alex's phone never opened it: just "for someone else".
    assert.equal((await alex.phone.post('/api/tickets/open', { code: t.code })).status, 403);
  });

  test('a film shown to members stays readable for a member who lost its ticket, and says why', async () => {
    const t = await keepable({}, 'solaris');
    const alex = await member(uniq('Alex'));
    const alexBrowser = await alex.device(await opened(fresh(), t, 'solaris'));
    await kept(await (await member()).device(await opened(fresh(), t, 'solaris')), 'solaris');
    const pg = await page(alexBrowser, 'solaris');
    assert.equal(pg.status, 200);
    assert.equal(pg.data.access.via, 'member');
    assert.equal(pg.data.access.ticketKept, true);
    assert.equal(pg.data.access.canPlay, false);
    // Someone signed in who never had it sees the plain member page.
    const other = await member(uniq('Kim'));
    assert.equal((await page(other.phone, 'solaris')).data.access.ticketKept, false);
  });

  test('Sign in and keep it: the link opened before signing in comes along, and can then be kept', async () => {
    const t = await keepable();
    const b = await opened(fresh(), t);
    assert.equal((await page(b)).data.access.canKeep, true);
    const { p, device } = await member();
    await device(b);
    await kept(b);
    assert.equal(ticketRow(t.id).person_id, p.id);
  });

  test('not while another browser is playing it; once that browser pauses, the keeper resumes the same screening', async () => {
    const t = await keepable({ screeningLimit: 2, daysAfterFirstPlay: 3 });
    const tv = await opened(fresh(), t);
    const { screeningId } = await play(tv);
    assert.equal((await heartbeat(tv, screeningId, { position: 30 })).status, 200);
    const { device } = await member();
    const laptop = await device(await opened(fresh(), t));

    const busy = await keep(laptop);
    assert.equal(busy.status, 409);
    assert.equal(busy.data.error, 'playing-elsewhere');
    assert.equal(ticketRow(t.id).person_id, null);

    const clocks = () => {
      const r = ticketRow(t.id);
      const s = screeningRow(screeningId);
      return { firstPlayed: r.first_played_at, limit: r.screening_limit, days: r.days_after_first_play, startedAt: s.started_at, resumableUntil: s.resumable_until };
    };
    const beforeKeep = clocks();
    const expiresBefore = (await adminTicket(t.id)).expiresAt;
    assert.equal((await pause(tv, screeningId, 40)).status, 200);
    await kept(laptop);
    assert.deepEqual(clocks(), beforeKeep, 'limits and clocks unchanged');
    assert.equal((await adminTicket(t.id)).expiresAt, expiresBefore);
    assert.equal((await adminTicket(t.id)).screeningsUsed, 1);

    // The TV lost it: its next request is refused, and it can't hold on to the screening.
    assert.equal(await status(tv, segment(3)), 403);
    assert.equal((await heartbeat(tv, screeningId, { position: 46 })).status, 404);
    await lostIt(tv, t);

    // The keeper takes the same screening over at once, at the same place.
    const s = await play(laptop);
    assert.equal(s.screeningId, screeningId);
    assert.equal(s.resumed, true);
    assert.equal(s.position, 40);
    assert.equal(await status(laptop, MASTER), 200);
    assert.equal((await adminTicket(t.id)).screeningsUsed, 1, 'still one screening used');
  });

  test('a browser that has gone quiet, or can no longer play, doesn’t block keeping', async () => {
    const t = await keepable();
    const tv = await opened(fresh(), t);
    const { screeningId } = await play(tv);
    const { device } = await member();
    const laptop = await device(await opened(fresh(), t));
    // Quiet for longer than a heartbeat allows.
    srv.db.prepare('UPDATE screenings SET active_until = ? WHERE id = ?').run(Date.now() - 1, screeningId);
    await kept(laptop);

    const t2 = await keepable({}, 'heat');
    const tv2 = await opened(fresh(), t2, 'heat');
    const s2 = await play(tv2, 'heat');
    const laptop2 = await device(await opened(fresh(), t2, 'heat'));
    // The playing browser was signed out of the ticket.
    await admin.post(`/api/admin/tickets/${t2.id}/sign-out-browsers`);
    await opened(laptop2, t2, 'heat');
    await kept(laptop2, 'heat');
    assert.equal((await play(laptop2, 'heat')).screeningId, s2.screeningId);
  });

  test('two keeps at once: exactly one wins, and the other browser is told it was kept', async () => {
    const t = await keepable();
    const sam = await member();
    const alex = await member(uniq('Alex'));
    const a = await sam.device(await opened(fresh(), t));
    const b = await alex.device(await opened(fresh(), t));
    const results = await Promise.all([keep(a), keep(b)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const winner = results[0].status === 200 ? sam : alex;
    const loser = results[0].status === 200 ? b : a;
    assert.equal(ticketRow(t.id).person_id, winner.p.id);
    assert.equal(srv.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE type = 'ticket-kept' AND ticket_id = ?`).get(t.id).n, 1);
    await lostIt(loser, t);
  });

  test('two of one person’s browsers keeping at once: one keep, and both have it', async () => {
    const t = await keepable();
    const { p, device } = await member();
    const a = await device(await opened(fresh(), t));
    const b = await device(await opened(fresh(), t));
    const results = await Promise.all([keep(a), keep(b)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(ticketRow(t.id).person_id, p.id);
    for (const x of [a, b]) assert.equal((await page(x)).data.access.ticket.inAccount, true);
  });

  test('recorded in Activity against the person, with the device', async () => {
    const t = await keepable();
    const { p, device } = await member();
    const b = await device(await opened(fresh(), t));
    await kept(b);
    const e = (await admin.get(`/api/admin/activity?ticket=${t.id}`)).data.events.find((x) => x.type === 'ticket-kept');
    assert.ok(e, 'ticket-kept event');
    assert.equal(e.personId, p.id);
    assert.equal(e.filmId, films.arrival);
    assert.ok(e.device);
    assert.ok((await admin.get(`/api/admin/activity?person=${p.id}`)).data.events.some((x) => x.type === 'ticket-kept'));
  });

  test('Your tickets lists a kept ticket from when it was kept', async () => {
    const { device } = await member();
    const b = await device();
    const older = await keepable({}, 'heat');
    const newer = await issue({}, 'arrival');
    await opened(b, newer);
    await opened(b, older, 'heat');
    // Heat was issued an hour ago and Arrival opened a minute ago (requests here can
    // share a millisecond). Once kept, Heat counts from the keep, not from its issue.
    srv.db.prepare('UPDATE tickets SET created_at = ? WHERE id = ?').run(Date.now() - 60 * 60 * 1000, older.id);
    srv.db.prepare('UPDATE session_tickets SET added_at = ? WHERE ticket_id = ?').run(Date.now() - 60 * 1000, newer.id);
    await kept(b, 'heat');
    assert.deepEqual((await me(b)).tickets.map((x) => x.film.slug).slice(0, 2), ['heat', 'arrival']);
  });
});

// ====================================================================== the admin
describe('giving and releasing', () => {
  test('releasing a kept ticket gives it back to the browsers that had opened the link, and takes it from the keeper', async () => {
    const t = await keepable();
    const friend = await opened(fresh(), t);
    const { device } = await member();
    const b = await device(await opened(fresh(), t));
    const keeperOnly = await device();
    await kept(b);
    await lostIt(friend, t);

    const r = await holder(t.id, { personId: null });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.person, null);
    assert.equal(r.data.claimable, false, 'not keepable again unless you say so');
    assert.equal(r.data.claimedAt, null);
    assert.equal(r.data.browsers, 2);
    const row = ticketRow(t.id);
    assert.equal(row.person_id, null);
    assert.equal(row.claimed_at, null);

    for (const x of [friend, b]) assert.equal((await page(x)).status, 200);
    const { screeningId } = await play(friend);
    assert.equal(await status(friend, MASTER), 200);
    await pause(friend, screeningId, 12);
    assert.equal((await play(b)).screeningId, screeningId);
    assert.equal(await status(friend, MASTER), 403, 'one device at a time: the keeper took it over last');
    assert.deepEqual(await listed(keeperOnly), [], 'a device of the keeper that never opened the link loses it');
  });

  test('releasing with the box ticked makes it keepable again', async () => {
    const t = await keepable();
    const sam = await member();
    await kept(await sam.device(await opened(fresh(), t)));
    const r = await holder(t.id, { personId: null, claimable: true });
    assert.equal(r.data.claimable, true);
    const alex = await member(uniq('Alex'));
    const b = await alex.device(await opened(fresh(), t));
    await kept(b);
    assert.equal(ticketRow(t.id).person_id, alex.p.id);
  });

  test('giving a ticket for anyone to a person: browsers that opened the link lose it', async () => {
    const t = await keepable();
    const friend = await opened(fresh(), t);
    const { p, phone } = await member();
    const r = await holder(t.id, { personId: p.id });
    assert.equal(r.status, 200);
    assert.equal(r.data.person.id, p.id);
    assert.equal(r.data.claimable, false);
    assert.equal(r.data.claimedAt, null, 'given, not kept');
    assert.equal(r.data.waitingBrowsers, 1);
    await lostIt(friend, t);
    assert.equal((await listed(phone)).length, 1);
    await play(phone);
  });

  test('giving a kept ticket to someone else, and its open screening moves with it', async () => {
    const t = await keepable();
    const sam = await member();
    const alex = await member(uniq('Alex'));
    const b = await sam.device(await opened(fresh(), t));
    await kept(b);
    const { screeningId } = await play(b);
    assert.equal((await heartbeat(b, screeningId, { position: 20 })).status, 200);
    await holder(t.id, { personId: alex.p.id });
    assert.equal(ticketRow(t.id).person_id, alex.p.id);
    assert.equal(await status(b, segment(2)), 403, "Sam's browser stops on its next request");
    // Sam's browser was still "playing", but can't any more: Alex takes over at once.
    const s = await play(alex.phone);
    assert.equal(s.screeningId, screeningId);
    const types = (await admin.get(`/api/admin/activity?ticket=${t.id}`)).data.events.map((e) => [e.type, e.personId]);
    assert.ok(types.some(([type, pid]) => type === 'ticket-released' && pid === sam.p.id));
    assert.ok(types.some(([type, pid]) => type === 'ticket-given' && pid === alex.p.id));
  });

  test('refused without a personId, for someone disabled or unknown; the same person is no change', async () => {
    const t = await keepable();
    const { p } = await member();
    assert.equal((await holder(t.id, {})).status, 400);
    assert.equal((await holder(t.id, { personId: 999999 })).status, 400);
    const dana = await newPerson(admin, uniq('Dana'));
    await admin.post(`/api/admin/people/${dana.id}/disable`);
    assert.equal((await holder(t.id, { personId: dana.id })).status, 409);
    assert.equal(ticketRow(t.id).person_id, null);
    assert.equal(ticketRow(t.id).claimable, 1, 'a refused change changes nothing');
    await holder(t.id, { personId: p.id });
    const events = () => srv.db.prepare('SELECT COUNT(*) AS n FROM events WHERE ticket_id = ?').get(t.id).n;
    const n = events();
    assert.equal((await holder(t.id, { personId: p.id })).status, 200);
    assert.equal(events(), n, 'giving it to the same person again records nothing');
    assert.equal((await fresh().post(`/api/admin/tickets/${t.id}/holder`, { personId: null })).status, 401, 'viewers can’t');
  });

  test('Sign out browsers forgets the waiting browsers, so a release then gives it to nobody', async () => {
    const t = await keepable();
    const friend = await opened(fresh(), t);
    await kept(await (await member()).device(await opened(fresh(), t)));
    await admin.post(`/api/admin/tickets/${t.id}/sign-out-browsers`);
    assert.equal((await adminTicket(t.id)).waitingBrowsers, 0);
    // No longer told it was kept: the browser simply has no ticket now.
    assert.equal((await page(friend)).status, 404);
    await holder(t.id, { personId: null });
    assert.equal((await page(friend)).status, 404, 'it has to open the link again');
    await opened(friend, t);
    await play(friend);
  });

  test('revoke and restore a kept ticket: the keeper has it back at once; the waiting browsers were forgotten', async () => {
    const t = await keepable();
    const friend = await opened(fresh(), t);
    const sam = await member();
    await kept(await sam.device(await opened(fresh(), t)));
    await admin.post(`/api/admin/tickets/${t.id}/revoke`);
    assert.equal((await page(friend)).status, 404);
    assert.equal(await status(sam.phone, '/api/films/arrival'), 404);
    await admin.post(`/api/admin/tickets/${t.id}/restore`);
    assert.equal((await listed(sam.phone)).length, 1);
    assert.equal((await adminTicket(t.id)).waitingBrowsers, 0);
    assert.equal((await page(friend)).status, 404);
  });

  test('disabling the keeper stops the ticket for them, and doesn’t give it back to anyone', async () => {
    const t = await keepable();
    const friend = await opened(fresh(), t);
    const sam = await member();
    await kept(await sam.device(await opened(fresh(), t)));
    await admin.post(`/api/admin/people/${sam.p.id}/disable`);
    assert.equal(await status(sam.phone, '/api/films/arrival'), 404);
    await lostIt(friend, t);
    await holder(t.id, { personId: null });
    assert.equal((await page(friend)).status, 200, 'released, the friend has it again');
  });
});
