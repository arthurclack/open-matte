// Start-by while the tape is out: version 2, slice 6 (docs/version-2.md, "Start-by
// while the tape is out"). Nobody can press Play on a link while the film's one tape
// is with someone else, so that time is given back to a link's start-by date.
//
// A table of loans and deadlines in, dates out, written from the plan and not from
// the implementation: a link that has been played has no start-by; otherwise start
// from the date as it was set and go through the film's loans on other links in the
// order they were taken, leaving out the ended ones the upgrade made. Each one the
// link began to wait for before the date as it then stands pushes the date back by
// the time the tape was out since the link was made: to the loan's end, or to now
// while it is still out, so the time left stands still.
//
// Then the same rule told another way, hour by hour, against a few hundred shops
// made at random: an hour with the tape out on another link, begun before the date as
// it then stands, moves the date an hour.
//
// The rows are written straight into a database of the test's own, in memory, and
// the clock is passed in: no test there waits, and none presses Play.
//
// Last, over HTTP, where the date is used: the friend's film page and front page (the
// date the link goes by, and never a date while the tape is out), the back office's
// link (the date as it was set beside the date it goes by, and whether its time
// stands still), the counts of a film's and a member's links, and Play in the time
// given back. The Status list is in test/booth.test.js, and that the date tells
// nobody who had the tape in test/never-who.test.js.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';

const { addFilm, adminBrowser, browser, enroll, makeFilm, newPerson, setupLink, startServer, tempDir } = await import('./helpers.js');
const { createAccess, startByMayMove } = await import('../server/access.js');
const { openDb } = await import('../server/db.js');
const { createSettings } = await import('../server/settings.js');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Every time in the table is in hours from here: a Monday morning.
const BASE = Date.UTC(2026, 10, 2, 9);
const at = (hours) => (hours == null ? null : BASE + hours * HOUR);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const db = openDb(':memory:');
const access = createAccess(db, createSettings(db));
after(() => db.close());

const q = {
  film: db.prepare("INSERT INTO films (slug, title, published, media_status, media, created_at, updated_at) VALUES (?, ?, 1, 'ok', '{}', 0, 0)"),
  ticket: db.prepare('INSERT INTO tickets (code, film_id, person_id, start_by, first_played_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  person: db.prepare('INSERT INTO people (name, webauthn_user_id, disabled_at, created_at) VALUES (?, ?, ?, 0)'),
  session: db.prepare("INSERT INTO sessions (id_hash, kind, device, created_at, last_seen_at, expires_at, revoked_at) VALUES (?, 'viewer', 'Safari on Mac', 0, 0, ?, ?)"),
  screening: db.prepare('INSERT INTO screenings (ticket_id, film_id, session_hash, started_at, resumable_until, last_heartbeat_at, active_until) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  loan: db.prepare('INSERT INTO loans (film_id, ticket_id, screening_id, person_id, session_hash, device, taken_at, due_at, ended_at, ended_how) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  row: db.prepare('SELECT * FROM tickets WHERE id = ?'),
};

// One film with one link, and the times its tape went out. Hours throughout.
//   link   { made = 0, startBy = 100, played }: `played` is first_played_at;
//   loans  { taken, ended, how = 'returned', days = 3 }: on a link of its own, unless
//          `own` (this link's loan) or `otherFilm`. Left without `ended`, it is out:
//          to a browser, unless `member`. `signedOutAt` and `cardOffAt` are when its
//          borrower stopped being able to play, with nothing written on the loan.
let made = 0;
function shop({ link = {}, loans = [] }) {
  const n = ++made;
  const film = Number(q.film.run(`film-${n}`, `Film ${n}`).lastInsertRowid);
  const other = Number(q.film.run(`film-${n}-other`, `Other film ${n}`).lastInsertRowid);
  const ticket = Number(q.ticket.run(`link-${n}`, film, null, at(link.startBy === undefined ? 100 : link.startBy), at(link.played), at(link.made ?? 0)).lastInsertRowid);
  for (const [i, l] of loans.entries()) {
    const on = l.otherFilm ? other : film;
    let person = null;
    if (l.member) person = Number(q.person.run(`Member ${n}.${i}`, `user-${n}-${i}`, at(l.cardOffAt)).lastInsertRowid);
    const hash = sha256(`browser-${n}-${i}`);
    q.session.run(hash, BASE + 3650 * DAY, at(l.signedOutAt));
    const lender = l.own ? ticket : Number(q.ticket.run(`link-${n}-lender-${i}`, on, person, null, at(l.taken), at(Math.min(l.taken, 0) - 1)).lastInsertRowid);
    const due = at(l.taken) + (l.days ?? 3) * DAY;
    const screening = Number(q.screening.run(lender, on, hash, at(l.taken), due, at(l.taken), at(l.taken)).lastInsertRowid);
    q.loan.run(on, lender, screening, person, hash, 'Safari on Mac', at(l.taken), due, at(l.ended), l.ended == null ? null : l.how ?? 'returned');
  }
  return () => ({ ...q.row.get(ticket) });
}

// [now, the date expected, the link's state expected (left out where the table's
// rows were written after `now`, so only the date can be asked)]
const TABLE = [
  {
    name: 'no start-by date: none, whatever the tape did',
    link: { startBy: null },
    loans: [{ taken: 10, ended: 40 }],
    asks: [[50, null, 'in'], [5000, null, 'in']],
  },
  {
    name: 'the tape never went out: the date as it was set',
    asks: [[50, 100, 'in'], [99, 100, 'in'], [100, 100, 'expired'], [5000, 100, 'expired']],
  },
  {
    name: 'out for 30 hours and back before the date: 30 hours later',
    loans: [{ taken: 20, ended: 50 }],
    asks: [[60, 130, 'in'], [129, 130, 'in'], [130, 130, 'expired']],
  },
  {
    name: 'the date passes while the tape is out: the link waits, the time left stands still, and it has that time once the tape is due',
    loans: [{ taken: 90, days: 5 }],
    asks: [[95, 105, 'waiting'], [100, 110, 'waiting'], [150, 160, 'waiting'], [209, 219, 'waiting'], [210, 220, 'in'], [219, 220, 'in'], [220, 220, 'expired']],
  },
  {
    name: 'the same loan with its end written down: the same dates',
    loans: [{ taken: 90, days: 5, ended: 210, how: 'due' }],
    asks: [[210, 220, 'in'], [219, 220, 'in'], [220, 220, 'expired']],
  },
  {
    name: 'taken an hour before the date: an hour left when it is back',
    loans: [{ taken: 99, ended: 150 }],
    asks: [[150, 151, 'in'], [151, 151, 'expired']],
  },
  {
    name: 'taken at the very moment of the date: nothing back',
    loans: [{ taken: 100, ended: 150 }],
    asks: [[160, 100, 'expired']],
  },
  {
    name: 'taken after the date had passed, and still out: nothing back, and the link is missed while the tape is out',
    loans: [{ taken: 110, days: 5 }],
    asks: [[120, 100, 'expired'], [200, 100, 'expired']],
  },
  {
    name: 'taken after the date had passed, and back: nothing back',
    loans: [{ taken: 110, ended: 130 }],
    asks: [[140, 100, 'expired']],
  },
  {
    name: 'several loans: each pushes the date the next is held to, and one taken after the date as it then stands gives nothing',
    //       100 + 30 = 130;        + 10 = 140;             125 < 140: + 15 = 155;    160 >= 155: nothing
    loans: [{ taken: 20, ended: 50 }, { taken: 60, ended: 70 }, { taken: 125, ended: 140 }, { taken: 160, ended: 170 }],
    asks: [[150, 155, 'in'], [155, 155, 'expired'], [200, 155, 'expired']],
  },
  {
    name: 'a loan taken after the date as it was set, but before the date as an earlier loan left it, counts',
    //       100 + 70 = 170;        150 < 170: + 10 = 180
    loans: [{ taken: 20, ended: 90 }, { taken: 150, ended: 160 }],
    asks: [[165, 180, 'in'], [180, 180, 'expired']],
  },
  {
    name: 'earlier loans, and one still out that was taken before the date as they left it: waiting',
    //       100 + 30 = 130;        120 < 130: out since 120
    loans: [{ taken: 20, ended: 50 }, { taken: 120, days: 5 }],
    asks: [[125, 135, 'waiting'], [200, 210, 'waiting'], [240, 250, 'in'], [250, 250, 'expired']],
  },
  {
    name: 'earlier loans, and one still out that was taken after the date as they left it: missed',
    loans: [{ taken: 20, ended: 50 }, { taken: 135, days: 5 }],
    asks: [[140, 130, 'expired']],
  },
  {
    name: 'a loan that began before the link was sent and came back after: only the time since the link was made',
    loans: [{ taken: -30, ended: 20 }],
    asks: [[30, 120, 'in'], [120, 120, 'expired']],
  },
  {
    name: 'a loan that began before the link was sent and is still out: the time left when it was sent stands still',
    loans: [{ taken: -30, days: 30 }],
    asks: [[1, 101, 'waiting'], [50, 150, 'waiting'], [400, 500, 'waiting']],
  },
  {
    name: 'a loan that was back before the link was sent: nothing',
    loans: [{ taken: -50, ended: -10 }],
    asks: [[10, 100, 'in']],
  },
  {
    name: 'a link sent with its date already past while the tape is out: missed from the start, and its date never moves',
    link: { startBy: -5 },
    loans: [{ taken: -30, days: 30 }],
    asks: [[1, -5, 'expired'], [50, -5, 'expired'], [400, -5, 'expired']],
  },
  {
    name: 'a link sent with its date at that very moment, the tape out: missed at once',
    link: { startBy: 0 },
    loans: [{ taken: -10, days: 30 }],
    asks: [[5, 0, 'expired']],
  },
  {
    name: 'a link sent while the tape is out, with its date ahead: it waits from when it was sent',
    link: { made: 40, startBy: 60 },
    loans: [{ taken: 10, days: 30 }],
    asks: [[45, 65, 'waiting'], [70, 90, 'waiting'], [300, 320, 'waiting']],
  },
  {
    name: 'the link’s own loan: a link that has been played has no start-by',
    link: { played: 20 },
    loans: [{ taken: 20, ended: 50, own: true }],
    asks: [[60, null, 'spent'], [5000, null, 'spent']],
  },
  {
    name: 'the link’s own loan gives it nothing back, even on a row no screen can make (lent, yet never played)',
    loans: [{ taken: 20, ended: 50, own: true }],
    asks: [[60, 100, 'spent']],
  },
  {
    name: 'a link first played in 1.x, with no loan: it met its date then, and has none',
    link: { played: 5 },
    loans: [{ taken: 20, ended: 50 }],
    asks: [[60, null, 'in'], [5000, null, 'in']],
  },
  {
    name: 'the ended loans the upgrade made for links 1.x had used up are left out',
    loans: [{ taken: 20, ended: 50, how: 'before-2.0' }, { taken: 60, ended: 65, how: 'before-2.0' }],
    asks: [[70, 100, 'in'], [100, 100, 'expired']],
  },
  {
    name: 'a loan the upgrade made that was still out then counts, like any other',
    loans: [{ taken: 20, ended: 50, how: 'before-2.0' }, { taken: 60, ended: 65, how: 'due' }],
    asks: [[70, 105, 'in']],
  },
  {
    name: 'another film’s tape is another film’s',
    loans: [{ taken: 20, ended: 50, otherFilm: true }, { taken: 60, days: 5, otherFilm: true }],
    asks: [[70, 100, 'in'], [100, 100, 'expired']],
  },
  {
    name: 'an end the clock hasn’t reached counts only as far as now',
    loans: [{ taken: 20, ended: 80 }],
    asks: [[50, 130], [79, 159], [80, 160, 'in'], [90, 160, 'in']],
  },
  {
    name: 'a loan the clock hasn’t reached counts for nothing yet',
    loans: [{ taken: 60, ended: 70 }],
    asks: [[40, 100], [60, 100], [61, 101]],
  },
  {
    name: 'over with no end written, because it was due: back when it was due, as closeStale will write',
    //       due at 20 + 72 = 92: out for 72 hours
    loans: [{ taken: 20, days: 3 }],
    asks: [[91, 171, 'waiting'], [92, 172, 'in'], [150, 172, 'in'], [172, 172, 'expired']],
  },
  {
    name: 'over with no end written, because its browser signed out at hour 60: back at that moment',
    loans: [{ taken: 20, days: 5, signedOutAt: 60 }],
    asks: [[60, 140, 'in'], [61, 140, 'in'], [139, 140, 'in'], [140, 140, 'expired']],
  },
  {
    name: 'over with no end written, a member’s whose card was turned off at hour 70: back at that moment',
    loans: [{ taken: 20, days: 5, member: true, cardOffAt: 70 }],
    asks: [[80, 150, 'in'], [150, 150, 'expired']],
  },
  {
    name: 'out to a member, on their own link: as out to a browser',
    loans: [{ taken: 90, days: 5, member: true }],
    asks: [[150, 160, 'waiting'], [210, 220, 'in']],
  },
  {
    name: 'two loans whose times overlap (a clock that stepped back): no hour is given back twice',
    //       20 to 60 and 40 to 80 are 60 hours out, not 80
    loans: [{ taken: 20, ended: 60 }, { taken: 40, ended: 80 }],
    asks: [[90, 160, 'in'], [160, 160, 'expired']],
  },
  {
    name: 'a loan wholly inside another’s time gives nothing more',
    loans: [{ taken: 20, ended: 80 }, { taken: 30, ended: 40 }],
    asks: [[90, 160, 'in']],
  },
  {
    name: 'of the loans taken before the link was sent, only the last can have been out then: an earlier one whose end reads later (a clock that stepped back) gives nothing',
    // One tape: the second was taken after the first came back, whatever the clock said.
    loans: [{ taken: -40, ended: 30 }, { taken: -20, ended: -10 }],
    asks: [[50, 100, 'in']],
  },
  {
    name: 'a long history before the link was sent, and one loan since: only the one since',
    loans: [...Array.from({ length: 40 }, (_, i) => ({ taken: -2000 + i * 40, ended: -1990 + i * 40 })), { taken: 30, ended: 45 }],
    asks: [[60, 115, 'in']],
  },
];

describe('effectiveStartBy: loans and deadlines in, dates out', () => {
  for (const row of TABLE) {
    test(row.name, () => {
      const ticket = shop(row);
      for (const [now, date, state] of row.asks) {
        const status = access.ticketStatus(ticket(), at(now));
        const hours = (ms) => (ms == null ? null : (ms - BASE) / HOUR);
        assert.equal(hours(access.effectiveStartBy(ticket(), at(now))), date, `the date, asked at hour ${now}`);
        assert.equal(hours(status.startBy), date, `ticketStatus gives the same date, asked at hour ${now}`);
        if (state) assert.equal(status.state, state, `the link’s state at hour ${now}`);
        // "Paused" is for the back office: the date is still ahead and the tape is out on another link.
        if (state) assert.equal(access.startByPaused(status, at(now)), state === 'waiting' && date != null, `paused, at hour ${now}`);
      }
    });
  }

  test('reading the date writes nothing: not the end of a loan that is over, and no event', () => {
    const count = () => [db.prepare('SELECT COUNT(*) AS n FROM loans WHERE ended_at IS NULL').get().n, db.prepare('SELECT COUNT(*) AS n FROM events').get().n];
    const ticket = shop({ loans: [{ taken: 20, days: 3 }] });
    const before = count();
    assert.equal(access.effectiveStartBy(ticket(), at(500)), at(172));
    assert.equal(access.ticketStatus(ticket(), at(500)).state, 'expired');
    assert.deepEqual(count(), before);
    // Once the sweeper has written the end down, the date is the one that was read.
    assert.ok(access.sweep(at(500)) >= 1);
    assert.equal(access.effectiveStartBy(ticket(), at(500)), at(172));
  });

  test('a link that waits is never missed while the tape is out, however long that is; a missed link’s date never moves', () => {
    const waits = shop({ loans: [{ taken: 99, days: 30 }] });
    const missed = shop({ loans: [{ taken: 100, days: 30 }] });
    for (let hour = 100; hour < 99 + 30 * 24; hour += 7) {
      assert.equal(access.effectiveStartBy(waits(), at(hour)), at(hour + 1), `an hour left, at hour ${hour}`);
      assert.equal(access.ticketStatus(waits(), at(hour)).state, 'waiting');
      assert.equal(access.effectiveStartBy(missed(), at(hour)), at(100));
      assert.equal(access.ticketStatus(missed(), at(hour)).state, 'expired');
    }
  });
});

// The same rule, hour by hour. From the hour the link was made to now: an hour with
// the tape out on another link (not one of the upgrade's ended loans), begun before
// the date as it then stands, moves the date an hour. Every time here is a whole hour.
// Of the loans taken before the link was made, only the last can have been out then.
function hourByHour({ link, loans }, now) {
  if (link.startBy == null || link.played != null) return null;
  let date = link.startBy;
  const others = loans.filter((l) => !l.own && !l.otherFilm && l.how !== 'before-2.0');
  const counted = [...others.filter((l) => l.taken < link.made).slice(-1), ...others.filter((l) => l.taken >= link.made)];
  const out = (h) => counted.some((l) => l.taken <= h && h + 1 <= (l.ended ?? Infinity));
  for (let h = link.made; h < now; h++) if (h < date && out(h)) date++;
  return date;
}

describe('effectiveStartBy, against the same rule told hour by hour', () => {
  // A generator with a seed, so a failure can be run again.
  function random(seed) {
    let s = seed;
    return (n) => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return Math.floor((s / 2 ** 32) * n);
    };
  }

  test('400 shops made at random: links sent before, during and after loans, dates ahead and past, a tape still out', () => {
    // The test Status and the counts of links use to read no loans for a link
    // (startByMayMove) must never say so of one whose date has moved; and a read
    // through many links (startByReader) gives every link the same date.
    const mayMove = db.prepare(`SELECT ${startByMayMove(':now')} AS may FROM tickets t WHERE t.id = :id`);
    let unmoved = 0;
    const pick = random(20261112);
    for (let n = 0; n < 400; n++) {
      const link = { made: pick(60) - 20, startBy: pick(8) === 0 ? null : pick(220) - 20, played: pick(12) === 0 ? pick(40) : undefined };
      const now = pick(420) - 10;
      const loans = [];
      let t = pick(80) - 60;
      const count = pick(7);
      for (let i = 0; i < count; i++) {
        const length = 1 + pick(60);
        const last = i === count - 1;
        // The last may still be out; one in eight is the upgrade's; one in ten begins
        // before the one before it ended (a clock that stepped back).
        const live = last && pick(3) === 0;
        loans.push({ taken: t, ended: live ? undefined : t + length, days: live ? 30 : 3, how: !live && pick(8) === 0 ? 'before-2.0' : 'returned' });
        t += pick(10) === 0 ? pick(length) : length + pick(50);
      }
      // A loan still out must be live by the one test at `now`: due after it.
      const open = loans.find((l) => l.ended == null);
      if (open && open.taken + 30 * 24 <= now) open.ended = open.taken + 30 * 24;
      const ticket = shop({ link, loans });
      const expected = hourByHour({ link, loans }, now);
      const got = access.effectiveStartBy(ticket(), at(now));
      assert.equal(got == null ? null : (got - BASE) / HOUR, expected, `shop ${n}: ${JSON.stringify({ link, loans, now })}`);
      // And the state goes by that date: missed once it has passed, for a link that never lent.
      const { state } = access.ticketStatus(ticket(), at(now));
      if (expected != null) assert.equal(state === 'expired', expected <= now, `shop ${n}, state ${state}: ${JSON.stringify({ link, loans, now })}`);
      else assert.notEqual(state, 'expired', `shop ${n}`);
      assert.equal(access.startByReader(at(now))(ticket()), got, `shop ${n}, read with the film's other links`);
      if (expected == null) continue;
      const { may } = mayMove.get({ id: ticket().id, now: at(now) });
      if (expected !== link.startBy) assert.equal(may, 1, `shop ${n}: ${JSON.stringify({ link, loans, now })}`);
      else if (!may) unmoved++;
    }
    assert.ok(unmoved > 50, `no loans read for a link no loan could have moved: ${unmoved} times`);
  });
});

// ====================================================================== over HTTP
describe('the date a link goes by, where it is used', () => {
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

  const ownFilm = (slug) => addFilm(admin, mediaDir, slug, { title: `Film ${slug}` });
  async function ok(promise) {
    const r = await promise;
    assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
  const issue = async (film, fields = {}) => (await ok(admin.post('/api/admin/tickets', { filmId: film.id, ...fields })))[0];
  async function opened(ticket, b = browser(srv.base)) {
    await ok(b.post('/api/tickets/open', { code: ticket.code }));
    return b;
  }
  const sql = (text, ...args) => srv.db.prepare(text).run(...args);
  const loanOf = (ticket) => ({ ...srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(ticket.id) });
  const ticketRow = (ticket) => ({ ...srv.db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.id) });
  const adminLink = (ticket) => ok(admin.get(`/api/admin/tickets/${ticket.id}`));
  const listedLink = async (ticket) => (await ok(admin.get('/api/admin/tickets'))).find((t) => t.id === ticket.id);
  const dates = async (ticket) => {
    const [one, listed] = [await adminLink(ticket), await listedLink(ticket)];
    // (While the link's time stands still, the date it goes by moves with the clock:
    // the second answer's is the later one, by the moment between the two.)
    const moved = one.startByPaused ? listed.effectiveStartBy - one.effectiveStartBy : 0;
    assert.ok(moved >= 0 && moved < 5000, `the date moved ${moved} ms between two answers`);
    const keys = (t) => [t.linkState, t.startBy, t.effectiveStartBy - (t === listed ? moved : 0), t.startByPaused];
    assert.deepEqual(keys(listed), keys(one), 'the list of links says what the link’s own page says');
    return one;
  };
  const friendsLink = async (b, film) => (await ok(b.get(`/api/films/${film.slug}`))).access.ticket;
  const onFrontPage = async (b, film) => (await ok(b.get('/api/me'))).tickets.find((t) => t.film.slug === film.slug).ticket;
  const links = async (film) => {
    const [one, listed] = [(await ok(admin.get(`/api/admin/films/${film.id}`))).links, (await ok(admin.get('/api/admin/films'))).find((f) => f.id === film.id).links];
    assert.deepEqual(listed, one);
    return one;
  };
  // As the clock would have it some time on: the film's links were made, and its
  // loan taken and due, that much earlier.
  function age(film, by) {
    sql('UPDATE tickets SET created_at = created_at - ? WHERE film_id = ?', by, film.id);
    sql('UPDATE loans SET taken_at = taken_at - ?1, due_at = due_at - ?1 WHERE film_id = ?2', by, film.id);
  }

  test('a link whose date passes while the tape is out: the back office and the friend, while it is out and once it is back', async () => {
    const film = await ownFilm('date-given-back');
    const lends = await issue(film, { label: 'Lends', loanDays: 5 });
    const set = Date.now() + DAY;
    const dated = await issue(film, { label: 'Dated', startBy: set });
    assert.deepEqual([dated.startBy, dated.effectiveStartBy, dated.startByPaused, dated.linkState], [set, set, false, 'unopened'], 'as sent: the date it goes by is the date it was sent with');
    const friend = await opened(dated);
    const before = await friendsLink(friend, film);
    assert.deepEqual([before.state, before.tape, before.startBy], ['ok', 'in', set]);

    // The tape goes out on the other link. Two days on, the date as it was set was an hour ago.
    const borrower = await opened(lends);
    const played = await ok(borrower.post(`/api/films/${film.slug}/screenings`));
    age(film, 2 * DAY);
    const passed = Date.now() - HOUR;
    sql('UPDATE tickets SET start_by = ? WHERE id = ?', passed, dated.id);
    const taken = loanOf(lends).taken_at;
    assert.ok(taken < passed && passed < Date.now() && loanOf(lends).due_at > Date.now());

    // The back office: it waits, and its time stands still. The date it goes by is
    // the date as set plus the time the tape has been out so far, and moves with the clock.
    const [t0, waiting, t1] = [Date.now(), await dates(dated), Date.now()];
    // (1.x's state, 'ok' here, went in slice 10: linkState says it.)
    assert.deepEqual([waiting.linkState, waiting.state, waiting.startBy, waiting.startByPaused], ['waiting', undefined, passed, true]);
    assert.ok(waiting.effectiveStartBy >= passed + (t0 - taken) && waiting.effectiveStartBy <= passed + (t1 - taken), 'the date as set, and the time the tape has been out');
    assert.ok(waiting.effectiveStartBy > t1, 'so it is still ahead');
    assert.deepEqual(await links(film), { live: 2, waiting: 1, total: 2 }, 'both links are live: one has the tape, one waits');
    // The friend: out, the date the tape is due back, and nothing of a start-by.
    for (const read of [friendsLink, onFrontPage]) {
      const out = await read(friend, film);
      assert.deepEqual([out.state, out.tape, out.startBy, out.dueBack], ['out', 'out', null, loanOf(lends).due_at]);
    }
    assert.deepEqual((await friend.post(`/api/films/${film.slug}/screenings`)).data, { error: 'out' });

    // The tape comes back. The link has the time it was out, to the millisecond.
    assert.equal(taken, played.takenAt - 2 * DAY);
    const { returned } = await ok(borrower.post(`/api/films/${film.slug}/return`, { takenAt: taken }));
    const goesBy = passed + (returned.at - taken);
    assert.ok(Math.abs(goesBy - Date.now() - (2 * DAY - HOUR)) < 5000, 'two days less an hour ahead: what it had left when the tape went out');
    const back = await dates(dated);
    assert.deepEqual([back.linkState, back.startBy, back.effectiveStartBy, back.startByPaused], ['opened', passed, goesBy, false]);
    assert.deepEqual(await links(film), { live: 1, waiting: 1, total: 2 }, 'the link that lent is spent; the dated one can still lend');
    for (const read of [friendsLink, onFrontPage]) {
      const again = await read(friend, film);
      assert.deepEqual([again.state, again.tape, again.startBy, again.dueBack], ['ok', 'in', goesBy, null], 'the friend is told the date the link goes by');
    }
    const text = JSON.stringify([await ok(friend.get(`/api/films/${film.slug}`)), await ok(friend.get('/api/me'))]);
    for (const key of ['effectiveStartBy', 'startByPaused', 'startByAsSet', String(passed)]) assert.ok(!text.includes(key), `a friend’s answer holds ${key}`);

    // The film's files break: unavailable, and the tape still in for this link, by
    // the date it goes by (it could still lend), not the date as it was set.
    sql("UPDATE films SET media_status = 'error' WHERE id = ?", film.id);
    try {
      const broken = await friendsLink(friend, film);
      assert.deepEqual([broken.state, broken.tape, broken.startBy], ['unavailable', 'in', goesBy]);
      const office = await dates(dated);
      assert.deepEqual([office.linkState, office.effectiveStartBy], ['unavailable', goesBy]);
    } finally {
      sql("UPDATE films SET media_status = 'ok' WHERE id = ?", film.id);
    }

    // A form that sends the date back as it came changes nothing: the date it was
    // set to is its own key, apart from the date the link goes by.
    const saved = await ok(admin.patch(`/api/admin/tickets/${dated.id}`, { label: back.label, startBy: back.startBy }));
    assert.deepEqual([saved.startBy, saved.effectiveStartBy, ticketRow(dated).start_by], [passed, goesBy, passed]);

    // Play, in the time given back: it takes the tape, and from then the link has no start-by.
    const took = await ok(friend.post(`/api/films/${film.slug}/screenings`));
    assert.equal(took.took, true);
    const lent = await dates(dated);
    assert.deepEqual([lent.linkState, lent.startBy, lent.effectiveStartBy, lent.startByPaused], ['has', passed, null, false]);
    assert.equal((await friendsLink(friend, film)).startBy, null);
  });

  test('a link whose date had passed before the tape went out is missed, in or out, and its date stays as it was set', async () => {
    const film = await ownFilm('date-not-given-back');
    const lends = await issue(film, { label: 'Lends' });
    const missed = await issue(film, { label: 'Missed', startBy: Date.now() + HOUR });
    const friend = await opened(missed);
    // Three days on: the date passed two days ago, and only then does the tape go out.
    sql('UPDATE tickets SET created_at = created_at - ? WHERE film_id = ?', 3 * DAY, film.id);
    const set = Date.now() - 2 * DAY;
    sql('UPDATE tickets SET start_by = ? WHERE id = ?', set, missed.id);
    const said = async () => {
      const [office, page, front] = [await dates(missed), await friendsLink(friend, film), await onFrontPage(friend, film)];
      assert.deepEqual([page, (await friend.post(`/api/films/${film.slug}/screenings`)).data], [front, { error: 'expired' }]);
      // The back office's linkState, and no 1.x state beside it ('expired', until slice 10).
      return [office.linkState, office.state, office.startBy, office.effectiveStartBy, office.startByPaused, page.state, page.tape, page.startBy, page.dueBack];
    };
    const expected = ['missed', undefined, set, set, false, 'expired', null, set, null];
    assert.deepEqual(await said(), expected, 'with the tape in');
    const borrower = await opened(lends);
    const played = await ok(borrower.post(`/api/films/${film.slug}/screenings`));
    assert.deepEqual(await said(), expected, 'with the tape out: this link could not have lent');
    assert.deepEqual(await links(film), { live: 1, waiting: 0, total: 2 });
    // With the film's files broken while the tape is out: unavailable, and no tape
    // for this link, in or out: it is past its date, and could not lend.
    sql("UPDATE films SET media_status = 'error' WHERE id = ?", film.id);
    try {
      const broken = await friendsLink(friend, film);
      assert.deepEqual([broken.state, broken.tape, broken.startBy, broken.dueBack], ['unavailable', null, null, null]);
      assert.equal((await dates(missed)).linkState, 'unavailable');
    } finally {
      sql("UPDATE films SET media_status = 'ok' WHERE id = ?", film.id);
    }
    await ok(borrower.post(`/api/films/${film.slug}/return`, { takenAt: played.takenAt }));
    assert.deepEqual(await said(), expected, 'and with the tape back');
    assert.deepEqual(await links(film), { live: 0, waiting: 0, total: 2 });
  });

  test('the take-back’s confirmation names a link the borrower’s browser also holds that has its time back: it could still lend', async () => {
    const film = await ownFilm('date-held');
    const takes = await issue(film, { label: 'Takes the tape' });
    const held = await issue(film, { label: 'Held, with its time back', startBy: Date.now() + HOUR });
    const earlier = await issue(film, { label: 'An earlier loan' });
    // An earlier loan, on a link of its own: out for a day, and back. Two days on in
    // all, the held link's date as it was set passed an hour ago, with a day given back.
    const first = await opened(earlier);
    const played = await ok(first.post(`/api/films/${film.slug}/screenings`));
    age(film, 2 * DAY);
    const taken = loanOf(earlier).taken_at;
    assert.equal(taken, played.takenAt - 2 * DAY);
    await ok(first.post(`/api/films/${film.slug}/return`, { takenAt: taken }));
    sql('UPDATE loans SET ended_at = ? WHERE ticket_id = ?', taken + DAY, earlier.id);
    const set = Date.now() - HOUR;
    sql('UPDATE tickets SET start_by = ? WHERE id = ?', set, held.id);
    assert.deepEqual([(await dates(held)).linkState, (await dates(held)).effectiveStartBy], ['unopened', set + DAY]);

    // One browser holds both links. Play takes the older, and the other waits.
    const borrower = await opened(takes);
    await opened(held, borrower);
    await ok(borrower.post(`/api/films/${film.slug}/screenings`));
    assert.equal(loanOf(takes).session_hash != null && loanOf(held).id === undefined, true);
    const [loan] = (await ok(admin.get(`/api/admin/loans?live=1&film=${film.id}`))).loans;
    assert.deepEqual(loan.otherLinks, [{ id: held.id, label: 'Held, with its time back', kind: 'anyone', linkState: 'waiting', cancelledToo: false }]);
    // Taken back, that link is left alone, and the borrower's page shows it with the tape in.
    const took = await ok(admin.post(`/api/admin/loans/${loan.id}/take-back`, { ticketId: takes.id }));
    assert.deepEqual(took.alsoCancelled, []);
    const theirs = await friendsLink(borrower, film);
    assert.deepEqual([theirs.state, theirs.tape], ['ok', 'in']);
    assert.ok(theirs.startBy > Date.now() && theirs.startBy > set + DAY, 'with the time both loans were out given back');
  });

  test('a member’s own link with its time given back counts among their live links, and a second link of theirs waits while they have the tape', async () => {
    const film = await ownFilm('date-members');
    const p = await newPerson(admin, 'Dated Dora');
    const phone = browser(srv.base);
    assert.equal((await enroll(phone, (await setupLink(admin, p.id)).token, { auth: softAuthenticator() })).status, 200);
    const first = await issue(film, { personId: p.id, label: 'Dora’s first', loanDays: 5 });
    const second = await issue(film, { personId: p.id, label: 'Dora’s second', startBy: Date.now() + HOUR });
    const liveLinks = async () => (await ok(admin.get('/api/admin/people'))).find((m) => m.id === p.id).liveLinks;
    assert.equal(await liveLinks(), 2);
    // Play takes her older link (question 9). A day on, the second link's date has
    // passed with the tape out on her first: it waits, as anyone's would.
    const played = await ok(phone.post(`/api/films/${film.slug}/screenings`));
    assert.equal(loanOf(first).taken_at, played.takenAt);
    age(film, DAY);
    const set = Date.now() - HOUR;
    sql('UPDATE tickets SET start_by = ? WHERE id = ?', set, second.id);
    const waiting = await dates(second);
    assert.deepEqual([waiting.linkState, waiting.startByPaused, waiting.startBy], ['waiting', true, set]);
    assert.equal(await liveLinks(), 2);
    // She returns it. The second link has the time back, and is hers to play.
    const { returned } = await ok(phone.post(`/api/films/${film.slug}/return`, { takenAt: loanOf(first).taken_at }));
    const goesBy = set + (returned.at - loanOf(first).taken_at);
    const back = await dates(second);
    assert.deepEqual([back.linkState, back.effectiveStartBy, back.startByPaused], ['unopened', goesBy, false]);
    assert.equal(await liveLinks(), 1, 'the first is spent; the second could still lend');
    assert.deepEqual([(await friendsLink(phone, film)).state, (await friendsLink(phone, film)).startBy], ['ok', goesBy]);
  });
});

// ====================================================================== many links missed
describe('a shop with many links missed long ago', () => {
  // A missed link stays missed for good, so in a shop that has lent for years they
  // only grow in number. Status and the counts of a film's and a member's links tell
  // them apart without reading each one's loans: what they read stays the same however
  // many there are. Counted here by the statements the server runs for each request.
  const mediaDir = tempDir();
  const db = openDb(':memory:');
  let statements = 0;
  const prepare = db.prepare.bind(db);
  db.prepare = (text) => {
    const s = prepare(text);
    for (const m of ['get', 'all', 'run', 'iterate']) {
      const f = s[m].bind(s);
      s[m] = (...args) => {
        statements++;
        return f(...args);
      };
    }
    return s;
  };
  let srv;
  let admin;
  before(async () => {
    srv = await startServer({ mediaDir, db, limits: { scale: 100 } });
    admin = await adminBrowser(srv.base);
  });
  after(() => srv.close());

  test('Status, Films and Members read as much for 60 links missed long ago as for 20, and say the same of them', async () => {
    const film = await addFilm(admin, mediaDir, 'missed-many', { title: 'Missed many times' });
    const p = await newPerson(admin, 'Missing Mo');
    const now = Date.now();
    const ago = (days) => now - days * DAY;
    // Lent for a day now and then, a year ago and since, on links of their own.
    const sql = (text, ...args) => Number(db.prepare(text).run(...args).lastInsertRowid);
    sql("INSERT INTO sessions (id_hash, kind, device, created_at, last_seen_at, expires_at) VALUES ('missed-many', 'viewer', 'Safari on Mac', 0, 0, ?)", ago(300));
    for (const d of [400, 300, 200, 100, 30]) {
      const lender = sql('INSERT INTO tickets (code, film_id, first_played_at, created_at) VALUES (?, ?, ?, ?)', `missed-lender-${d}`, film.id, ago(d), ago(d + 1));
      const sc = sql("INSERT INTO screenings (ticket_id, film_id, session_hash, started_at, resumable_until, last_heartbeat_at, active_until) VALUES (?, ?, 'missed-many', ?, ?, ?, ?)", lender, film.id, ago(d), ago(d - 3), ago(d), ago(d));
      sql("INSERT INTO loans (film_id, ticket_id, screening_id, session_hash, device, taken_at, due_at, ended_at, ended_how) VALUES (?, ?, ?, 'missed-many', 'Safari on Mac', ?, ?, ?, 'returned')", film.id, lender, sc, ago(d), ago(d - 3), ago(d - 1));
    }
    // Links Mo never used, each to be started within two days: half made when the tape
    // was in and stayed in, half made the day before it went out for a day, so their
    // dates moved a day. All missed all the same, months ago.
    let n = 0;
    const miss = (count) => {
      for (let i = 0; i < count; i++) {
        const moved = n % 2 === 1;
        const d = moved ? [300, 100][(n >> 1) % 2] + 1 : [350, 250][(n >> 1) % 2];
        sql('INSERT INTO tickets (code, film_id, person_id, start_by, created_at) VALUES (?, ?, ?, ?, ?)', `missed-${n++}`, film.id, p.id, ago(d - 2), ago(d));
      }
    };
    const read = async () => {
      const answers = {};
      const counts = {};
      for (const [key, url] of [['booth', '/api/admin/booth'], ['films', '/api/admin/films'], ['people', '/api/admin/people']]) {
        const before = statements;
        const r = await admin.get(url);
        counts[key] = statements - before;
        assert.equal(r.status, 200);
        answers[key] = r.data;
      }
      return {
        counts,
        listed: answers.booth.attention.tickets.filter((t) => t.film.id === film.id),
        links: answers.films.find((f) => f.id === film.id).links,
        liveLinks: answers.people.find((m) => m.id === p.id).liveLinks,
      };
    };
    miss(20);
    const twenty = await read();
    miss(40);
    const sixty = await read();
    assert.deepEqual(sixty.counts, twenty.counts, 'the same statements, however many links were missed');
    assert.deepEqual([twenty.listed, twenty.liveLinks, twenty.links.live, twenty.links.total], [[], 0, 0, 25]);
    assert.deepEqual([sixty.listed, sixty.liveLinks, sixty.links.live, sixty.links.total], [[], 0, 0, 65]);
    // Each one's date as the link's own page works it out: missed, and the moved ones a day later than set.
    const missed = db.prepare("SELECT id, start_by FROM tickets WHERE code LIKE 'missed-%' AND code NOT LIKE 'missed-lender-%' ORDER BY id").all();
    for (const [i, t] of missed.entries()) {
      const link = (await admin.get(`/api/admin/tickets/${t.id}`)).data;
      assert.deepEqual([link.linkState, link.effectiveStartBy - t.start_by], ['missed', i % 2 === 1 ? DAY : 0], `missed-${i}`);
    }
  });
});
