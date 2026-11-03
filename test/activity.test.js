// Activity, filtered and paged; the film and person summaries; and the ticket list's
// last activity once its events have gone: milestone 3, slice 4. Written from
// docs/milestone-3.md and the slice 4 spec, not from the implementation. Summaries are
// built from tickets and screenings only, so the clean-up never changes them.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';
import { FILM_SECONDS, adminBrowser, browser, enroll, makeFilm, newPerson, setupLink, startServer, tempDir } from './helpers.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const VIEWING = ['opened', 'play', 'heartbeat', 'finished'];
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
  c.heartbeat = async (b, id, position, playing = true) => {
    const r = await b.post(`/api/screenings/${id}/heartbeat`, { position, playing });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  };
  // A person with a passkey, signed in on the browser returned.
  c.member = async (name) => {
    const p = await newPerson(c.admin, name);
    const phone = c.fresh();
    const r = await enroll(phone, (await setupLink(c.admin, p.id)).token, { auth: softAuthenticator() });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return { p, phone };
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
    const types = ['opened', 'play', 'heartbeat', 'finished', 'ticket-given', 'link-created'];
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

  test('kind: viewing, or accounts and links, or everything', async () => {
    const types = async (query) => (await pages(query, 4)).flatMap((p) => p.events).map((e) => e.type);
    const film = `film=${c.films.solaris}`;
    assert.deepEqual(await types(`${film}&kind=viewing&heartbeats=1`), page.filter((e) => VIEWING.includes(e.type)).map((e) => e.type));
    assert.deepEqual(await types(`${film}&kind=viewing`), page.filter((e) => VIEWING.includes(e.type) && e.type !== 'heartbeat').map((e) => e.type), 'progress reports only when asked for');
    assert.deepEqual(await types(`${film}&kind=accounts`), page.filter((e) => !VIEWING.includes(e.type)).map((e) => e.type));
    assert.deepEqual(await types(`${film}&kind=accounts&heartbeats=1`), page.filter((e) => !VIEWING.includes(e.type)).map((e) => e.type));
    assert.deepEqual(await types(film), page.filter((e) => e.type !== 'heartbeat').map((e) => e.type));
  });

  test('the ticket, film and person filters still work, alone and with kind', async () => {
    const all = async (query) => (await pages(query, 1000)).flatMap((p) => p.events);
    const types = async (query) => (await all(query)).map((e) => e.type).sort();

    assert.deepEqual(await types(`ticket=${samTicket.id}`), ['opened', 'play']);
    assert.deepEqual(await types(`ticket=${samTicket.id}&heartbeats=1`), ['heartbeat', 'opened', 'play']);
    assert.deepEqual(await types(`ticket=${samTicket.id}&kind=accounts`), []);

    // A person's account events, and their viewing events through the browser.
    assert.deepEqual(await types(`person=${sam.p.id}`), ['link-created', 'opened', 'passkey-added', 'play']);
    assert.deepEqual(await types(`person=${sam.p.id}&kind=viewing`), ['opened', 'play']);
    assert.deepEqual(await types(`person=${sam.p.id}&kind=viewing&heartbeats=1`), ['heartbeat', 'opened', 'play']);
    assert.deepEqual(await types(`person=${sam.p.id}&kind=accounts`), ['link-created', 'passkey-added']);
    for (const e of await all(`person=${sam.p.id}&heartbeats=1`)) assert.equal(e.personId, sam.p.id);

    const heat = await all(`film=${c.films.heat}`);
    assert.deepEqual(heat.map((e) => e.type).sort(), ['opened', 'play']);
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
    assert.equal(await detail(t.untouched.id), null);
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
    // Heat: six tickets.
    const finished = await c.issue({ label: 'Finished' }, 'heat');
    await finish(await c.opened(c.fresh(), finished), 'heat');
    const started = await c.issue({ label: 'Started' }, 'heat');
    const b = await c.opened(c.fresh(), started);
    const id = await c.play(b, 'heat');
    await c.heartbeat(b, id, 30, false);
    await c.opened(c.fresh(), await c.issue({ label: 'Opened' }, 'heat'));
    await c.issue({ label: 'Not yet opened' }, 'heat');
    const revoked = await c.issue({ label: 'Revoked' }, 'heat');
    assert.equal((await c.admin.post(`/api/admin/tickets/${revoked.id}/revoke`)).status, 200);
    // Alex's own: two screenings, the second watched to the end.
    const mine = await c.issue({ personId: alex.p.id, label: 'Alex' }, 'heat');
    assert.equal((await alex.phone.get('/api/films/heat')).status, 200);
    const first = await c.play(alex.phone, 'heat');
    await c.heartbeat(alex.phone, first, 10, false);
    c.sql('UPDATE screenings SET resumable_until = ? WHERE id = ?', Date.now() - MINUTE, first);
    await finish(alex.phone, 'heat');
    assert.equal((await c.admin.get(`/api/admin/tickets/${mine.id}`)).data.screeningsUsed, 2);

    // Solaris: Alex's ticket, finished, given back, and started again.
    await c.issue({ personId: alex.p.id, label: 'Alex' }, 'solaris');
    assert.equal((await alex.phone.get('/api/films/solaris')).status, 200);
    const given = await finish(alex.phone, 'solaris');
    assert.equal((await c.admin.post(`/api/admin/screenings/${given}/void`)).status, 200);
    const again = await c.play(alex.phone, 'solaris');
    await c.heartbeat(alex.phone, again, 12, false);

    // Arrival: a ticket for anyone that Alex's phone opened and played. Not Alex's own.
    await c.opened(alex.phone, await c.issue({ label: 'Opened on Alex’s phone' }));
    await c.play(alex.phone);
  });

  test("a film's numbers come from its tickets and screenings", async () => {
    assert.deepEqual(filmSummary(await filmPage('heat')), { issued: 6, revoked: 1, opened: 4, played: 3, finished: 2, screenings: 4 });
  });

  test('a screening given back doesn’t count as finished', async () => {
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
    // Every browser ended long ago, too: those holding no screening that can still be resumed go.
    c.sql("UPDATE sessions SET revoked_at = ? WHERE kind = 'viewer'", Date.now() - 60 * DAY);
    const r = await c.clearEverythingOld();
    assert.ok(r.lastRun.deleted.events > 0 && r.lastRun.deleted.sessions > 0, JSON.stringify(r.lastRun));
    assert.deepEqual(
      { heat: filmSummary(await filmPage('heat')), solaris: filmSummary(await filmPage('solaris')), arrival: filmSummary(await filmPage('arrival')), alex: personSummary(await personPage()) },
      before1,
    );
  });
});
