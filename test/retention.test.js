// Retention: milestone 3, slice 4. Written from docs/history/milestone-3.md (slice 4),
// not from the implementation, and from docs/version-2.md ("Events, the Ledger,
// retention and Status") for loans. Old events and ended browser sessions are deleted;
// tickets, loans, responses and screenings never are, so deleting anything never
// changes what a viewer can do. That rule comes first. createRetention is imported to run a clean-up at a
// chosen `now` (the admin's Clear now always runs at the real time), and createAccess
// and createSettings to read each ticket's state at times other than now, as the
// server would.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';

const { FILM_SECONDS, addFilm, adminBrowser, browser, enroll, makeFilm, newPerson, playbackFiles, setupLink, signIn, startServer, tempDir } = await import('./helpers.js');
const { openDb } = await import('../server/db.js');
const { DEFAULT_SETTINGS, createSettings } = await import('../server/settings.js');
const { createAccess } = await import('../server/access.js');
const { createRetention } = await import('../server/retention.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;
const DEFAULTS = { retainProgressDays: 30, retainEventsDays: 365, retainSessionsDays: 30 };
// The smallest windows the settings allow.
const TINY = { retainProgressDays: 1, retainEventsDays: 30, retainSessionsDays: 1 };

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashOf = (b) => sha256(b.jar.get('om_session'));
const plain = (row) => (row ? { ...row } : row);
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const statuses = (b, urls) => Promise.all(urls.map(async (u) => (await b.get(u)).status));
const rowsOf = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(plain);
// What the clean-up may delete, and everything it must leave exactly as it was.
const DELETABLE = ['events', 'sessions', 'session_tickets'];
const UNTOUCHED = ['films', 'tickets', 'loans', 'responses', 'screenings', 'people', 'passkeys', 'person_links', 'settings'];
const tables = (db, names = UNTOUCHED) => Object.fromEntries(names.map((t) => [t, rowsOf(db, t)]));

// ====================================================================== the rule
describe('the rule: deleting anything never changes what a viewer can do', () => {
  const mediaDir = tempDir();
  const NOW = Date.now();
  // Times to read each link's state at: its start-by date and its tape's due time pass in between.
  const AT = { now: NOW, tomorrow: NOW + DAY, 'in four days': NOW + 4 * DAY, 'in twenty years': NOW + 20 * YEAR };
  let srv;
  let admin;
  let access;
  const films = {};
  // The links, by the state they're in. One tape per film, so a film each.
  const t = {};
  // [what, browser, film]: every browser and the film it watches.
  const seen = [];
  // Ended browsers the first clean-up deletes.
  const ended = {};
  let sam;
  let before1;

  // A link for a film of its own, named after the state the link will be in.
  async function issue(what, fields = {}) {
    films[what] = (await addFilm(admin, mediaDir, what)).id;
    const r = await admin.post('/api/admin/tickets', { filmId: films[what], label: what, ...fields });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    t[what] = r.data[0];
    return t[what];
  }
  async function opened(b, ticket) {
    const r = await b.post('/api/tickets/open', { code: ticket.code });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return b;
  }
  async function play(b, slug) {
    const r = await b.post(`/api/films/${slug}/screenings`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.screeningId;
  }
  async function heartbeat(b, id, position, playing = true) {
    const r = await b.post(`/api/screenings/${id}/heartbeat`, { position, playing });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  // Watched to `position` and paused there, so no screening is busy playing.
  async function watched(b, slug, position) {
    const id = await play(b, slug);
    await heartbeat(b, id, position);
    await heartbeat(b, id, position, false);
    return id;
  }
  const sql = (s, ...args) => srv.db.prepare(s).run(...args);
  const fresh = () => browser(srv.base);
  const loanOf = (what) => srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(t[what].id);
  // The whole loan moves back in time: taken `taken` ago, due after its three days.
  const takenAgo = (what, taken) => {
    sql('UPDATE loans SET taken_at = ?, due_at = ? WHERE ticket_id = ?', NOW - taken, NOW - taken + 3 * DAY, t[what].id);
    sql('UPDATE tickets SET first_played_at = ? WHERE id = ?', NOW - taken, t[what].id);
    sql('UPDATE screenings SET started_at = ? WHERE ticket_id = ?', NOW - taken, t[what].id);
  };

  // What each browser can do: its film's page, its links, every playback file and the
  // poster, and Play where Play is refused (Play that works would take a tape).
  async function whatBrowsersCanDo() {
    const out = {};
    for (const [what, b, slug] of seen) {
      const page = await b.get(`/api/films/${slug}`);
      const me = (await b.get('/api/me')).data;
      const canPlay = page.status === 200 && page.data.access.canPlay;
      const refused = canPlay ? null : await b.post(`/api/films/${slug}/screenings`);
      out[what] = {
        page: page.status,
        access: page.data.access ?? page.data.error,
        person: me.person,
        tickets: me.tickets.map(({ film, ticket }) => ({ film: film.slug, ticket })),
        linkTickets: me.linkTickets,
        media: await statuses(b, playbackFiles(slug)),
        poster: (await b.get(`/media/${slug}/poster.jpg`)).status,
        play: refused && { status: refused.status, error: refused.data.error },
      };
    }
    return out;
  }

  // Every link as the admin reads it, leaving out what isn't the link's own: how
  // many browsers opened it, its last activity, and the device names of browsers.
  async function whatTheAdminSees() {
    const out = {};
    for (const [what, { id }] of Object.entries(t)) {
      const r = await admin.get(`/api/admin/tickets/${id}`);
      assert.equal(r.status, 200);
      const a = r.data;
      out[what] = {
        ...omit(a, ['browsers', 'waitingBrowsers', 'browserList', 'lastActivity', 'openScreening', 'screenings']),
        openScreening: a.openScreening && omit(a.openScreening, ['device']),
        screenings: a.screenings.map((s) => omit(s, ['device'])),
      };
    }
    return out;
  }

  // access.ticketStatus for every link, now and later: its state, its loan and the film's.
  function ticketStates() {
    const out = {};
    for (const [what, { id }] of Object.entries(t)) {
      const row = srv.db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
      out[what] = Object.fromEntries(
        Object.entries(AT).map(([when, at]) => {
          const s = access.ticketStatus(row, at);
          return [when, { ...s, loan: plain(s.loan), out: plain(s.out) }];
        }),
      );
    }
    return out;
  }

  // The film pages (with their summaries) and Sam's page in the admin.
  async function adminPages() {
    const filmPages = {};
    for (const [slug, id] of Object.entries(films)) filmPages[slug] = (await admin.get(`/api/admin/films/${id}`)).data;
    return { filmPages, films: (await admin.get('/api/admin/films')).data, sam: (await admin.get(`/api/admin/people/${sam.p.id}`)).data };
  }

  async function record() {
    return { tickets: await whatTheAdminSees(), states: ticketStates(), tables: tables(srv.db), pages: await adminPages() };
  }

  before(async () => {
    makeFilm(mediaDir, 'arrival');
    srv = await startServer({ mediaDir, limits: { scale: 100 } });
    admin = await adminBrowser(srv.base);
    await admin.post('/api/admin/scan');
    access = createAccess(srv.db, createSettings(srv.db));

    // Sam, signed in on a phone; a laptop that signed in and then out.
    const p = await newPerson(admin, 'Sam');
    const auth = softAuthenticator();
    const phone = fresh();
    assert.equal((await enroll(phone, (await setupLink(admin, p.id)).token, { auth })).status, 200);
    const laptop = fresh();
    assert.equal((await signIn(laptop, auth)).status, 200);
    ended.laptop = hashOf(laptop);
    assert.equal((await laptop.post('/api/signout')).status, 200);
    sam = { p, phone };

    // Spent: the tape went out ten weeks ago, in a browser that has since ended (the
    // first clean-up deletes it), and came due three days later; the link was opened
    // in another browser that hasn't ended. The server's sweep wrote the end down.
    // (1.x opened it in the second browser afterwards. A spent link opens only in a
    // browser that already holds it, so here the second browser opened it first.)
    await issue('spent');
    const alsoOpened = await opened(fresh(), t.spent);
    const player = await opened(fresh(), t.spent);
    await watched(player, 'spent', 20);
    ended.player = hashOf(player);
    takenAgo('spent', 70 * DAY);
    assert.equal(access.sweep(NOW), 1);
    assert.equal((await fresh().post('/api/tickets/open', { code: t.spent.code })).status, 410);
    seen.push(['spent', await opened(alsoOpened, t.spent), 'spent']);

    // Links for anyone, each opened in a browser of its own. Out: the tape is with it.
    await issue('out');
    const out = await opened(fresh(), t.out);
    await watched(out, 'out', 30);
    seen.push(['out with this browser, paused at 30s', out, 'out']);

    // Due: taken four days ago, due back yesterday.
    await issue('due');
    const due = await opened(fresh(), t.due);
    await watched(due, 'due', 10);
    takenAgo('due', 4 * DAY);
    seen.push(['came due a day ago', due, 'due']);

    await issue('start-by-passed', { startBy: NOW - HOUR });
    seen.push(['start-by passed', await opened(fresh(), t['start-by-passed']), 'start-by-passed']);

    await issue('start-by-pending', { startBy: NOW + 2 * DAY });
    seen.push(['start-by in two days', await opened(fresh(), t['start-by-pending']), 'start-by-pending']);

    await issue('finished');
    const finished = await opened(fresh(), t.finished);
    const f = await play(finished, 'finished');
    await heartbeat(finished, f, FILM_SECONDS / 2);
    await heartbeat(finished, f, FILM_SECONDS);
    await heartbeat(finished, f, FILM_SECONDS, false);
    seen.push(['played and finished, the tape still out', finished, 'finished']);

    // Returned by its browser before it was due; and one whose tape the owner took back.
    await issue('returned');
    const returned = await opened(fresh(), t.returned);
    await watched(returned, 'returned', 12);
    assert.equal((await returned.post('/api/films/returned/return', { takenAt: loanOf('returned').taken_at })).status, 200);
    seen.push(['returned early', returned, 'returned']);

    await issue('taken-back');
    const takenBack = await opened(fresh(), t['taken-back']);
    await watched(takenBack, 'taken-back', 14);
    assert.equal((await admin.post(`/api/admin/loans/${loanOf('taken-back').id}/take-back`, { ticketId: t['taken-back'].id })).status, 200);
    seen.push(['its tape taken back', takenBack, 'taken-back']);

    // Cancelled before it lent. (Cancelling a link that has the tape is taking the tape back.)
    await issue('revoked');
    const revoked = await opened(fresh(), t.revoked);
    assert.equal((await admin.post(`/api/admin/tickets/${t.revoked.id}/revoke`)).status, 200);
    seen.push(['revoked', revoked, 'revoked']);

    await issue('never-opened', { loanDays: 7 });

    // Kept by Sam, from a link another browser had opened first; then the tape went out to Sam.
    await issue('kept', { claimable: true });
    const first = await opened(fresh(), t.kept);
    await opened(phone, t.kept);
    assert.equal((await phone.post('/api/films/kept/keep')).status, 200);
    await watched(phone, 'kept', 15);
    seen.push(['kept by Sam', phone, 'kept'], ['kept: the browser that opened it first', first, 'kept']);

    // Only for Sam, signed in.
    await issue('for-sam', { personId: p.id });
    assert.equal((await phone.get('/api/films/for-sam')).status, 200);
    await watched(phone, 'for-sam', 40);
    seen.push(['for Sam', phone, 'for-sam']);

    // A tape out with a browser that was signed out long ago (as far as the database can
    // tell). The tape is back from that moment, but nothing has written its end.
    await issue('held-by-ended');
    const holder = await opened(fresh(), t['held-by-ended']);
    await watched(holder, 'held-by-ended', 25);
    ended.holder = hashOf(holder);
    seen.push(['its tape out with an ended browser', holder, 'held-by-ended']);

    // Opened in a browser whose session expired long ago.
    await issue('old-browser');
    const old = await opened(fresh(), t['old-browser']);
    ended.expired = hashOf(old);
    seen.push(['opened in a browser that expired', old, 'old-browser']);

    // Time passes. Every event is 400 days old; three browsers ended long ago, one of
    // them the one whose tape nobody has written back; and a fourth expired.
    sql('UPDATE events SET at = at - ?', 400 * DAY);
    sql('UPDATE sessions SET revoked_at = ? WHERE id_hash IN (?, ?, ?)', NOW - 60 * DAY, ended.laptop, ended.player, ended.holder);
    sql('UPDATE sessions SET created_at = ?1, last_seen_at = ?1, expires_at = ?2 WHERE id_hash = ?3', NOW - 130 * DAY, NOW - 40 * DAY, ended.expired);
  });
  after(() => srv.close());

  test('links in every state, with old events and ended browsers everywhere', async () => {
    const state = Object.fromEntries(await Promise.all(Object.entries(t).map(async ([what, { id }]) => [what, (await admin.get(`/api/admin/tickets/${id}`)).data])));
    // As the back office still says it, in 1.x's words: 'used_up' is a link that has lent.
    const expected = {
      spent: 'used_up', out: 'ok', due: 'used_up', 'start-by-passed': 'expired', 'start-by-pending': 'ok', finished: 'ok',
      returned: 'used_up', 'taken-back': 'revoked', revoked: 'revoked', 'never-opened': 'ok', kept: 'ok', 'for-sam': 'ok', 'held-by-ended': 'used_up', 'old-browser': 'ok',
    };
    assert.deepEqual(Object.fromEntries(Object.entries(state).map(([what, a]) => [what, a.state])), expected);
    // And as access.js reads them, in version 2's.
    const now = Object.fromEntries(Object.entries(ticketStates()).map(([what, at]) => [what, at.now.state]));
    assert.deepEqual(now, {
      spent: 'spent', out: 'lent', due: 'spent', 'start-by-passed': 'expired', 'start-by-pending': 'in', finished: 'lent',
      returned: 'spent', 'taken-back': 'revoked', revoked: 'revoked', 'never-opened': 'in', kept: 'lent', 'for-sam': 'lent', 'held-by-ended': 'spent', 'old-browser': 'in',
    });
    assert.equal(state.finished.finished, true);
    assert.equal(state.out.openScreening.resumableUntil, loanOf('out').due_at);
    assert.equal(state.kept.person.id, sam.p.id);
    assert.ok(state.kept.claimedAt);
    assert.equal(state['for-sam'].person.id, sam.p.id);
    assert.equal(state['start-by-pending'].startBy, NOW + 2 * DAY);
    assert.deepEqual([loanOf('spent').ended_how, loanOf('spent').ended_at], ['due', loanOf('spent').due_at]);
    assert.deepEqual([loanOf('due').ended_at, loanOf('held-by-ended').ended_at], [null, null], 'back by the clock, with no end written');
    assert.deepEqual([loanOf('returned').ended_how, loanOf('taken-back').ended_how], ['returned', 'taken-back']);
    assert.equal(state['held-by-ended'].openScreening, null);
    const old = srv.db.prepare('SELECT COUNT(*) AS n FROM events WHERE at < ?').get(NOW - 300 * DAY).n;
    assert.equal(old, srv.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 'every event is old');
    assert.ok(srv.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'heartbeat'").get().n > 0, 'progress reports among them');
    assert.ok(srv.db.prepare("SELECT COUNT(*) AS n FROM events WHERE person_id IS NOT NULL").get().n > 0, 'account events too');
    assert.ok(srv.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type IN ('lent', 'returned', 'ticket-sent', 'ticket-cancelled')").get().n > 5, 'and the events about loans');
  });

  test('clearing now with the smallest windows deletes the old events and the ended browsers, and nothing else', async () => {
    const saved = await admin.patch('/api/admin/settings', TINY);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const browsersBefore = await whatBrowsersCanDo();
    before1 = { browsers: browsersBefore, ...(await record()) };
    const sessionsBefore = rowsOf(srv.db, 'sessions').map((s) => s.id_hash);
    const heldTicketsBefore = rowsOf(srv.db, 'session_tickets');
    assert.equal(loanOf('held-by-ended').ended_at, null, 'its end is still not written');

    const preview = (await admin.get('/api/admin/retention')).data.preview;
    const r = await admin.post('/api/admin/retention/run', {});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.lastRun.deleted, preview, 'it deleted what the preview said');
    assert.ok(preview.progressReports > 0 && preview.events > 0, JSON.stringify(preview));
    assert.equal(preview.sessions, 3, 'the laptop and the spent link’s browser, signed out long ago, and the browser that expired long ago');

    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM events WHERE at < ?').get(Date.now() - 30 * DAY).n, 0, 'no old event is left');
    const gone = [ended.laptop, ended.player, ended.expired];
    const sessionsAfter = rowsOf(srv.db, 'sessions').map((s) => s.id_hash);
    assert.deepEqual(sessionsAfter, sessionsBefore.filter((h) => !gone.includes(h)));
    // The loan is over once its browser's session ended, and when that was is read from this row.
    assert.ok(sessionsAfter.includes(ended.holder), 'the ended browser named by a loan whose end isn’t written stays');
    assert.deepEqual(rowsOf(srv.db, 'session_tickets'), heldTicketsBefore.filter((st) => !gone.includes(st.session_hash)), 'only the deleted browsers’ tickets went with them');
    assert.deepEqual([loanOf('spent').session_hash, loanOf('spent').device !== null], [ended.player, true], 'the spent loan stays, naming its deleted browser and keeping its device');
    assert.equal(srv.db.prepare('SELECT session_hash FROM screenings WHERE ticket_id = ?').get(t.spent.id).session_hash, ended.player);
  });

  test('every link reads the same: state, loan, plays, finished, resume positions and deadlines, now and later', async () => {
    const after1 = await record();
    assert.deepEqual(after1.tables, before1.tables, 'films, tickets, loans, responses, screenings, people, passkeys, links and settings are untouched');
    assert.deepEqual(after1.tickets, before1.tickets);
    assert.deepEqual(after1.states, before1.states);
    assert.deepEqual(after1.pages, before1.pages, 'the film pages, their summaries, and Sam’s page');
  });

  test('every browser can do what it could before, and a tape that is out still plays for its borrower', async () => {
    assert.deepEqual(await whatBrowsersCanDo(), before1.browsers);
    const holders = [['out with this browser, paused at 30s', 30], ['played and finished, the tape still out', FILM_SECONDS], ['for Sam', 40], ['kept by Sam', 15]];
    for (const [what, position] of holders) {
      const [, b, slug] = seen.find(([w]) => w === what);
      assert.deepEqual(await statuses(b, playbackFiles(slug)), playbackFiles(slug).map(() => 200), what);
      const r = await b.post(`/api/films/${slug}/screenings`);
      assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.data)}`);
      assert.equal(r.data.resumed, true, what);
      assert.equal(r.data.position, position, what);
      await heartbeat(b, r.data.screeningId, position, false);
    }
  });

  test('at a far-future now, with every event and browser gone, every link still reads the same', async () => {
    const FAR = NOW + 20 * YEAR;
    // By then the server's sweep has long written down every tape that came back. The
    // one whose browser was signed out before the loan began, by these clocks, ended
    // when it began: never before, whatever the clocks say.
    assert.equal(access.sweep(FAR), 5);
    const held = loanOf('held-by-ended');
    assert.deepEqual([held.ended_how, held.ended_at], ['signed-out', held.taken_at]);
    assert.deepEqual([loanOf('out').ended_how, loanOf('out').ended_at], ['due', loanOf('out').due_at]);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM loans WHERE ended_at IS NULL').get().n, 0);

    const before2 = await record();
    const retention = createRetention({ db: srv.db, settings: createSettings(srv.db) });
    const preview = retention.preview(FAR);
    assert.deepEqual(retention.run(FAR), preview);
    for (const table of DELETABLE) assert.equal(rowsOf(srv.db, table).length, 0, `${table}: everything had ended by then`);

    // The admin's own session went too.
    admin = await adminBrowser(srv.base);
    const after2 = await record();
    assert.deepEqual(after2.tables, before2.tables);
    assert.deepEqual(after2.tickets, before2.tickets);
    assert.deepEqual(after2.states, before2.states);
    assert.deepEqual(after2.pages.filmPages, before2.pages.filmPages);
    assert.deepEqual(after2.pages.films, before2.pages.films);
    // Sam's browsers are gone; when Sam last signed in is not.
    assert.deepEqual(omit(after2.pages.sam, ['browsers']), omit(before2.pages.sam, ['browsers']));
    assert.ok(after2.pages.sam.lastSignedInAt > 0);
  });
});

// ====================================================================== what a clean-up deletes
// A database with one of each kind of event and browser session, at known ages, cleared
// at `NOW` with the default windows (30 days, 365 days, 30 days).
function fixture(NOW) {
  const db = openDb(':memory:');
  const settings = createSettings(db);
  const film = Number(db.prepare("INSERT INTO films (slug, title, media_status, created_at, updated_at) VALUES ('arrival', 'Arrival', 'ok', 0, 0)").run().lastInsertRowid);
  const ticket = Number(db.prepare("INSERT INTO tickets (code, film_id, created_at) VALUES ('abcdefghjkmnp', ?, 0)").run(film).lastInsertRowid);
  const person = Number(db.prepare("INSERT INTO people (name, webauthn_user_id, created_at) VALUES ('Sam', 'user-id', 0)").run().lastInsertRowid);
  const events = new Map();
  const event = (name, type, at, session = null) => {
    const viewing = ['opened', 'play', 'heartbeat', 'finished'].includes(type);
    const r = db
      .prepare('INSERT INTO events (at, type, film_id, ticket_id, session_hash, position, person_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(at, type, viewing ? film : null, viewing ? ticket : null, session, type === 'heartbeat' ? 30 : null, viewing ? null : person);
    events.set(name, Number(r.lastInsertRowid));
  };
  const session = (name, { revoked = null, expires = NOW + 50 * DAY } = {}) => {
    db.prepare('INSERT INTO sessions (id_hash, kind, device, created_at, last_seen_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(name, 'viewer', 'Safari on iPhone', NOW - 500 * DAY, NOW - 400 * DAY, expires, revoked);
    db.prepare('INSERT INTO session_tickets (session_hash, ticket_id, added_at) VALUES (?, ?, ?)').run(name, ticket, NOW - 500 * DAY);
  };
  // A tape that browser took on a link of its own, 120 days ago, due three days later.
  // Its browser ended 100 days ago; `endWritten` says whether anything wrote that down.
  const loan = (holder, endWritten) => {
    const taken = NOW - 120 * DAY;
    const link = Number(db.prepare('INSERT INTO tickets (code, film_id, created_at) VALUES (?, ?, 0)').run(`loan${holder.length}xxxxxxxx`.slice(0, 13), film).lastInsertRowid);
    const play = Number(
      db.prepare('INSERT INTO screenings (ticket_id, film_id, session_hash, started_at, resumable_until, last_heartbeat_at, active_until) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(link, film, holder, taken, taken + 3 * DAY, taken, taken).lastInsertRowid,
    );
    db.prepare('INSERT INTO loans (film_id, ticket_id, screening_id, session_hash, device, taken_at, due_at, ended_at, ended_how) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(film, link, play, holder, 'Safari on iPhone', taken, taken + 3 * DAY, endWritten ? taken + 3 * DAY : null, endWritten ? 'due' : null);
  };

  session('live');
  session('live, named only by old events');
  session('signed out 31 days ago', { revoked: NOW - 31 * DAY });
  session('signed out 29 days ago', { revoked: NOW - 29 * DAY });
  session('expired 31 days ago', { expires: NOW - 31 * DAY });
  session('expired 29 days ago', { expires: NOW - 29 * DAY });
  session('expired an hour ago', { expires: NOW - HOUR });
  session('ended, named by an event', { revoked: NOW - 100 * DAY });
  session('ended, named by a progress report', { revoked: NOW - 100 * DAY });
  session('ended, named only by old events', { revoked: NOW - 400 * DAY });
  session('ended, named by a loan whose end is not written', { revoked: NOW - 100 * DAY });
  session('ended, named by a loan that has ended', { revoked: NOW - 100 * DAY });
  loan('ended, named by a loan whose end is not written', false);
  loan('ended, named by a loan that has ended', true);

  event('heartbeat 31 days old', 'heartbeat', NOW - 31 * DAY);
  event('heartbeat 29 days old', 'heartbeat', NOW - 29 * DAY);
  event('heartbeat 10 days old', 'heartbeat', NOW - 10 * DAY, 'ended, named by a progress report');
  event('opened a year and a day ago', 'opened', NOW - 366 * DAY);
  event('opened 100 days ago', 'opened', NOW - 100 * DAY, 'ended, named by an event');
  event('opened 400 days ago by a live browser', 'opened', NOW - 400 * DAY, 'live, named only by old events');
  event('play 400 days ago', 'play', NOW - 400 * DAY, 'ended, named only by old events');
  event('finished 364 days ago', 'finished', NOW - 364 * DAY);
  event('signed-in 400 days ago', 'signed-in', NOW - 400 * DAY);
  event('link-created 200 days ago', 'link-created', NOW - 200 * DAY);
  event('ticket-kept 366 days ago', 'ticket-kept', NOW - 366 * DAY);
  event('passkey-added 31 days ago', 'passkey-added', NOW - 31 * DAY);

  const left = () => {
    const ids = new Set(rowsOf(db, 'events').map((e) => e.id));
    return [...events].filter(([, id]) => ids.has(id)).map(([name]) => name);
  };
  return { db, settings, retention: createRetention({ db, settings }), event, session, left };
}

// With the default windows, at the fixture's NOW.
const DELETED = { progressReports: 1, events: 5, sessions: 4 };
const DELETED_EVENTS = ['heartbeat 31 days old', 'opened a year and a day ago', 'opened 400 days ago by a live browser', 'play 400 days ago', 'signed-in 400 days ago', 'ticket-kept 366 days ago'];
const DELETED_SESSIONS = ['signed out 31 days ago', 'expired 31 days ago', 'ended, named only by old events', 'ended, named by a loan that has ended'];

describe('what a clean-up deletes', () => {
  const NOW = Date.UTC(2027, 5, 15, 4);

  test('progress reports and other events go by their own windows, account events included', () => {
    const f = fixture(NOW);
    const all = f.left();
    assert.deepEqual(f.retention.run(NOW), DELETED);
    assert.deepEqual(f.left(), all.filter((name) => !DELETED_EVENTS.includes(name)));
  });

  // 1.x kept an ended browser while it held a play that could still be resumed. The
  // loan is what matters now: one whose end isn't written needs its browser's row, to
  // read when that browser ended; once the end is written the loan has all it needs.
  test('a browser goes only when it ended long enough ago, no event names it, and no loan whose end isn’t written names it; its tickets go with it', () => {
    const f = fixture(NOW);
    const sessions = rowsOf(f.db, 'sessions').map((s) => s.id_hash);
    const screenings = rowsOf(f.db, 'screenings');
    const loans = rowsOf(f.db, 'loans');
    f.retention.run(NOW);
    const left = rowsOf(f.db, 'sessions').map((s) => s.id_hash);
    assert.deepEqual(left, sessions.filter((h) => !DELETED_SESSIONS.includes(h)));
    assert.ok(left.includes('live') && left.includes('live, named only by old events'), 'a live browser is never deleted');
    assert.ok(left.includes('ended, named by a loan whose end is not written'));
    assert.deepEqual(rowsOf(f.db, 'session_tickets').map((st) => st.session_hash), left, 'the tickets of deleted browsers went with them, and only theirs');
    assert.deepEqual(rowsOf(f.db, 'screenings'), screenings, 'screenings keep the browser that held them, even a deleted one');
    assert.deepEqual(rowsOf(f.db, 'loans'), loans, 'and so do loans, with its device');
    // The sweep writes that loan's end, and logs it against its browser, dated when it
    // was due. From then the browser lives only as long as that event, like any other.
    const named = 'ended, named by a loan whose end is not written';
    assert.equal(createAccess(f.db, f.settings).sweep(NOW), 1);
    const swept = rowsOf(f.db, 'loans').find((l) => l.session_hash === named);
    assert.deepEqual([swept.ended_how, swept.ended_at], ['due', swept.due_at], 'it came due before its browser signed out');
    f.retention.run(NOW);
    assert.ok(rowsOf(f.db, 'sessions').some((x) => x.id_hash === named), 'its "returned" event, 117 days old, still names it');
    f.retention.run(NOW + 300 * DAY);
    assert.equal(rowsOf(f.db, 'sessions').some((x) => x.id_hash === named), false, 'gone with that event, a year after the tape came back');
    assert.deepEqual(rowsOf(f.db, 'loans').find((l) => l.session_hash === named), swept, 'the loan is untouched, and still says which device');
    for (const e of rowsOf(f.db, 'events').filter((e) => e.session_hash)) assert.ok(left.includes(e.session_hash), 'every event left still finds its browser');
  });

  test('the preview counts what a run deletes, and deletes nothing', () => {
    const f = fixture(NOW);
    const everything = tables(f.db, [...DELETABLE, ...UNTOUCHED]);
    assert.deepEqual(f.retention.preview(NOW), DELETED);
    assert.deepEqual(tables(f.db, [...DELETABLE, ...UNTOUCHED]), everything);
    assert.deepEqual(f.retention.run(NOW), DELETED);
    const none = { progressReports: 0, events: 0, sessions: 0 };
    assert.deepEqual(f.retention.preview(NOW), none, 'nothing more to do');
    assert.deepEqual(f.retention.run(NOW), none);
  });

  test('films, tickets, loans, responses, screenings, people, passkeys, links and settings are never touched', () => {
    const f = fixture(NOW);
    const untouched = tables(f.db);
    f.retention.run(NOW);
    f.retention.run(NOW + 20 * YEAR);
    assert.deepEqual(tables(f.db), untouched);
  });

  test('the windows are the settings', () => {
    const f = fixture(NOW);
    f.settings.update({ retainProgressDays: 5, retainEventsDays: 150, retainSessionsDays: 60 });
    assert.deepEqual(f.retention.status().settings, { retainProgressDays: 5, retainEventsDays: 150, retainSessionsDays: 60 });
    // Every progress report; events over 150 days old; browsers ended over 60 days ago
    // that nothing still names, now that their progress reports have gone.
    assert.deepEqual(f.retention.preview(NOW), { progressReports: 3, events: 7, sessions: 3 });
    assert.deepEqual(f.retention.run(NOW), { progressReports: 3, events: 7, sessions: 3 });
    assert.deepEqual(f.left(), ['opened 100 days ago', 'passkey-added 31 days ago']);
  });

  test('a browser signed out after it had expired ended when it expired', () => {
    const f = fixture(NOW);
    f.session('expired 40 days ago, signed out 5 days ago', { expires: NOW - 40 * DAY, revoked: NOW - 5 * DAY });
    f.retention.run(NOW);
    assert.equal(f.db.prepare('SELECT 1 FROM sessions WHERE id_hash = ?').get('expired 40 days ago, signed out 5 days ago'), undefined);
  });

  test('the last run is remembered from when the server started', () => {
    const f = fixture(NOW);
    assert.deepEqual(f.retention.status(), { lastRun: null, lastError: null, settings: DEFAULTS });
    const deleted = f.retention.run(NOW);
    const { lastRun, lastError } = f.retention.status();
    assert.deepEqual(lastRun.deleted, deleted);
    assert.ok(lastRun.at === NOW || Math.abs(lastRun.at - Date.now()) < MINUTE, `at ${lastRun.at}`);
    assert.equal(lastError, null);
    assert.equal(createRetention({ db: f.db, settings: f.settings }).status().lastRun, null, 'in memory only');
  });
});

describe('the daily clean-up', () => {
  test('runs about a minute after the server starts, then every 24 hours', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const f = fixture(Date.now());
    f.retention.start();
    assert.equal(f.retention.status().lastRun, null, 'not straight away');
    t.mock.timers.tick(2 * MINUTE);
    assert.deepEqual(f.retention.status().lastRun?.deleted, DELETED);

    f.event('a progress report that aged meanwhile', 'heartbeat', Date.now() - 40 * DAY);
    t.mock.timers.tick(HOUR);
    assert.ok(f.left().includes('a progress report that aged meanwhile'), 'not again within the hour');
    t.mock.timers.tick(24 * HOUR);
    assert.ok(!f.left().includes('a progress report that aged meanwhile'), 'and again the next day');
    assert.deepEqual(f.retention.status().lastRun.deleted, { progressReports: 1, events: 0, sessions: 0 });
  });

  test('a failed clean-up is logged and kept as the last error, deletes no event, and never throws', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const logged = t.mock.method(console, 'error', () => {});
    const f = fixture(Date.now());
    // The heartbeats can go; the account event can't. One transaction: neither goes.
    f.db.exec("CREATE TRIGGER refuse BEFORE DELETE ON events WHEN OLD.type = 'signed-in' BEGIN SELECT RAISE(ABORT, 'the disk is full'); END");
    const events = rowsOf(f.db, 'events');
    f.retention.start();
    assert.doesNotThrow(() => t.mock.timers.tick(2 * MINUTE));
    assert.ok(logged.mock.callCount() >= 1, 'logged with console.error');
    const { lastRun, lastError } = f.retention.status();
    assert.ok(lastError, 'kept in status().lastError');
    assert.match(JSON.stringify(lastError), /the disk is full/);
    assert.equal(lastRun, null);
    assert.deepEqual(rowsOf(f.db, 'events'), events);
  });
});

// ====================================================================== settings and the admin
describe('Keeping records, in Settings and the admin', () => {
  const mediaDir = tempDir();
  let srv;
  let admin;
  let viewer;
  let filmId;

  before(async () => {
    makeFilm(mediaDir, 'arrival');
    srv = await startServer({ mediaDir, limits: { scale: 100 } });
    admin = await adminBrowser(srv.base);
    await admin.post('/api/admin/scan');
    filmId = (await admin.get('/api/admin/films')).data[0].id;
    await admin.patch(`/api/admin/films/${filmId}`, { published: true });
    const ticket = (await admin.post('/api/admin/tickets', { filmId })).data[0];
    viewer = browser(srv.base);
    assert.equal((await viewer.post('/api/tickets/open', { code: ticket.code })).status, 200);
  });
  after(() => srv.close());

  test('three settings, public like the rest, with their defaults', async () => {
    for (const [key, value] of Object.entries(DEFAULTS)) assert.equal(DEFAULT_SETTINGS[key], value, key);
    const s = (await admin.get('/api/admin/settings')).data;
    for (const [key, value] of Object.entries(DEFAULTS)) assert.equal(s[key], value, key);
  });

  test('each is a whole number of days in its range; a refused save changes nothing', async () => {
    const ranges = { retainProgressDays: [1, 365], retainEventsDays: [30, 3650], retainSessionsDays: [1, 365] };
    for (const [key, [min, max]] of Object.entries(ranges)) {
      for (const value of [min - 1, max + 1, min + 0.5, String(min), null, -1]) {
        const r = await admin.patch('/api/admin/settings', { [key]: value });
        assert.equal(r.status, 400, `${key} = ${JSON.stringify(value)}`);
      }
      // Along with a valid value for another setting: all or nothing.
      assert.equal((await admin.patch('/api/admin/settings', { cinemaName: 'Elsewhere', [key]: max + 1 })).status, 400);
      const s = (await admin.get('/api/admin/settings')).data;
      assert.equal(s[key], DEFAULTS[key], key);
      assert.equal(s.cinemaName, DEFAULT_SETTINGS.cinemaName);
      for (const value of [min, max]) {
        const r = await admin.patch('/api/admin/settings', { [key]: value });
        assert.equal(r.status, 200, `${key} = ${value}: ${JSON.stringify(r.data)}`);
        assert.equal(r.data[key], value);
        assert.equal((await admin.get('/api/admin/retention')).data.settings[key], value);
      }
    }
    assert.equal((await admin.patch('/api/admin/settings', DEFAULTS)).status, 200);
  });

  test('the admin sees the settings, the last run and what a clean-up would delete now', async () => {
    const r = await admin.get('/api/admin/retention');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.data).sort(), ['lastError', 'lastRun', 'preview', 'settings']);
    assert.equal(r.data.lastRun, null, 'not yet since the server started');
    assert.equal(r.data.lastError, null);
    assert.deepEqual(r.data.settings, DEFAULTS);
    assert.deepEqual(Object.keys(r.data.preview).sort(), ['events', 'progressReports', 'sessions']);
    for (const n of Object.values(r.data.preview)) assert.ok(Number.isInteger(n) && n >= 0);
  });

  test('Clear now deletes what the preview said, and says what it cleared', async () => {
    const now = Date.now();
    const insert = srv.db.prepare('INSERT INTO events (at, type, film_id) VALUES (?, ?, ?)');
    insert.run(now - 40 * DAY, 'heartbeat', filmId);
    insert.run(now - 400 * DAY, 'opened', filmId);
    insert.run(now - 400 * DAY, 'link-created', null);
    srv.db.prepare("INSERT INTO sessions (id_hash, kind, created_at, last_seen_at, expires_at, revoked_at) VALUES ('old browser', 'viewer', ?, ?, ?, ?)")
      .run(now - 100 * DAY, now - 90 * DAY, now + 10 * DAY, now - 90 * DAY);

    const preview = (await admin.get('/api/admin/retention')).data.preview;
    assert.ok(preview.progressReports >= 1 && preview.events >= 2 && preview.sessions >= 1, JSON.stringify(preview));
    const r = await admin.post('/api/admin/retention/run', {});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(Object.keys(r.data).sort(), ['lastError', 'lastRun', 'preview', 'settings']);
    assert.deepEqual(r.data.lastRun.deleted, preview);
    assert.ok(Math.abs(r.data.lastRun.at - Date.now()) < MINUTE);
    assert.deepEqual(r.data.preview, { progressReports: 0, events: 0, sessions: 0 });
    assert.equal(srv.db.prepare("SELECT 1 FROM sessions WHERE id_hash = 'old browser'").get(), undefined);
    assert.deepEqual((await admin.get('/api/admin/retention')).data.lastRun, r.data.lastRun, 'remembered');
  });

  test('only the admin can see or clear', async () => {
    srv.db.prepare("INSERT INTO events (at, type, film_id) VALUES (?, 'heartbeat', ?)").run(Date.now() - 40 * DAY, filmId);
    const preview = (await admin.get('/api/admin/retention')).data.preview;
    for (const b of [browser(srv.base), viewer]) {
      assert.equal((await b.get('/api/admin/retention')).status, 401);
      assert.equal((await b.post('/api/admin/retention/run', {})).status, 401);
      assert.equal((await b.patch('/api/admin/settings', { retainProgressDays: 1 })).status, 401);
    }
    assert.deepEqual((await admin.get('/api/admin/retention')).data.preview, preview, 'nothing was cleared');
  });

  test('a browser lives as long as its events, so Activity still names the person', async () => {
    const p = await newPerson(admin, 'Robin');
    const auth = softAuthenticator();
    assert.equal((await enroll(browser(srv.base), (await setupLink(admin, p.id)).token, { auth })).status, 200);
    const ticket = (await admin.post('/api/admin/tickets', { filmId, personId: p.id })).data[0];
    const laptop = browser(srv.base);
    assert.equal((await signIn(laptop, auth)).status, 200);
    assert.equal((await laptop.get('/api/films/arrival')).status, 200);
    const laptopHash = hashOf(laptop);
    await laptop.post('/api/signout');
    // Signed out two months ago; the film page was opened last week.
    srv.db.prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ?').run(Date.now() - 60 * DAY, laptopHash);
    srv.db.prepare('UPDATE events SET at = ? WHERE session_hash = ?').run(Date.now() - 7 * DAY, laptopHash);

    assert.equal((await admin.patch('/api/admin/settings', { retainSessionsDays: 1 })).status, 200);
    await admin.post('/api/admin/retention/run', {});
    assert.ok(srv.db.prepare('SELECT 1 FROM sessions WHERE id_hash = ?').get(laptopHash), 'its events still name it');
    const opened = (await admin.get(`/api/admin/activity?person=${p.id}`)).data.events.find((e) => e.type === 'opened' && e.ticketId === ticket.id);
    assert.ok(opened, 'Activity finds the person through the browser');
    assert.equal(opened.personName, 'Robin');
    assert.ok(opened.device);

    // A year on, its events have gone, and so has it.
    srv.db.prepare('UPDATE events SET at = ? WHERE session_hash = ?').run(Date.now() - 400 * DAY, laptopHash);
    await admin.post('/api/admin/retention/run', {});
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM events WHERE session_hash = ?').get(laptopHash).n, 0);
    assert.equal(srv.db.prepare('SELECT 1 FROM sessions WHERE id_hash = ?').get(laptopHash), undefined);
    assert.equal((await admin.patch('/api/admin/settings', DEFAULTS)).status, 200);
  });
});
