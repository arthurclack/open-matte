// Handing a tape back with a response: version 2, slice 4 (docs/version-2.md, "Picked
// for you, and responses"). Written from the plan, not the implementation, to its
// "done when": a response is refused from a browser's loan, from anyone but the
// borrower, twice, and after the tape came back on its own; the page's canRespond and
// the return route agree in every case; and no event holds a response's words. A
// signed-in friend can hand a tape back at any time while they have it, watched to the
// end or not (question 13, answer b). Then the back office's three routes: the list
// with its unread count, mark as read, and delete. What nobody but the owner may
// learn from a response is in test/never-who.test.js.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';
import { FILM_SECONDS, addFilm, adminBrowser, browser, enroll, newPerson, setupLink, signIn, startServer, tempDir } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const KINDS = ['loved-it', 'still-thinking', 'not-for-me', 'lets-talk'];
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// A shop of its own: the back office's suite counts every response in its shop.
async function shop() {
  const mediaDir = tempDir();
  const srv = await startServer({ mediaDir, limits: { scale: 100 } });
  const admin = await adminBrowser(srv.base);
  const s = { srv, admin, db: srv.db };
  s.ownFilm = (slug, overrides) => addFilm(admin, mediaDir, slug, overrides);
  s.issue = async (film, fields = {}) => {
    const r = await admin.post('/api/admin/tickets', { filmId: film.id, ...fields });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data[0];
  };
  s.opened = async (ticket, b = browser(srv.base)) => {
    const r = await b.post('/api/tickets/open', { code: ticket.code });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return b;
  };
  // A member signed in on their phone; device() signs another browser in as them.
  s.member = async (name) => {
    const p = await newPerson(admin, name);
    const auth = softAuthenticator();
    const phone = browser(srv.base);
    assert.equal((await enroll(phone, (await setupLink(admin, p.id)).token, { auth })).status, 200);
    const device = async (b = browser(srv.base)) => {
      assert.equal((await signIn(b, auth)).status, 200);
      return b;
    };
    return { p, phone, auth, device };
  };
  s.loanOf = (ticket) => {
    const row = srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(ticket.id);
    return row ? { ...row } : null;
  };
  s.responses = () => srv.db.prepare('SELECT * FROM responses ORDER BY id').all().map((r) => ({ ...r }));
  s.responseTo = (loan) => {
    const row = srv.db.prepare('SELECT * FROM responses WHERE loan_id = ?').get(loan.id);
    return row ? { ...row } : null;
  };
  s.returnedEvents = (ticket) =>
    srv.db.prepare("SELECT * FROM events WHERE ticket_id = ? AND type = 'returned' ORDER BY id").all(ticket.id).map((e) => ({ ...e, detail: JSON.parse(e.detail) }));
  // A member with a film of their own and the tape out on their own link.
  s.borrowed = async (slug, name) => {
    const film = await s.ownFilm(slug);
    const who = await s.member(name);
    const ticket = await s.issue(film, { personId: who.p.id });
    const took = await play(who.phone, film);
    assert.equal(took.status, 200, JSON.stringify(took.data));
    return { film, who, ticket, loan: s.loanOf(ticket), screeningId: took.data.screeningId };
  };
  return s;
}

const play = (b, film) => b.post(`/api/films/${film.slug}/screenings`);
const page = async (b, film) => (await b.get(`/api/films/${film.slug}`)).data.access?.ticket ?? null;
const giveBack = (b, film, body) => b.post(`/api/films/${film.slug}/return`, body);
const report = (b, id, body = { position: 5 }) => b.post(`/api/screenings/${id}/heartbeat`, body);
const answer = (r) => [r.status, r.data];
const master = (film) => `/media/${film.slug}/hls/master.m3u8`;

let s;
before(async () => {
  s = await shop();
});
after(() => s.srv.close());

// ====================================================================== handing it back
describe('Hand it back', () => {
  test('the member who borrowed it hands it back with a response, from any of their devices: the tape is in at once, the link is spent, and the owner has what they said', async () => {
    const { film, who: sam, ticket, loan, screeningId } = await s.borrowed('hand-back', 'Handback Sam');
    const other = await s.opened(await s.issue(film));
    const laptop = await sam.device();
    // Part-way through, on the phone. The laptop's page offers the hand-back all the same.
    assert.equal((await report(sam.phone, screeningId, { position: 20 })).status, 200);
    const mine = await page(laptop, film);
    assert.deepEqual(mine.loan, { takenAt: loan.taken_at, position: 20, finishedAt: null, toBrowser: false, canRespond: true });
    assert.equal((await page(other, film)).tape, 'out');

    const before = Date.now();
    const r = await giveBack(laptop, film, { takenAt: mine.loan.takenAt, response: 'not-for-me', message: '  Not my kind of thing, but thank you.\nThe ending, though.  ' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(Object.keys(r.data).sort(), ['responded', 'returned']);
    assert.equal(r.data.responded, true);
    const { at } = r.data.returned;
    assert.ok(at >= before && at <= Date.now());

    // The tape is back, as with Return it now.
    const ended = s.loanOf(ticket);
    assert.deepEqual([ended.ended_how, ended.ended_at], ['returned', at]);
    assert.deepEqual(answer(await report(sam.phone, screeningId, { position: 21 })), [409, { error: 'returned' }]);
    assert.equal((await sam.phone.get(master(film))).status, 403);
    for (const b of [sam.phone, laptop]) {
      const spent = await page(b, film);
      assert.deepEqual([spent.state, spent.tape, spent.loan, spent.returned], ['spent', null, null, { at, how: 'returned' }]);
    }
    assert.equal((await page(other, film)).tape, 'in', 'free at once');

    // What they said: one row, from the member, about this loan and this film, unread.
    assert.deepEqual(s.responseTo(loan), {
      id: s.responseTo(loan).id, loan_id: loan.id, person_id: sam.p.id, film_id: film.id,
      kind: 'not-for-me', message: 'Not my kind of thing, but thank you.\nThe ending, though.', created_at: at, read_at: null,
    });
    // The Ledger: returned, by the laptop, with a response. Never the words, nor which of the four.
    const [returned, ...more] = s.returnedEvents(ticket);
    assert.deepEqual(more, []);
    assert.deepEqual([returned.at, returned.session_hash, returned.person_id, returned.screening_id], [at, sha256(laptop.jar.get('om_session')), sam.p.id, loan.screening_id]);
    assert.deepEqual(returned.detail, { loanId: loan.id, how: 'returned', response: true });
    const everyEvent = JSON.stringify(s.db.prepare('SELECT * FROM events').all());
    for (const words of ['Not my kind', 'The ending', 'not-for-me']) assert.ok(!everyEvent.includes(words), words);
  });

  test('each of the four responses, with a message or with none; a message of nothing but spaces is none', async () => {
    const messages = ['Loved every minute.', undefined, null, '  \n ', 'm'.repeat(2000)];
    const kinds = [...KINDS, 'loved-it'];
    for (const [i, kind] of kinds.entries()) {
      const { film, who, loan } = await s.borrowed(`four-kinds-${i}`, `Kind ${i}`);
      const body = { takenAt: loan.taken_at, response: kind };
      if (messages[i] !== undefined) body.message = messages[i];
      const r = await giveBack(who.phone, film, body);
      assert.deepEqual([r.status, r.data.responded], [200, true], `${kind}: ${JSON.stringify(r.data)}`);
      const kept = s.responseTo(loan);
      assert.deepEqual([kept.kind, kept.message, kept.person_id, kept.film_id], [kind, typeof messages[i] === 'string' && messages[i].trim() ? messages[i].trim() : null, who.p.id, film.id]);
    }
    // A NUL has no place in words (SQLite would count a message that begins with one as
    // empty): it is dropped, and the response is kept, not answered with an error.
    for (const [i, [sent, kept]] of [['\0', null], ['\0After a NUL.', 'After a NUL.']].entries()) {
      const { film, who, loan } = await s.borrowed(`nul-message-${i}`, `Nul ${i}`);
      const r = await giveBack(who.phone, film, { takenAt: loan.taken_at, response: 'lets-talk', message: sent });
      assert.deepEqual([r.status, r.data.responded, s.responseTo(loan).message], [200, true, kept]);
    }
  });

  test('at any time while they have it: straight after Play, part-way, or watched to the end (question 13)', async () => {
    const moments = {
      'straight after Play': async () => {},
      'part-way': async (b, id) => assert.equal((await report(b, id, { position: 40, playing: false })).status, 200),
      'watched to the end': async (b, id) => assert.equal((await report(b, id, { position: FILM_SECONDS })).status, 200),
    };
    for (const [i, [when, watch]] of Object.entries(moments).entries()) {
      const { film, who, loan, screeningId } = await s.borrowed(`any-time-${i}`, `Anytime ${i}`);
      await watch(who.phone, screeningId);
      const mine = await page(who.phone, film);
      assert.equal(Boolean(mine.loan.finishedAt), when === 'watched to the end', when);
      assert.equal(mine.loan.canRespond, true, when);
      const r = await giveBack(who.phone, film, { takenAt: loan.taken_at, response: 'still-thinking' });
      assert.deepEqual([r.status, r.data.responded], [200, true], when);
      assert.equal(s.responseTo(loan).kind, 'still-thinking');
    }
  });

  test('Return it now says nothing: the tape comes back with no response, and none can follow', async () => {
    const { film, who, ticket, loan } = await s.borrowed('says-nothing', 'Silent Sam');
    const r = await giveBack(who.phone, film, { takenAt: loan.taken_at });
    assert.deepEqual([r.status, r.data.responded], [200, false]);
    assert.equal(s.responseTo(loan), null);
    assert.deepEqual(s.returnedEvents(ticket).map((e) => e.detail), [{ loanId: loan.id, how: 'returned', response: false }]);
    assert.deepEqual(answer(await giveBack(who.phone, film, { takenAt: loan.taken_at, response: 'loved-it' })), [409, { error: 'nothing-to-return' }]);
    assert.equal(s.responseTo(loan), null);
  });
});

// ====================================================================== refused
describe('a response is refused', () => {
  test('from a browser’s loan, on a link anyone can use, signed in or not: the borrower is told, the tape stays out, and nothing is kept', async () => {
    const film = await s.ownFilm('refused-browser');
    const filmToo = await s.ownFilm('refused-signed-in');
    const sam = await s.member('Signed-in Sam');
    const anonymous = await s.opened(await s.issue(film));
    // Sam is signed in when they press Play on a link anyone can use: the loan is the
    // browser's all the same (question 2), and that link may have been forwarded.
    const forAnyone = await s.issue(filmToo);
    await s.opened(forAnyone, sam.phone);
    const count = s.responses().length;

    for (const [b, f] of [[anonymous, film], [sam.phone, filmToo]]) {
      const took = await play(b, f);
      assert.deepEqual([took.status, took.data.toBrowser], [200, true]);
      const mine = await page(b, f);
      assert.equal(mine.loan.canRespond, false);
      const loan = { ...s.db.prepare('SELECT * FROM loans WHERE film_id = ?').get(f.id) };
      for (const body of [{ response: 'loved-it' }, { response: 'lets-talk', message: 'Call me.' }]) {
        assert.deepEqual(answer(await giveBack(b, f, { takenAt: mine.loan.takenAt, ...body })), [409, { error: 'cannot-respond' }]);
      }
      assert.deepEqual({ ...s.db.prepare('SELECT * FROM loans WHERE id = ?').get(loan.id) }, loan, 'the tape is still out, as it was');
      assert.equal((await page(b, f)).tape, 'yours');
      assert.equal((await report(b, took.data.screeningId)).status, 200, 'and still plays');
      assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM events WHERE film_id = ? AND type = 'returned'").get(f.id).n, 0);
      // Sam's other device, signed in as Sam and holding the same link, isn't the
      // borrower: the tape is that one browser's.
      if (b === sam.phone) {
        const laptop = await s.opened(forAnyone, await sam.device());
        assert.equal((await page(laptop, f)).loan, null);
        assert.deepEqual(answer(await giveBack(laptop, f, { takenAt: mine.loan.takenAt, response: 'loved-it' })), [409, { error: 'nothing-to-return' }]);
      }
      // It can still be returned, saying nothing.
      const r = await giveBack(b, f, { takenAt: mine.loan.takenAt });
      assert.deepEqual([r.status, r.data.responded], [200, false]);
    }
    assert.equal(s.responses().length, count, 'nothing was kept');
  });

  test('from anyone but the borrower: "nothing to return", with a response exactly as without one', async () => {
    const { film, who: sam, ticket, loan, screeningId } = await s.borrowed('refused-others', 'Borrower Sam');
    const jo = await s.member('Bystander Jo');
    await s.issue(film, { personId: jo.p.id });
    const waiting = await s.opened(await s.issue(film));
    const stranger = browser(s.srv.base);
    const count = s.responses().length;

    for (const [who, b] of [['a member with a link of their own that waits', jo.phone], ['a browser with a link that waits', waiting], ['a stranger', stranger], ['the owner’s own browser', s.admin]]) {
      for (const takenAt of [loan.taken_at, loan.taken_at + 1, 0]) {
        const without = await giveBack(b, film, { takenAt });
        const withOne = await giveBack(b, film, { takenAt, response: 'loved-it', message: 'Not mine to say.' });
        assert.deepEqual(answer(withOne), [409, { error: 'nothing-to-return' }], who);
        assert.deepEqual(answer(withOne), answer(without), who);
      }
    }
    assert.deepEqual(s.loanOf(ticket), loan, 'the borrower’s loan is as it was');
    assert.equal(s.responses().length, count);
    assert.equal((await report(sam.phone, screeningId)).status, 200);
    // The database itself refuses a response from anyone but the loan's member.
    assert.throws(
      () => s.db.prepare("INSERT INTO responses (loan_id, person_id, film_id, kind, created_at) VALUES (?, ?, ?, 'loved-it', ?)").run(loan.id, jo.p.id, film.id, Date.now()),
      /a response comes from the person who borrowed the tape/,
    );
  });

  test('twice: the second finds nothing to return, and what was said first stands; two at once, one is taken', async () => {
    const { film, who, ticket, loan } = await s.borrowed('refused-twice', 'Twice Sam');
    const first = await giveBack(who.phone, film, { takenAt: loan.taken_at, response: 'loved-it', message: 'The first word.' });
    assert.deepEqual([first.status, first.data.responded], [200, true]);
    const kept = s.responseTo(loan);

    for (const body of [{ response: 'not-for-me', message: 'A second thought.' }, { response: 'loved-it', message: 'The first word.' }, {}]) {
      assert.deepEqual(answer(await giveBack(who.phone, film, { takenAt: loan.taken_at, ...body })), [409, { error: 'nothing-to-return' }]);
    }
    assert.equal((await page(who.phone, film)).loan, null, 'the page offers no hand-back for a tape that is back');
    assert.deepEqual(s.responseTo(loan), kept);
    assert.equal(s.returnedEvents(ticket).length, 1);
    // And the database: one response for a loan, ever.
    assert.throws(
      () => s.db.prepare("INSERT INTO responses (loan_id, person_id, film_id, kind, created_at) VALUES (?, ?, ?, 'lets-talk', ?)").run(loan.id, who.p.id, film.id, Date.now()),
      /UNIQUE constraint failed/,
    );

    // Two devices press at the same moment.
    const again = await s.borrowed('refused-twice-at-once', 'Twice Jo');
    const laptop = await again.who.device();
    const both = await Promise.all([
      giveBack(again.who.phone, again.film, { takenAt: again.loan.taken_at, response: 'loved-it', message: 'From the phone.' }),
      giveBack(laptop, again.film, { takenAt: again.loan.taken_at, response: 'not-for-me', message: 'From the laptop.' }),
    ]);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
    assert.deepEqual(both.find((r) => r.status === 409).data, { error: 'nothing-to-return' });
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM responses WHERE loan_id = ?').get(again.loan.id).n, 1);
    assert.equal(s.returnedEvents(again.ticket).length, 1);
  });

  test('from a browser signed out between the route reading its session and the step: nothing to return, as Play takes nothing', async () => {
    // As a second process on the same file would: the route has read the session,
    // and the session is signed out before the step begins.
    const { film, who, ticket, loan } = await s.borrowed('signed-out-meanwhile', 'Meanwhile Sam');
    const viewer = { ...s.db.prepare("SELECT * FROM sessions WHERE person_id = ? AND kind = 'viewer'").get(who.p.id) };
    const row = { ...s.db.prepare('SELECT * FROM films WHERE id = ?').get(film.id) };
    s.db.prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ?').run(Date.now(), viewer.id_hash);
    const access = s.srv.app.locals.access;
    for (const body of [{ response: 'loved-it', message: 'Too late.' }, {}]) {
      assert.deepEqual(access.returnTape(viewer, row, { takenAt: loan.taken_at, ...body }), { error: 'nothing-to-return' });
    }
    assert.deepEqual(access.startScreening(viewer, row), { error: 'no-access' });
    assert.deepEqual([s.loanOf(ticket).ended_at, s.responseTo(loan), s.returnedEvents(ticket).length], [null, null, 0], 'the tape is still out, and nothing was said');
  });

  test('after the tape came back on its own: it was due, the owner took it back, or the member’s card was turned off', async () => {
    const count = s.responses().length;
    const said = { response: 'loved-it', message: 'Too late to say.' };

    // Due: the loan's time has run out, and nothing has written that down yet.
    const due = await s.borrowed('refused-due', 'Due Sam');
    s.db.prepare('UPDATE loans SET taken_at = taken_at - ?1, due_at = ?2 WHERE id = ?3').run(4 * DAY, Date.now() - 1000, due.loan.id);
    const dueLoan = s.loanOf(due.ticket);
    assert.deepEqual([(await page(due.who.phone, due.film)).state, (await page(due.who.phone, due.film)).loan], ['spent', null]);
    assert.deepEqual(answer(await giveBack(due.who.phone, due.film, { takenAt: dueLoan.taken_at, ...said })), [409, { error: 'nothing-to-return' }]);
    assert.deepEqual([s.loanOf(due.ticket).ended_how, s.loanOf(due.ticket).ended_at], ['due', dueLoan.due_at], 'it came back when it was due, not when they asked');
    assert.deepEqual(s.returnedEvents(due.ticket).map((e) => e.detail.response), [false]);

    // Taken back.
    const taken = await s.borrowed('refused-taken-back', 'Taken Sam');
    assert.equal((await s.admin.post(`/api/admin/loans/${taken.loan.id}/take-back`, { ticketId: taken.ticket.id })).status, 200);
    assert.equal(await page(taken.who.phone, taken.film), null);
    assert.deepEqual(answer(await giveBack(taken.who.phone, taken.film, { takenAt: taken.loan.taken_at, ...said })), [409, { error: 'nothing-to-return' }]);
    assert.equal(s.loanOf(taken.ticket).ended_how, 'taken-back');

    // The card turned off, and on again: the loan stays ended, and there is nothing to say it to.
    const off = await s.borrowed('refused-card-off', 'Disabled Sam');
    assert.equal((await s.admin.post(`/api/admin/people/${off.who.p.id}/disable`)).status, 200);
    assert.deepEqual(answer(await giveBack(off.who.phone, off.film, { takenAt: off.loan.taken_at, ...said })), [409, { error: 'nothing-to-return' }]);
    assert.equal((await s.admin.post(`/api/admin/people/${off.who.p.id}/enable`)).status, 200);
    const back = await off.who.device();
    assert.deepEqual([(await page(back, off.film)).state, (await page(back, off.film)).loan], ['spent', null]);
    assert.deepEqual(answer(await giveBack(back, off.film, { takenAt: off.loan.taken_at, ...said })), [409, { error: 'nothing-to-return' }]);
    assert.equal(s.loanOf(off.ticket).ended_how, 'disabled');

    assert.equal(s.responses().length, count, 'none of them was kept');
    assert.ok(!JSON.stringify(s.db.prepare('SELECT * FROM events').all()).includes('Too late to say.'));
  });

  test('while the film is off the shelf the borrower can’t return it, with a response or without; back on the shelf, they can', async () => {
    const { film, who, ticket, loan } = await s.borrowed('refused-off-shelf', 'Shelf Sam');
    assert.equal((await s.admin.patch(`/api/admin/films/${film.id}`, { published: false })).status, 200);
    assert.equal(await page(who.phone, film), null);
    for (const body of [{}, { response: 'loved-it' }]) assert.deepEqual(answer(await giveBack(who.phone, film, { takenAt: loan.taken_at, ...body })), [409, { error: 'nothing-to-return' }]);
    assert.deepEqual(s.loanOf(ticket), loan, 'nothing ended: the clock runs');
    assert.equal(s.responseTo(loan), null);

    assert.equal((await s.admin.patch(`/api/admin/films/${film.id}`, { published: true })).status, 200);
    assert.equal((await page(who.phone, film)).loan.canRespond, true);
    assert.deepEqual((await giveBack(who.phone, film, { takenAt: loan.taken_at, response: 'loved-it' })).data.responded, true);
  });
});

// ====================================================================== the page and the route
describe('the page’s canRespond and the return route agree', () => {
  // Each case: who asks, about which film, and what the plan says they can do. The
  // page is read first; then the same browser hands the tape back with a response,
  // sending the loan's own takenAt whether or not its page was given it.
  const cases = {
    'a member, on their own link, playing': async () => {
      const x = await s.borrowed('agree-playing', 'Agree One');
      return { b: x.who.phone, ...x, can: true };
    },
    'that member’s other device, which never played': async () => {
      const x = await s.borrowed('agree-second-device', 'Agree Two');
      return { b: await x.who.device(), ...x, can: true };
    },
    'a member, with the film’s files broken': async () => {
      const x = await s.borrowed('agree-broken', 'Agree Three');
      s.db.prepare("UPDATE films SET media_status = 'missing' WHERE id = ?").run(x.film.id);
      return { b: x.who.phone, ...x, can: true };
    },
    'a member, a minute before the tape is due': async () => {
      const x = await s.borrowed('agree-nearly-due', 'Agree Four');
      s.db.prepare('UPDATE loans SET taken_at = taken_at - ?1, due_at = ?2 WHERE id = ?3').run(2 * DAY, Date.now() + 60 * 1000, x.loan.id);
      return { b: x.who.phone, ...x, loan: s.loanOf(x.ticket), can: true };
    },
    'a browser, on a link anyone can use': async () => {
      const film = await s.ownFilm('agree-browser');
      const ticket = await s.issue(film);
      const b = await s.opened(ticket);
      assert.equal((await play(b, film)).status, 200);
      return { b, film, ticket, loan: s.loanOf(ticket), can: false, refusal: 'cannot-respond' };
    },
    'a member signed in, on a link anyone can use': async () => {
      const film = await s.ownFilm('agree-signed-in');
      const who = await s.member('Agree Five');
      const ticket = await s.issue(film);
      await s.opened(ticket, who.phone);
      assert.equal((await play(who.phone, film)).status, 200);
      return { b: who.phone, film, ticket, loan: s.loanOf(ticket), can: false, refusal: 'cannot-respond' };
    },
    'a member signed in, on a link anyone can use, who also has a link of their own for the film': async () => {
      const film = await s.ownFilm('agree-both-links');
      const who = await s.member('Agree Six');
      const ticket = await s.issue(film);
      await s.opened(ticket, who.phone);
      assert.equal((await play(who.phone, film)).status, 200);
      await s.issue(film, { personId: who.p.id });
      return { b: who.phone, film, ticket, loan: s.loanOf(ticket), can: false, refusal: 'cannot-respond' };
    },
    'another browser on the link anyone can use that lent': async () => {
      const film = await s.ownFilm('agree-same-link');
      const ticket = await s.issue(film);
      assert.equal((await play(await s.opened(ticket), film)).status, 200);
      return { b: await s.opened(ticket), film, ticket, loan: s.loanOf(ticket), can: false, refusal: 'nothing-to-return' };
    },
    'a member whose own link waits while another member has the tape': async () => {
      const x = await s.borrowed('agree-waiting', 'Agree Seven');
      const other = await s.member('Agree Eight');
      await s.issue(x.film, { personId: other.p.id });
      return { b: other.phone, ...x, can: false, refusal: 'nothing-to-return' };
    },
    'a member whose tape is in: they never pressed Play': async () => {
      const film = await s.ownFilm('agree-in');
      const who = await s.member('Agree Nine');
      const ticket = await s.issue(film, { personId: who.p.id });
      return { b: who.phone, film, ticket, loan: { taken_at: Date.now() }, can: false, refusal: 'nothing-to-return' };
    },
    'a member whose tape came due': async () => {
      const x = await s.borrowed('agree-due', 'Agree Ten');
      s.db.prepare('UPDATE loans SET taken_at = taken_at - ?1, due_at = ?2 WHERE id = ?3').run(4 * DAY, Date.now() - 1, x.loan.id);
      return { b: x.who.phone, ...x, loan: s.loanOf(x.ticket), can: false, refusal: 'nothing-to-return' };
    },
    'a member who has returned it already': async () => {
      const x = await s.borrowed('agree-returned', 'Agree Eleven');
      assert.equal((await giveBack(x.who.phone, x.film, { takenAt: x.loan.taken_at })).status, 200);
      return { b: x.who.phone, ...x, can: false, refusal: 'nothing-to-return' };
    },
    'a member whose film went off the shelf': async () => {
      const x = await s.borrowed('agree-off-shelf', 'Agree Twelve');
      assert.equal((await s.admin.patch(`/api/admin/films/${x.film.id}`, { published: false })).status, 200);
      return { b: x.who.phone, ...x, can: false, refusal: 'nothing-to-return' };
    },
    'the owner, previewing a film whose tape a member has': async () => {
      const x = await s.borrowed('agree-preview', 'Agree Thirteen');
      return { b: s.admin, ...x, can: false, refusal: 'nothing-to-return' };
    },
    // The owner's browser shows every film as a preview, which never takes a tape and
    // offers nothing to hand back: also when that browser is signed in as the member
    // who has the tape. They hand it back on a device that shows them their own page.
    'the owner’s browser, signed in as the member who has the tape as well': async () => {
      const x = await s.borrowed('agree-owner-and-member', 'Agree Fourteen');
      const both = await x.who.device(await adminBrowser(s.srv.base));
      assert.equal((await both.get(`/api/films/${x.film.slug}`)).data.access.preview, true);
      return { b: both, ...x, can: false, refusal: 'nothing-to-return' };
    },
  };

  for (const [name, setUp] of Object.entries(cases)) {
    test(name, async () => {
      const c = await setUp();
      const offered = Boolean((await page(c.b, c.film))?.loan?.canRespond);
      const before = s.responses().length;
      const r = await giveBack(c.b, c.film, { takenAt: c.loan.taken_at, response: 'still-thinking', message: `Said by ${name}.` });
      const taken = r.status === 200;
      assert.equal(offered, taken, `the page said ${offered}, the route answered ${r.status} ${JSON.stringify(r.data)}`);
      assert.equal(offered, c.can, 'and both are what the plan says');
      assert.equal(s.responses().length, before + (c.can ? 1 : 0));
      if (c.can) assert.deepEqual([r.data.responded, s.responses().at(-1).message], [true, `Said by ${name}.`]);
      else assert.deepEqual(answer(r), [409, { error: c.refusal }]);
    });
  }
});

// ====================================================================== the back office
describe('the back office’s responses', () => {
  let o;
  let made;
  // Three responses in a shop of its own, a moment apart: the oldest first.
  before(async () => {
    o = await shop();
    made = [];
    for (const [i, [kind, message]] of [['loved-it', 'The first, and the oldest.'], ['lets-talk', null], ['not-for-me', 'The third, and the newest.']].entries()) {
      const x = await o.borrowed(`office-${i}`, `Office Member ${i}`);
      const r = await giveBack(x.who.phone, x.film, message ? { takenAt: x.loan.taken_at, response: kind, message } : { takenAt: x.loan.taken_at, response: kind });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      made.push({ ...x, kind, message, at: r.data.returned.at, id: o.responseTo(x.loan).id });
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
  });
  after(() => o.srv.close());
  const list = async () => (await o.admin.get('/api/admin/responses')).data;

  test('the list: newest first, each with who said it, about which film, and the loan it came with; and how many are unread', async () => {
    const r = await o.admin.get('/api/admin/responses');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.data).sort(), ['responses', 'unread']);
    assert.equal(r.data.unread, 3);
    const newestFirst = made.toReversed();
    assert.deepEqual(
      r.data.responses,
      newestFirst.map((m) => ({
        id: m.id,
        kind: m.kind,
        message: m.message,
        createdAt: m.at,
        readAt: null,
        person: { id: m.who.p.id, name: m.who.p.name, disabled: false },
        film: { id: m.film.id, slug: m.film.slug, title: m.film.title },
        loan: { takenAt: m.loan.taken_at, dueAt: m.loan.due_at, endedAt: m.at },
      })),
    );
    // A member whose card has been turned off since is still named.
    assert.equal((await o.admin.post(`/api/admin/people/${made[0].who.p.id}/disable`)).status, 200);
    assert.deepEqual((await list()).responses.at(-1).person, { id: made[0].who.p.id, name: made[0].who.p.name, disabled: true });
    assert.equal((await o.admin.post(`/api/admin/people/${made[0].who.p.id}/enable`)).status, 200);
  });

  test('mark as read: the count goes down once, and the first time stands', async () => {
    const before = Date.now();
    const r = await o.admin.post(`/api/admin/responses/${made[1].id}/read`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(Object.keys(r.data).sort(), ['response', 'unread']);
    assert.equal(r.data.unread, 2);
    const { readAt } = r.data.response;
    assert.ok(readAt >= before && readAt <= Date.now());
    assert.deepEqual([r.data.response.id, r.data.response.kind, r.data.response.film.slug], [made[1].id, 'lets-talk', made[1].film.slug]);

    await new Promise((resolve) => setTimeout(resolve, 3));
    const again = await o.admin.post(`/api/admin/responses/${made[1].id}/read`);
    assert.deepEqual([again.status, again.data.unread, again.data.response.readAt], [200, 2, readAt]);
    const now = await list();
    assert.equal(now.unread, 2);
    assert.deepEqual(now.responses.map((x) => [x.id, x.readAt]), [[made[2].id, null], [made[1].id, readAt], [made[0].id, null]]);
    // Nothing else of it moved.
    assert.deepEqual({ ...o.db.prepare('SELECT * FROM responses WHERE id = ?').get(made[1].id) }, { id: made[1].id, loan_id: made[1].loan.id, person_id: made[1].who.p.id, film_id: made[1].film.id, kind: 'lets-talk', message: null, created_at: made[1].at, read_at: readAt });
    // No such response.
    for (const id of [987654, 0, 'abc', '1e3']) assert.equal((await o.admin.post(`/api/admin/responses/${id}/read`)).status, 404, String(id));
    assert.equal((await list()).unread, 2);
  });

  test('delete: gone for good; the loan and its line in the Ledger stay, and the borrower can’t say it again', async () => {
    const m = made[2];
    // Like every call that changes something, a DELETE is sent as JSON.
    const bare = await o.admin.send('DELETE', `/api/admin/responses/${m.id}`);
    assert.deepEqual([bare.status, bare.data], [415, { error: 'json-required' }]);
    assert.equal((await list()).responses.length, 3);

    const r = await o.admin.send('DELETE', `/api/admin/responses/${m.id}`, {});
    assert.deepEqual([r.status, r.data], [200, { deleted: m.id, unread: 1 }]);
    const now = await list();
    assert.deepEqual([now.unread, now.responses.map((x) => x.id)], [1, [made[1].id, made[0].id]]);
    assert.equal(o.responseTo(m.loan), null);
    assert.ok(!JSON.stringify(o.db.prepare('SELECT * FROM responses').all()).includes('The third, and the newest.'));

    // The loan is as it ended, and the Ledger still says a response came with it.
    assert.deepEqual([o.loanOf(m.ticket).ended_how, o.loanOf(m.ticket).ended_at], ['returned', m.at]);
    assert.deepEqual(o.returnedEvents(m.ticket).map((e) => e.detail), [{ loanId: m.loan.id, how: 'returned', response: true }]);
    assert.equal((await page(m.who.phone, m.film)).state, 'spent');
    assert.deepEqual(answer(await giveBack(m.who.phone, m.film, { takenAt: m.loan.taken_at, response: 'loved-it', message: 'Once more.' })), [409, { error: 'nothing-to-return' }]);
    assert.equal(o.responseTo(m.loan), null);
    // Twice, or one that never was.
    for (const id of [m.id, 987654, 'abc']) assert.equal((await o.admin.send('DELETE', `/api/admin/responses/${id}`, {})).status, 404, String(id));
    assert.equal((await list()).responses.length, 2);
  });

  test('for the owner alone: a friend, signed in or not, gets nothing from any of the three, and changes nothing', async () => {
    const before = o.responses();
    const friend = made[0].who.phone;
    const stranger = browser(o.srv.base);
    for (const b of [friend, stranger]) {
      for (const r of [
        await b.get('/api/admin/responses'),
        await b.post(`/api/admin/responses/${made[0].id}/read`),
        await b.send('DELETE', `/api/admin/responses/${made[0].id}`, {}),
      ]) {
        assert.deepEqual([r.status, r.data], [401, { error: 'not-signed-in' }]);
      }
    }
    assert.deepEqual(o.responses(), before);
    // Nothing a friend can ask holds a word of what they, or anyone, said.
    for (const url of ['/api/me', '/api/account', `/api/films/${made[0].film.slug}`, '/api/site']) {
      const text = JSON.stringify((await friend.get(url)).data);
      assert.ok(!text.includes('The first, and the oldest.') && !/"kind"|loved-it|"responded"/.test(text), url);
    }
  });

  test('the Ledger and the clean-up: no event holds a response’s words, and deleting old events and sessions leaves every response as it was', async () => {
    const events = JSON.stringify(o.db.prepare('SELECT * FROM events').all());
    const sent = JSON.stringify((await o.admin.get('/api/admin/activity?limit=1000&heartbeats=1')).data);
    for (const words of ['The first, and the oldest.', 'The third, and the newest.', ...KINDS]) assert.ok(!events.includes(words) && !sent.includes(words), words);
    const loansOnly = (await o.admin.get('/api/admin/activity?kind=loans')).data.events.filter((e) => e.type === 'returned');
    assert.deepEqual(loansOnly.map((e) => e.detail.response), [true, true, true], 'that a response came is in the Ledger, under loans');

    const before = o.responses();
    assert.equal(before.length, 2);
    const run = o.srv.app.locals.retention.run(Date.now() + 800 * DAY);
    assert.ok(run.events > 0, JSON.stringify(run));
    assert.equal(o.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0);
    assert.deepEqual(o.responses(), before);
    // (The clean-up took the owner's old session with the rest: they sign in again.)
    const after = (await (await adminBrowser(o.srv.base)).get('/api/admin/responses')).data;
    assert.deepEqual([after.unread, after.responses.map((x) => [x.id, x.message, x.person.name])], [1, [[made[1].id, null, made[1].who.p.name], [made[0].id, 'The first, and the oldest.', made[0].who.p.name]]]);
  });
});
