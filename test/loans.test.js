// One tape per film, and one borrower at a time: version 2, slice 2 ("Loans: taking
// the tape"). Written from docs/version-2.md ("The rules", "What can happen to a
// tape", "A link's state, the same whoever asks"), not from the implementation: one
// test for each row of what can happen to a tape. Taking it is slice 2; returning it,
// taking it back, the guards on a link that has the tape, moving its due date and
// spent links are slice 3 ("Coming back"), from "Return it now" down. The clock is
// passed in, as test/screenings.test.js does, so no test waits three days.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';

const { FILM_SECONDS, addFilm, adminBrowser, browser, enroll, makeFilm, newPerson, setupLink, signIn, startServer, tempDir } = await import('./helpers.js');
const { createAccess } = await import('../server/access.js');
const { config } = await import('../server/config.js');
const { tx } = await import('../server/db.js');
const { createSettings } = await import('../server/settings.js');
const { openDb } = await import('../server/db.js');

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const master = (slug) => `/media/${slug}/hls/master.m3u8`;

const mediaDir = tempDir();
let srv;
let admin;
let access;

before(async () => {
  makeFilm(mediaDir, 'arrival');
  srv = await startServer({ mediaDir, limits: { scale: 100 } });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  // The rules, asked directly with a clock of the test's own.
  access = createAccess(srv.db, createSettings(srv.db));
});
after(() => srv.close());

// A film of its own for every test: one tape each.
const ownFilm = (slug) => addFilm(admin, mediaDir, slug);
async function issue(film, fields = {}) {
  const r = await admin.post('/api/admin/tickets', { filmId: film.id, ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data[0];
}
async function opened(ticket, b = browser(srv.base)) {
  const r = await b.post('/api/tickets/open', { code: ticket.code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return b;
}
// A member signed in on their phone; device() signs another browser in as them.
async function member(name) {
  const p = await newPerson(admin, name);
  const auth = softAuthenticator();
  const phone = browser(srv.base);
  assert.equal((await enroll(phone, (await setupLink(admin, p.id)).token, { auth })).status, 200);
  const device = async (b = browser(srv.base)) => {
    assert.equal((await signIn(b, auth)).status, 200);
    return b;
  };
  return { p, phone, auth, device };
}
// The browser as the server's routes see it: its session's row, with its person's name.
const hashOf = (b) => sha256(b.jar.get('om_session'));
const viewerOf = (b) => ({ ...srv.db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(hashOf(b)) });
const filmRow = (film) => srv.db.prepare('SELECT * FROM films WHERE id = ?').get(film.id);
const ticketRow = (ticket) => srv.db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.id);
const loanOf = (ticket) => {
  const row = srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(ticket.id);
  return row ? { ...row } : null;
};
const screeningRow = (id) => ({ ...srv.db.prepare('SELECT * FROM screenings WHERE id = ?').get(id) });
const loansOn = (film) => srv.db.prepare('SELECT * FROM loans WHERE film_id = ? ORDER BY id').all(film.id).map((l) => ({ ...l }));
const eventsOf = (ticket, type) =>
  srv.db.prepare('SELECT * FROM events WHERE ticket_id = ? AND type = ? ORDER BY id').all(ticket.id, type).map((e) => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null }));
const sql = (s, ...args) => srv.db.prepare(s).run(...args);
// Play, pressed at `now`.
const press = (b, film, now) => access.startScreening(viewerOf(b), filmRow(film), now);
const stateOf = (ticket, now) => access.ticketStatus(ticketRow(ticket), now).state;
const viewOf = (b, film, now) => {
  const a = access.filmAccess({ viewer: viewerOf(b) }, filmRow(film), now);
  return [a.view, a.tape];
};

// ====================================================================== sending and opening
describe('sending a link, and opening one', () => {
  test('sending takes nothing: a row with its days, and one event for each link', async () => {
    const film = await ownFilm('sent');
    const sam = await newPerson(admin, 'Sent Sam');
    const plain = await issue(film);
    const five = await issue(film, { loanDays: 5 });
    const forSam = await issue(film, { personId: sam.id, loanDays: 30 });
    const several = (await admin.post('/api/admin/tickets', { filmId: film.id, count: 3, loanDays: 2 })).data;
    assert.equal(several.length, 3);

    assert.deepEqual([ticketRow(plain).loan_days, ticketRow(five).loan_days, ticketRow(forSam).loan_days], [null, 5, 30]);
    for (const t of [plain, five, forSam, ...several]) {
      assert.equal(ticketRow(t).pick_note, null);
      const [sent, ...more] = eventsOf(t, 'ticket-sent');
      assert.deepEqual(more, [], 'one event each');
      assert.deepEqual([sent.film_id, sent.session_hash, sent.screening_id], [film.id, null, null]);
      assert.deepEqual(sent.detail, { loanDays: ticketRow(t).loan_days, note: false });
      assert.equal(sent.person_id, t.id === forSam.id ? sam.id : null, 'a link for a member names them');
    }
    assert.deepEqual(loansOn(film), [], 'sending a link never takes the tape');
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM screenings WHERE film_id = ?').get(film.id).n, 0);
    for (const t of [plain, five, forSam]) assert.equal(stateOf(t, Date.now()), 'in', 'several links for one film, all of them waiting for a Play');
    assert.equal(access.ticketStatus(ticketRow(plain)).loanDays, 3, 'with none of its own, the shop’s days');
    assert.equal(access.ticketStatus(ticketRow(five)).loanDays, 5);
  });

  test('opening attaches the link to the browser, whether the tape is in or out, and takes nothing', async () => {
    const film = await ownFilm('opened');
    const first = await issue(film);
    const second = await issue(film);
    const borrower = await opened(first);
    assert.deepEqual(loansOn(film), [], 'opening took nothing');
    assert.ok(ticketRow(first).first_opened_at);
    assert.equal(press(borrower, film, Date.now()).error, undefined);

    // With the tape out: the same answer, for the link that has it and for another.
    for (const t of [first, second]) {
      const b = browser(srv.base);
      const r = await b.post('/api/tickets/open', { code: t.code });
      assert.deepEqual([r.status, r.data], [200, { slug: 'opened' }]);
      assert.ok(srv.db.prepare('SELECT 1 FROM session_tickets WHERE session_hash = ? AND ticket_id = ?').get(hashOf(b), t.id), 'attached');
      assert.equal((await b.get('/api/films/opened')).data.access.ticket.state, 'out');
    }
    assert.equal(loansOn(film).length, 1);
    assert.deepEqual(eventsOf(second, 'lent'), []);
  });
});

// ====================================================================== Play
describe('pressing Play', () => {
  test('with the tape in: a screening and a loan due after the link’s days, the first play marked, and "lent" and "play" logged', async () => {
    const film = await ownFilm('play-in');
    const ticket = await issue(film, { loanDays: 5 });
    const b = await opened(ticket);
    const t0 = Date.now() + HOUR;
    assert.deepEqual(viewOf(b, film, t0), ['in', 'in']);

    const r = press(b, film, t0);
    assert.deepEqual([r.error, r.resumed], [undefined, false]);
    const loan = loanOf(ticket);
    assert.deepEqual(loan, {
      id: loan.id, film_id: film.id, ticket_id: ticket.id, screening_id: r.screening.id, person_id: null,
      session_hash: hashOf(b), device: 'Browser on unknown device', taken_at: t0, due_at: t0 + 5 * DAY, ended_at: null, ended_how: null,
    });
    assert.deepEqual(r.loan.id, loan.id);
    const s = screeningRow(r.screening.id);
    assert.deepEqual([s.ticket_id, s.film_id, s.session_hash, s.started_at, s.position_seconds, s.finished_at], [ticket.id, film.id, hashOf(b), t0, 0, null]);
    assert.equal(s.resumable_until, t0 + 5 * DAY, 'written once, as the due time');
    assert.equal(ticketRow(ticket).first_played_at, t0);
    const [lent] = eventsOf(ticket, 'lent');
    assert.deepEqual([lent.at, lent.film_id, lent.session_hash, lent.screening_id, lent.detail], [t0, film.id, hashOf(b), s.id, { loanId: loan.id, dueAt: t0 + 5 * DAY }]);
    const [play] = eventsOf(ticket, 'play');
    assert.deepEqual([play.at, play.screening_id, play.detail], [t0, s.id, { resumed: false }]);
    assert.deepEqual(viewOf(b, film, t0), ['yours', 'yours']);
    assert.equal(stateOf(ticket, t0), 'lent');
    assert.equal(access.mayStream({ viewer: viewerOf(b) }, filmRow(film), t0), true);
  });

  test('when the tape is yours: the same play, where it had got to, and nothing more is taken', async () => {
    const film = await ownFilm('play-yours');
    const ticket = await issue(film);
    const b = await opened(ticket);
    const t0 = Date.now() + HOUR;
    const first = press(b, film, t0);
    assert.deepEqual(access.heartbeat(viewerOf(b), first.screening.id, { position: 61, playing: false }, t0 + MINUTE), { ok: true });

    for (const at of [t0 + 2 * MINUTE, t0 + DAY, t0 + 3 * DAY - 1]) {
      const again = press(b, film, at);
      assert.deepEqual([again.error, again.resumed, again.screening.id, again.screening.position_seconds, again.loan.id], [undefined, true, first.screening.id, 61, first.loan.id], String(at - t0));
    }
    assert.equal(loansOn(film).length, 1);
    assert.equal(eventsOf(ticket, 'lent').length, 1);
    assert.deepEqual([loanOf(ticket).taken_at, loanOf(ticket).due_at], [t0, t0 + 3 * DAY], 'pressing Play again never moves the date');
    assert.equal(ticketRow(ticket).first_played_at, t0);
    // Logged when the tape was taken, and then the same browser again at most every five minutes.
    assert.deepEqual(eventsOf(ticket, 'play').map((e) => [e.at - t0, e.detail.resumed]), [[0, false], [DAY, true], [3 * DAY - 1, true]]);
  });

  test('is refused with the view’s name: out, spent, expired, unavailable; a film only listed for members is no-ticket; and no film is no-access', async () => {
    const film = await ownFilm('play-refused');
    const t0 = Date.now() + HOUR;
    const lent = await issue(film);
    const borrower = await opened(lent);
    const sameLink = await opened(lent);
    const waiting = await opened(await issue(film));
    const missed = await opened(await issue(film, { startBy: t0 - MINUTE }));
    const stranger = await opened(await issue(await ownFilm('play-refused-other')));
    const sam = await member('Refused Sam');
    await admin.patch(`/api/admin/films/${film.id}`, { memberVisible: true });
    assert.equal(press(borrower, film, t0).error, undefined);

    assert.equal(press(sameLink, film, t0 + 1).error, 'out');
    assert.equal(press(waiting, film, t0 + 1).error, 'out');
    assert.equal(press(missed, film, t0 + 1).error, 'expired');
    assert.equal(press(sam.phone, film, t0 + 1).error, 'no-ticket');
    assert.equal(press(stranger, film, t0 + 1).error, 'no-access');
    assert.equal(access.startScreening(null, filmRow(film), t0 + 1).error, 'no-access');
    // The moment it's due, it is back: the link that lent is spent, for both its browsers.
    const due = t0 + 3 * DAY;
    assert.equal(press(sameLink, film, due - 1).error, 'out');
    assert.equal(press(sameLink, film, due).error, 'spent');
    assert.equal(press(borrower, film, due).error, 'spent');
    // Broken files: nothing plays, for a link that could lend or one that couldn't.
    sql("UPDATE films SET media_status = 'error' WHERE id = ?", film.id);
    for (const b of [waiting, borrower, missed]) assert.equal(press(b, film, due + 1).error, 'unavailable');
    sql("UPDATE films SET media_status = 'ok' WHERE id = ?", film.id);
    assert.equal(loansOn(film).length, 1, 'no refused Play took anything');
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM screenings WHERE film_id = ?').get(film.id).n, 1);
  });

  test('reaching 92% marks the play finished, and the tape stays out until it is due', async () => {
    const film = await ownFilm('play-finished');
    const ticket = await issue(film);
    const b = await opened(ticket);
    const other = await opened(await issue(film));
    const t0 = Date.now() + HOUR;
    const { screening } = press(b, film, t0);
    assert.deepEqual(access.heartbeat(viewerOf(b), screening.id, { position: 0.92 * FILM_SECONDS }, t0 + HOUR), { ok: true });
    assert.equal(screeningRow(screening.id).finished_at, t0 + HOUR);
    assert.equal(eventsOf(ticket, 'finished').length, 1);
    assert.deepEqual([loanOf(ticket).ended_at, stateOf(ticket, t0 + 2 * HOUR)], [null, 'lent']);
    assert.equal(press(other, film, t0 + 2 * HOUR).error, 'out');
    assert.equal(press(b, film, t0 + 2 * HOUR).resumed, true, 'a scene can be watched again');
    assert.equal(access.mayStream({ viewer: viewerOf(b) }, filmRow(film), t0 + 3 * DAY - 1), true);
    assert.equal(access.mayStream({ viewer: viewerOf(b) }, filmRow(film), t0 + 3 * DAY), false);
  });

  test('your own preview never takes the tape', async () => {
    const film = await ownFilm('play-preview');
    assert.equal((await admin.post('/api/films/play-preview/screenings')).data.preview, true);
    const a = access.filmAccess({ admin: { id_hash: 'the admin' } }, filmRow(film));
    assert.deepEqual([a.view, a.canPlay, a.via, a.ticket], ['preview', true, 'admin', null]);
    assert.equal(access.mayStream({ admin: { id_hash: 'the admin' } }, filmRow(film)), true);
    assert.deepEqual(loansOn(film), []);
  });

  // The route reads the browser's session, then Play begins its step. One process does
  // the two with nothing in between; a second process on the same file could sign the
  // browser out there. The loan would be over before it began, and the link spent.
  test('a browser signed out between the request and the step takes nothing, and its link can still lend', async () => {
    const film = await ownFilm('play-signed-out-meanwhile');
    const ticket = await issue(film);
    const b = await opened(ticket);
    const t0 = Date.now() + HOUR;
    const asTheRouteReadIt = viewerOf(b);
    sql('UPDATE sessions SET revoked_at = ? WHERE id_hash = ?', t0, hashOf(b));
    assert.equal(access.startScreening(asTheRouteReadIt, filmRow(film), t0 + 1).error, 'no-access');
    assert.deepEqual(loansOn(film), []);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM screenings WHERE film_id = ?').get(film.id).n, 0);
    assert.deepEqual([stateOf(ticket, t0 + 1), ticketRow(ticket).first_played_at], ['in', null], 'not spent: nobody had the tape');
    assert.deepEqual(eventsOf(ticket, 'lent'), []);

    // A member's own link, on a device signed out meanwhile: the same. Their other device takes it.
    const own = await ownFilm('play-signed-out-meanwhile-member');
    const sam = await member('Meanwhile Sam');
    const mine = await issue(own, { personId: sam.p.id });
    const laptop = await sam.device();
    const stale = viewerOf(sam.phone);
    sql('UPDATE sessions SET revoked_at = ? WHERE id_hash = ?', t0, hashOf(sam.phone));
    assert.equal(access.startScreening(stale, filmRow(own), t0 + 1).error, 'no-access');
    assert.equal(loanOf(mine), null);
    assert.equal(press(laptop, own, t0 + 1).error, undefined);
  });
});

// ====================================================================== coming due
describe('a tape that has come due', () => {
  // Nothing has ended it; every read decides by the clock. Whatever writes its end
  // writes the due time, and logs "returned" dated then.
  const cameDue = (ticket, t0) => {
    const loan = loanOf(ticket);
    assert.deepEqual([loan.ended_at, loan.ended_how], [t0 + 3 * DAY, 'due'], 'ended when it was due, not when that was written');
    const [returned, ...more] = eventsOf(ticket, 'returned');
    assert.deepEqual(more, [], 'logged once');
    assert.deepEqual([returned.at, returned.film_id, returned.screening_id, returned.session_hash, returned.person_id], [t0 + 3 * DAY, loan.film_id, loan.screening_id, loan.session_hash, loan.person_id]);
    assert.deepEqual(returned.detail, { loanId: loan.id, how: 'due', response: false });
  };

  test('is back from its due time by the clock alone: live a millisecond before, over at the moment itself, with nothing written', async () => {
    const film = await ownFilm('due-clock');
    const ticket = await issue(film);
    const b = await opened(ticket);
    const other = await opened(await issue(film));
    const t0 = Date.now() + HOUR;
    press(b, film, t0);
    const due = t0 + 3 * DAY;
    assert.deepEqual([stateOf(ticket, due - 1), viewOf(b, film, due - 1), viewOf(other, film, due - 1)], ['lent', ['yours', 'yours'], ['out', 'out']]);
    assert.deepEqual([stateOf(ticket, due), viewOf(b, film, due), viewOf(other, film, due)], ['spent', ['spent', null], ['in', 'in']]);
    assert.equal(access.ticketStatus(ticketRow(ticket), due).out, null);
    assert.equal(access.ticketStatus(ticketRow(ticket), due).loan.id, loanOf(ticket).id, 'its own loan is still the link’s, over');
    assert.equal(access.heartbeat(viewerOf(b), loanOf(ticket).screening_id, { position: 5 }, due).error, 'due');
    assert.equal(loanOf(ticket).ended_at, null, 'reads never write');
    assert.deepEqual(eventsOf(ticket, 'returned'), []);
  });

  test('its end is written by the next Play on the film, in the same step as the new loan', async () => {
    const film = await ownFilm('due-play');
    const ticket = await issue(film);
    const next = await issue(film);
    const b = await opened(ticket);
    const other = await opened(next);
    const t0 = Date.now() + HOUR;
    press(b, film, t0);
    const later = t0 + 3 * DAY + 5 * HOUR;
    const took = press(other, film, later);
    assert.deepEqual([took.error, took.resumed], [undefined, false]);
    cameDue(ticket, t0);
    assert.deepEqual([loanOf(next).taken_at, loanOf(next).ended_at], [later, null]);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM loans WHERE film_id = ? AND ended_at IS NULL').get(film.id).n, 1);
  });

  test('or by a refused Play, by keeping a link for the film, or by the sweeper: always dated when it was due', async () => {
    const t0 = Date.now() + HOUR;
    const later = t0 + 3 * DAY + 5 * HOUR;

    // A refused Play: the borrower's own, on the link that is now spent.
    const refused = await ownFilm('due-refused');
    const first = await issue(refused);
    const b = await opened(first);
    press(b, refused, t0);
    assert.equal(press(b, refused, later).error, 'spent');
    cameDue(first, t0);

    // Keeping: a keepable link for the film, kept once the tape is back.
    const kept = await ownFilm('due-keep');
    const lent = await issue(kept);
    press(await opened(lent), kept, t0);
    const sam = await member('Due Sam');
    const keepable = await issue(kept, { claimable: true });
    await opened(keepable, sam.phone);
    assert.equal(access.keep(viewerOf(sam.phone), filmRow(kept), t0 + DAY).error, 'cannot-keep', 'not while the tape is out');
    assert.equal(loanOf(lent).ended_at, null);
    assert.equal(access.keep(viewerOf(sam.phone), filmRow(kept), later).ticket.person_id, sam.p.id);
    cameDue(lent, t0);

    // The sweeper: all films at once (this shop's other tapes among them), and only
    // the tapes that are back.
    const swept = await ownFilm('due-sweep');
    const still = await ownFilm('due-still-out');
    const a = await issue(swept);
    const c = await issue(still, { loanDays: 30 });
    press(await opened(a), swept, t0);
    press(await opened(c), still, t0);
    access.sweep(t0 + 3 * DAY - 1);
    assert.equal(loanOf(a).ended_at, null, 'a millisecond before it is due, not this one');
    const closed = access.sweep(later);
    assert.ok(closed >= 1);
    assert.deepEqual(access.sweeperStatus(), { lastRun: { at: later, closed }, lastError: null });
    cameDue(a, t0);
    assert.equal(loanOf(c).ended_at, null, 'a tape still out is left alone');
    assert.equal(access.sweep(later), 0, 'and nothing is written twice');
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM loans WHERE ended_at IS NULL AND due_at <= ?').get(later).n, 0, 'for every film');
  });

  test('the sweeper runs every minute, and a failure is logged and never thrown', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const logged = t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'log', () => {});
    // A database of its own: a film, a link, a browser, and a tape that came due long ago.
    const db = openDb(':memory:');
    const own = createAccess(db, createSettings(db));
    const film = Number(db.prepare("INSERT INTO films (slug, title, published, media_status, created_at, updated_at) VALUES ('f', 'F', 1, 'ok', 0, 0)").run().lastInsertRowid);
    const link = Number(db.prepare("INSERT INTO tickets (code, film_id, created_at) VALUES ('abcdefghjkmnp', ?, 0)").run(film).lastInsertRowid);
    db.prepare("INSERT INTO sessions (id_hash, kind, created_at, last_seen_at, expires_at) VALUES ('s', 'viewer', 0, 0, ?)").run(Date.now() + 90 * DAY);
    db.prepare("INSERT INTO session_tickets (session_hash, ticket_id, added_at) VALUES ('s', ?, 0)").run(link);
    const taken = Date.now() - 10 * DAY;
    assert.equal(own.startScreening({ id_hash: 's', person_id: null, device: 'Safari on Mac' }, db.prepare('SELECT * FROM films').get(), taken).error, undefined);
    const loan = () => db.prepare('SELECT * FROM loans').get();

    own.startSweeper();
    assert.equal(own.sweeperStatus().lastRun, null, 'not straight away');
    t.mock.timers.tick(59 * SECOND);
    assert.equal(loan().ended_at, null);
    t.mock.timers.tick(SECOND);
    assert.deepEqual([loan().ended_at, loan().ended_how], [taken + 3 * DAY, 'due']);
    assert.equal(own.sweeperStatus().lastRun.closed, 1);
    t.mock.timers.tick(MINUTE);
    assert.equal(own.sweeperStatus().lastRun.closed, 0, 'again a minute later');

    db.close();
    assert.doesNotThrow(() => t.mock.timers.tick(MINUTE));
    assert.ok(logged.mock.callCount() >= 1, 'logged with console.error');
    assert.ok(own.sweeperStatus().lastError);
  });
});

// ====================================================================== the borrower can no longer play
describe('a borrower who can no longer play', () => {
  test('a browser with a tape out is signed out, or its session ends: back from that moment, written later as signed-out', async () => {
    const t0 = Date.now() + HOUR;
    for (const [slug, column] of [['gone-signed-out', 'revoked_at'], ['gone-expired', 'expires_at']]) {
      const film = await ownFilm(slug);
      const ticket = await issue(film);
      const b = await opened(ticket);
      const other = await opened(await issue(film));
      press(b, film, t0);
      // An hour in. (Until then its session was good until a day past the due time.)
      assert.equal(viewerOf(b).expires_at >= t0 + 4 * DAY, true);
      sql(`UPDATE sessions SET ${column} = ? WHERE id_hash = ?`, t0 + HOUR, hashOf(b));
      // A session that expires is live until the moment it does. (One signed out is over as soon as its row says so.)
      if (column === 'expires_at') assert.deepEqual([stateOf(ticket, t0 + HOUR - 1), viewOf(other, film, t0 + HOUR - 1)], ['lent', ['out', 'out']]);
      assert.deepEqual([stateOf(ticket, t0 + HOUR), viewOf(other, film, t0 + HOUR)], ['spent', ['in', 'in']], column);
      assert.equal(loanOf(ticket).ended_at, null);
      assert.ok(access.sweep(t0 + 2 * HOUR) >= 1);
      assert.deepEqual([loanOf(ticket).ended_at, loanOf(ticket).ended_how], [t0 + HOUR, 'signed-out'], column);
      const [returned] = eventsOf(ticket, 'returned');
      assert.deepEqual([returned.at, returned.detail.how], [t0 + HOUR, 'signed-out']);
      assert.equal(press(other, film, t0 + 2 * HOUR).error, undefined, 'another link takes it');
    }
  });

  test('a browser that signed out after the tape was due: it came due first', async () => {
    const film = await ownFilm('gone-after-due');
    const ticket = await issue(film);
    const b = await opened(ticket);
    const t0 = Date.now() + HOUR;
    press(b, film, t0);
    sql('UPDATE sessions SET revoked_at = ? WHERE id_hash = ?', t0 + 3 * DAY + HOUR, hashOf(b));
    assert.ok(access.sweep(t0 + 4 * DAY) >= 1);
    assert.deepEqual([loanOf(ticket).ended_at, loanOf(ticket).ended_how], [t0 + 3 * DAY, 'due']);
  });

  // A clock that stepped back, or a session row the clean-up has deleted, must never
  // break the check that a loan ends no sooner than it began: one bad row would stop
  // every Play on its film, and every sweep.
  test('a session that ended before the loan began, by the clock, or is gone altogether: closed no sooner than taken, with no error', async () => {
    const t0 = Date.now() + HOUR;

    const before = await ownFilm('gone-before-taken');
    const early = await issue(before);
    const b = await opened(early);
    press(b, before, t0);
    sql('UPDATE sessions SET revoked_at = ? WHERE id_hash = ?', t0 - HOUR, hashOf(b));
    assert.ok(access.sweep(t0 + MINUTE) >= 1);
    assert.deepEqual([loanOf(early).ended_at, loanOf(early).ended_how], [t0, 'signed-out'], 'at the moment it was taken');

    // The row is gone: the moment isn't known, so the time of writing.
    const gone = await ownFilm('gone-row');
    const lost = await issue(gone);
    const c = await opened(lost);
    press(c, gone, t0);
    const hash = hashOf(c);
    sql('DELETE FROM sessions WHERE id_hash = ?', hash);
    assert.equal(stateOf(lost, t0 + 1), 'spent');
    assert.ok(access.sweep(t0 + 2 * HOUR) >= 1);
    assert.deepEqual([loanOf(lost).ended_at, loanOf(lost).ended_how, loanOf(lost).session_hash, loanOf(lost).device], [t0 + 2 * HOUR, 'signed-out', hash, 'Browser on unknown device'], 'the loan keeps its browser and device');

    // The same, written by a server whose clock has stepped back to before the loan began.
    const stepped = await ownFilm('gone-clock-back');
    const odd = await issue(stepped);
    const d = await opened(odd);
    const next = await opened(await issue(stepped));
    press(d, stepped, t0);
    sql('DELETE FROM sessions WHERE id_hash = ?', hashOf(d));
    const took = press(next, stepped, t0 - DAY);
    assert.equal(took.error, undefined, 'Play on the film still works');
    assert.deepEqual([loanOf(odd).ended_at, loanOf(odd).ended_how], [t0, 'signed-out'], 'never before it was taken');
    assert.deepEqual(srv.db.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]), ['ok']);
  });

  // The same clock, stepped back the other way: the session's row says it was signed
  // out at a time the server hasn't reached. The one test reads it as signed out, so
  // the tape is back; its end is never written later than the moment of writing (it
  // used to be written as "due", at the due time, days ahead).
  test('a browser signed out at a time the server’s clock hasn’t reached yet: back all the same, and written no later than the moment of writing', async () => {
    const film = await ownFilm('gone-clock-behind');
    const ticket = await issue(film);
    const b = await opened(ticket);
    const next = await opened(await issue(film));
    const t0 = Date.now() + HOUR;
    press(b, film, t0);
    sql('UPDATE sessions SET revoked_at = ? WHERE id_hash = ?', t0 + HOUR, hashOf(b));
    const now = t0 + 30 * MINUTE;
    assert.deepEqual([stateOf(ticket, now), viewOf(next, film, now)], ['spent', ['in', 'in']]);
    assert.ok(access.sweep(now) >= 1);
    assert.deepEqual([loanOf(ticket).ended_at, loanOf(ticket).ended_how], [now, 'signed-out']);
    assert.deepEqual(eventsOf(ticket, 'returned').map((e) => [e.at, e.detail.how]), [[now, 'signed-out']], 'the Ledger has nothing dated ahead');
    assert.equal(press(next, film, now).error, undefined);

    // A member signed in on the borrowing browser, whose card's row says it was turned
    // off at such a time: the same.
    const second = await ownFilm('gone-clock-behind-card');
    const sam = await member('Clock-behind Sam');
    const anyone = await issue(second);
    await opened(anyone, sam.phone);
    press(sam.phone, second, t0);
    assert.equal(loanOf(anyone).person_id, null);
    sql('UPDATE people SET disabled_at = ? WHERE id = ?', t0 + HOUR, sam.p.id);
    try {
      assert.equal(stateOf(anyone, now), 'spent');
      assert.ok(access.sweep(now) >= 1);
      assert.deepEqual([loanOf(anyone).ended_at, loanOf(anyone).ended_how], [now, 'disabled']);
    } finally {
      sql('UPDATE people SET disabled_at = NULL WHERE id = ?', sam.p.id);
    }
  });

  test('a member’s card is turned off: their tapes end in the same step, and turning it on again, with no sweep in between, leaves the loan ended and the link spent', async () => {
    const film = await ownFilm('card-off');
    const overdue = await ownFilm('card-off-overdue');
    const sam = await member('Card-off Sam');
    const ticket = await issue(film, { personId: sam.p.id });
    const old = await issue(overdue, { personId: sam.p.id });
    const other = await opened(await issue(film));
    const now = Date.now();
    // One taken an hour ago; one taken five days ago, due two days ago, which nothing has written back.
    assert.equal(press(sam.phone, film, now - HOUR).loan.person_id, sam.p.id);
    press(sam.phone, overdue, now - 5 * DAY);
    assert.equal(press(other, film, now).error, 'out');

    assert.equal((await admin.post(`/api/admin/people/${sam.p.id}/disable`)).status, 200);
    const loan = loanOf(ticket);
    assert.equal(loan.ended_how, 'disabled');
    assert.ok(loan.ended_at >= now && loan.ended_at <= Date.now(), 'at the moment the card went off');
    assert.deepEqual(eventsOf(ticket, 'returned').map((e) => [e.at, e.person_id, e.detail]), [[loan.ended_at, sam.p.id, { loanId: loan.id, how: 'disabled', response: false }]]);
    assert.deepEqual([loanOf(old).ended_at, loanOf(old).ended_how], [now - 2 * DAY, 'due'], 'the one already past due ended when it was due');

    assert.equal((await admin.post(`/api/admin/people/${sam.p.id}/enable`)).status, 200);
    assert.equal(srv.db.prepare('SELECT disabled_at FROM people WHERE id = ?').get(sam.p.id).disabled_at, null);
    assert.deepEqual([loanOf(ticket).ended_at, loanOf(ticket).ended_how], [loan.ended_at, 'disabled'], 'the loan stays ended');
    assert.equal(stateOf(ticket, Date.now()), 'spent', 'the link stays spent');
    assert.equal(access.sweep(Date.now()), 0);
    assert.equal(press(other, film, Date.now()).error, undefined, 'and the film is in for another link');
    // Signed in again, the member finds their link spent.
    assert.equal((await signIn(sam.phone, sam.auth)).status, 200);
    assert.equal(press(sam.phone, film, Date.now()).error, 'spent');
    assert.deepEqual(viewOf(sam.phone, overdue, Date.now()), ['spent', null]);
  });
});

// ====================================================================== the film itself
describe('the film, while its tape is out', () => {
  test('its files break: nothing ends and the clock runs; the borrower keeps the tape, the due date and their place, and it stays on their card', async () => {
    const film = await ownFilm('files-break');
    const sam = await member('Broken Sam');
    const ticket = await issue(film, { personId: sam.p.id });
    const waiting = await opened(await issue(film));
    const r = await sam.phone.post('/api/films/files-break/screenings');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const { screeningId, dueBack, takenAt } = r.data;
    assert.equal((await sam.phone.post(`/api/screenings/${screeningId}/heartbeat`, { position: 33, playing: false })).status, 200);

    sql("UPDATE films SET media_status = 'error' WHERE id = ?", film.id);
    try {
      const page = (await sam.phone.get('/api/films/files-break')).data.access;
      assert.equal(page.canPlay, false);
      assert.deepEqual(page.ticket, {
        state: 'unavailable', tape: 'yours', loanDays: null, startBy: null, dueBack,
        loan: { takenAt, position: 33, finishedAt: null, toBrowser: false, canRespond: true },
        returned: null, pickNote: null, inAccount: true,
      });
      // On their card still, on another device too.
      const laptop = await sam.device();
      const listed = (await laptop.get('/api/me')).data.tickets.find((t) => t.film.slug === 'files-break').ticket;
      assert.deepEqual([listed.state, listed.tape, listed.dueBack], ['unavailable', 'yours', dueBack]);
      // Nothing plays, and the player is told why.
      assert.deepEqual((await sam.phone.post('/api/films/files-break/screenings')).data, { error: 'unavailable' });
      assert.equal((await sam.phone.get(master('files-break'))).status, 403);
      assert.deepEqual((await sam.phone.post(`/api/screenings/${screeningId}/heartbeat`, { position: 34 })).data, { error: 'unavailable' });
      // Anyone else: unavailable, with the tape out and the same date.
      const theirs = (await waiting.get('/api/films/files-break')).data.access.ticket;
      assert.deepEqual([theirs.state, theirs.tape, theirs.dueBack, theirs.loan], ['unavailable', 'out', dueBack, null]);
      // The loan goes on: nothing ended it, and its clock runs to the same due time.
      assert.deepEqual([loanOf(ticket).ended_at, loanOf(ticket).due_at], [null, dueBack]);
      assert.deepEqual(viewOf(sam.phone, film, dueBack - 1), ['unavailable', 'yours']);
      assert.deepEqual(viewOf(sam.phone, film, dueBack), ['unavailable', null], 'once due, the link is spent under the broken film');
      assert.deepEqual(viewOf(waiting, film, dueBack), ['unavailable', 'in'], 'and a link that could still lend has the tape in: nothing has been taken out');
    } finally {
      sql("UPDATE films SET media_status = 'ok' WHERE id = ?", film.id);
    }
    // Mended, it is still theirs, where they left it.
    const again = await sam.phone.post('/api/films/files-break/screenings');
    assert.deepEqual([again.data.screeningId, again.data.resumed, again.data.position, again.data.dueBack], [screeningId, true, 33, dueBack]);
  });

  test('goes off the shelf: nothing ends and the clock runs; the borrower sees no such film; back on the shelf it is still theirs', async () => {
    const film = await ownFilm('off-the-shelf');
    const ticket = await issue(film);
    const b = await opened(ticket);
    const { screeningId, dueBack } = (await b.post('/api/films/off-the-shelf/screenings')).data;
    assert.equal((await admin.patch(`/api/admin/films/${film.id}`, { published: false })).status, 200);
    assert.equal((await b.get('/api/films/off-the-shelf')).status, 404);
    assert.equal((await b.post('/api/films/off-the-shelf/screenings')).status, 404);
    assert.deepEqual((await b.post(`/api/screenings/${screeningId}/heartbeat`, { position: 3 })).data, { error: 'unpublished' });
    assert.deepEqual((await b.get('/api/me')).data.tickets, []);
    assert.equal(stateOf(ticket, Date.now()), 'unpublished');
    assert.deepEqual([loanOf(ticket).ended_at, loanOf(ticket).due_at], [null, dueBack], 'the loan goes on');
    assert.equal(access.ticketStatus(ticketRow(ticket)).out.id, loanOf(ticket).id, 'and the film’s tape is still out');
    assert.equal((await admin.patch(`/api/admin/films/${film.id}`, { published: true })).status, 200);
    assert.deepEqual((await b.post('/api/films/off-the-shelf/screenings')).data.screeningId, screeningId);
    assert.deepEqual(viewOf(b, film, dueBack), ['spent', null], 'due when it always was');
  });
});

// ====================================================================== the state of a link
describe('a link’s state, the same whoever asks', () => {
  test('a start-by date that passes while the tape is out on another link leaves the link waiting, and once the tape is back the link has that time back; one that had already passed is expired', async () => {
    const film = await ownFilm('start-by-out');
    const t0 = Date.now() + HOUR;
    const lends = await issue(film);
    const waits = await issue(film, { startBy: t0 + DAY });
    const missed = await issue(film, { startBy: t0 - HOUR });
    const [a, b, c] = [await opened(lends), await opened(waits), await opened(missed)];

    assert.deepEqual([stateOf(waits, t0 - 1), stateOf(missed, t0 - 1)], ['in', 'expired']);
    press(a, film, t0);
    assert.deepEqual([stateOf(lends, t0), stateOf(waits, t0), stateOf(missed, t0)], ['lent', 'waiting', 'expired']);
    assert.deepEqual([viewOf(b, film, t0), viewOf(c, film, t0)], [['out', 'out'], ['expired', null]]);

    // Its date passes with the tape still out, taken before the date: it waits, and looks just as it did.
    const passed = t0 + DAY + 1;
    assert.equal(stateOf(waits, passed), 'waiting');
    assert.deepEqual(viewOf(b, film, passed), ['out', 'out']);
    assert.equal(press(b, film, passed).error, 'out');
    // The tape comes back, three days after it went out, and the link has those three
    // days back (slice 6): its date was a day after the tape was taken, and is a day
    // after the tape came back. Nothing has written the loan's end yet: reading writes nothing.
    const due = t0 + 3 * DAY;
    assert.equal(loanOf(lends).ended_at, null);
    assert.equal(access.ticketStatus(ticketRow(waits), due).startBy, due + DAY);
    assert.deepEqual([stateOf(waits, due), viewOf(b, film, due)], ['in', ['in', 'in']]);
    assert.deepEqual([stateOf(waits, due + DAY - 1), stateOf(waits, due + DAY)], ['in', 'expired'], 'a day left, as when the tape went out');
    assert.deepEqual(viewOf(b, film, due + DAY), ['expired', null]);
    // The link that had been missed before the tape went out is given nothing back.
    assert.deepEqual([stateOf(missed, due), access.ticketStatus(ticketRow(missed), due).startBy], ['expired', t0 - HOUR]);
    assert.equal(press(c, film, due + HOUR).error, 'expired');
    // And Play takes the tape in the time given back, long after the date as it was set.
    const took = press(b, film, due + HOUR);
    assert.deepEqual([took.error, took.loan.ticket_id, took.loan.taken_at], [undefined, waits.id, due + HOUR]);
    assert.deepEqual([loanOf(lends).ended_at, loanOf(lends).ended_how], [due, 'due'], 'the first loan’s end is written as it was read');
    assert.equal(access.ticketStatus(ticketRow(waits), due + 2 * DAY).startBy, null, 'a start-by only matters until the first play');
  });

  test('a link that lent before its own start-by stays lent after the date; a tape that went out after a link’s date had passed leaves that link expired', async () => {
    const t0 = Date.now() + HOUR;
    const own = await ownFilm('start-by-lent');
    const dated = await issue(own, { startBy: t0 + DAY });
    const a = await opened(dated);
    press(a, own, t0);
    assert.deepEqual([stateOf(dated, t0 + 2 * DAY), viewOf(a, own, t0 + 2 * DAY)], ['lent', ['yours', 'yours']]);
    assert.equal(access.ticketStatus(ticketRow(dated), t0 + 2 * DAY).startBy, null, 'a start-by only matters until the first play');

    const late = await ownFilm('start-by-late');
    const tooLate = await issue(late, { startBy: t0 + HOUR });
    const taker = await issue(late);
    const b = await opened(tooLate);
    press(await opened(taker), late, t0 + 2 * HOUR);
    // The tape is out, but it went out after this link's date: that link could not have lent.
    assert.deepEqual([stateOf(tooLate, t0 + 3 * HOUR), viewOf(b, late, t0 + 3 * HOUR)], ['expired', ['expired', null]]);
  });

  test('a link first played in 1.x met its start-by then: it lends once more, whatever the date', async () => {
    const film = await ownFilm('start-by-met');
    const ticket = await issue(film, { startBy: Date.now() - 2 * DAY });
    const b = await opened(ticket);
    assert.equal(stateOf(ticket, Date.now()), 'expired');
    // As the upgrade leaves a 1.x link that was played in time and still had plays left: no loan.
    sql('UPDATE tickets SET first_played_at = ? WHERE id = ?', Date.now() - 5 * DAY, ticket.id);
    assert.equal(stateOf(ticket, Date.now()), 'in');
    const now = Date.now();
    assert.equal(press(b, film, now).error, undefined);
    assert.equal(ticketRow(ticket).first_played_at < now - 4 * DAY, true, 'its first play stays when it was');
  });

  test('revoked, off the shelf and unavailable come first, and say nothing of the loan they leave running', async () => {
    const film = await ownFilm('state-order');
    const ticket = await issue(film);
    const b = await opened(ticket);
    const now = Date.now();
    press(b, film, now);
    const read = () => {
      const s = access.ticketStatus(ticketRow(ticket), now + 1);
      return [s.state, s.loan?.id ?? null, s.out?.id ?? null];
    };
    const id = loanOf(ticket).id;
    assert.deepEqual(read(), ['lent', id, id]);
    sql("UPDATE films SET media_status = 'missing' WHERE id = ?", film.id);
    assert.deepEqual(read(), ['unavailable', id, id], 'loan and out are filled in whatever the state');
    sql('UPDATE films SET published = 0 WHERE id = ?', film.id);
    assert.deepEqual(read(), ['unpublished', id, id]);
    sql('UPDATE tickets SET revoked_at = ? WHERE id = ?', now, ticket.id);
    assert.deepEqual(read(), ['revoked', id, id]);
    sql("UPDATE films SET media_status = 'ok', published = 1 WHERE id = ?", film.id);
    sql('UPDATE tickets SET revoked_at = NULL WHERE id = ?', ticket.id);
    assert.deepEqual(read(), ['lent', id, id]);
  });
});

// ====================================================================== links for one member
describe('links for one member', () => {
  test('lend to the member, on every device they sign in on, one at a time', async () => {
    const film = await ownFilm('member-devices');
    const sam = await member('Devices Sam');
    const ticket = await issue(film, { personId: sam.p.id });
    const laptop = await sam.device();
    const t0 = Date.now();
    const took = press(sam.phone, film, t0);
    assert.deepEqual([took.loan.person_id, took.loan.session_hash], [sam.p.id, hashOf(sam.phone)]);
    for (const b of [sam.phone, laptop]) assert.deepEqual(viewOf(b, film, t0 + 1), ['yours', 'yours']);
    assert.equal(press(laptop, film, t0 + SECOND).error, 'playing-elsewhere', 'while the phone plays');
    assert.equal(access.mayStream({ viewer: viewerOf(laptop) }, filmRow(film), t0 + SECOND), false, 'the tape alone isn’t the stream: the screening is on the phone');
    access.heartbeat(viewerOf(sam.phone), took.screening.id, { position: 9, playing: false }, t0 + 2 * SECOND);
    assert.equal(press(laptop, film, t0 + 3 * SECOND).screening.id, took.screening.id);
    assert.equal(access.mayStream({ viewer: viewerOf(laptop) }, filmRow(film), t0 + 4 * SECOND), true);
    assert.equal(access.heartbeat(viewerOf(sam.phone), took.screening.id, { position: 10 }, t0 + 4 * SECOND).error, 'playing-elsewhere');
    assert.equal(loansOn(film).length, 1);
    assert.equal(loanOf(ticket).session_hash, hashOf(sam.phone), 'the loan still says which browser pressed Play');
  });

  test('two links for one member and film: Play takes the older, the second waits, and lends after the first is back; only the one that took the tape is spent', async () => {
    const film = await ownFilm('member-two-links');
    const sam = await member('Two-links Sam');
    const first = await issue(film, { personId: sam.p.id });
    const second = await issue(film, { personId: sam.p.id, loanDays: 7 });
    const t0 = Date.now();
    assert.equal(press(sam.phone, film, t0).ticket.id, first.id);
    assert.deepEqual([stateOf(first, t0 + 1), stateOf(second, t0 + 1)], ['lent', 'waiting']);
    assert.equal(loanOf(second), null);
    // The page shows the one with the tape, and Play carries on with it.
    assert.deepEqual(viewOf(sam.phone, film, t0 + 1), ['yours', 'yours']);
    assert.equal(press(sam.phone, film, t0 + MINUTE).resumed, true);

    const due = t0 + 3 * DAY;
    assert.deepEqual([stateOf(first, due), stateOf(second, due)], ['spent', 'in']);
    assert.deepEqual(viewOf(sam.phone, film, due), ['in', 'in'], 'the page turns to the link that can still lend');
    const again = press(sam.phone, film, due);
    assert.deepEqual([again.ticket.id, again.resumed, again.loan.due_at], [second.id, false, due + 7 * DAY]);
    assert.deepEqual(loansOn(film).map((l) => [l.ticket_id, l.ended_how]), [[first.id, 'due'], [second.id, null]]);
  });

  test('with their own link and a link anyone can use in one browser, Play takes their own', async () => {
    const film = await ownFilm('member-own-first');
    const sam = await member('Own-first Sam');
    const link = await issue(film);
    const own = await issue(film, { personId: sam.p.id });
    await opened(link, sam.phone);
    assert.ok(link.id < own.id, 'the link for anyone is the older');
    const took = press(sam.phone, film, Date.now());
    assert.deepEqual([took.ticket.id, took.loan.person_id], [own.id, sam.p.id]);
    assert.equal(loanOf(link), null);
  });
});

// ====================================================================== the borrowing browser's session
describe('a browser with a tape out keeps its session, and its cookie, until a day past the due time', () => {
  const play = (b, slug) => b.post(`/api/films/${slug}/screenings`);
  const cookieOf = (r) => r.headers.getSetCookie().filter((c) => c.startsWith('om_session='));
  const maxAge = (cookie) => Number(/Max-Age=(\d+)/.exec(cookie)[1]) * SECOND;
  const near = (actual, expected) => Math.abs(actual - expected) < MINUTE;

  test('a session made 89 days ago plays; its row and its cookie then last a day past the due time; and two days later it still has its cookie and its tape', async () => {
    const film = await ownFilm('session-89');
    const ticket = await issue(film);
    const b = await opened(ticket);
    const token = b.jar.get('om_session');
    // Made 89 days ago: a day of its 90 left, and the browser's cookie with it.
    sql('UPDATE sessions SET created_at = ?, expires_at = ? WHERE id_hash = ?', Date.now() - 89 * DAY, Date.now() + DAY, hashOf(b));

    const r = await play(b, 'session-89');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.toBrowser, true);
    assert.equal(viewerOf(b).expires_at, r.data.dueBack + DAY, 'the row: a day past the due time');
    const [cookie, ...more] = cookieOf(r);
    assert.deepEqual(more, []);
    assert.ok(cookie.startsWith(`om_session=${token};`), 'the same token: no new session');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.ok(near(maxAge(cookie), 4 * DAY), `the cookie: four days, not one (${cookie})`);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE id_hash = ?').get(hashOf(b)).n, 1);

    // Two days later. Without the longer life, the session would have ended yesterday.
    sql('UPDATE sessions SET created_at = created_at - ?1, expires_at = expires_at - ?1 WHERE id_hash = ?2', 2 * DAY, hashOf(b));
    sql('UPDATE loans SET taken_at = taken_at - ?1, due_at = due_at - ?1 WHERE ticket_id = ?2', 2 * DAY, ticket.id);
    assert.ok(viewerOf(b).created_at < Date.now() - 90 * DAY, 'past its ninety days');
    const page = await b.get('/api/films/session-89');
    assert.equal(page.status, 200);
    assert.deepEqual([page.data.access.ticket.tape, page.data.access.ticket.dueBack], ['yours', r.data.dueBack - 2 * DAY]);
    // The film's page sends the cookie again too, with what is left: two days.
    const [again] = cookieOf(page);
    assert.ok(again.startsWith(`om_session=${token};`));
    assert.ok(near(maxAge(again), 2 * DAY), again);
    assert.equal((await b.get(master('session-89'))).status, 200);
    const resumed = await play(b, 'session-89');
    assert.deepEqual([resumed.status, resumed.data.resumed], [200, true]);
    assert.ok(near(maxAge(cookieOf(resumed)[0]), 2 * DAY), 'and every Play that carries on');
    // The tape comes due; a day later the session ends, like any other.
    assert.equal(access.filmAccess({ viewer: viewerOf(b) }, filmRow(film), r.data.dueBack - 2 * DAY).view, 'spent');
  });

  // VIEWER_SESSION_DAYS has no minimum, so a shop's sessions can be shorter than a
  // loan. Signing in makes a new session, and a tape taken on a link anyone can use
  // stays the browser's (question 2): the new session must last as the old one did.
  test('signing in with a tape out: the new session and its cookie last a day past the due time too, where the shop’s sessions are shorter than the loan', async () => {
    const was = config.viewerSessionDays;
    config.viewerSessionDays = 2;
    try {
      const film = await ownFilm('session-sign-in');
      const ticket = await issue(film, { loanDays: 7 });
      const sam = await member('Short-session Sam');
      const b = await opened(ticket);
      assert.ok(near(viewerOf(b).expires_at - Date.now(), 2 * DAY), 'a session of two days here');
      const r = await play(b, 'session-sign-in');
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const due = r.data.dueBack;
      assert.equal(viewerOf(b).expires_at, due + DAY, 'Play made it last a day past the due time');

      const before = hashOf(b);
      const signedIn = await signIn(b, sam.auth);
      assert.equal(signedIn.status, 200, JSON.stringify(signedIn.data));
      assert.notEqual(hashOf(b), before, 'a new session');
      assert.deepEqual([loanOf(ticket).session_hash, loanOf(ticket).person_id, loanOf(ticket).due_at], [hashOf(b), null, due], 'the tape came along, and is still the browser’s');
      assert.deepEqual([viewerOf(b).person_id, viewerOf(b).expires_at], [sam.p.id, due + DAY], 'the new session: a day past the due time, not two days');
      const [cookie, ...more] = cookieOf(signedIn);
      assert.deepEqual(more, []);
      assert.ok(near(maxAge(cookie), due + DAY - Date.now()), `and its cookie with it (${cookie})`);
      // Three days on, past the two a session lasts here: still theirs, until it is due.
      assert.deepEqual(viewOf(b, film, Date.now() + 3 * DAY), ['yours', 'yours']);
      assert.deepEqual([stateOf(ticket, due - 1), stateOf(ticket, due)], ['lent', 'spent']);
      assert.equal(access.sweep(Date.now() + 3 * DAY) >= 0 && loanOf(ticket).ended_at, null, 'nothing wrote it down as signed out');

      // With no tape out, a sign-in is the shop's two days, as before; and a tape that
      // was due already lengthens nothing.
      const plain = await sam.device();
      assert.ok(near(viewerOf(plain).expires_at - Date.now(), 2 * DAY));
      const old = await ownFilm('session-sign-in-past-due');
      const past = await issue(old, { loanDays: 30 });
      const c = await opened(past);
      assert.equal((await play(c, 'session-sign-in-past-due')).status, 200);
      sql('UPDATE loans SET taken_at = taken_at - ?1, due_at = due_at - ?1 WHERE ticket_id = ?2', 30 * DAY + HOUR, past.id);
      const late = await signIn(c, sam.auth);
      assert.ok(near(viewerOf(c).expires_at - Date.now(), 2 * DAY));
      assert.ok(near(maxAge(cookieOf(late)[0]), 2 * DAY));
    } finally {
      config.viewerSessionDays = was;
    }
  });

  test('a cookie is never shortened: a young session keeps its ninety days', async () => {
    const film = await ownFilm('session-young');
    const b = await opened(await issue(film));
    const before = viewerOf(b).expires_at;
    const r = await play(b, 'session-young');
    assert.equal(viewerOf(b).expires_at, before, 'the row is left as it was');
    assert.ok(near(maxAge(cookieOf(r)[0]), 90 * DAY), cookieOf(r)[0]);
  });

  test('the cookie is sent again to the borrowing browser only: not to a member with their own link, nor to anyone refused, nor to another holder’s page', async () => {
    const film = await ownFilm('session-others');
    const own = await ownFilm('session-member');
    const ticket = await issue(film);
    const b = await opened(ticket);
    const sameLink = await opened(ticket);
    const waiting = await opened(await issue(film));
    assert.deepEqual(cookieOf(await b.get('/api/films/session-others')), [], 'not before Play: the tape isn’t theirs yet');
    assert.equal(cookieOf(await play(b, 'session-others')).length, 1);
    for (const other of [sameLink, waiting]) {
      const before = viewerOf(other).expires_at;
      const refused = await play(other, 'session-others');
      assert.deepEqual([refused.status, cookieOf(refused)], [409, []]);
      assert.deepEqual(cookieOf(await other.get('/api/films/session-others')), []);
      assert.equal(viewerOf(other).expires_at, before);
    }
    // A member's own link lends to the member: their session is theirs to renew by signing in.
    const sam = await member('Session Sam');
    await issue(own, { personId: sam.p.id });
    const before = viewerOf(sam.phone).expires_at;
    const r = await play(sam.phone, 'session-member');
    assert.deepEqual([r.status, r.data.toBrowser, cookieOf(r)], [200, false, []]);
    assert.deepEqual(cookieOf(await sam.phone.get('/api/films/session-member')), []);
    assert.equal(viewerOf(sam.phone).expires_at, before);
  });
});

// ====================================================================== whole days
test('a loan is whole days of 24 hours from the moment Play is pressed, across the clocks changing on 25 October (Europe/London)', async () => {
  const tz = process.env.TZ;
  process.env.TZ = 'Europe/London';
  try {
    // Saturday 24 October 2026, 20:30 in London, still on summer time. The clocks go back that night.
    const t0 = Date.UTC(2026, 9, 24, 19, 30);
    assert.equal(new Date(t0).getHours(), 20, 'this test reads the clock as London does');
    const film = await ownFilm('clocks-change');
    const ticket = await issue(film);
    const b = await opened(ticket);
    const other = await opened(await issue(film));
    const r = press(b, film, t0);
    assert.equal(r.loan.due_at - r.loan.taken_at, 3 * DAY);
    assert.equal(r.loan.due_at, Date.UTC(2026, 9, 27, 19, 30));
    // Three days of 24 hours end at 19:30 by London's clocks, an hour "early" on the wall.
    assert.deepEqual([new Date(r.loan.due_at).getDate(), new Date(r.loan.due_at).getHours(), new Date(r.loan.due_at).getMinutes()], [27, 19, 30]);
    assert.equal(press(other, film, r.loan.due_at - 1).error, 'out');
    assert.equal(press(other, film, r.loan.due_at).error, undefined);
    assert.equal(loanOf(ticket).ended_at, r.loan.due_at);
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});

// ====================================================================== slice 3: coming back
// Over HTTP, as a friend's page and the back office ask.
const play = (b, film) => b.post(`/api/films/${film.slug}/screenings`);
const page = async (b, film) => (await b.get(`/api/films/${film.slug}`)).data.access?.ticket;
const giveBack = (b, film, body) => b.post(`/api/films/${film.slug}/return`, body);
const report = (b, id, body = { position: 5 }) => b.post(`/api/screenings/${id}/heartbeat`, body);
const takeBack = (ticket, loan = loanOf(ticket)) => admin.post(`/api/admin/loans/${loan.id}/take-back`, { ticketId: ticket.id });
const answer = (r) => [r.status, r.data];
const held = (ticket) => srv.db.prepare('SELECT COUNT(*) AS n FROM session_tickets WHERE ticket_id = ?').get(ticket.id).n;
const live = (film) => loansOn(film).filter((l) => l.ended_at === null);
// A tape taken over HTTP on a link for anyone: the link, the borrowing browser, its loan and its play.
async function lentTo(film, fields = {}, b = browser(srv.base)) {
  const ticket = await issue(film, fields);
  await opened(ticket, b);
  const r = await play(b, film);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { ticket, b, loan: loanOf(ticket), screeningId: r.data.screeningId };
}

describe('Return it now', () => {
  test('the borrower returns it: the film is free at once, the link is spent, and their other device stops at its next report', async () => {
    const film = await ownFilm('return-member');
    const sam = await member('Return Sam');
    const ticket = await issue(film, { personId: sam.p.id });
    const laptop = await sam.device();
    const other = await opened(await issue(film));
    const took = await play(sam.phone, film);
    assert.equal(took.status, 200, JSON.stringify(took.data));
    assert.equal((await report(sam.phone, took.data.screeningId, { position: 31 })).status, 200);
    assert.equal((await page(other, film)).tape, 'out');
    const { takenAt } = (await page(laptop, film)).loan;
    assert.equal(takenAt, loanOf(ticket).taken_at, 'the page gives the borrower what the return asks for');

    // From the laptop, while the phone plays: the tape is the member's, on any device.
    const before = Date.now();
    const r = await giveBack(laptop, film, { takenAt });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(Object.keys(r.data).sort(), ['responded', 'returned']);
    assert.equal(r.data.responded, false);
    const loan = loanOf(ticket);
    assert.deepEqual([loan.ended_how, loan.ended_at], ['returned', r.data.returned.at]);
    assert.ok(loan.ended_at >= before && loan.ended_at <= Date.now() && loan.ended_at < loan.due_at);

    // The phone, at its next report and its next segment.
    assert.deepEqual(answer(await report(sam.phone, took.data.screeningId, { position: 32 })), [409, { error: 'returned' }]);
    assert.equal((await sam.phone.get(master(film.slug))).status, 403);
    assert.equal(screeningRow(took.data.screeningId).position_seconds, 31, 'a report after the return moves nothing');
    assert.ok(screeningRow(took.data.screeningId).active_until <= loan.ended_at, 'it is playing nowhere from that moment');

    // The link is spent, for both devices; only the one who borrowed is told how it came back.
    for (const b of [sam.phone, laptop]) {
      const mine = await page(b, film);
      assert.deepEqual([mine.state, mine.tape, mine.dueBack, mine.loan, mine.returned], ['spent', null, null, null, { at: loan.ended_at, how: 'returned' }]);
      assert.deepEqual(answer(await play(b, film)), [409, { error: 'spent' }]);
    }
    assert.equal(stateOf(ticket, Date.now()), 'spent');
    assert.equal(ticketRow(ticket).revoked_at, null, 'spent, not cancelled');

    // Free at once: nothing waits for a sweep.
    assert.equal((await page(other, film)).tape, 'in');
    const next = await play(other, film);
    assert.deepEqual([next.status, next.data.took], [200, true]);
    assert.equal(live(film).length, 1);

    // Logged once, dated when it came back, naming the member and the device that returned it.
    const [returned, ...more] = eventsOf(ticket, 'returned');
    assert.deepEqual(more, []);
    assert.deepEqual([returned.at, returned.film_id, returned.screening_id, returned.session_hash, returned.person_id], [loan.ended_at, film.id, loan.screening_id, hashOf(laptop), sam.p.id]);
    assert.deepEqual(returned.detail, { loanId: loan.id, how: 'returned', response: false });
  });

  test('a browser’s tape, on a link anyone can use: only that browser returns it, and nobody else learns it was returned', async () => {
    const film = await ownFilm('return-browser');
    const { ticket, b, loan, screeningId } = await lentTo(film);
    const sameLink = await opened(ticket);
    const otherLink = await opened(await issue(film));
    const sam = await member('Return Bystander');
    await opened(ticket, sam.phone);

    // Everyone but the borrower: one answer, whatever they send.
    for (const who of [sameLink, otherLink, sam.phone, browser(srv.base)]) {
      for (const takenAt of [loan.taken_at, loan.taken_at + 1, 0, Date.now()]) {
        assert.deepEqual(answer(await giveBack(who, film, { takenAt })), [409, { error: 'nothing-to-return' }]);
      }
    }
    assert.equal(loanOf(ticket).ended_at, null);
    assert.equal((await report(b, screeningId)).status, 200, 'the borrower plays on');

    const r = await giveBack(b, film, { takenAt: loan.taken_at });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(answer(await report(b, screeningId)), [409, { error: 'returned' }]);
    assert.deepEqual((await page(b, film)).returned, { at: r.data.returned.at, how: 'returned' });
    // Another browser on the link that lent sees it spent, and not how or when.
    for (const who of [sameLink, sam.phone]) {
      const theirs = await page(who, film);
      assert.deepEqual([theirs.state, theirs.tape, theirs.returned, theirs.dueBack], ['spent', null, null, null]);
      assert.deepEqual(answer(await report(who, screeningId)), [404, { error: 'not-found' }]);
    }
    assert.equal((await page(otherLink, film)).tape, 'in');
    // A browser's return names no person.
    const [returned] = eventsOf(ticket, 'returned');
    assert.deepEqual([returned.session_hash, returned.person_id, returned.detail.how], [hashOf(b), null, 'returned']);
    // Twice: there is nothing left to return.
    assert.deepEqual(answer(await giveBack(b, film, { takenAt: loan.taken_at })), [409, { error: 'nothing-to-return' }]);
    assert.equal(eventsOf(ticket, 'returned').length, 1);
  });

  test('a return from a tab left open on an earlier loan changes nothing', async () => {
    const film = await ownFilm('return-stale-tab');
    const sam = await member('Stale-tab Sam');
    const first = await issue(film, { personId: sam.p.id });
    const second = await issue(film, { personId: sam.p.id });
    assert.equal((await play(sam.phone, film)).status, 200);
    const earlier = loanOf(first).taken_at;
    assert.equal((await giveBack(sam.phone, film, { takenAt: earlier })).status, 200);
    // Their second link lends (question 9), a moment later.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const again = await play(sam.phone, film);
    assert.deepEqual([again.status, again.data.took], [200, true]);
    const later = loanOf(second);
    assert.notEqual(later.taken_at, earlier);

    // The tab left open on the first loan presses Return it now.
    assert.deepEqual(answer(await giveBack(sam.phone, film, { takenAt: earlier })), [409, { error: 'nothing-to-return' }]);
    assert.deepEqual(loanOf(second), later, 'the later loan is as it was');
    assert.equal((await page(sam.phone, film)).tape, 'yours');
    assert.equal(eventsOf(second, 'returned').length, 0);
    // The page showing the loan that is out returns it.
    assert.equal((await giveBack(sam.phone, film, { takenAt: later.taken_at })).status, 200);
    assert.deepEqual(loansOn(film).map((l) => l.ended_how), ['returned', 'returned']);
  });

  test('what isn’t a return is refused before anything is looked up, and what can’t be returned is "nothing to return"', async () => {
    const film = await ownFilm('return-refused');
    const { ticket, b, loan } = await lentTo(film);
    const takenAt = loan.taken_at;

    // 400: the same for the borrower, a stranger and a film that isn't there.
    const malformed = [{}, { takenAt: null }, { takenAt: String(takenAt) }, { takenAt: 1.5 }, { takenAt, message: 'Lovely.' }, { takenAt, response: 'meh' }, { takenAt, response: 'loved-it', message: 7 }, { takenAt, response: 'loved-it', message: 'x'.repeat(2001) }];
    for (const body of malformed) {
      const mine = await giveBack(b, film, body);
      assert.equal(mine.status, 400, JSON.stringify(body));
      assert.deepEqual(answer(await giveBack(browser(srv.base), film, body)), answer(mine), JSON.stringify(body));
      assert.deepEqual(answer(await b.post('/api/films/no-such-film/return', body)), answer(mine), JSON.stringify(body));
    }
    // A response is only for a tape borrowed on a member's own link (slice 4,
    // test/responses.test.js). This is a browser's tape, on a link anyone can use: the
    // borrower who sends one is told it can't be taken, and the tape stays out.
    // Anyone else: nothing to return, as ever.
    assert.deepEqual(answer(await giveBack(b, film, { takenAt, response: 'loved-it', message: 'Lovely.' })), [409, { error: 'cannot-respond' }]);
    assert.deepEqual(answer(await giveBack(browser(srv.base), film, { takenAt, response: 'loved-it' })), [409, { error: 'nothing-to-return' }]);
    assert.equal(loanOf(ticket).ended_at, null, 'nothing changed');
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM responses').get().n, 0);

    // 409 nothing-to-return: no such film, no session, the wrong loan, and your own preview.
    assert.deepEqual(answer(await b.post('/api/films/no-such-film/return', { takenAt })), [409, { error: 'nothing-to-return' }]);
    assert.deepEqual(answer(await giveBack(browser(srv.base), film, { takenAt })), [409, { error: 'nothing-to-return' }]);
    assert.deepEqual(answer(await giveBack(b, film, { takenAt: takenAt - 1 })), [409, { error: 'nothing-to-return' }]);
    assert.deepEqual(answer(await giveBack(admin, film, { takenAt })), [409, { error: 'nothing-to-return' }]);
    // A link whose tape is in, and one that waits: nothing to return.
    const idle = await ownFilm('return-idle');
    const waiting = await opened(await issue(idle));
    assert.deepEqual(answer(await giveBack(waiting, idle, { takenAt })), [409, { error: 'nothing-to-return' }]);
    assert.deepEqual(loansOn(idle), []);
    assert.equal(loanOf(ticket).ended_at, null);
    assert.equal(eventsOf(ticket, 'returned').length, 0);
  });

  test('a tape past due can’t be returned: it came due first, and the return writes that down', async () => {
    const film = await ownFilm('return-past-due');
    const ticket = await issue(film);
    const b = await opened(ticket);
    const t0 = Date.now() + HOUR;
    const took = press(b, film, t0);
    const due = t0 + 3 * DAY;
    // A millisecond before it is due it can be returned; this asks at the moment itself.
    assert.equal(access.returnTape(viewerOf(b), filmRow(film), { takenAt: t0 }, due).error, 'nothing-to-return');
    assert.deepEqual([loanOf(ticket).ended_at, loanOf(ticket).ended_how], [due, 'due'], 'ended when it was due');
    assert.deepEqual(eventsOf(ticket, 'returned').map((e) => [e.at, e.detail.how]), [[due, 'due']]);

    const early = await ownFilm('return-just-in-time');
    const second = await issue(early);
    const c = await opened(second);
    press(c, early, t0);
    const r = access.returnTape(viewerOf(c), filmRow(early), { takenAt: t0 }, due - 1);
    assert.deepEqual(r.returned, { at: due - 1 });
    assert.deepEqual([loanOf(second).ended_at, loanOf(second).ended_how], [due - 1, 'returned']);
    assert.equal(took.error, undefined);
  });

  test('with the film’s files broken the borrower can still return it; with the film off the shelf they can’t', async () => {
    const film = await ownFilm('return-broken');
    const { ticket, b, loan } = await lentTo(film);
    sql("UPDATE films SET media_status = 'error' WHERE id = ?", film.id);
    const broken = await page(b, film);
    assert.deepEqual([broken.state, broken.tape, broken.loan.takenAt], ['unavailable', 'yours', loan.taken_at]);
    assert.equal((await giveBack(b, film, { takenAt: loan.taken_at })).status, 200);
    assert.equal(loanOf(ticket).ended_how, 'returned');

    const off = await ownFilm('return-off-shelf');
    const lent = await lentTo(off);
    assert.equal((await admin.patch(`/api/admin/films/${off.id}`, { published: false })).status, 200);
    assert.deepEqual(answer(await giveBack(lent.b, off, { takenAt: lent.loan.taken_at })), [409, { error: 'nothing-to-return' }]);
    assert.equal(loanOf(lent.ticket).ended_at, null, 'nothing ends, and the clock runs');
    // Back on the shelf it is still theirs to return.
    assert.equal((await admin.patch(`/api/admin/films/${off.id}`, { published: true })).status, 200);
    assert.equal((await giveBack(lent.b, off, { takenAt: lent.loan.taken_at })).status, 200);
  });

  test('is limited to 30 per 10 minutes from one connection, as keeping is', async () => {
    // A server of its own, with the real limits.
    const dir = tempDir();
    makeFilm(dir, 'arrival');
    const own = await startServer({ mediaDir: dir });
    try {
      const b = browser(own.base);
      for (let i = 0; i < 30; i++) assert.equal((await b.post('/api/films/arrival/return', { takenAt: 1 })).status, 409, `press ${i + 1}`);
      const over = await b.post('/api/films/arrival/return', { takenAt: 1 });
      assert.deepEqual([over.status, over.data.error], [429, 'too-many-requests']);
      assert.ok(Number(over.headers.get('retry-after')) > 0);
      // Counted before the request is read: a malformed one is limited too.
      assert.equal((await b.post('/api/films/arrival/return', {})).status, 429);
    } finally {
      await own.close();
    }
  });
});

// ====================================================================== taking a tape back
describe('taking a tape back', () => {
  test('from a browser: its player is told "taken back", its page is gone, the link is cancelled for every browser, and another link takes the tape', async () => {
    const film = await ownFilm('take-back-browser');
    const { ticket, b, loan, screeningId } = await lentTo(film);
    const sameLink = await opened(ticket);
    const next = await opened(await issue(film));
    assert.equal((await report(b, screeningId, { position: 12 })).status, 200);
    assert.equal(held(ticket), 2);

    const before = Date.now();
    const r = await takeBack(ticket);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.alsoCancelled, []);
    assert.deepEqual([r.data.ticket.id, r.data.ticket.state], [ticket.id, 'revoked']);
    const ended = loanOf(ticket);
    assert.equal(ended.ended_how, 'taken-back');
    assert.ok(ended.ended_at >= before && ended.ended_at <= Date.now());
    assert.deepEqual([r.data.loan.id, r.data.loan.endedAt, r.data.loan.endedHow], [loan.id, ended.ended_at, 'taken-back']);
    assert.equal(ticketRow(ticket).revoked_at, ended.ended_at, 'the link is cancelled in the same step');
    assert.equal(held(ticket), 0, 'and forgotten in every browser that opened it');
    // It was playing a moment ago (a report keeps a play busy for 75 seconds): the play stops with the loan.
    assert.equal(screeningRow(screeningId).active_until, ended.ended_at, 'the screening stops');
    const [shown] = (await admin.get(`/api/admin/tickets/${ticket.id}`)).data.screenings;
    assert.deepEqual([shown.id, shown.activeUntil <= Date.now()], [screeningId, true], 'and the back office no longer shows it playing');

    // The borrower: the player says why, by the loan; the page is as a cancelled link's (question 6).
    assert.deepEqual(answer(await report(b, screeningId, { position: 13 })), [409, { error: 'taken-back' }]);
    assert.equal(screeningRow(screeningId).position_seconds, 12);
    assert.equal((await b.get(master(film.slug))).status, 403);
    for (const who of [b, sameLink]) {
      assert.deepEqual(answer(await who.get(`/api/films/${film.slug}`)), [404, { error: 'not-found' }]);
      assert.deepEqual(answer(await play(who, film)), [404, { error: 'not-found' }]);
      assert.deepEqual((await who.get('/api/me')).data.tickets, []);
      assert.deepEqual(answer(await who.post('/api/tickets/open', { code: ticket.code })), [410, { error: 'ticket-revoked' }]);
      assert.deepEqual(answer(await giveBack(who, film, { takenAt: loan.taken_at })), [409, { error: 'nothing-to-return' }]);
    }
    // Only the borrower is told anything about the loan: the other browser's report finds no such play.
    assert.deepEqual(answer(await report(sameLink, screeningId)), [404, { error: 'not-found' }]);

    // Another link takes the tape, from the beginning.
    const took = await play(next, film);
    assert.deepEqual([took.status, took.data.took, took.data.position], [200, true, 0]);
    // Logged as the tape coming back; the link's own cancelling is that event.
    assert.deepEqual(eventsOf(ticket, 'returned').map((e) => [e.at, e.detail]), [[ended.ended_at, { loanId: loan.id, how: 'taken-back', response: false }]]);
    assert.deepEqual(eventsOf(ticket, 'ticket-cancelled'), []);
  });

  test('from a member: every device stops, and their other links for the film that never lent are cancelled in the same step', async () => {
    const film = await ownFilm('take-back-member');
    const sam = await member('Take-back Sam');
    const jo = await member('Take-back Jo');
    // An earlier link of Sam's for this film, which lent and came back: spent.
    const earlier = await issue(film, { personId: sam.p.id });
    assert.equal((await play(sam.phone, film)).status, 200);
    assert.equal((await giveBack(sam.phone, film, { takenAt: loanOf(earlier).taken_at })).status, 200);
    const first = await issue(film, { personId: sam.p.id });
    const second = await issue(film, { personId: sam.p.id });
    const third = await issue(film, { personId: sam.p.id, startBy: Date.now() - HOUR });
    const forJo = await issue(film, { personId: jo.p.id });
    // A link anyone can use that Sam's phone also holds: other people hold it too.
    const shared = await issue(film);
    await opened(shared, sam.phone);
    const stranger = await opened(shared);
    // And a link of Sam's for another film.
    const elsewhere = await ownFilm('take-back-elsewhere');
    const otherFilm = await issue(elsewhere, { personId: sam.p.id });

    const laptop = await sam.device();
    const took = await play(sam.phone, film);
    assert.equal(took.status, 200, JSON.stringify(took.data));
    assert.equal(loanOf(first).person_id, sam.p.id, 'Play took the oldest of their own');
    assert.equal((await report(sam.phone, took.data.screeningId, { position: 8, playing: false })).status, 200);
    assert.equal((await play(laptop, film)).data.resumed, true);

    const r = await takeBack(first);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.alsoCancelled, [second.id, third.id], 'their waiting link, and the one past its start-by: neither ever lent');
    const at = loanOf(first).ended_at;
    for (const t of [first, second, third]) assert.equal(ticketRow(t).revoked_at, at);
    for (const t of [forJo, shared, otherFilm]) assert.equal(ticketRow(t).revoked_at, null, 'nobody else’s link, no link for anyone, and no other film');
    // Only links that never lent go: the spent one is as it was, with nothing logged.
    assert.deepEqual([ticketRow(earlier).revoked_at, eventsOf(earlier, 'ticket-cancelled'), stateOf(earlier, Date.now())], [null, [], 'spent']);
    assert.deepEqual(eventsOf(earlier, 'returned').map((e) => e.detail.how), ['returned']);
    assert.deepEqual([second, third].map((t) => eventsOf(t, 'ticket-cancelled').map((e) => [e.at, e.film_id, e.person_id])), [[[at, film.id, sam.p.id]], [[at, film.id, sam.p.id]]]);
    assert.deepEqual(eventsOf(first, 'ticket-cancelled'), [], 'the link that had the tape is logged as returned, once');
    assert.deepEqual(eventsOf(first, 'returned').map((e) => [e.person_id, e.detail.how]), [[sam.p.id, 'taken-back']]);

    // Both devices' players stop with "taken back".
    for (const b of [laptop, sam.phone]) assert.deepEqual(answer(await report(b, took.data.screeningId)), [409, { error: 'taken-back' }]);
    // Sam still holds the link anyone can use, so that is what their page shows now: in,
    // like the stranger's. It was left alone on purpose (question 14).
    assert.equal(held(shared), 2);
    assert.deepEqual([(await page(sam.phone, film)).tape, (await page(stranger, film)).tape], ['in', 'in']);
    assert.equal((await page(sam.phone, film)).inAccount, false);
    // Jo's link takes the tape.
    assert.deepEqual((await play(jo.phone, film)).data.took, true);
    assert.equal((await page(sam.phone, elsewhere)).tape, 'in');
  });

  test('then Play by the same member on their second link: no such film, and no new loan', async () => {
    const film = await ownFilm('take-back-second-link');
    const sam = await member('Second-link Sam');
    const first = await issue(film, { personId: sam.p.id });
    const second = await issue(film, { personId: sam.p.id });
    assert.equal((await play(sam.phone, film)).status, 200);
    assert.equal(stateOf(second, Date.now()), 'waiting');
    assert.deepEqual((await takeBack(first)).data.alsoCancelled, [second.id]);

    assert.deepEqual(answer(await sam.phone.get(`/api/films/${film.slug}`)), [404, { error: 'not-found' }]);
    assert.deepEqual(answer(await play(sam.phone, film)), [404, { error: 'not-found' }]);
    assert.equal(loanOf(second), null);
    assert.deepEqual(loansOn(film).map((l) => [l.ticket_id, l.ended_how]), [[first.id, 'taken-back']]);
    // The second link never lent, so it can be restored; the first can't.
    assert.deepEqual(answer(await admin.post(`/api/admin/tickets/${first.id}/restore`)), [409, { error: 'lent-once' }]);
    assert.equal((await admin.post(`/api/admin/tickets/${second.id}/restore`)).status, 200);
    assert.deepEqual((await play(sam.phone, film)).data.took, true);
  });

  // Question 16 (answered (b), 12 Nov 2026). A member who pressed Play on a link anyone
  // can use, signed in, has a browser's loan (question 2). A take-back reads who is
  // signed in on that browser and cancels that member's never-lent links for the film
  // too, as question 14 does for a member's own loan. Before the answer, their own
  // link was left and Play took the tape straight back.
  test('from a signed-in member who took it on a link anyone can use: their own link for the film goes too, and the page is gone (question 16)', async () => {
    const film = await ownFilm('take-back-signed-in-browser');
    const sam = await member('Any-link Sam');
    const anyone = await issue(film);
    await opened(anyone, sam.phone);
    const took = await play(sam.phone, film);
    assert.deepEqual([took.status, took.data.toBrowser], [200, true]);
    assert.equal(loanOf(anyone).person_id, null, 'the browser’s loan, not the member’s');
    // You then send Sam a link of their own, and another member one too.
    const own = await issue(film, { personId: sam.p.id });
    const ada = await member('Any-link Ada');
    const adas = await issue(film, { personId: ada.p.id });

    const r = await takeBack(anyone);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.alsoCancelled, [own.id]);
    assert.deepEqual([ticketRow(anyone).revoked_at != null, ticketRow(own).revoked_at != null, ticketRow(adas).revoked_at], [true, true, null]);
    assert.equal(eventsOf(own, 'ticket-cancelled').length, 1);
    assert.deepEqual(answer(await report(sam.phone, took.data.screeningId)), [409, { error: 'taken-back' }]);
    assert.equal((await sam.phone.get(`/api/films/${film.slug}`)).status, 404);
    assert.equal((await play(sam.phone, film)).status, 404);
    // The other member's link is untouched and can take the tape.
    assert.deepEqual((await play(ada.phone, film)).data.took, true);
  });

  test('is by the loan, with its link as a check: a loan that isn’t out, or isn’t on that link, is "not out" and nothing changes', async () => {
    const film = await ownFilm('take-back-check');
    const { ticket, b, loan, screeningId } = await lentTo(film);
    const waiting = await issue(film);
    const unchanged = () => {
      assert.deepEqual(loanOf(ticket), loan);
      assert.deepEqual([ticketRow(ticket).revoked_at, ticketRow(waiting).revoked_at, held(ticket)], [null, null, 1]);
    };
    assert.deepEqual(answer(await admin.post(`/api/admin/loans/${loan.id}/take-back`, { ticketId: waiting.id })), [409, { error: 'not-out' }]);
    assert.equal((await admin.post(`/api/admin/loans/${loan.id}/take-back`, {})).status, 400);
    assert.equal((await admin.post(`/api/admin/loans/${loan.id}/take-back`, { ticketId: String(ticket.id) })).status, 400);
    assert.equal((await admin.post('/api/admin/loans/987654321/take-back', { ticketId: ticket.id })).status, 404);
    assert.equal((await admin.post('/api/admin/loans/abc/take-back', { ticketId: ticket.id })).status, 404);
    assert.equal((await browser(srv.base).post(`/api/admin/loans/${loan.id}/take-back`, { ticketId: ticket.id })).status, 401, 'yours alone');
    assert.equal((await b.post(`/api/admin/loans/${loan.id}/take-back`, { ticketId: ticket.id })).status, 401);
    unchanged();
    assert.equal((await report(b, screeningId)).status, 200);

    assert.equal((await takeBack(ticket, loan)).status, 200);
    // Twice, from a page left open: the loan is over. A later loan on the film is never touched.
    const next = await lentTo(film);
    assert.deepEqual(answer(await takeBack(ticket, loan)), [409, { error: 'not-out' }]);
    assert.equal(loanOf(next.ticket).ended_at, null);
    assert.equal(eventsOf(ticket, 'returned').length, 1);
  });

  test('a tape past due isn’t taken back: it came due, its link is spent and not cancelled', async () => {
    const film = await ownFilm('take-back-past-due');
    const ticket = await issue(film);
    const b = await opened(ticket);
    const t0 = Date.now() + HOUR;
    press(b, film, t0);
    const due = t0 + 3 * DAY;
    assert.equal(access.takeBack(loanOf(ticket).id, ticket.id, due).error, 'not-out');
    assert.deepEqual([loanOf(ticket).ended_at, loanOf(ticket).ended_how], [due, 'due']);
    assert.equal(ticketRow(ticket).revoked_at, null);
    assert.equal(held(ticket), 1);
    assert.equal(stateOf(ticket, due), 'spent');

    // A millisecond sooner, it is.
    const early = await ownFilm('take-back-just-in-time');
    const second = await issue(early);
    press(await opened(second), early, t0);
    const r = access.takeBack(loanOf(second).id, second.id, due - 1);
    assert.deepEqual([r.error, r.loan.ended_at, r.loan.ended_how, r.ticket.revoked_at], [undefined, due - 1, 'taken-back', due - 1]);
  });
});

// ====================================================================== cancel and restore
describe('cancelling a link, and restoring one', () => {
  test('cancelling the link that has the tape is taking the tape back', async () => {
    const film = await ownFilm('cancel-lent');
    const sam = await member('Cancel Sam');
    const first = await issue(film, { personId: sam.p.id });
    const second = await issue(film, { personId: sam.p.id });
    const took = await play(sam.phone, film);
    const r = await admin.post(`/api/admin/tickets/${first.id}/revoke`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual([r.data.id, r.data.state, r.data.tookBack, r.data.alsoCancelled], [first.id, 'revoked', true, [second.id]]);
    assert.equal(loanOf(first).ended_how, 'taken-back');
    assert.deepEqual(answer(await report(sam.phone, took.data.screeningId)), [409, { error: 'taken-back' }]);
    assert.deepEqual(answer(await sam.phone.get(`/api/films/${film.slug}`)), [404, { error: 'not-found' }]);
    assert.deepEqual(live(film), []);
  });

  test('cancelling a link that doesn’t have the tape is as before, logged once, and leaves the tape where it is', async () => {
    const film = await ownFilm('cancel-waiting');
    const { ticket, b, screeningId } = await lentTo(film);
    const waiting = await issue(film);
    const w = await opened(waiting);
    const r = await admin.post(`/api/admin/tickets/${waiting.id}/revoke`);
    assert.deepEqual([r.status, r.data.state, r.data.tookBack, r.data.alsoCancelled], [200, 'revoked', false, []]);
    assert.deepEqual(answer(await w.get(`/api/films/${film.slug}`)), [404, { error: 'not-found' }]);
    assert.equal(held(waiting), 0);
    assert.equal(loanOf(ticket).ended_at, null, 'the tape is still out on the other link');
    assert.equal((await report(b, screeningId)).status, 200);
    // Cancelling it again changes nothing, and logs nothing more.
    assert.equal((await admin.post(`/api/admin/tickets/${waiting.id}/revoke`)).status, 200);
    const cancelled = eventsOf(waiting, 'ticket-cancelled');
    assert.deepEqual(cancelled.map((e) => [e.film_id, e.person_id, e.session_hash]), [[film.id, null, null]]);
    assert.equal(cancelled[0].at, ticketRow(waiting).revoked_at);
    assert.equal((await admin.get('/api/admin/activity?kind=loans&ticket=' + waiting.id)).data.events.map((e) => e.type).includes('ticket-cancelled'), true, 'filed under loans');
  });

  test('restoring works only for a link that never lent: not one whose tape was taken back, nor a spent one, nor the one that has the tape', async () => {
    const film = await ownFilm('restore');
    const never = await issue(film);
    assert.equal((await admin.post(`/api/admin/tickets/${never.id}/revoke`)).status, 200);
    const restored = await admin.post(`/api/admin/tickets/${never.id}/restore`);
    assert.deepEqual([restored.status, restored.data.state, restored.data.revokedAt], [200, 'ok', null]);
    assert.deepEqual(eventsOf(never, 'ticket-restored').map((e) => e.film_id), [film.id]);
    // Restoring one that isn't cancelled changes nothing, and logs nothing.
    assert.equal((await admin.post(`/api/admin/tickets/${never.id}/restore`)).status, 200);
    assert.equal(eventsOf(never, 'ticket-restored').length, 1);

    // It has the tape.
    const b = await opened(never);
    assert.equal((await play(b, film)).status, 200);
    assert.deepEqual(answer(await admin.post(`/api/admin/tickets/${never.id}/restore`)), [409, { error: 'lent-once' }]);
    // Spent, then cancelled: still once.
    assert.equal((await giveBack(b, film, { takenAt: loanOf(never).taken_at })).status, 200);
    const cancelled = await admin.post(`/api/admin/tickets/${never.id}/revoke`);
    assert.deepEqual([cancelled.data.state, cancelled.data.tookBack], ['revoked', false]);
    assert.deepEqual(answer(await admin.post(`/api/admin/tickets/${never.id}/restore`)), [409, { error: 'lent-once' }]);
    assert.ok(ticketRow(never).revoked_at);
    // Taken back.
    const { ticket } = await lentTo(film);
    assert.equal((await takeBack(ticket)).status, 200);
    assert.deepEqual(answer(await admin.post(`/api/admin/tickets/${ticket.id}/restore`)), [409, { error: 'lent-once' }]);
    assert.ok(ticketRow(ticket).revoked_at);
    assert.equal(eventsOf(ticket, 'ticket-restored').length, 0);
  });
});

// ====================================================================== a link can't change hands with the tape
describe('while a link has the tape it can’t change hands (question 2)', () => {
  test('giving it to a member, letting anyone use it and Sign out browsers are refused; once the tape is back they go', async () => {
    const film = await ownFilm('guards');
    const sam = await member('Guard Sam');
    const jo = await member('Guard Jo');
    const { ticket, b, loan, screeningId } = await lentTo(film);
    const before = { ...ticketRow(ticket) };
    const refused = async () => {
      assert.deepEqual(answer(await admin.post(`/api/admin/tickets/${ticket.id}/holder`, { personId: sam.p.id })), [409, { error: 'tape-out' }]);
      assert.deepEqual(answer(await admin.post(`/api/admin/tickets/${ticket.id}/holder`, { personId: null, claimable: true })), [409, { error: 'tape-out' }]);
      assert.deepEqual(answer(await admin.post(`/api/admin/tickets/${ticket.id}/sign-out-browsers`)), [409, { error: 'tape-out' }]);
      // Giving its play back went with slice 9 (below): there is no such route.
      assert.deepEqual(answer(await admin.post(`/api/admin/screenings/${screeningId}/void`)), [404, { error: 'not-found' }]);
    };
    await refused();
    // With the film's files broken, or the film off the shelf, the link still has the tape.
    sql("UPDATE films SET media_status = 'missing' WHERE id = ?", film.id);
    await refused();
    sql("UPDATE films SET media_status = 'ok', published = 0 WHERE id = ?", film.id);
    await refused();
    sql('UPDATE films SET published = 1 WHERE id = ?', film.id);
    assert.deepEqual({ ...ticketRow(ticket) }, before, 'nothing about the link changed');
    assert.deepEqual([held(ticket), screeningRow(screeningId).voided_at, loanOf(ticket).ended_at], [1, null, null]);
    assert.deepEqual(['ticket-given', 'ticket-released'].flatMap((type) => eventsOf(ticket, type)), []);
    assert.equal((await report(b, screeningId)).status, 200, 'the borrower plays on');
    // Giving it to nobody new, as it already is: nothing to refuse.
    assert.equal((await admin.post(`/api/admin/tickets/${ticket.id}/holder`, { personId: null, claimable: false })).status, 200);

    // A link for the film that doesn't have the tape changes hands as before.
    const waiting = await issue(film);
    assert.equal((await admin.post(`/api/admin/tickets/${waiting.id}/holder`, { personId: jo.p.id })).status, 200);
    assert.equal(ticketRow(waiting).person_id, jo.p.id);

    // A member's own link with the tape: the same.
    const own = await ownFilm('guards-member');
    const mine = await issue(own, { personId: sam.p.id });
    assert.equal((await play(sam.phone, own)).status, 200);
    assert.deepEqual(answer(await admin.post(`/api/admin/tickets/${mine.id}/holder`, { personId: null })), [409, { error: 'tape-out' }]);
    assert.deepEqual(answer(await admin.post(`/api/admin/tickets/${mine.id}/holder`, { personId: jo.p.id })), [409, { error: 'tape-out' }]);
    assert.equal(ticketRow(mine).person_id, sam.p.id);

    // The tape comes back: the link is spent, and can be given, released and forgotten.
    assert.equal((await giveBack(b, film, { takenAt: loan.taken_at })).status, 200);
    assert.equal((await admin.post(`/api/admin/tickets/${ticket.id}/sign-out-browsers`)).status, 200);
    assert.equal(held(ticket), 0);
    assert.equal((await admin.post(`/api/admin/tickets/${ticket.id}/holder`, { personId: sam.p.id })).status, 200);
    assert.equal(ticketRow(ticket).person_id, sam.p.id);
    assert.equal(stateOf(ticket, Date.now()), 'spent', 'given or not, it has lent');
    // Its playback still can't be given back: a link lends once, and the route is gone.
    assert.deepEqual(answer(await admin.post(`/api/admin/screenings/${screeningId}/void`)), [404, { error: 'not-found' }]);
    assert.equal(screeningRow(screeningId).voided_at, null);
  });

  test('a tape past due no longer holds its link: the refusals go by the clock, and write the end down', async () => {
    const film = await ownFilm('guards-past-due');
    const sam = await member('Past-due Sam');
    const ticket = await issue(film);
    const b = await opened(ticket);
    const t0 = Date.now() + HOUR;
    press(b, film, t0);
    const due = t0 + 3 * DAY;
    assert.equal(access.setTicketPerson(ticket.id, sam.p.id, {}, due - 1).error, 'tape-out');
    assert.equal(access.forgetBrowsers(ticket.id, due - 1).error, 'tape-out');
    assert.equal(loanOf(ticket).ended_at, null);
    assert.equal(access.forgetBrowsers(ticket.id, due).error, undefined);
    assert.deepEqual([loanOf(ticket).ended_at, loanOf(ticket).ended_how], [due, 'due']);
    assert.equal(access.setTicketPerson(ticket.id, sam.p.id, {}, due).changed, true);
  });

  // Slices 3 to 8 let a play from 1.x that no loan names be given back, until the
  // button went. Slice 9 took the button and its route away (the plan's API table):
  // a play from 1.x is now history like any other, and nothing writes voided_at.
  test('Give back is gone: a play from 1.x that no loan names can no longer be given back', async () => {
    const film = await ownFilm('void-1x');
    const ticket = await issue(film);
    const id = Number(sql('INSERT INTO screenings (ticket_id, film_id, session_hash, started_at, resumable_until, last_heartbeat_at, active_until) VALUES (?, ?, ?, 1, 2, 1, 1)', ticket.id, film.id, 'gone').lastInsertRowid);
    assert.deepEqual(answer(await admin.post(`/api/admin/screenings/${id}/void`)), [404, { error: 'not-found' }]);
    assert.equal(screeningRow(id).voided_at, null);
    assert.deepEqual(answer(await admin.post('/api/admin/screenings/987654321/void')), [404, { error: 'not-found' }]);
  });
});

// ====================================================================== moving a due date
describe('moving a due date (question 8)', () => {
  const patch = (ticket, body) => admin.patch(`/api/admin/tickets/${ticket.id}`, body);
  const cookieOf = (r) => r.headers.getSetCookie().filter((c) => c.startsWith('om_session='));

  test('later, or earlier: the tape is due that many days after it was taken, for the borrower and everyone waiting, and it is logged', async () => {
    const film = await ownFilm('due-moved');
    const { ticket, b, loan } = await lentTo(film);
    const other = await opened(await issue(film));
    assert.equal(loan.due_at, loan.taken_at + 3 * DAY);

    const later = await patch(ticket, { loanDays: 10 });
    assert.equal(later.status, 200, JSON.stringify(later.data));
    const to = loan.taken_at + 10 * DAY;
    assert.deepEqual([loanOf(ticket).due_at, ticketRow(ticket).loan_days, later.data.expiresAt], [to, 10, to]);
    assert.deepEqual([(await page(b, film)).dueBack, (await page(other, film)).dueBack], [to, to]);
    assert.deepEqual(eventsOf(ticket, 'due-changed').map((e) => [e.film_id, e.screening_id, e.detail]), [[film.id, loan.screening_id, { loanId: loan.id, from: loan.due_at, to }]]);
    assert.equal(loanOf(ticket).taken_at, loan.taken_at, 'when it was taken never moves');

    // Earlier, but not into the past.
    const earlier = await patch(ticket, { loanDays: 1 });
    assert.equal(earlier.status, 200, JSON.stringify(earlier.data));
    assert.equal(loanOf(ticket).due_at, loan.taken_at + DAY);
    assert.deepEqual(eventsOf(ticket, 'due-changed').at(-1).detail, { loanId: loan.id, from: to, to: loan.taken_at + DAY });
    // The same again: nothing moves, nothing is logged.
    assert.equal((await patch(ticket, { loanDays: 1 })).status, 200);
    assert.equal(eventsOf(ticket, 'due-changed').length, 2);
    // Nothing: the shop's own days.
    assert.equal((await patch(ticket, { loanDays: null })).status, 200);
    assert.deepEqual([loanOf(ticket).due_at, ticketRow(ticket).loan_days], [loan.taken_at + 3 * DAY, null]);
    // A save that doesn't mention the days leaves the date alone (1.1.0's link page sent
    // none; since slice 9 its play limit and days after the first play are refused, and
    // nothing in such a save is kept).
    for (const old of [{ screeningLimit: 2 }, { daysAfterFirstPlay: 9 }]) assert.equal((await patch(ticket, { label: 'Not kept', ...old })).status, 400);
    assert.equal(ticketRow(ticket).label === 'Not kept', false);
    assert.equal((await patch(ticket, { label: 'Renamed' })).status, 200);
    assert.deepEqual([loanOf(ticket).due_at, ticketRow(ticket).label], [loan.taken_at + 3 * DAY, 'Renamed']);
    assert.equal(eventsOf(ticket, 'due-changed').length, 3);
    for (const bad of [0, 31, 1.5, 'soon', -1]) assert.equal((await patch(ticket, { loanDays: bad })).status, 400, String(bad));
    assert.equal(loanOf(ticket).ended_at, null);
    // It is filed with the loans.
    assert.equal((await admin.get(`/api/admin/activity?kind=loans&ticket=${ticket.id}`)).data.events.filter((e) => e.type === 'due-changed').length, 3);
  });

  // A link's page saves all its fields together. The days it already has, sent again,
  // are no change to the date: not when the shop's default (which is for new links)
  // has changed since the tape went out, nor on a loan whose date isn't whole days
  // from when it was taken, as the upgrade from 1.x makes them.
  test('a save that sends the link’s own days again moves nothing, whatever the shop’s default is now, and saves the rest', async () => {
    const film = await ownFilm('due-days-unchanged');
    const { ticket, loan } = await lentTo(film);
    assert.deepEqual([ticketRow(ticket).loan_days, loan.due_at], [null, loan.taken_at + 3 * DAY]);
    try {
      // The default goes up: the tape that is out keeps its date.
      assert.equal((await admin.patch('/api/admin/settings', { loanDays: 7 })).status, 200);
      const up = await patch(ticket, { loanDays: null, label: 'Hello' });
      assert.equal(up.status, 200, JSON.stringify(up.data));
      assert.deepEqual([loanOf(ticket).due_at, ticketRow(ticket).loan_days, ticketRow(ticket).label], [loan.due_at, null, 'Hello']);
      // The default goes down, two days in: a day from when it was taken has passed,
      // and the save is not refused for it.
      sql('UPDATE loans SET taken_at = taken_at - ?1, due_at = due_at - ?1 WHERE id = ?2', 2 * DAY, loan.id);
      assert.equal((await admin.patch('/api/admin/settings', { loanDays: 1 })).status, 200);
      const down = await patch(ticket, { loanDays: null, label: 'Hello again' });
      assert.equal(down.status, 200, JSON.stringify(down.data));
      assert.deepEqual([loanOf(ticket).due_at, ticketRow(ticket).label], [loan.due_at - 2 * DAY, 'Hello again']);
      assert.deepEqual(eventsOf(ticket, 'due-changed'), []);
      // A new value is still a change, counted from when the tape was taken. And back to
      // none is one too: the shop's default as it is now, refused here, because that
      // day has passed.
      assert.equal((await patch(ticket, { loanDays: 4 })).status, 200);
      assert.equal(loanOf(ticket).due_at, loanOf(ticket).taken_at + 4 * DAY);
      assert.deepEqual(answer(await patch(ticket, { loanDays: null, label: 'Refused' })), [409, { error: 'would-end-loan' }]);
      assert.deepEqual([ticketRow(ticket).loan_days, ticketRow(ticket).label], [4, 'Hello again']);
    } finally {
      await admin.patch('/api/admin/settings', { loanDays: 3 });
    }

    // A loan as the upgrade makes them: due at a time that isn't whole days from when it was taken.
    const upgraded = await ownFilm('due-days-unchanged-off-grid');
    const second = await lentTo(upgraded, { loanDays: 5 });
    sql('UPDATE loans SET due_at = due_at - ? WHERE id = ?', 90 * MINUTE, second.loan.id);
    const due = second.loan.due_at - 90 * MINUTE;
    const same = await patch(second.ticket, { loanDays: 5, label: 'Viv' });
    assert.equal(same.status, 200, JSON.stringify(same.data));
    assert.deepEqual([loanOf(second.ticket).due_at, ticketRow(second.ticket).label, eventsOf(second.ticket, 'due-changed')], [due, 'Viv', []]);
    assert.equal((await patch(second.ticket, { loanDays: 6 })).status, 200);
    assert.equal(loanOf(second.ticket).due_at, second.loan.taken_at + 6 * DAY);
  });

  test('into the past is refused, and nothing changes: not the date, nor anything else in the same save', async () => {
    const film = await ownFilm('due-into-past');
    const ticket = await issue(film, { label: 'As sent', loanDays: 5 });
    const b = await opened(ticket);
    const t0 = Date.now() - 2 * DAY - HOUR;
    press(b, film, t0);
    const before = { loan: loanOf(ticket), ticket: { ...ticketRow(ticket) } };
    // Two days and an hour in: one day, or two, would have it due already.
    for (const loanDays of [1, 2]) {
      assert.deepEqual(answer(await patch(ticket, { loanDays, label: 'Changed', startBy: Date.now() + DAY })), [409, { error: 'would-end-loan' }]);
    }
    assert.deepEqual({ loan: loanOf(ticket), ticket: { ...ticketRow(ticket) } }, before);
    assert.deepEqual(eventsOf(ticket, 'due-changed'), []);
    assert.equal((await page(b, film)).tape, 'yours');
    // Three days is still ahead.
    assert.equal((await patch(ticket, { loanDays: 3, label: 'Changed' })).status, 200);
    assert.deepEqual([loanOf(ticket).due_at, ticketRow(ticket).label], [t0 + 3 * DAY, 'Changed']);

    // To the millisecond, with the clock passed in.
    const exact = await ownFilm('due-into-past-exact');
    const second = await issue(exact, { loanDays: 5 });
    const t1 = Date.now() + HOUR;
    press(await opened(second), exact, t1);
    const move = (days, now) => tx(srv.db, () => access.setLoanDays(second.id, days, now), { immediate: true });
    assert.equal(move(1, t1 + DAY).error, 'would-end-loan', 'due at this very moment is already back');
    assert.equal(loanOf(second).due_at, t1 + 5 * DAY);
    assert.deepEqual(move(1, t1 + DAY - 1).moved, { loanId: loanOf(second).id, from: t1 + 5 * DAY, to: t1 + DAY });
  });

  test('a browser’s session follows a date moved later, and its cookie at its next film page; a member’s tape needs neither', async () => {
    const film = await ownFilm('due-moved-session');
    const { ticket, b, loan } = await lentTo(film, { loanDays: 1 });
    // The browser's session was made 80 days ago: it ends in ten days.
    const expires = Date.now() + 10 * DAY;
    sql('UPDATE sessions SET created_at = ?, expires_at = ? WHERE id_hash = ?', Date.now() - 80 * DAY, expires, hashOf(b));
    assert.equal((await patch(ticket, { loanDays: 30 })).status, 200);
    const due = loan.taken_at + 30 * DAY;
    assert.equal(viewerOf(b).expires_at, due + DAY, 'a day past the new due time');
    const again = await b.get(`/api/films/${film.slug}`);
    const [cookie] = cookieOf(again);
    assert.ok(cookie, 'the cookie is sent again with the page');
    assert.ok(Math.abs(Number(/Max-Age=(\d+)/.exec(cookie)[1]) * SECOND - (due + DAY - Date.now())) < MINUTE);
    // Moved earlier again: the session is never shortened.
    assert.equal((await patch(ticket, { loanDays: 2 })).status, 200);
    assert.equal(viewerOf(b).expires_at, due + DAY);

    const own = await ownFilm('due-moved-member');
    const sam = await member('Due-moved Sam');
    const mine = await issue(own, { personId: sam.p.id, loanDays: 1 });
    assert.equal((await play(sam.phone, own)).status, 200);
    const session = viewerOf(sam.phone).expires_at;
    assert.equal((await patch(mine, { loanDays: 30 })).status, 200);
    assert.equal(viewerOf(sam.phone).expires_at, session);
    assert.deepEqual(cookieOf(await sam.phone.get(`/api/films/${own.slug}`)), []);
    assert.equal(eventsOf(mine, 'due-changed')[0].person_id, sam.p.id);
  });

  test('on a link that doesn’t have the tape it only sets how long the link will lend for', async () => {
    const film = await ownFilm('due-not-lent');
    const ticket = await issue(film);
    assert.equal((await patch(ticket, { loanDays: 7 })).status, 200);
    assert.equal(ticketRow(ticket).loan_days, 7);
    const b = await opened(ticket);
    assert.equal((await page(b, film)).loanDays, 7);
    const t0 = Date.now() + HOUR;
    assert.equal(press(b, film, t0).loan.due_at, t0 + 7 * DAY);
    // Past due: nothing is moved, the end is written as it was, and the link keeps the number.
    const move = tx(srv.db, () => access.setLoanDays(ticket.id, 30, t0 + 8 * DAY), { immediate: true });
    assert.deepEqual([move.error, move.moved], [undefined, null]);
    assert.deepEqual([loanOf(ticket).due_at, loanOf(ticket).ended_at, loanOf(ticket).ended_how, ticketRow(ticket).loan_days], [t0 + 7 * DAY, t0 + 7 * DAY, 'due', 30]);
    assert.deepEqual(eventsOf(ticket, 'due-changed'), []);
  });
});

// ====================================================================== spent links
describe('a spent link', () => {
  test('opened in a browser that doesn’t hold it: 410, no session, nothing about the film; in one that holds it, as before', async () => {
    const film = await ownFilm('spent-open');
    const { ticket, b, loan } = await lentTo(film);
    const alsoHolds = await opened(ticket);
    // While its tape is out it opens like any link.
    assert.deepEqual(answer(await browser(srv.base).post('/api/tickets/open', { code: ticket.code })), [200, { slug: film.slug }]);
    assert.equal((await giveBack(b, film, { takenAt: loan.taken_at })).status, 200);

    const sessions = () => srv.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
    const before = [sessions(), held(ticket), ticketRow(ticket).first_opened_at];
    const stranger = browser(srv.base);
    const r = await stranger.post('/api/tickets/open', { code: ticket.code });
    assert.deepEqual(answer(r), [410, { error: 'ticket-spent' }]);
    assert.deepEqual(r.headers.getSetCookie(), []);
    // A browser with a session of its own, from another link: the same, and it isn't attached.
    const elsewhere = await opened(await issue(await ownFilm('spent-open-elsewhere')));
    assert.deepEqual(answer(await elsewhere.post('/api/tickets/open', { code: ticket.code })), [410, { error: 'ticket-spent' }]);
    assert.deepEqual([sessions() - 1, held(ticket), ticketRow(ticket).first_opened_at], before, 'one session, for the other link; nothing for this one');
    assert.equal((await elsewhere.get(`/api/films/${film.slug}`)).status, 404);

    // The browsers that hold it still have their page.
    for (const who of [b, alsoHolds]) {
      assert.deepEqual(answer(await who.post('/api/tickets/open', { code: ticket.code })), [200, { slug: film.slug }]);
      assert.equal((await page(who, film)).state, 'spent');
    }
    // It is the link that is spent, not the film: with the tape out again on another
    // link, or the film's files broken, a stranger still gets the same answer.
    const next = await lentTo(film);
    assert.deepEqual(answer(await browser(srv.base).post('/api/tickets/open', { code: ticket.code })), [410, { error: 'ticket-spent' }]);
    sql("UPDATE films SET media_status = 'error' WHERE id = ?", film.id);
    assert.deepEqual(answer(await browser(srv.base).post('/api/tickets/open', { code: ticket.code })), [410, { error: 'ticket-spent' }]);
    assert.deepEqual(answer(await browser(srv.base).post('/api/tickets/open', { code: next.ticket.code })), [200, { slug: film.slug }], 'the link that has the tape opens');
    sql("UPDATE films SET media_status = 'ok' WHERE id = ?", film.id);
  });

  test('a member’s own spent link still opens for them, signed in, and tells anyone else what it did before', async () => {
    const film = await ownFilm('spent-open-member');
    const sam = await member('Spent Sam');
    const jo = await member('Spent Jo');
    const ticket = await issue(film, { personId: sam.p.id });
    assert.equal((await play(sam.phone, film)).status, 200);
    assert.equal((await giveBack(sam.phone, film, { takenAt: loanOf(ticket).taken_at })).status, 200);
    assert.deepEqual(answer(await sam.phone.post('/api/tickets/open', { code: ticket.code })), [200, { slug: film.slug }]);
    assert.deepEqual(answer(await browser(srv.base).post('/api/tickets/open', { code: ticket.code })), [401, { error: 'sign-in-required' }]);
    assert.deepEqual(answer(await jo.phone.post('/api/tickets/open', { code: ticket.code })), [403, { error: 'ticket-for-someone-else' }]);
  });
});

// ====================================================================== everyone signed out
describe('"Sign out every friend and member" (question 5)', () => {
  test('a browser’s tape comes back at once and its link is spent; a member’s own tape is still theirs when they sign in again', async () => {
    const film = await ownFilm('everyone-out-browser');
    const { ticket, b, screeningId } = await lentTo(film);
    const nextLink = await issue(film);
    const own = await ownFilm('everyone-out-member');
    const sam = await member('Everyone-out Sam');
    const mine = await issue(own, { personId: sam.p.id });
    const took = await play(sam.phone, own);
    assert.equal((await report(sam.phone, took.data.screeningId, { position: 44, playing: false })).status, 200);

    const before = Date.now();
    assert.ok((await admin.post('/api/admin/sessions/expire-all')).data.expired >= 2);

    // The browser's tape: back from that moment, with nothing written yet.
    assert.equal(loanOf(ticket).ended_at, null);
    assert.equal(stateOf(ticket, Date.now()), 'spent');
    assert.deepEqual(answer(await report(b, screeningId)), [404, { error: 'signed-out' }]);
    assert.deepEqual(answer(await browser(srv.base).post('/api/tickets/open', { code: ticket.code })), [410, { error: 'ticket-spent' }]);
    const next = await opened(nextLink);
    assert.deepEqual((await play(next, film)).data.took, true);
    const ended = loanOf(ticket);
    assert.equal(ended.ended_how, 'signed-out');
    assert.ok(ended.ended_at >= before && ended.ended_at <= Date.now());

    // The member's tape: out all the while, and theirs again once they sign in.
    assert.equal(stateOf(mine, Date.now()), 'lent');
    assert.equal((await sam.phone.get(master(own.slug))).status, 403, 'signed out, it plays nowhere');
    const waiting = await opened(await issue(own));
    assert.deepEqual(answer(await play(waiting, own)), [409, { error: 'out' }]);
    await sam.device(sam.phone);
    const again = await play(sam.phone, own);
    assert.deepEqual([again.data.resumed, again.data.screeningId, again.data.position], [true, took.data.screeningId, 44]);
    assert.equal(loanOf(mine).ended_at, null);
  });
});

// ====================================================================== asked at once
// One process answers its requests one after another, so two sent together only take
// turns: whichever is read first wins. test/loans-race.test.js has the same races
// between two threads that truly overlap.
describe('two things asked of one tape at once, over HTTP', () => {
  test('a return and a take-back: one winner, and the loan ends once', async () => {
    const hows = new Set();
    for (let round = 0; round < 6; round++) {
      const film = await ownFilm(`at-once-return-${round}`);
      const { ticket, b, loan } = await lentTo(film);
      // Sent in either order, turn about.
      const asks = [() => giveBack(b, film, { takenAt: loan.taken_at }), () => takeBack(ticket, loan)];
      const [first, second] = await Promise.all((round % 2 ? asks.reverse() : asks).map((ask) => ask()));
      assert.deepEqual([first.status, second.status].sort(), [200, 409], JSON.stringify([first.data, second.data]));
      const lost = [first, second].find((r) => r.status === 409).data.error;
      const ended = loanOf(ticket);
      assert.deepEqual([ended.ended_how, lost], ended.ended_how === 'returned' ? ['returned', 'not-out'] : ['taken-back', 'nothing-to-return']);
      assert.equal(Boolean(ticketRow(ticket).revoked_at), ended.ended_how === 'taken-back');
      assert.deepEqual(eventsOf(ticket, 'returned').map((e) => e.detail.how), [ended.ended_how]);
      hows.add(ended.ended_how);
    }
    assert.deepEqual([...hows].sort(), ['returned', 'taken-back'], 'each won when it was asked first');
  });

  test('Play on another link and a take-back: the tape is taken back, and never out twice', async () => {
    const told = new Set();
    for (let round = 0; round < 6; round++) {
      const film = await ownFilm(`at-once-play-${round}`);
      const { ticket, loan } = await lentTo(film);
      const next = await issue(film);
      const other = await opened(next);
      const asks = [() => play(other, film), () => takeBack(ticket, loan)];
      const answers = await Promise.all((round % 2 ? asks.reverse() : asks).map((ask) => ask()));
      const [pressed, taken] = round % 2 ? answers.reverse() : answers;
      assert.equal(taken.status, 200, JSON.stringify(taken.data));
      assert.equal(loanOf(ticket).ended_how, 'taken-back');
      if (pressed.status === 409) assert.deepEqual([pressed.data, loanOf(next)], [{ error: 'out' }, null]);
      else assert.deepEqual([pressed.status, pressed.data.took, loanOf(next).ended_at], [200, true, null]);
      assert.ok(live(film).length <= 1);
      told.add(pressed.status);
    }
    assert.deepEqual([...told].sort(), [200, 409], 'Play asked first is refused; asked second, it takes the tape');
  });
});
