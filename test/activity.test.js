// Activity, filtered and paged; the film and person summaries; and the ticket list's
// last activity once its events have gone: milestone 3, slice 4. Written from
// docs/history/milestone-3.md (slice 4), not from the implementation. Summaries are
// built from tickets and screenings only, so the clean-up never changes them. From
// version 2 a film is one tape, so where several links for one film are played here,
// each tape comes back (it comes due) before the next goes out.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';
import { FILM_SECONDS, adminBrowser, browser, enroll, makeFilm, newPerson, setupLink, signIn, startServer, tempDir } from './helpers.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const VIEWING = ['opened', 'play', 'heartbeat', 'finished'];
// Written from docs/version-2.md's table of kinds, not from the server's list.
const LOANS = ['ticket-sent', 'lent', 'returned', 'due-changed', 'ticket-cancelled', 'ticket-restored'];
const TINY = { retainProgressDays: 1, retainEventsDays: 30, retainSessionsDays: 1 };
const DEFAULTS = { retainProgressDays: 30, retainEventsDays: 365, retainSessionsDays: 30 };

// A server with three published films, and the helpers every part below uses.
function cinema() {
  const mediaDir = tempDir();
  const c = { films: {} };
  before(async () => {
    makeFilm(mediaDir, 'arrival');
    makeFilm(mediaDir, 'heat', { title: 'Heat', year: 1995 });
    makeFilm(mediaDir, 'solaris', { title: 'Solaris', year: 1972 });
    c.srv = await startServer({ mediaDir, limits: { scale: 100 } });
    c.admin = await adminBrowser(c.srv.base);
    await c.admin.post('/api/admin/scan');
    for (const f of (await c.admin.get('/api/admin/films')).data) {
      c.films[f.slug] = f.id;
      await c.admin.patch(`/api/admin/films/${f.id}`, { published: true });
    }
  });
  after(() => c.srv.close());
  c.fresh = () => browser(c.srv.base);
  c.issue = async (fields = {}, slug = 'arrival') => {
    const r = await c.admin.post('/api/admin/tickets', { filmId: c.films[slug], ...fields });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data[0];
  };
  c.opened = async (b, ticket) => {
    const r = await b.post('/api/tickets/open', { code: ticket.code });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return b;
  };
  c.play = async (b, slug = 'arrival') => {
    const r = await b.post(`/api/films/${slug}/screenings`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.screeningId;
  };
  // The tape that went out on this link came due a moment ago: the film is in again.
  c.back = (ticket) => {
    const l = c.srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(ticket.id);
    c.sql('UPDATE loans SET taken_at = ?, due_at = ? WHERE id = ?', Date.now() - 1 - (l.due_at - l.taken_at), Date.now() - 1, l.id);
  };
  c.heartbeat = async (b, id, position, playing = true) => {
    const r = await b.post(`/api/screenings/${id}/heartbeat`, { position, playing });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  };
  // A person with a passkey, signed in on the browser returned. device() signs
  // another browser in as them.
  c.member = async (name) => {
    const p = await newPerson(c.admin, name);
    const phone = c.fresh();
    const auth = softAuthenticator();
    const r = await enroll(phone, (await setupLink(c.admin, p.id)).token, { auth });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const device = async () => {
      const b = c.fresh();
      assert.equal((await signIn(b, auth)).status, 200);
      return b;
    };
    return { p, phone, device };
  };
  c.sql = (s, ...args) => c.srv.db.prepare(s).run(...args);
  // Every event made so far is a year and more old; the clean-up runs with the
  // smallest windows, and the settings go back afterwards.
  c.clearEverythingOld = async () => {
    c.sql('UPDATE events SET at = at - ?', 400 * DAY);
    assert.equal((await c.admin.patch('/api/admin/settings', TINY)).status, 200);
    const r = await c.admin.post('/api/admin/retention/run', {});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await c.admin.patch('/api/admin/settings', DEFAULTS)).status, 200);
    assert.equal(c.srv.db.prepare('SELECT COUNT(*) AS n FROM events WHERE at < ?').get(Date.now() - 300 * DAY).n, 0);
    return r.data;
  };
  return c;
}

// ====================================================================== Activity
describe('Activity, filtered and paged', () => {
  const c = cinema();
  let sam;
  let samTicket;
  let anyone;
  let page;

  // Every page from the first, following `next` until it is null.
  async function pages(query, limit) {
    const out = [];
    let before = '';
    for (let i = 0; i < 100; i++) {
      const r = await c.admin.get(`/api/admin/activity?${query}&limit=${limit}${before}`);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      out.push(r.data);
      if (r.data.next === null) return out;
      before = `&before=${encodeURIComponent(r.data.next)}`;
    }
    throw new Error('next never ran out');
  }
  // Newest first, by (at, id).
  const order = (events) => [...events].sort((a, b) => b.at - a.at || b.id - a.id);

  before(async () => {
    // Real events: Sam's link and passkey, then Sam watching a ticket of Sam's own;
    // a ticket for anyone, opened and played in a browser of its own.
    sam = await c.member('Sam');
    samTicket = await c.issue({ personId: sam.p.id, label: 'For Sam' });
    assert.equal((await sam.phone.get('/api/films/arrival')).status, 200);
    const id = await c.play(sam.phone);
    await c.heartbeat(sam.phone, id, 20);
    await c.heartbeat(sam.phone, id, 20, false);
    anyone = await c.issue({ label: 'For anyone' }, 'heat');
    const b = await c.opened(c.fresh(), anyone);
    assert.equal((await b.get('/api/films/heat')).status, 200);
    await c.play(b, 'heat');

    // Events made up for paging, all for Solaris: 30 of them, four to each moment, and
    // inserted out of order so ids don't follow times.
    // Kinds of all three sets: viewing, loans, and accounts (every other kind).
    const types = ['opened', 'play', 'heartbeat', 'finished', 'ticket-given', 'link-created', 'ticket-sent', 'lent', 'returned', 'due-changed', 'ticket-cancelled', 'ticket-restored', 'ticket-kept'];
    const t0 = Date.now() - HOUR;
    const made = Array.from({ length: 30 }, (_, i) => ({ at: t0 - Math.floor(i / 4) * MINUTE, type: types[i % types.length] }));
    made.sort((a, b) => ((a.at * 7919) % 31) - ((b.at * 7919) % 31) || a.type.localeCompare(b.type));
    const insert = c.srv.db.prepare('INSERT INTO events (at, type, film_id) VALUES (?, ?, ?)');
    for (const e of made) insert.run(e.at, e.type, c.films.solaris);
    page = order(c.srv.db.prepare('SELECT id, at, type FROM events WHERE film_id = ?').all(c.films.solaris).map((e) => ({ ...e })));
  });

  test('the response is { events, next }, each event as before', async () => {
    const r = await c.admin.get(`/api/admin/activity?ticket=${samTicket.id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.data).sort(), ['events', 'next']);
    assert.equal(r.data.next, null, 'everything fitted');
    const e = r.data.events.find((x) => x.type === 'play');
    for (const key of ['id', 'at', 'type', 'position', 'detail', 'screeningId', 'filmId', 'filmTitle', 'ticketId', 'ticketLabel', 'device', 'personId', 'personName']) {
      assert.ok(key in e, key);
    }
    assert.equal(e.personName, 'Sam');
    assert.equal(e.ticketLabel, 'For Sam');
    assert.deepEqual(e.detail, { resumed: false });
  });

  test('Show older: pages follow (at, id), with no event twice and none missed, ties included', async () => {
    for (const limit of [1, 4, 7, 30, 31]) {
      const got = await pages(`film=${c.films.solaris}&heartbeats=1`, limit);
      const events = got.flatMap((p) => p.events);
      assert.deepEqual(events.map((e) => e.id), page.map((e) => e.id), `limit ${limit}`);
      got.forEach((p, i) => {
        if (i < got.length - 1) assert.equal(p.events.length, limit, 'only the last page is short');
        assert.ok(p.events.length <= limit);
        const last = p.events.at(-1);
        if (p.next !== null) assert.equal(p.next, `${last.at}.${last.id}`, 'next is the last event’s <at>.<id>');
      });
    }
  });

  test('before returns only events strictly older, in (at, id) order', async () => {
    // The second of four at one moment: the two after it share its time.
    const k = page.findIndex((e, i) => i > 0 && page[i - 1].at === e.at && page[i + 1]?.at === e.at);
    assert.ok(k > 0);
    const r = await c.admin.get(`/api/admin/activity?film=${c.films.solaris}&heartbeats=1&limit=1000&before=${page[k].at}.${page[k].id}`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.events.map((e) => e.id), page.slice(k + 1).map((e) => e.id));
    assert.equal(r.data.next, null);
  });

  // 1.x had two kinds: viewing, and everything else. Version 2 has three (version-2.md,
  // "Events, the Ledger, retention and Status"): viewing as before; loans, which is
  // what happens to a link and its tape; and accounts, which is every other kind.
  // 1.x's "not viewing" would file every loan under cards, passkeys and links.
  test('kind: viewing, loans, accounts, or everything; each event is in exactly one kind', async () => {
    const types = async (query) => (await pages(query, 4)).flatMap((p) => p.events).map((e) => e.type);
    const film = `film=${c.films.solaris}`;
    const accounts = (e) => !VIEWING.includes(e.type) && !LOANS.includes(e.type);
    assert.deepEqual(await types(`${film}&kind=viewing&heartbeats=1`), page.filter((e) => VIEWING.includes(e.type)).map((e) => e.type));
    assert.deepEqual(await types(`${film}&kind=viewing`), page.filter((e) => VIEWING.includes(e.type) && e.type !== 'heartbeat').map((e) => e.type), 'progress reports only when asked for');
    assert.deepEqual(await types(`${film}&kind=loans`), page.filter((e) => LOANS.includes(e.type)).map((e) => e.type));
    assert.deepEqual(await types(`${film}&kind=loans&heartbeats=1`), page.filter((e) => LOANS.includes(e.type)).map((e) => e.type));
    assert.deepEqual(await types(`${film}&kind=accounts`), page.filter(accounts).map((e) => e.type));
    assert.deepEqual(await types(`${film}&kind=accounts&heartbeats=1`), page.filter(accounts).map((e) => e.type));
    assert.deepEqual(await types(film), page.filter((e) => e.type !== 'heartbeat').map((e) => e.type));
    // The three kinds together are everything, and no event is in two.
    assert.deepEqual(new Set(await types(`${film}&kind=loans`)), new Set(LOANS), 'the six kinds about a link and its tape');
    assert.deepEqual(new Set(await types(`${film}&kind=accounts`)), new Set(['ticket-given', 'link-created', 'ticket-kept']), 'keeping, giving and releasing a link stay with accounts');
    const counts = await Promise.all(['viewing&heartbeats=1', 'loans', 'accounts'].map(async (kind) => (await types(`${film}&kind=${kind}`)).length));
    assert.equal(counts.reduce((a, b) => a + b), page.length);
    const unknown = await c.admin.get('/api/admin/activity?kind=tapes');
    assert.deepEqual([unknown.status, unknown.data], [400, { error: 'kind must be viewing, loans or accounts' }]);
  });

  test('the ticket, film and person filters still work, alone and with kind', async () => {
    const all = async (query) => (await pages(query, 1000)).flatMap((p) => p.events);
    const types = async (query) => (await all(query)).map((e) => e.type).sort();

    // A link's sending and its tape going out are events too: the Ledger's third kind, loans.
    assert.deepEqual(await types(`ticket=${samTicket.id}`), ['lent', 'opened', 'play', 'ticket-sent']);
    assert.deepEqual(await types(`ticket=${samTicket.id}&heartbeats=1`), ['heartbeat', 'lent', 'opened', 'play', 'ticket-sent']);
    assert.deepEqual(await types(`ticket=${samTicket.id}&kind=viewing`), ['opened', 'play']);
    assert.deepEqual(await types(`ticket=${samTicket.id}&kind=loans`), ['lent', 'ticket-sent']);
    assert.deepEqual(await types(`ticket=${samTicket.id}&kind=accounts`), []);

    // A person's account events, the link sent to them, and their viewing events and
    // the tape they took, through the browser.
    assert.deepEqual(await types(`person=${sam.p.id}`), ['lent', 'link-created', 'opened', 'passkey-added', 'play', 'ticket-sent']);
    assert.deepEqual(await types(`person=${sam.p.id}&kind=viewing`), ['opened', 'play']);
    assert.deepEqual(await types(`person=${sam.p.id}&kind=viewing&heartbeats=1`), ['heartbeat', 'opened', 'play']);
    assert.deepEqual(await types(`person=${sam.p.id}&kind=loans`), ['lent', 'ticket-sent']);
    assert.deepEqual(await types(`person=${sam.p.id}&kind=accounts`), ['link-created', 'passkey-added']);
    for (const e of await all(`person=${sam.p.id}&heartbeats=1`)) assert.equal(e.personId, sam.p.id);
    const lent = (await all(`ticket=${samTicket.id}`)).find((e) => e.type === 'lent');
    const loan = c.srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(samTicket.id);
    assert.deepEqual(lent.detail, { loanId: loan.id, dueAt: loan.due_at });
    assert.deepEqual((await all(`ticket=${samTicket.id}`)).find((e) => e.type === 'ticket-sent').detail, { loanDays: null, note: false });

    const heat = await all(`film=${c.films.heat}`);
    assert.deepEqual(heat.map((e) => e.type).sort(), ['lent', 'opened', 'play', 'ticket-sent']);
    for (const e of heat) assert.equal(e.ticketId, anyone.id);
    assert.ok(heat.every((e) => e.personId === null), 'a browser that isn’t signed in names nobody');

    // Every filter at once, paged.
    const both = await pages(`film=${c.films.arrival}&person=${sam.p.id}&kind=viewing&heartbeats=1`, 1);
    assert.deepEqual(both.flatMap((p) => p.events).map((e) => e.type).sort(), ['heartbeat', 'opened', 'play']);
  });

  test('limit is still the page size', async () => {
    const r = await c.admin.get(`/api/admin/activity?film=${c.films.solaris}&heartbeats=1&limit=3`);
    assert.deepEqual(r.data.events.map((e) => e.id), page.slice(0, 3).map((e) => e.id));
    assert.equal(r.data.next, `${page[2].at}.${page[2].id}`);
  });

  test('admin only', async () => {
    assert.equal((await c.fresh().get('/api/admin/activity')).status, 401);
  });
});

// ====================================================================== last activity
describe('the ticket list’s last activity, once the events have gone', () => {
  const c = cinema();
  const t = {};

  before(async () => {
    t.played = await c.issue({ label: 'Played' });
    const b = await c.opened(c.fresh(), t.played);
    assert.equal((await b.get('/api/films/arrival')).status, 200);
    const id = await c.play(b);
    await c.heartbeat(b, id, 30);
    // Pausing updates the screening a moment after the last progress report, and logs nothing.
    await new Promise((r) => setTimeout(r, 5));
    await c.heartbeat(b, id, 35, false);
    t.opened = await c.issue({ label: 'Opened' });
    assert.equal((await (await c.opened(c.fresh(), t.opened)).get('/api/films/arrival')).status, 200);
    t.untouched = await c.issue({ label: 'Untouched' });
  });

  const listed = async () => Object.fromEntries((await c.admin.get('/api/admin/tickets')).data.map((a) => [a.id, a.lastActivity]));
  const detail = async (id) => (await c.admin.get(`/api/admin/tickets/${id}`)).data.lastActivity;

  test('while events remain, it is the latest event', async () => {
    const latest = { ...c.srv.db.prepare('SELECT at, type FROM events WHERE ticket_id = ? ORDER BY at DESC, id DESC LIMIT 1').get(t.played.id) };
    assert.equal(latest.type, 'heartbeat');
    const screening = c.srv.db.prepare('SELECT last_heartbeat_at AS at FROM screenings WHERE ticket_id = ?').get(t.played.id).at;
    assert.ok(screening > latest.at, 'the screening was updated after the last event');
    assert.deepEqual(await detail(t.played.id), latest);
    assert.deepEqual((await listed())[t.played.id], latest);
    // Sending a link is logged, and isn't activity on it.
    assert.equal(c.srv.db.prepare("SELECT COUNT(*) AS n FROM events WHERE ticket_id = ? AND type = 'ticket-sent'").get(t.untouched.id).n, 1);
    assert.equal(await detail(t.untouched.id), null);
    assert.equal((await listed())[t.untouched.id], null);
  });

  test('then the latest screening, then when it was first opened', async () => {
    await c.clearEverythingOld();
    assert.equal(c.srv.db.prepare('SELECT COUNT(*) AS n FROM events WHERE ticket_id IN (?, ?)').get(t.played.id, t.opened.id).n, 0);
    const screening = c.srv.db.prepare('SELECT MAX(COALESCE(last_heartbeat_at, started_at)) AS at FROM screenings WHERE ticket_id = ?').get(t.played.id).at;
    const firstOpened = c.srv.db.prepare('SELECT first_opened_at AS at FROM tickets WHERE id = ?').get(t.opened.id).at;
    assert.ok(screening && firstOpened);
    const expected = { [t.played.id]: { at: screening, type: 'play' }, [t.opened.id]: { at: firstOpened, type: 'opened' }, [t.untouched.id]: null };
    const list = await listed();
    for (const [id, last] of Object.entries(expected)) {
      assert.deepEqual(list[id], last, `the list, ticket ${id}`);
      assert.deepEqual(await detail(id), last, `the ticket's page, ticket ${id}`);
    }
  });
});

// ====================================================================== summaries
// The spec names the numbers (issued, of which revoked; opened; played; finished;
// screenings started) but not where they sit in the response: the summary is the
// object holding opened, played and finished, and a person's is the list of films
// each with those.
function* objects(v) {
  if (!v || typeof v !== 'object') return;
  if (!Array.isArray(v)) yield v;
  for (const x of Object.values(v)) yield* objects(x);
}
function filmSummary(film) {
  const all = [...objects(film)];
  const s = all.find((o) => ['opened', 'played', 'finished'].every((k) => typeof o[k] === 'number'));
  assert.ok(s, `no summary in the film's page: ${JSON.stringify(film)}`);
  // Screenings started may sit beside the ticket counts, or one level up.
  const started = [s, all.find((o) => Object.values(o).includes(s))]
    .filter(Boolean)
    .map((o) => Object.entries(o).find(([k, v]) => /screening|started/i.test(k) && typeof v === 'number'))
    .find(Boolean);
  return { issued: s.issued ?? s.tickets, revoked: s.revoked, opened: s.opened, played: s.played, finished: s.finished, screenings: started?.[1] };
}
function personSummary(person) {
  // Each as a flag, a count or a time.
  const value = (e, k) => e[k] ?? e[`${k}At`];
  const isEntry = (e) => e && typeof e === 'object' && ['opened', 'played', 'finished'].every((k) => k in e || `${k}At` in e);
  const list = [...objects(person)].flatMap((o) => Object.values(o)).find((v) => Array.isArray(v) && v.length && v.every(isEntry));
  assert.ok(list, `no films in the person's page: ${JSON.stringify(person)}`);
  return list.map((e) => ({ film: e.film?.title ?? e.title ?? e.filmTitle, opened: Boolean(value(e, 'opened')), played: Boolean(value(e, 'played')), finished: Boolean(value(e, 'finished')) }));
}

describe('summaries on the film and person pages', () => {
  const c = cinema();
  let alex;
  const filmPage = async (slug) => (await c.admin.get(`/api/admin/films/${c.films[slug]}`)).data;
  const personPage = async () => (await c.admin.get(`/api/admin/people/${alex.p.id}`)).data;
  const finish = async (b, slug) => {
    const id = await c.play(b, slug);
    await c.heartbeat(b, id, FILM_SECONDS);
    await c.heartbeat(b, id, FILM_SECONDS, false);
    return id;
  };

  before(async () => {
    alex = await c.member('Alex');
    // Heat: six links. One tape, so each comes back before the next goes out.
    const finished = await c.issue({ label: 'Finished' }, 'heat');
    await finish(await c.opened(c.fresh(), finished), 'heat');
    c.back(finished);
    const started = await c.issue({ label: 'Started' }, 'heat');
    const b = await c.opened(c.fresh(), started);
    const id = await c.play(b, 'heat');
    await c.heartbeat(b, id, 30, false);
    c.back(started);
    await c.opened(c.fresh(), await c.issue({ label: 'Opened' }, 'heat'));
    await c.issue({ label: 'Not yet opened' }, 'heat');
    const revoked = await c.issue({ label: 'Revoked' }, 'heat');
    assert.equal((await c.admin.post(`/api/admin/tickets/${revoked.id}/revoke`)).status, 200);
    // Alex's own, watched to the end. (1.x: two plays on it. A link lends once, so one.)
    const mine = await c.issue({ personId: alex.p.id, label: 'Alex' }, 'heat');
    assert.equal((await alex.phone.get('/api/films/heat')).status, 200);
    await finish(alex.phone, 'heat');
    assert.equal((await c.admin.get(`/api/admin/tickets/${mine.id}`)).data.screeningsUsed, 1);

    // Solaris: Alex's link, watched to the end in 1.x and that play then given back
    // (the back office's Give back, which goes: here the row is marked as 1.x left it).
    await c.issue({ personId: alex.p.id, label: 'Alex' }, 'solaris');
    assert.equal((await alex.phone.get('/api/films/solaris')).status, 200);
    const given = await finish(alex.phone, 'solaris');
    c.sql('UPDATE screenings SET voided_at = ? WHERE id = ?', Date.now(), given);

    // Arrival: a link for anyone that Alex's phone opened and played. Not Alex's own.
    await c.opened(alex.phone, await c.issue({ label: 'Opened on Alex’s phone' }));
    await c.play(alex.phone);
  });

  test("a film's numbers come from its tickets and screenings", async () => {
    assert.deepEqual(filmSummary(await filmPage('heat')), { issued: 6, revoked: 1, opened: 4, played: 3, finished: 2, screenings: 3 });
  });

  test('a play given back in 1.x doesn’t count as finished', async () => {
    const s = filmSummary(await filmPage('solaris'));
    assert.deepEqual({ issued: s.issued, revoked: s.revoked, opened: s.opened, played: s.played, finished: s.finished }, { issued: 1, revoked: 0, opened: 1, played: 1, finished: 0 });
  });

  test("a person's films: their own tickets only, opened, played and finished, newest first", async () => {
    assert.deepEqual(personSummary(await personPage()), [
      { film: 'Solaris', opened: true, played: true, finished: false },
      { film: 'Heat', opened: true, played: true, finished: true },
    ]);
  });

  test('the clean-up changes none of them', async () => {
    const before1 = { heat: filmSummary(await filmPage('heat')), solaris: filmSummary(await filmPage('solaris')), arrival: filmSummary(await filmPage('arrival')), alex: personSummary(await personPage()) };
    // Every browser ended long ago, too: those no loan with its end unwritten names go.
    c.sql("UPDATE sessions SET revoked_at = ? WHERE kind = 'viewer'", Date.now() - 60 * DAY);
    const r = await c.clearEverythingOld();
    assert.ok(r.lastRun.deleted.events > 0 && r.lastRun.deleted.sessions > 0, JSON.stringify(r.lastRun));
    assert.deepEqual(
      { heat: filmSummary(await filmPage('heat')), solaris: filmSummary(await filmPage('solaris')), arrival: filmSummary(await filmPage('arrival')), alex: personSummary(await personPage()) },
      before1,
    );
  });
});

// ====================================================================== how often
// docs/access.md, "What is recorded": how many viewing events one viewer makes.
describe('how often viewing is recorded', () => {
  const c = cinema();
  const count = (type, ticketId) => c.srv.db.prepare('SELECT COUNT(*) AS n FROM events WHERE type = ? AND ticket_id = ?').get(type, ticketId).n;
  const backdate = (type, ticketId, ms) => c.sql('UPDATE events SET at = at - ? WHERE type = ? AND ticket_id = ?', ms, type, ticketId);
  const page = async (b) => assert.equal((await b.get('/api/films/arrival')).status, 200);

  test('opened: at most once per 30 minutes per browser', async () => {
    const t = await c.issue();
    const b = await c.opened(c.fresh(), t);
    for (let i = 0; i < 3; i++) await page(b);
    assert.equal(count('opened', t.id), 1, 'three page loads, one event');
    await page(await c.opened(c.fresh(), t));
    assert.equal(count('opened', t.id), 2, 'another browser counts on its own');
    backdate('opened', t.id, 29 * MINUTE);
    await page(b);
    assert.equal(count('opened', t.id), 2, 'not after 29 minutes');
    backdate('opened', t.id, 2 * MINUTE);
    await page(b);
    assert.equal(count('opened', t.id), 3, 'again after 30');
  });

  test('opened: not when the page reads itself again, after Play or once the player stops', async () => {
    const t = await c.issue();
    const b = await c.opened(c.fresh(), t);
    await page(b);
    // The friend reads the page for 40 minutes, then presses Play.
    backdate('opened', t.id, 40 * MINUTE);
    await c.play(b);
    assert.equal((await b.get('/api/films/arrival?again=1')).status, 200);
    assert.equal(count('opened', t.id), 1, 'opened once, then played');
    await page(b);
    assert.equal(count('opened', t.id), 2, 'loading the page itself still counts');
  });

  // Each test that presses Play does it on a film of its own: this one on Heat.
  test('heartbeat: progress is logged at most every 5 minutes while playing, and a pause not at all', async () => {
    const t = await c.issue({}, 'heat');
    const b = await c.opened(c.fresh(), t);
    const id = await c.play(b, 'heat');
    for (const position of [10, 20, 30]) await c.heartbeat(b, id, position);
    assert.equal(count('heartbeat', t.id), 1, 'three reports, one event');
    backdate('heartbeat', t.id, 5 * MINUTE);
    await c.heartbeat(b, id, 31, false);
    assert.equal(count('heartbeat', t.id), 1, 'a pause is not logged');
    c.sql("UPDATE events SET at = at + ? WHERE type = 'heartbeat' AND ticket_id = ?", MINUTE, t.id);
    await c.heartbeat(b, id, 40);
    assert.equal(count('heartbeat', t.id), 1, 'not after 4 minutes');
    backdate('heartbeat', t.id, MINUTE);
    await c.heartbeat(b, id, 50);
    assert.equal(count('heartbeat', t.id), 2, 'again after 5');
    // Every report still moves the screening on.
    assert.equal(c.srv.db.prepare('SELECT position_seconds FROM screenings WHERE id = ?').get(id).position_seconds, 50);
  });

  // 1.x: two browsers on one link took the play from each other. Taking over is among
  // one borrower's own devices now: a member's phone and laptop.
  test('play: taking the tape and every move to another of the borrower’s devices, but the same device again at most every 5 minutes', async () => {
    // On Solaris, which no other test here plays.
    const sam = await c.member('Sam Plays');
    const t = await c.issue({ personId: sam.p.id }, 'solaris');
    const laptop = sam.phone;
    const tv = await sam.device();
    const play = (b) => c.play(b, 'solaris');
    const resumed = () =>
      c.srv.db
        .prepare("SELECT detail FROM events WHERE type = 'play' AND ticket_id = ? ORDER BY id")
        .all(t.id)
        .map((e) => JSON.parse(e.detail).resumed);

    const id = await play(laptop);
    for (let i = 0; i < 3; i++) assert.equal(await play(laptop), id);
    assert.equal(count('play', t.id), 1, 'a refresh or a double click is not another event');

    await c.heartbeat(laptop, id, 20, false);
    assert.equal(await play(tv), id);
    await c.heartbeat(tv, id, 30, false);
    assert.equal(await play(laptop), id);
    assert.equal(count('play', t.id), 3, 'moving to another device and back always is');

    backdate('play', t.id, 4 * MINUTE);
    await play(laptop);
    assert.equal(count('play', t.id), 3, 'not after 4 minutes');
    backdate('play', t.id, MINUTE);
    await play(laptop);
    assert.equal(count('play', t.id), 4, 'again after 5');
    assert.deepEqual(resumed(), [false, true, true, true]);
    assert.equal(count('lent', t.id), 1, 'the tape went out once, however often Play was pressed');

    // 1.x: a new play once the last one's window had closed. A link lends once; the next
    // link's first Play, which takes the tape, always is logged.
    c.back(t);
    assert.equal((await laptop.post('/api/films/solaris/screenings')).data.error, 'spent');
    assert.equal(count('play', t.id), 4);
    const next = await c.issue({}, 'solaris');
    const other = await c.opened(c.fresh(), next);
    assert.notEqual(await play(other), id);
    assert.deepEqual([count('play', next.id), count('lent', next.id)], [1, 1]);
    assert.deepEqual([count('returned', t.id), count('lent', t.id)], [1, 1], 'and the first tape’s coming back was written down, once');
  });
});
