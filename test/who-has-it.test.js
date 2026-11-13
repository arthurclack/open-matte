// What the back office and the front page need to know: version 2, slice 5. Written
// from docs/version-2.md ("The API", "A link's state, the same whoever asks", "What
// can happen to a tape", "Never who has it"), not from the implementation.
//
// The back office is told who has each tape: a film's `tape`, `links` and `lending`,
// /api/admin/loans (with `otherLinks` for the take-back's confirmation), a link's
// `loan`, `loanDays` and `linkState`, a member's `tapesOut`, `liveLinks` and `loans`,
// Status's `attention.tapes` and the sweeper's last run, and `access.tape` on the
// owner's own preview of a film page. Each of those needs the owner's session.
// The front page is told what is this browser's: /api/me with what it has out first,
// `browserLoans`, and in or out with the date on the members' shelf (question 7: yes).
// That no viewer's answer says who has a tape is test/never-who.test.js.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';
import { FILM_SECONDS, addFilm, adminBrowser, browser, enroll, makeFilm, newPerson, setupLink, signIn, startServer, tempDir } from './helpers.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const DEVICES = { [EDGE]: 'Edge on Windows', [SAFARI]: 'Safari on iPhone' };
const NO_DEVICE = 'Browser on unknown device';

const mediaDir = tempDir();
let srv;
let admin;

before(async () => {
  makeFilm(mediaDir, 'arrival');
  srv = await startServer({ mediaDir, limits: { scale: 100 } });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
});
after(() => srv.close());

// ------------------------------------------------------------ helpers
// A browser that says what it is, so its device has a name of its own.
function browserOn(ua) {
  const b = browser(srv.base);
  const send = (method) => (url, body = method === 'GET' ? undefined : {}) =>
    b.send(method, url, body === undefined ? undefined : JSON.stringify(body), { type: body === undefined ? undefined : 'application/json', headers: { 'user-agent': ua } });
  return { jar: b.jar, get: send('GET'), post: send('POST'), patch: send('PATCH') };
}
const fresh = (ua) => (ua ? browserOn(ua) : browser(srv.base));
// A film of its own for every test: one tape each.
const ownFilm = (slug, fields = {}) => addFilm(admin, mediaDir, slug, { title: `Film ${slug}`, ...fields });
async function issue(film, fields = {}) {
  const r = await admin.post('/api/admin/tickets', { filmId: film.id, ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data[0];
}
async function opened(ticket, b = fresh()) {
  const r = await b.post('/api/tickets/open', { code: ticket.code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return b;
}
// A member signed in on their phone; device() signs another browser in as them.
async function member(name, ua) {
  const p = await newPerson(admin, name);
  const auth = softAuthenticator();
  const phone = fresh(ua);
  assert.equal((await enroll(phone, (await setupLink(admin, p.id)).token, { auth })).status, 200);
  const device = async (b = fresh()) => {
    assert.equal((await signIn(b, auth)).status, 200);
    return b;
  };
  return { p, phone, auth, device };
}
const personOf = ({ p }, disabled = false) => ({ id: p.id, name: p.name, disabled });
async function play(b, film) {
  const r = await b.post(`/api/films/${film.slug}/screenings`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const report = (b, played, body) => b.post(`/api/screenings/${played.screeningId}/heartbeat`, body);
const giveBack = (b, film, takenAt, extra = {}) => b.post(`/api/films/${film.slug}/return`, { takenAt, ...extra });
const answer = (r) => [r.status, r.data];
async function ok(promise) {
  const r = await promise;
  assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
const loans = async (query = '') => (await ok(admin.get(`/api/admin/loans${query}`))).loans;
const loanOn = async (ticket) => (await loans(`?ticket=${ticket.id}`))[0] ?? null;
const filmOf = (film) => ({ id: film.id, slug: film.slug, title: film.title });
const adminFilm = (film) => ok(admin.get(`/api/admin/films/${film.id}`));
const listedFilm = async (film) => (await ok(admin.get('/api/admin/films'))).find((f) => f.id === film.id);
const adminLink = (ticket) => ok(admin.get(`/api/admin/tickets/${ticket.id}`));
const listedLink = async (ticket) => (await ok(admin.get('/api/admin/tickets'))).find((t) => t.id === ticket.id);
const row = (table, id) => ({ ...srv.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) });
const sql = (s, ...args) => srv.db.prepare(s).run(...args);
const page = async (b, film) => (await ok(b.get(`/api/films/${film.slug}`))).access;
const me = (b) => ok(b.get('/api/me'));
const booth = () => ok(admin.get('/api/admin/booth'));
// As the clock would have it some time on: the loan was taken, and is due, that much earlier.
const age = (loan, by) => sql('UPDATE loans SET taken_at = taken_at - ?1, due_at = due_at - ?1 WHERE id = ?2', by, loan.id);

// ====================================================================== films
describe('a film’s tape, its links and how it has been lent, for the owner', () => {
  test('a film nobody has a link for: in, no links, never lent; off the shelf, its tape is "off"', async () => {
    const film = await ownFilm('who-empty');
    const one = await adminFilm(film);
    assert.deepEqual(one.tape, { state: 'in', loan: null });
    assert.deepEqual(one.links, { live: 0, waiting: 0, total: 0 });
    assert.deepEqual(one.lending, { sent: 0, cancelled: 0, opened: 0, lent: 0, finished: 0, responses: 0 });
    // The list has the tape and the links, and leaves the counts to the film's own page.
    const listed = await listedFilm(film);
    assert.deepEqual([listed.tape, listed.links], [one.tape, one.links]);
    assert.ok(!('lending' in listed) && !('viewing' in listed));
    // 1.1.0's count of active tapes went with its Films page (slice 9): Links is links.live.
    assert.ok(!('tickets' in listed), '1.1.0’s count is gone');

    const off = await ok(admin.patch(`/api/admin/films/${film.id}`, { published: false }));
    assert.deepEqual(off.tape, { state: 'off', loan: null });
    assert.deepEqual((await listedFilm(film)).tape, { state: 'off', loan: null });
    // A film the scan has only just found is off the shelf as well.
    assert.deepEqual((await addFilm(admin, mediaDir, 'who-unpublished', { published: false })).tape, { state: 'off', loan: null });
  });

  test('links are counted as live while they have the tape or could still take it, and waiting until they have lent', async () => {
    const film = await ownFilm('who-counts');
    const sam = await member('Counts Sam');
    await issue(film, { personId: sam.p.id, label: 'Sam’s own' });
    const first = await issue(film, { label: 'First for anyone' });
    await issue(film, { label: 'Second for anyone' });
    const cancelled = await issue(film, { label: 'Cancelled' });
    await ok(admin.post(`/api/admin/tickets/${cancelled.id}/revoke`));
    await issue(film, { label: 'Start-by missed', startBy: Date.now() - HOUR });
    const counts = async () => {
      const [one, listed] = [await adminFilm(film), await listedFilm(film)];
      assert.deepEqual([listed.tape, listed.links], [one.tape, one.links], 'the list and the film’s page say the same');
      return [one.tape.state, one.links];
    };
    // Five sent. One is cancelled and one missed its start-by date: three could lend.
    assert.deepEqual(await counts(), ['in', { live: 3, waiting: 3, total: 5 }]);

    const b = await opened(first);
    const played = await play(b, film);
    // One has the tape: still live, no longer waiting.
    assert.deepEqual(await counts(), ['out', { live: 3, waiting: 2, total: 5 }]);
    const out = (await adminFilm(film)).tape.loan;
    assert.deepEqual(out, await loanOn(first), 'the film’s loan is the one /api/admin/loans gives');
    assert.deepEqual([out.ticket, out.takenAt, out.live], [{ id: first.id, label: 'First for anyone' }, played.takenAt, true]);

    // Back: the link that lent is spent, and no longer live.
    assert.equal((await giveBack(b, film, played.takenAt)).status, 200);
    assert.deepEqual(await counts(), ['in', { live: 2, waiting: 2, total: 5 }]);
    assert.deepEqual((await adminFilm(film)).tape, { state: 'in', loan: null });
    assert.deepEqual((await adminFilm(film)).lending, { sent: 5, cancelled: 1, opened: 1, lent: 1, finished: 0, responses: 0 });

    // Sam opens the film's page, takes it on their own link, watches to the end, and
    // hands it back with a response.
    assert.equal((await page(sam.phone, film)).ticket.tape, 'in');
    const mine = await play(sam.phone, film);
    assert.equal((await report(sam.phone, mine, { position: FILM_SECONDS - 2 })).status, 200);
    assert.deepEqual(await counts(), ['out', { live: 2, waiting: 1, total: 5 }]);
    assert.equal((await giveBack(sam.phone, film, mine.takenAt, { response: 'loved-it', message: 'Thank you.' })).status, 200);
    assert.deepEqual(await counts(), ['in', { live: 1, waiting: 1, total: 5 }]);
    const lending = { sent: 5, cancelled: 1, opened: 2, lent: 2, finished: 1, responses: 1 };
    assert.deepEqual((await adminFilm(film)).lending, lending);

    // Counted from links, loans and responses, never from events: the clean-up changes nothing.
    sql('DELETE FROM events WHERE film_id = ?', film.id);
    assert.deepEqual((await adminFilm(film)).lending, lending);
    assert.deepEqual(await counts(), ['in', { live: 1, waiting: 1, total: 5 }]);
  });

  test('off the shelf with its tape out, the film is "off" and its loan is still shown; with its files broken it is still "out"', async () => {
    const film = await ownFilm('who-off-out');
    const link = await issue(film, { label: 'Out, then off' });
    const waiting = await issue(film, { label: 'Waits' });
    const b = await opened(link, fresh(EDGE));
    await play(b, film);
    const loan = await loanOn(link);

    sql("UPDATE films SET media_status = 'error' WHERE id = ?", film.id);
    assert.deepEqual((await adminFilm(film)).tape, { state: 'out', loan }, 'the film’s files are its own trouble: mediaStatus says so');
    assert.equal((await adminFilm(film)).mediaStatus, 'error');
    sql("UPDATE films SET media_status = 'ok' WHERE id = ?", film.id);

    await ok(admin.patch(`/api/admin/films/${film.id}`, { published: false }));
    for (const f of [await adminFilm(film), await listedFilm(film)]) {
      assert.deepEqual(f.tape, { state: 'off', loan }, 'the clock runs on, and the owner still sees who has it');
      // The links are as they stand with the tape, whatever the film's own state.
      assert.deepEqual(f.links, { live: 2, waiting: 1, total: 2 });
    }
    assert.deepEqual([(await adminLink(link)).linkState, (await adminLink(waiting)).linkState], ['off', 'off']);
    // And it can still be taken back.
    assert.equal((await admin.post(`/api/admin/loans/${loan.id}/take-back`, { ticketId: link.id })).status, 200);
    assert.deepEqual((await adminFilm(film)).tape, { state: 'off', loan: null });
  });

  test('a tape past due is in, written down or not: reading never writes its end', async () => {
    const film = await ownFilm('who-past-due');
    const link = await issue(film, { loanDays: 2 });
    const b = await opened(link);
    await play(b, film);
    const before = await loanOn(link);
    age(before, 2 * DAY + MINUTE);
    const due = before.dueAt - 2 * DAY - MINUTE;

    assert.deepEqual((await adminFilm(film)).tape, { state: 'in', loan: null });
    assert.deepEqual((await listedFilm(film)).links, { live: 0, waiting: 0, total: 1 }, 'its link is spent');
    assert.deepEqual(await loans(`?live=1&film=${film.id}`), []);
    // The owner is told the end closeStale will write: due, at its due time.
    const told = await loanOn(link);
    assert.deepEqual([told.live, told.endedAt, told.endedHow, told.playingNow, told.otherLinks], [false, due, 'due', false, []]);
    assert.equal((await adminLink(link)).linkState, 'done');
    assert.deepEqual([row('loans', before.id).ended_at, row('loans', before.id).ended_how], [null, null], 'nothing wrote it');
    assert.equal((await booth()).attention.tapes.out, (await loans('?live=1')).length);
    // Written, it is what the owner was told.
    srv.app.locals.access.sweep();
    assert.deepEqual([row('loans', before.id).ended_at, row('loans', before.id).ended_how], [due, 'due']);
    assert.deepEqual(await loanOn(link), told);
  });
});

// ====================================================================== /api/admin/loans
describe('GET /api/admin/loans: every time a tape went out, and who has it', () => {
  test('the owner’s alone: no session, a viewer’s session and the borrower’s own are all refused', async () => {
    const film = await ownFilm('who-owners-alone');
    const sam = await member('Refused Sam');
    await issue(film, { personId: sam.p.id });
    await play(sam.phone, film);
    const holder = await opened(await issue(film));
    for (const b of [fresh(), holder, sam.phone]) {
      for (const url of ['/api/admin/loans', '/api/admin/loans?live=1', `/api/admin/loans?film=${film.id}`, `/api/admin/films/${film.id}`, '/api/admin/films', '/api/admin/tickets', '/api/admin/people', `/api/admin/people/${sam.p.id}`, '/api/admin/booth']) {
        assert.deepEqual(answer(await b.get(url)), [401, { error: 'not-signed-in' }], url);
      }
    }
    // A browser that was the owner's, signed out of the back office: refused from then on.
    const was = await adminBrowser(srv.base);
    assert.equal((await was.get('/api/admin/loans')).status, 200);
    await was.post('/api/admin/logout');
    assert.equal((await was.get('/api/admin/loans')).status, 401);
  });

  test('a tape out on a member’s own link: the member by name, since when, due when, and how playback stands', async () => {
    const film = await ownFilm('who-member-loan');
    const sam = await member('Loan Sam', SAFARI);
    const link = await issue(film, { personId: sam.p.id, label: 'For Sam', loanDays: 4 });
    const started = Date.now();
    const played = await play(sam.phone, film);
    const [loan] = await loans(`?film=${film.id}`);
    assert.ok(loan.takenAt >= started && loan.takenAt <= Date.now());
    assert.deepEqual(loan, {
      id: srv.db.prepare('SELECT id FROM loans WHERE ticket_id = ?').get(link.id).id,
      film: filmOf(film),
      ticket: { id: link.id, label: 'For Sam' },
      borrower: { kind: 'person', person: personOf(sam) },
      takenAt: played.takenAt,
      dueAt: played.takenAt + 4 * DAY,
      endedAt: null,
      endedHow: null,
      live: true,
      // Its playback, among the link's plays (slice 10: the link's page reads it there).
      screeningId: played.screeningId,
      playingNow: true,
      position: 0,
      finished: false,
      response: null,
      otherLinks: [],
    });
    // Playback: where it is, paused or playing, finished or not.
    assert.equal((await report(sam.phone, played, { position: 31 })).status, 200);
    assert.deepEqual(await loanOn(link), { ...loan, position: 31 });
    assert.equal((await report(sam.phone, played, { position: 40, playing: false })).status, 200);
    assert.deepEqual(await loanOn(link), { ...loan, position: 40, playingNow: false });
    assert.equal((await report(sam.phone, played, { position: FILM_SECONDS - 1 })).status, 200);
    assert.deepEqual(await loanOn(link), { ...loan, position: FILM_SECONDS - 1, finished: true }, 'finished, and still out');
    // Their card turned off: the tape is back, and the loan still says whose it was.
    await ok(admin.post(`/api/admin/people/${sam.p.id}/disable`));
    const ended = await loanOn(link);
    assert.deepEqual([ended.live, ended.endedHow, ended.playingNow, ended.borrower], [false, 'disabled', false, { kind: 'person', person: personOf(sam, true) }]);
    assert.ok(ended.endedAt >= played.takenAt && ended.endedAt <= Date.now());
  });

  test('a tape out to a browser, on a link anyone can use: its device, and the member it is signed in as only while that is known', async () => {
    // Not signed in: the device alone.
    const film = await ownFilm('who-browser-loan');
    const link = await issue(film, { label: 'Kitchen TV' });
    const tv = await opened(link, fresh(EDGE));
    const played = await play(tv, film);
    const loan = await loanOn(link);
    assert.deepEqual(loan.borrower, { kind: 'browser', device: DEVICES[EDGE], signedInAs: null });
    assert.deepEqual([loan.ticket, loan.takenAt, loan.dueAt, loan.live], [{ id: link.id, label: 'Kitchen TV' }, played.takenAt, played.takenAt + 3 * DAY, true]);

    // Signed in before Play: the loan is still the browser's (question 2), and the owner sees the name.
    const second = await ownFilm('who-browser-signed-in');
    const jo = await member('Browser Jo', SAFARI);
    const forAnyone = await issue(second, { label: 'Forwarded' });
    await opened(forAnyone, jo.phone);
    await play(jo.phone, second);
    const signedIn = await loanOn(forAnyone);
    assert.deepEqual(signedIn.borrower, { kind: 'browser', device: DEVICES[SAFARI], signedInAs: personOf(jo) });
    assert.deepEqual(await loans(`?person=${jo.p.id}`), [], 'a browser’s loan isn’t the member’s own');

    // Signed in after Play: the tape comes along to the new session, and the name with it.
    const third = await ownFilm('who-browser-signs-in-later');
    const later = await issue(third, { label: 'Signs in later' });
    const laptop = await opened(later, fresh(EDGE));
    await play(laptop, third);
    assert.deepEqual((await loanOn(later)).borrower, { kind: 'browser', device: DEVICES[EDGE], signedInAs: null });
    await jo.device(laptop);
    const carried = await loanOn(later);
    assert.deepEqual([carried.borrower, carried.live], [{ kind: 'browser', device: DEVICES[EDGE], signedInAs: personOf(jo) }, true]);

    // Signed out: the tape is back at that moment, written down or not, and the name
    // is still known while the session's row is there.
    const session = row('loans', signedIn.id).session_hash;
    const before = Date.now();
    await jo.phone.post('/api/signout');
    const signedOut = await loanOn(forAnyone);
    assert.deepEqual([signedOut.live, signedOut.endedHow, signedOut.borrower], [false, 'signed-out', signedIn.borrower]);
    assert.ok(signedOut.endedAt >= before && signedOut.endedAt <= Date.now());
    assert.equal(srv.db.prepare('SELECT ended_at FROM loans WHERE id = ?').get(signedOut.id).ended_at, null, 'reading wrote nothing');
    srv.app.locals.access.sweep();
    assert.deepEqual(await loanOn(forAnyone), signedOut, 'written, it is what the owner was told');

    // After the clean-up has deleted the ended session (about a year on), the device
    // stands alone. Here that session, and what was logged for it, ended two years ago.
    sql('UPDATE sessions SET created_at = created_at - ?1, expires_at = expires_at - ?1, revoked_at = revoked_at - ?1 WHERE id_hash = ?2', 730 * DAY, session);
    sql('UPDATE events SET at = at - ? WHERE session_hash = ?', 730 * DAY, session);
    assert.equal(srv.app.locals.retention.run().sessions, 1);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE id_hash = ?').get(session).n, 0);
    const after = await loanOn(forAnyone);
    assert.deepEqual(after.borrower, { kind: 'browser', device: DEVICES[SAFARI], signedInAs: null });
    assert.deepEqual({ ...after, borrower: null }, { ...signedOut, borrower: null }, 'and nothing else about the loan changes');
  });

  test('how each one came back, a response with it, newest first, and the filters', async () => {
    const film = await ownFilm('who-history');
    const other = await ownFilm('who-history-other');
    const sam = await member('History Sam');
    const jo = await member('History Jo');
    const links = {
      returned: await issue(film, { label: 'Returned' }),
      handedBack: await issue(film, { personId: sam.p.id, label: 'Handed back' }),
      takenBack: await issue(film, { personId: jo.p.id, label: 'Taken back' }),
      out: await issue(film, { label: 'Out now' }),
      elsewhere: await issue(other, { personId: sam.p.id, label: 'Sam’s, on another film' }),
    };
    const b = await opened(links.returned);
    const first = await play(b, film);
    assert.equal((await giveBack(b, film, first.takenAt)).status, 200);
    const second = await play(sam.phone, film);
    const said = await ok(giveBack(sam.phone, film, second.takenAt, { response: 'lets-talk', message: 'Call me about the ending.' }));
    const third = await play(jo.phone, film);
    const taken = await ok(admin.post(`/api/admin/loans/${(await loanOn(links.takenBack)).id}/take-back`, { ticketId: links.takenBack.id }));
    const last = await opened(links.out);
    await play(last, film);
    await play(sam.phone, other);

    const all = await loans(`?film=${film.id}`);
    assert.deepEqual(all.map((l) => [l.ticket.label, l.live, l.endedHow]), [['Out now', true, null], ['Taken back', false, 'taken-back'], ['Handed back', false, 'returned'], ['Returned', false, 'returned']], 'newest first');
    const [, takenBack, handedBack, returned] = all;
    assert.deepEqual([returned.endedAt >= first.takenAt, returned.response, returned.borrower], [true, null, { kind: 'browser', device: NO_DEVICE, signedInAs: null }]);
    // What was said, for the owner: here as under Responses.
    const response = (await ok(admin.get('/api/admin/responses'))).responses.find((r) => r.film.id === film.id);
    assert.deepEqual(handedBack.response, { id: response.id, kind: 'lets-talk', message: 'Call me about the ending.', createdAt: said.returned.at, readAt: null });
    assert.deepEqual([handedBack.endedAt, handedBack.borrower], [said.returned.at, { kind: 'person', person: personOf(sam) }]);
    await ok(admin.post(`/api/admin/responses/${response.id}/read`));
    assert.ok((await loanOn(links.handedBack)).response.readAt);
    // The take-back answered with the loan as this list gives it.
    assert.deepEqual(taken.loan, takenBack);
    assert.deepEqual([takenBack.takenAt, takenBack.borrower, takenBack.otherLinks], [third.takenAt, { kind: 'person', person: personOf(jo) }, []]);

    // The filters, alone and together.
    const labels = async (query) => (await loans(query)).map((l) => l.ticket.label).sort();
    assert.deepEqual(await labels(`?live=1&film=${film.id}`), ['Out now']);
    assert.deepEqual(await labels(`?live=0&film=${film.id}`), ['Handed back', 'Out now', 'Returned', 'Taken back']);
    assert.deepEqual(await labels(`?person=${sam.p.id}`), ['Handed back', 'Sam’s, on another film']);
    assert.deepEqual(await labels(`?person=${sam.p.id}&live=1`), ['Sam’s, on another film']);
    assert.deepEqual(await labels(`?person=${sam.p.id}&film=${film.id}`), ['Handed back']);
    assert.deepEqual(await labels(`?ticket=${links.takenBack.id}`), ['Taken back']);
    assert.deepEqual(await labels(`?ticket=${links.takenBack.id}&live=1`), []);
    assert.deepEqual(await labels('?film=987654321'), []);
    const everything = await loans();
    assert.ok(everything.length >= 5);
    assert.deepEqual(everything.map((l) => l.takenAt), everything.map((l) => l.takenAt).sort((x, y) => y - x), 'newest first');
    assert.deepEqual((await loans('?live=1')).map((l) => l.live), (await loans('?live=1')).map(() => true));
    // A filter that isn't one is refused, not ignored: an ignored one would list every loan.
    for (const query of ['?film=abc', '?person=1.5', '?ticket=-1', '?live=yes', '?film=1&film=2', '?film=0', '?film[]=1', '?film[id]=1', '?films=1', '?live=1&who=sam']) {
      assert.equal((await admin.get(`/api/admin/loans${query}`)).status, 400, query);
    }
  });
});

// ====================================================================== otherLinks
describe('otherLinks: what a take-back would cancel with the tape, and what it would leave', () => {
  test('from a member: their other links for the film that never lent go; links anyone can use that their browsers hold are named and stay', async () => {
    const film = await ownFilm('who-other-links');
    const elsewhere = await ownFilm('who-other-links-elsewhere');
    const sam = await member('Other Sam');
    const jo = await member('Other Jo');
    const laptop = await sam.device();
    const lends = await issue(film, { personId: sam.p.id, label: 'Lends' });
    const second = await issue(film, { personId: sam.p.id, label: 'Sam’s second' });
    const held = await issue(film, { label: 'Anyone’s, in Sam’s laptop' });
    await opened(held, laptop);
    const strangers = await issue(film, { label: 'Anyone’s, in a stranger’s browser' });
    await opened(strangers);
    // Nor one in another member's browser, nor one in a browser Sam has signed out of.
    await opened(await issue(film, { label: 'Anyone’s, in Jo’s phone' }), jo.phone);
    const signedOut = await sam.device();
    await opened(await issue(film, { label: 'Anyone’s, in a browser Sam signed out of' }), signedOut);
    assert.equal((await signedOut.post('/api/signout')).status, 200);
    const cancelled = await issue(film, { personId: sam.p.id, label: 'Sam’s, cancelled' });
    await ok(admin.post(`/api/admin/tickets/${cancelled.id}/revoke`));
    await issue(film, { personId: jo.p.id, label: 'Jo’s' });
    await issue(elsewhere, { personId: sam.p.id, label: 'Sam’s, for another film' });
    // A link anyone can use that Sam's phone holds, and whose start-by date has passed: it can't lend.
    const pastHeld = await issue(film, { label: 'Anyone’s, start-by missed', startBy: Date.now() - HOUR });
    await opened(pastHeld, sam.phone);

    // Sam plays: the older of their own two links lends (question 9).
    await play(sam.phone, film);
    // One of Sam's own that had missed its start-by before the tape went out: it never lent, so it goes too.
    const missed = await issue(film, { personId: sam.p.id, label: 'Sam’s, start-by missed', startBy: Date.now() - DAY });
    const loan = await loanOn(lends);
    assert.equal(loan.live, true);
    assert.deepEqual(loan.otherLinks, [
      { id: second.id, label: 'Sam’s second', kind: 'person', linkState: 'waiting', cancelledToo: true },
      { id: missed.id, label: 'Sam’s, start-by missed', kind: 'person', linkState: 'missed', cancelledToo: true },
      { id: held.id, label: 'Anyone’s, in Sam’s laptop', kind: 'anyone', linkState: 'waiting', cancelledToo: false },
    ]);
    // The same on the film, on the link, on the member's page and in the list.
    assert.deepEqual((await adminFilm(film)).tape.loan.otherLinks, loan.otherLinks);
    assert.deepEqual((await adminLink(lends)).loan.otherLinks, loan.otherLinks);
    assert.deepEqual((await ok(admin.get(`/api/admin/people/${sam.p.id}`))).loans[0].otherLinks, loan.otherLinks);
    assert.deepEqual((await loans('?live=1')).find((l) => l.id === loan.id).otherLinks, loan.otherLinks);

    // Taking it back cancels exactly the ones it said, and leaves the rest.
    const taken = await ok(admin.post(`/api/admin/loans/${loan.id}/take-back`, { ticketId: lends.id }));
    assert.deepEqual(taken.alsoCancelled, loan.otherLinks.filter((l) => l.cancelledToo).map((l) => l.id));
    assert.deepEqual([(await adminLink(second)).linkState, (await adminLink(missed)).linkState, (await adminLink(held)).linkState], ['cancelled', 'cancelled', 'opened']);
    assert.deepEqual(taken.loan.otherLinks, [], 'a loan that is over has none');
    // The one that stayed is what Sam's laptop shows now, with the tape in.
    assert.equal((await page(laptop, film)).ticket.tape, 'in');
  });

  test('from a browser: nobody’s links go unless a member is signed in there, and then theirs do (question 16)', async () => {
    // Not signed in: another link anyone can use, held by the same browser, is named and stays.
    const film = await ownFilm('who-other-browser');
    // A link this browser borrowed on before and returned: it has lent, and can't again.
    const lentBefore = await issue(film, { label: 'Lent before, in that browser' });
    const tv = await opened(lentBefore);
    const earlier = await play(tv, film);
    assert.equal((await giveBack(tv, film, earlier.takenAt)).status, 200);
    const lends = await issue(film, { label: 'Lends' });
    const also = await issue(film, { label: 'Also in that browser' });
    const elsewhere = await issue(film, { label: 'In another browser' });
    await opened(lends, tv);
    await opened(also, tv);
    await opened(elsewhere);
    await play(tv, film);
    const loan = await loanOn(lends);
    assert.equal((await adminLink(lentBefore)).linkState, 'done');
    assert.deepEqual(loan.otherLinks, [{ id: also.id, label: 'Also in that browser', kind: 'anyone', linkState: 'waiting', cancelledToo: false }], 'only the one that could still lend');
    assert.deepEqual((await ok(admin.post(`/api/admin/loans/${loan.id}/take-back`, { ticketId: lends.id }))).alsoCancelled, []);

    // Signed in: that member's own never-lent links for the film go with it.
    const second = await ownFilm('who-other-signed-in');
    const sam = await member('Signed-in Sam');
    const forAnyone = await issue(second, { label: 'For anyone' });
    await opened(forAnyone, sam.phone);
    await play(sam.phone, second);
    // (Sent after Play: with their own link there before, Play would have taken that one.)
    const own = await issue(second, { personId: sam.p.id, label: 'Sam’s own' });
    const signedIn = await loanOn(forAnyone);
    assert.equal(signedIn.borrower.kind, 'browser');
    assert.deepEqual(signedIn.otherLinks, [{ id: own.id, label: 'Sam’s own', kind: 'person', linkState: 'waiting', cancelledToo: true }]);
    assert.deepEqual((await ok(admin.post(`/api/admin/loans/${signedIn.id}/take-back`, { ticketId: forAnyone.id }))).alsoCancelled, [own.id]);
  });
});

// ====================================================================== a link
describe('a link, for the owner: where it stands, its loan and its days', () => {
  test('linkState names every row of the state table, and the list, the link’s page and the answer to sending agree', async () => {
    const film = await ownFilm('who-states');
    const states = async (...tickets) => {
      const out = [];
      for (const t of tickets) {
        const [one, listed] = [await adminLink(t), await listedLink(t)];
        assert.deepEqual([listed.linkState, listed.loan, listed.loanDays], [one.linkState, one.loan, one.loanDays]);
        out.push(one.linkState);
      }
      return out;
    };
    const a = await issue(film, { label: 'A', loanDays: 7 });
    const b = await issue(film, { label: 'B' });
    assert.deepEqual([a.linkState, a.loan, a.loanDays, b.loanDays], ['unopened', null, 7, null], 'as sent: its own days, or null for the shop’s');
    const missed = await issue(film, { label: 'Missed', startBy: Date.now() - HOUR });
    const cancelled = await issue(film, { label: 'Cancelled' });
    await ok(admin.post(`/api/admin/tickets/${cancelled.id}/revoke`));
    assert.deepEqual(await states(a, b, missed, cancelled), ['unopened', 'unopened', 'missed', 'cancelled']);

    const first = await opened(a);
    assert.deepEqual(await states(a, b), ['opened', 'unopened']);
    const played = await play(first, film);
    assert.deepEqual(await states(a, b, missed, cancelled), ['has', 'waiting', 'missed', 'cancelled']);
    // The link's loan, as /api/admin/loans gives it; a link that never lent has none.
    const has = await adminLink(a);
    assert.deepEqual(has.loan, await loanOn(a));
    assert.deepEqual([has.loan.live, has.loan.dueAt, (await adminLink(b)).loan], [true, played.takenAt + 7 * DAY, null]);
    // 1.1.0's fields went in slice 10, once its pages had been rebuilt: the loan says
    // when it's due, and which play is its own.
    for (const old of ['state', 'expiresAt', 'openScreening', 'screeningsUsed', 'screeningsLeft', 'screeningLimit', 'daysAfterFirstPlay']) assert.ok(!(old in has), old);
    assert.equal(has.loan.screeningId, played.screeningId);

    // The film's own state comes first, as in the table; a cancelled link stays cancelled.
    sql("UPDATE films SET media_status = 'missing' WHERE id = ?", film.id);
    assert.deepEqual(await states(a, b, missed, cancelled), ['unavailable', 'unavailable', 'unavailable', 'cancelled']);
    assert.equal((await adminLink(a)).loan.live, true, 'and the loan goes on');
    sql("UPDATE films SET media_status = 'ok' WHERE id = ?", film.id);
    await ok(admin.patch(`/api/admin/films/${film.id}`, { published: false }));
    assert.deepEqual(await states(a, b, missed, cancelled), ['off', 'off', 'off', 'cancelled']);
    await ok(admin.patch(`/api/admin/films/${film.id}`, { published: true }));

    assert.equal((await giveBack(first, film, played.takenAt)).status, 200);
    assert.deepEqual(await states(a, b), ['done', 'unopened']);
    const done = await adminLink(a);
    // (1.x's state said 'used_up'; linkState says done, above.)
    assert.deepEqual([done.loan.live, done.loan.endedHow, done.linkState], [false, 'returned', 'done']);

    // Taken back: cancelled, and its loan says how.
    const second = await opened(b);
    await play(second, film);
    await ok(admin.post(`/api/admin/tickets/${b.id}/revoke`));
    const tookBack = await adminLink(b);
    assert.deepEqual([tookBack.linkState, tookBack.loan.endedHow, tookBack.loan.live], ['cancelled', 'taken-back', false]);
  });

  test('loanDays is the link’s own, null for the shop’s default: sent back as it came, it changes nothing', async () => {
    const film = await ownFilm('who-loan-days');
    const plain = await issue(film, { label: 'Default' });
    const five = await issue(film, { label: 'Five', loanDays: 5 });
    assert.deepEqual([plain.loanDays, five.loanDays], [null, 5]);
    // The shop's default changes: the link that follows it still says null, not the number.
    await ok(admin.patch('/api/admin/settings', { loanDays: 9 }));
    try {
      assert.deepEqual([(await adminLink(plain)).loanDays, (await adminLink(five)).loanDays], [null, 5]);
      const b = await opened(five);
      const played = await play(b, film);
      // A form may send every field with each save: the days as given move nothing.
      const saved = await ok(admin.patch(`/api/admin/tickets/${five.id}`, { label: 'Five, renamed', loanDays: (await adminLink(five)).loanDays }));
      assert.deepEqual([saved.label, saved.loanDays, saved.loan.dueAt], ['Five, renamed', 5, played.takenAt + 5 * DAY]);
      // Changed, the date moves, and the link's loan says so.
      const moved = await ok(admin.patch(`/api/admin/tickets/${five.id}`, { loanDays: 6 }));
      assert.deepEqual([moved.loanDays, moved.loan.dueAt, moved.linkState], [6, played.takenAt + 6 * DAY, 'has']);
    } finally {
      await ok(admin.patch('/api/admin/settings', { loanDays: 3 }));
    }
  });
});

// ====================================================================== members
describe('Members: the tapes each has out, and their loans', () => {
  test('the list has tapesOut, the soonest due first, and liveLinks; a member’s page has their loans', async () => {
    const [a, b, c] = [await ownFilm('who-member-a'), await ownFilm('who-member-b'), await ownFilm('who-member-c')];
    const sam = await member('Member Sam');
    const jo = await member('Member Jo');
    const links = {
      a: await issue(a, { personId: sam.p.id, loanDays: 2 }),
      b: await issue(b, { personId: sam.p.id, loanDays: 6 }),
      c: await issue(c, { personId: sam.p.id }),
      spare: await issue(a, { personId: sam.p.id, label: 'A second for the same film' }),
    };
    const listed = async (m) => (await ok(admin.get('/api/admin/people'))).find((p) => p.id === m.p.id);
    const detail = (m) => ok(admin.get(`/api/admin/people/${m.p.id}`));
    assert.deepEqual([(await listed(sam)).tapesOut, (await listed(sam)).liveLinks, (await detail(sam)).loans], [[], 4, []]);
    assert.deepEqual([(await listed(jo)).tapesOut, (await listed(jo)).liveLinks], [[], 0]);

    const first = await play(sam.phone, a);
    const second = await play(sam.phone, b);
    // Taken later and due later: newest first and soonest due first are not the same order.
    const tapesOut = [{ film: filmOf(a), dueAt: first.takenAt + 2 * DAY }, { film: filmOf(b), dueAt: second.takenAt + 6 * DAY }];
    assert.deepEqual((await listed(sam)).tapesOut, tapesOut, 'the soonest due back first');
    assert.equal((await listed(sam)).liveLinks, 4, 'two have the tape, two could still take one');
    const card = await detail(sam);
    assert.deepEqual([card.tapesOut, card.liveLinks], [tapesOut, 4]);
    assert.deepEqual(card.loans, await loans(`?person=${sam.p.id}`));
    assert.deepEqual(card.loans.map((l) => [l.film.slug, l.live, l.ticket.id]), [[b.slug, true, links.b.id], [a.slug, true, links.a.id]], 'newest first');
    assert.deepEqual((await listed(jo)).tapesOut, [], 'and nobody else’s');

    // A tape Jo takes on a link anyone can use, signed in, is that browser's loan: not on Jo's list.
    const forAnyone = await issue(c, { label: 'For anyone' });
    await opened(forAnyone, jo.phone);
    await play(jo.phone, c);
    assert.equal((await loanOn(forAnyone)).borrower.signedInAs.id, jo.p.id);
    assert.deepEqual([(await listed(jo)).tapesOut, (await listed(jo)).liveLinks, (await detail(jo)).loans], [[], 0, []]);

    // Returned: off the list, still among their loans, and its link no longer live.
    assert.equal((await giveBack(sam.phone, b, second.takenAt)).status, 200);
    assert.deepEqual([(await listed(sam)).tapesOut, (await listed(sam)).liveLinks], [[tapesOut[0]], 3]);
    assert.deepEqual((await detail(sam)).loans.map((l) => [l.film.slug, l.live, l.endedHow]), [[b.slug, false, 'returned'], [a.slug, true, null]]);
    // Their card turned off: nothing out.
    await ok(admin.post(`/api/admin/people/${sam.p.id}/disable`));
    assert.deepEqual((await listed(sam)).tapesOut, []);
    assert.deepEqual((await detail(sam)).loans.map((l) => l.endedHow), ['returned', 'disabled']);
  });
});

// ====================================================================== Status
describe('Status: tapes out, and the sweeper', () => {
  test('attention.tapes counts the tapes out and names the next due back; server.sweeper says when it last ran', async () => {
    const start = (await booth()).attention.tapes;
    assert.deepEqual(Object.keys(start), ['out', 'next']);
    const [soon, later] = [await ownFilm('who-status-soon'), await ownFilm('who-status-later')];
    const a = await opened(await issue(later, { loanDays: 30 }));
    await play(a, later);
    const link = await issue(soon, { loanDays: 1 });
    const b = await opened(link);
    const played = await play(b, soon);
    // Sooner than any tape another test left out: an hour from now.
    const loan = await loanOn(link);
    sql('UPDATE loans SET taken_at = ?, due_at = ? WHERE id = ?', played.takenAt - DAY + HOUR, played.takenAt + HOUR, loan.id);
    let { tapes } = (await booth()).attention;
    assert.deepEqual(tapes, { out: start.out + 2, next: { film: filmOf(soon), dueAt: played.takenAt + HOUR } });

    // Past due, with nothing written: not counted, and reading Status writes nothing.
    sql('UPDATE loans SET taken_at = ?, due_at = ? WHERE id = ?', played.takenAt - 2 * DAY, played.takenAt - DAY, loan.id);
    ({ tapes } = (await booth()).attention);
    assert.equal(tapes.out, start.out + 1);
    assert.notEqual(tapes.next.film.id, soon.id);
    assert.equal(row('loans', loan.id).ended_at, null);

    // The sweeper: nothing since the server started, until it runs.
    const { sweeper } = (await booth()).server;
    assert.deepEqual(Object.keys(sweeper), ['lastRun', 'lastError']);
    assert.equal(sweeper.lastError, null);
    const at = Date.now();
    const closed = srv.app.locals.access.sweep(at);
    assert.ok(closed >= 1);
    assert.deepEqual((await booth()).server.sweeper, { lastRun: { at, closed }, lastError: null });
    assert.equal(row('loans', loan.id).ended_how, 'due');
    assert.equal((await booth()).attention.tapes.out, start.out + 1, 'the same count, written or not');
  });
});

// ====================================================================== the owner's preview
describe('access.tape: the owner’s preview of a film page says who has the tape', () => {
  test('in the owner’s browser only: who, since when and until when; for every viewer there is no such key', async () => {
    const film = await ownFilm('who-preview');
    await ok(admin.patch(`/api/admin/films/${film.id}`, { memberVisible: true }));
    const preview = async (b = admin) => (await page(b, film)).tape;
    assert.deepEqual(await preview(), { out: false, borrower: null, takenAt: null, dueAt: null });

    const sam = await member('Preview Sam');
    const link = await issue(film, { personId: sam.p.id, loanDays: 2 });
    const waiting = await issue(film);
    const holder = await opened(waiting);
    const shelf = await member('Preview Shelf');
    const played = await play(sam.phone, film);
    const tape = { out: true, borrower: { kind: 'person', person: personOf(sam) }, takenAt: played.takenAt, dueAt: played.takenAt + 2 * DAY };
    assert.deepEqual(await preview(), tape);
    const mine = await page(admin, film);
    assert.deepEqual([mine.preview, mine.via, mine.ticket, mine.canPlay], [true, 'admin', null, true], 'a preview, as before');
    assert.equal((await loanOn(link)).takenAt, played.takenAt);

    // Every viewer: the borrower, a browser with a link that waits, a member with no link.
    for (const [who, b] of [['the borrower', sam.phone], ['another link', holder], ['a member with no link', shelf.phone]]) {
      const access = await page(b, film);
      assert.ok(!('tape' in access), `${who} is sent access.tape`);
      assert.deepEqual(Object.keys(access).sort(), ['canKeep', 'canPlay', 'mediaStatus', 'preview', 'published', 'ticket', 'ticketKept', 'via'], who);
    }
    assert.equal((await fresh().get(`/api/films/${film.slug}`)).status, 404);

    // The owner's browser, also signed in as the borrower: still the owner's preview.
    const both = await adminBrowser(srv.base);
    await sam.device(both);
    assert.deepEqual(await preview(both), tape);
    // Signed out of the back office, it is the borrower's own page again: no such key.
    await both.post('/api/admin/logout');
    const asBorrower = await page(both, film);
    assert.ok(!('tape' in asBorrower));
    assert.deepEqual([asBorrower.via, asBorrower.ticket.tape], ['ticket', 'yours']);

    // Off the shelf, the owner's preview still says who has it.
    await ok(admin.patch(`/api/admin/films/${film.id}`, { published: false }));
    assert.deepEqual(await preview(), tape);
    await ok(admin.patch(`/api/admin/films/${film.id}`, { published: true }));
    // Back: nobody has it.
    assert.equal((await giveBack(sam.phone, film, played.takenAt)).status, 200);
    assert.deepEqual(await preview(), { out: false, borrower: null, takenAt: null, dueAt: null });

    // To a browser on a link anyone can use: its device.
    const b = await opened(waiting, fresh(EDGE));
    const again = await play(b, film);
    assert.deepEqual(await preview(), { out: true, borrower: { kind: 'browser', device: DEVICES[EDGE], signedInAs: null }, takenAt: again.takenAt, dueAt: again.takenAt + 3 * DAY });
  });
});

// ====================================================================== the front page
describe('/api/me: what this browser has out comes first', () => {
  test('yours first, the soonest due back first; then the rest, newest first as before', async () => {
    const films = [];
    for (const n of [1, 2, 3, 4]) films.push(await ownFilm(`who-me-${n}`));
    const b = fresh();
    // Opened in this order: 1, 2, 3, 4. Newest first is 4, 3, 2, 1.
    const days = [9, 2, 5, 3];
    for (const [i, film] of films.entries()) {
      const link = await issue(film, { loanDays: days[i] });
      await opened(link, b);
      // A minute apart, so "newest first" has one answer.
      sql('UPDATE session_tickets SET added_at = ? WHERE ticket_id = ?', Date.now() - (10 - i) * MINUTE, link.id);
    }
    const order = async () => (await me(b)).tickets.map((x) => [x.film.slug, x.ticket.tape]);
    assert.deepEqual(await order(), [['who-me-4', 'in'], ['who-me-3', 'in'], ['who-me-2', 'in'], ['who-me-1', 'in']]);

    await play(b, films[0]);
    assert.deepEqual(await order(), [['who-me-1', 'yours'], ['who-me-4', 'in'], ['who-me-3', 'in'], ['who-me-2', 'in']]);
    const third = await play(b, films[2]);
    await play(b, films[1]);
    // Due in 2, 5 and 9 days.
    assert.deepEqual(await order(), [['who-me-2', 'yours'], ['who-me-3', 'yours'], ['who-me-1', 'yours'], ['who-me-4', 'in']]);
    const mine = (await me(b)).tickets;
    assert.deepEqual(mine.map((x) => x.ticket.dueBack), [...mine.slice(0, 3).map((x) => x.ticket.dueBack).sort((x, y) => x - y), null]);

    // Somebody else's tape moves nothing: film 4 goes out to another browser on another link.
    const other = await opened(await issue(films[3]));
    await play(other, films[3]);
    assert.deepEqual(await order(), [['who-me-2', 'yours'], ['who-me-3', 'yours'], ['who-me-1', 'yours'], ['who-me-4', 'out']]);
    // Returned, a tape is no longer first.
    assert.equal((await giveBack(b, films[2], third.takenAt)).status, 200);
    assert.deepEqual(await order(), [['who-me-2', 'yours'], ['who-me-1', 'yours'], ['who-me-4', 'out'], ['who-me-3', null]]);
  });

  test('browserLoans: the titles this browser has out on links anyone can use, and nobody else’s', async () => {
    const [x, y, own] = [await ownFilm('who-bl-x', { title: 'Xanadu' }), await ownFilm('who-bl-y', { title: 'Yojimbo' }), await ownFilm('who-bl-own', { title: 'Own Link Film' })];
    const sam = await member('Loans Sam');
    await issue(own, { personId: sam.p.id });
    const lx = await issue(x, { loanDays: 5 });
    const ly = await issue(y, { loanDays: 2 });
    const watcher = await opened(lx);
    await opened(ly, watcher);
    assert.deepEqual((await me(sam.phone)).browserLoans, []);
    assert.deepEqual((await me(fresh())).browserLoans, [], 'a browser with no session has none');

    await opened(lx, sam.phone);
    await opened(ly, sam.phone);
    const px = await play(sam.phone, x);
    await play(sam.phone, y);
    await play(sam.phone, own);
    // The two it took on links for anyone, the soonest due first. Not the member's own
    // tape: that is theirs on every device, and signing out here doesn't send it back.
    assert.deepEqual((await me(sam.phone)).browserLoans, ['Yojimbo', 'Xanadu']);
    assert.deepEqual((await me(sam.phone)).tickets.map((t) => [t.film.title, t.ticket.loan.toBrowser]), [['Yojimbo', true], ['Own Link Film', false], ['Xanadu', true]]);
    // Another browser holding the same links, and the member's other device: none of them theirs.
    assert.deepEqual((await me(watcher)).browserLoans, []);
    assert.deepEqual((await me(await sam.device())).browserLoans, []);
    assert.deepEqual((await me(admin)).browserLoans, []);

    // A film off the shelf is no film at all: its title isn't named.
    await ok(admin.patch(`/api/admin/films/${y.id}`, { published: false }));
    assert.deepEqual((await me(sam.phone)).browserLoans, ['Xanadu']);
    await ok(admin.patch(`/api/admin/films/${y.id}`, { published: true }));
    // Returned, or past due: no longer out.
    assert.equal((await giveBack(sam.phone, x, px.takenAt)).status, 200);
    assert.deepEqual((await me(sam.phone)).browserLoans, ['Yojimbo']);
    age(await loanOn(ly), 3 * DAY);
    assert.deepEqual((await me(sam.phone)).browserLoans, []);
    // Signing out sends back what it named: nothing is left out for that browser.
    assert.deepEqual(Object.keys(await me(sam.phone)).sort(), ['admin', 'browserLoans', 'linkTickets', 'memberFilms', 'person', 'site', 'tickets']);
  });

  test('the members’ shelf: in or out, and the date it is due back (question 7)', async () => {
    const film = await ownFilm('who-shelf', { title: 'Shelf Film', year: 1971 });
    const quiet = await ownFilm('who-shelf-quiet', { title: 'Quiet Film' });
    for (const f of [film, quiet]) await ok(admin.patch(`/api/admin/films/${f.id}`, { memberVisible: true }));
    const reader = await member('Shelf Reader');
    const shelf = async (b = reader.phone) => (await me(b)).memberFilms.filter((f) => f.slug.startsWith('who-shelf'));
    const entry = (f, tape, dueBack) => ({ slug: f.slug, title: f.title, year: f.year, runtimeMinutes: f.runtimeMinutes, directors: f.directors, posterUrl: f.posterUrl, tape, dueBack });
    assert.deepEqual(await shelf(), [entry(film, 'in', null), entry(quiet, 'in', null)].sort((a, b) => a.title.localeCompare(b.title)));

    const link = await issue(film, { loanDays: 4 });
    const b = await opened(link, fresh(EDGE));
    const played = await play(b, film);
    const out = (await shelf()).find((f) => f.slug === film.slug);
    assert.deepEqual(out, entry(film, 'out', played.takenAt + 4 * DAY));
    assert.deepEqual((await shelf()).find((f) => f.slug === quiet.slug), entry(quiet, 'in', null), 'only the film that is out');
    // Listed, never played: the page is as it was, with nothing of the tape.
    const listing = await page(reader.phone, film);
    assert.deepEqual(listing, { canPlay: false, via: 'member', ticket: null, preview: false, published: true, mediaStatus: listing.mediaStatus, canKeep: false, ticketKept: false });
    assert.deepEqual(answer(await reader.phone.post(`/api/films/${film.slug}/screenings`)), [409, { error: 'no-ticket' }]);
    // Not signed in, there is no shelf.
    assert.deepEqual((await me(fresh())).memberFilms, []);
    assert.deepEqual((await me(b)).memberFilms, [], 'nor for the borrower’s own browser, which isn’t signed in');

    // The owner moves the date: the shelf follows. The film's files break: still out, the same date.
    await ok(admin.patch(`/api/admin/tickets/${link.id}`, { loanDays: 6 }));
    assert.deepEqual((await shelf()).find((f) => f.slug === film.slug), entry(film, 'out', played.takenAt + 6 * DAY));
    sql("UPDATE films SET media_status = 'error' WHERE id = ?", film.id);
    assert.deepEqual((await shelf()).find((f) => f.slug === film.slug), entry(film, 'out', played.takenAt + 6 * DAY));
    sql("UPDATE films SET media_status = 'ok' WHERE id = ?", film.id);
    // Past due, written down or not: in.
    age(await loanOn(link), 7 * DAY);
    assert.deepEqual((await shelf()).find((f) => f.slug === film.slug), entry(film, 'in', null));
    assert.equal(row('loans', (await loanOn(link)).id).ended_at, null);

    // A member with a link for the film has it among their links, not on the shelf.
    const sam = await member('Shelf Sam');
    await issue(film, { personId: sam.p.id });
    assert.deepEqual((await shelf(sam.phone)).map((f) => f.slug), [quiet.slug]);
    await play(sam.phone, film);
    assert.equal((await shelf()).find((f) => f.slug === film.slug).tape, 'out');
  });
});
