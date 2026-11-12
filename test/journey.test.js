// The journey: import a film, publish it, send a link, open it in another browser,
// press Play (which takes the film's one tape), watch, and see it come due; then
// start-by dates, cancelling a link and the admin's own preview. Milestone 1's
// journey, retold for version 2 (docs/version-2.md): one tape per film, and a link
// lends once.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { FILM_SECONDS, addFilm, adminBrowser, browser, makeFilm, startServer, tempDir } from './helpers.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let srv;
let admin;
let filmId;
const mediaDir = tempDir();

const master = (slug) => `/media/${slug}/hls/master.m3u8`;
const MASTER = master('arrival');
const PLAYBACK_FILES = [
  MASTER,
  '/media/arrival/hls/v_h264_720/index.m3u8',
  '/media/arrival/hls/v_h264_720/init.mp4',
  '/media/arrival/hls/v_h264_720/seg_3.m4s',
  '/media/arrival/hls/a_fr/seg_0.m4s',
  '/media/arrival/subtitles/en.vtt',
];

async function newTicket(fields = {}) {
  const r = await admin.post('/api/admin/tickets', { filmId, ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data[0];
}

async function openTicket(b, ticket, slug = 'arrival') {
  const r = await b.post('/api/tickets/open', { code: ticket.code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.slug, slug);
}

// A film of its own for a test that presses Play outside the one ticket's journey.
const ownFilm = (slug) => addFilm(admin, mediaDir, slug);

async function statuses(b, urls) {
  return Promise.all(urls.map(async (u) => (await b.get(u)).status));
}

before(async () => {
  makeFilm(mediaDir, 'arrival');
  srv = await startServer({ mediaDir });
  admin = await adminBrowser(srv.base);
});
after(() => srv.close());

describe('import and publish', () => {
  test('a scan imports the folder as an unpublished film', async () => {
    const r = await admin.post('/api/admin/scan');
    assert.equal(r.status, 200);
    const film = r.data.films.find((f) => f.slug === 'arrival');
    assert.equal(film.status, 'ok', JSON.stringify(film));
    assert.equal(film.added, true);

    const films = (await admin.get('/api/admin/films')).data;
    assert.equal(films[0].published, false);
    assert.equal(films[0].recommendation, 'Watch it with the lights off.');
    assert.equal(films[0].media.durationSeconds, FILM_SECONDS);
    filmId = films[0].id;
  });

  test('tickets to an unpublished film open nothing', async () => {
    const ticket = await newTicket();
    const viewer = browser(srv.base);
    const r = await viewer.post('/api/tickets/open', { code: ticket.code });
    assert.equal(r.status, 409);
    assert.equal(r.data.error, 'film-unavailable');
  });

  test('publishing makes the film reachable with a ticket, and only with a ticket', async () => {
    const r = await admin.patch(`/api/admin/films/${filmId}`, { published: true });
    assert.equal(r.data.published, true);
    const stranger = browser(srv.base);
    assert.equal((await stranger.get('/api/films/arrival')).status, 404);
    assert.equal((await stranger.get('/media/arrival/poster.jpg')).status, 403);
    assert.deepEqual(await statuses(stranger, PLAYBACK_FILES), PLAYBACK_FILES.map(() => 403));
  });
});

describe('a link from opening to the tape coming due', () => {
  let ticket;
  // The browser the friend is watching in, and a second one they open the link in.
  let viewer;
  let tv;
  let loan;
  const loanRow = () => srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(ticket.id);

  test('opening the link shows the page without taking the tape', async () => {
    // 1.x's play limit and days after the first play are still sent by its send form: accepted, and ignored.
    ticket = await newTicket({ label: 'Sam', loanDays: 5, screeningLimit: 1, daysAfterFirstPlay: 3 });
    assert.deepEqual([ticket.screeningLimit, ticket.daysAfterFirstPlay], [null, null]);
    viewer = browser(srv.base);
    await openTicket(viewer, ticket);

    const page = await viewer.get('/api/films/arrival');
    assert.equal(page.status, 200);
    assert.equal(page.data.film.recommendation, 'Watch it with the lights off.');
    assert.equal(page.data.access.canPlay, true);
    // One set of keys, in every state. The play limits and the days after the first play are gone.
    assert.deepEqual(page.data.access.ticket, {
      state: 'ok', tape: 'in', loanDays: 5, startBy: null, dueBack: null, loan: null, returned: null, inAccount: false, expiresAt: null, openScreening: null,
    });
    assert.equal(page.data.film.media.masterUrl, undefined, 'the playlist URL is only handed out on Play');
    assert.equal(loanRow(), undefined, 'opening takes nothing');
    assert.equal(srv.db.prepare('SELECT first_played_at FROM tickets WHERE id = ?').get(ticket.id).first_played_at, null);

    assert.equal((await viewer.get('/media/arrival/poster.jpg')).status, 200);
    // A link alone doesn't unlock the stream: pressing Play does.
    assert.deepEqual(await statuses(viewer, PLAYBACK_FILES), PLAYBACK_FILES.map(() => 403));
  });

  test('pressing Play takes the tape, due back after the link’s days, and unlocks every playback file', async () => {
    const r = await viewer.post('/api/films/arrival/screenings');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual([r.data.resumed, r.data.took, r.data.toBrowser], [false, true, true]);
    assert.equal(r.data.masterUrl, MASTER);
    assert.equal(r.data.dueBack, r.data.takenAt + 5 * DAY);
    assert.deepEqual(await statuses(viewer, PLAYBACK_FILES), PLAYBACK_FILES.map(() => 200));
    assert.equal((await viewer.get('/media/arrival/film.json')).status, 404);
    assert.equal((await viewer.get('/media/arrival/hls/../film.json')).status, 404);

    loan = loanRow();
    assert.deepEqual([loan.film_id, loan.screening_id, loan.person_id, loan.ended_at], [filmId, r.data.screeningId, null, null]);
    assert.deepEqual([loan.taken_at, loan.due_at], [r.data.takenAt, r.data.dueBack]);
    const page = (await viewer.get('/api/films/arrival')).data.access;
    assert.equal(page.canPlay, true);
    assert.deepEqual(page.ticket, {
      state: 'ok', tape: 'yours', loanDays: null, startBy: null, dueBack: loan.due_at,
      loan: { takenAt: loan.taken_at, position: 0, finishedAt: null, toBrowser: true },
      returned: null, inAccount: false,
      // 1.1.0's two fields, until its pages are rebuilt: the due date, and where to resume.
      expiresAt: loan.due_at, openScreening: { resumableUntil: loan.due_at, position: 0 },
    });

    // The back office, still in 1.x's fields: one play, and the loan's due time as the expiry.
    const t = (await admin.get(`/api/admin/tickets/${ticket.id}`)).data;
    assert.equal(t.state, 'ok');
    assert.equal(t.screeningsUsed, 1);
    assert.equal(t.firstPlayedAt, loan.taken_at);
    assert.equal(t.expiresAt, loan.due_at);
    assert.deepEqual([t.openScreening.id, t.openScreening.playingNow, t.openScreening.resumableUntil], [r.data.screeningId, true, loan.due_at]);
    const kinds = (await admin.get(`/api/admin/activity?ticket=${ticket.id}`)).data.events.map((e) => e.type);
    assert.deepEqual(kinds.toSorted(), ['lent', 'opened', 'play', 'ticket-sent']);
  });

  test('refreshing resumes the same play: the tape is taken once', async () => {
    await viewer.post(`/api/screenings/${(await viewer.post('/api/films/arrival/screenings')).data.screeningId}/heartbeat`, { position: 40 });
    const again = await viewer.post('/api/films/arrival/screenings');
    assert.deepEqual([again.data.resumed, again.data.took, again.data.position], [true, false, 40]);
    assert.deepEqual([again.data.takenAt, again.data.dueBack], [loan.taken_at, loan.due_at]);
    const t = (await admin.get(`/api/admin/tickets/${ticket.id}`)).data;
    assert.equal(t.screeningsUsed, 1);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM loans').get().n, 1);
  });

  // 1.x let a second device on the link take over once the first paused. The borrower
  // on a link anyone can use is the browser that pressed Play (question 12, answer a).
  test('a second browser on the same link sees "out", like anyone, and cannot take over even once the first pauses', async () => {
    tv = browser(srv.base);
    await openTicket(tv, ticket);
    const out = { state: 'out', tape: 'out', loanDays: null, startBy: null, dueBack: loan.due_at, loan: null, returned: null, inAccount: false, expiresAt: null, openScreening: null };
    const page = (await tv.get('/api/films/arrival')).data.access;
    assert.equal(page.canPlay, false);
    assert.deepEqual(page.ticket, out);
    const blocked = await tv.post('/api/films/arrival/screenings');
    assert.deepEqual([blocked.status, blocked.data], [409, { error: 'out' }]);
    assert.equal((await tv.get(MASTER)).status, 403);

    const { screeningId } = (await viewer.post('/api/films/arrival/screenings')).data;
    await viewer.post(`/api/screenings/${screeningId}/heartbeat`, { position: 50, playing: false });

    const still = await tv.post('/api/films/arrival/screenings');
    assert.deepEqual([still.status, still.data], [409, { error: 'out' }], 'a pause frees nothing for another browser');
    assert.deepEqual((await tv.get('/api/films/arrival')).data.access.ticket, out);
    assert.equal((await tv.get(MASTER)).status, 403);
    // Nor can it learn which play has the tape: any screening id is "no such screening".
    const hb = await tv.post(`/api/screenings/${screeningId}/heartbeat`, { position: 51 });
    assert.deepEqual([hb.status, hb.data.error], [404, 'not-found']);
    assert.equal((await viewer.get(MASTER)).status, 200, 'the borrower keeps the stream');
    assert.equal((await viewer.post('/api/films/arrival/screenings')).data.position, 50);
  });

  test('reaching 92% of the running time marks the play finished, once, and the tape stays out', async () => {
    const { screeningId } = (await viewer.post('/api/films/arrival/screenings')).data;
    await viewer.post(`/api/screenings/${screeningId}/heartbeat`, { position: FILM_SECONDS * 0.9 });
    let events = (await admin.get(`/api/admin/activity?ticket=${ticket.id}`)).data.events;
    assert.equal(events.filter((e) => e.type === 'finished').length, 0);
    await viewer.post(`/api/screenings/${screeningId}/heartbeat`, { position: FILM_SECONDS * 0.93 });
    await viewer.post(`/api/screenings/${screeningId}/heartbeat`, { position: FILM_SECONDS });
    events = (await admin.get(`/api/admin/activity?ticket=${ticket.id}`)).data.events;
    assert.equal(events.filter((e) => e.type === 'finished').length, 1);
    assert.ok(events.some((e) => e.type === 'opened'));
    assert.ok(events.some((e) => e.type === 'play'));

    // Finishing ends nothing: it's theirs until it's due, to watch a scene again.
    const page = (await viewer.get('/api/films/arrival')).data.access;
    assert.deepEqual([page.canPlay, page.ticket.tape, page.ticket.dueBack], [true, 'yours', loan.due_at]);
    assert.ok(page.ticket.loan.finishedAt);
    assert.equal(loanRow().ended_at, null);
    assert.equal((await viewer.post('/api/films/arrival/screenings')).data.resumed, true);
    assert.equal((await viewer.get(MASTER)).status, 200);
    assert.equal((await tv.post('/api/films/arrival/screenings')).data.error, 'out');
  });

  // 1.x: the window to come back closed and the link was "used up", unless it had
  // plays left; and the link's own expiry beat the window. One clock now: the due time.
  test('when the tape comes due, the link is spent: it explains itself and plays nothing, in either browser', async () => {
    assert.equal((await viewer.get(MASTER)).status, 200);
    // Due a moment ago. The whole loan moves back, so it still began before it was due.
    srv.db.prepare('UPDATE loans SET taken_at = ?, due_at = ? WHERE id = ?').run(Date.now() - 1 - 5 * DAY, Date.now() - 1, loan.id);
    loan = loanRow();
    assert.equal((await viewer.get(MASTER)).status, 403, 'the very next media request');
    const page = await viewer.get('/api/films/arrival');
    assert.equal(page.status, 200);
    assert.equal(page.data.access.canPlay, false);
    assert.deepEqual(page.data.access.ticket, {
      state: 'spent', tape: null, loanDays: null, startBy: null, dueBack: null, loan: null,
      returned: { at: loan.due_at, how: 'due' }, inAccount: false, expiresAt: null, openScreening: null,
    });
    assert.equal(loanRow().ended_at, null, 'reading the page writes nothing');
    const r = await viewer.post('/api/films/arrival/screenings');
    assert.deepEqual([r.status, r.data], [409, { error: 'spent' }]);
    assert.equal((await viewer.get(MASTER)).status, 403);
    assert.deepEqual([loanRow().ended_at, loanRow().ended_how], [loan.due_at, 'due'], 'Play wrote the end, dated when it was due');

    // The other browser's link is the same link: spent. Only the borrower is told when it came back.
    const other = (await tv.get('/api/films/arrival')).data.access;
    assert.deepEqual([other.canPlay, other.ticket.state, other.ticket.tape, other.ticket.returned], [false, 'spent', null, null]);
    assert.deepEqual((await tv.post('/api/films/arrival/screenings')).data, { error: 'spent' });

    const t = (await admin.get(`/api/admin/tickets/${ticket.id}`)).data;
    assert.deepEqual([t.state, t.openScreening, t.expiresAt], ['used_up', null, null], 'the back office’s 1.x word for a link that has lent');
    const returned = (await admin.get(`/api/admin/activity?ticket=${ticket.id}`)).data.events.filter((e) => e.type === 'returned');
    assert.equal(returned.length, 1);
    assert.deepEqual([returned[0].at, returned[0].detail], [loan.due_at, { loanId: loan.id, how: 'due', response: false }]);
  });

  test('cancelling a spent link takes its page away, and the link opens nothing', async () => {
    await admin.post(`/api/admin/tickets/${ticket.id}/revoke`);
    assert.equal((await viewer.get('/api/films/arrival')).status, 404);
    assert.equal((await tv.get('/api/films/arrival')).status, 404);
    const reopen = await browser(srv.base).post('/api/tickets/open', { code: ticket.code });
    assert.equal(reopen.status, 410);
  });
});

describe('link rules', () => {
  test('a start-by deadline that passes before the first Play expires the link', async () => {
    const startBy = Date.now() - 1000;
    const ticket = await newTicket({ startBy });
    const b = browser(srv.base);
    await openTicket(b, ticket);
    const page = await b.get('/api/films/arrival');
    assert.deepEqual([page.data.access.ticket.state, page.data.access.ticket.tape, page.data.access.ticket.startBy], ['expired', null, startBy]);
    assert.equal((await b.post('/api/films/arrival/screenings')).data.error, 'expired');
  });

  test('a start-by deadline stops mattering once the tape has been taken', async () => {
    const film = await ownFilm('start-by');
    const ticket = await newTicket({ filmId: film.id, startBy: Date.now() + HOUR });
    const b = browser(srv.base);
    await openTicket(b, ticket, film.slug);
    assert.equal((await b.get(`/api/films/${film.slug}`)).data.access.ticket.startBy, ticket.startBy);
    assert.equal((await b.post(`/api/films/${film.slug}/screenings`)).status, 200);
    srv.db.prepare('UPDATE tickets SET start_by = ? WHERE id = ?').run(Date.now() - 1000, ticket.id);
    assert.equal((await b.get(master(film.slug))).status, 200);
    assert.deepEqual((({ state, tape, startBy }) => [state, tape, startBy])((await b.get(`/api/films/${film.slug}`)).data.access.ticket), ['ok', 'yours', null]);
  });

  // 1.x: "a limit of two screenings allows exactly two". There is no limit to count
  // now: a link lends once, and while the tape is out Play is pressed as often as you like.
  test('a link lends once: as many plays as you like while it has the tape, none once the tape is back', async () => {
    const film = await ownFilm('lends-once');
    const ticket = await newTicket({ filmId: film.id, screeningLimit: 2 });
    const b = browser(srv.base);
    await openTicket(b, ticket, film.slug);
    const first = (await b.post(`/api/films/${film.slug}/screenings`)).data;
    assert.equal(first.took, true);
    for (let i = 0; i < 3; i++) {
      const r = (await b.post(`/api/films/${film.slug}/screenings`)).data;
      assert.deepEqual([r.resumed, r.screeningId], [true, first.screeningId]);
    }
    srv.db.prepare('UPDATE loans SET taken_at = ?, due_at = ? WHERE ticket_id = ?').run(Date.now() - 1 - 3 * DAY, Date.now() - 1, ticket.id);
    assert.equal((await b.post(`/api/films/${film.slug}/screenings`)).data.error, 'spent');
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM screenings WHERE ticket_id = ?').get(ticket.id).n, 1);
    // A second loan on one link is refused by the database itself.
    const l = srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(ticket.id);
    assert.throws(
      () => srv.db.prepare('INSERT INTO loans (film_id, ticket_id, screening_id, session_hash, taken_at, due_at) VALUES (?, ?, ?, ?, ?, ?)').run(l.film_id, l.ticket_id, l.screening_id, 'x', 1, 2),
      /UNIQUE constraint failed: loans\./,
    );
  });

  test('a tape past due is taken by the next link, with nothing written in between', async () => {
    const film = await ownFilm('next-link');
    const first = browser(srv.base);
    const next = browser(srv.base);
    const a = await newTicket({ filmId: film.id });
    const b = await newTicket({ filmId: film.id });
    await openTicket(first, a, film.slug);
    await openTicket(next, b, film.slug);
    assert.equal((await first.post(`/api/films/${film.slug}/screenings`)).status, 200);
    assert.deepEqual((await next.post(`/api/films/${film.slug}/screenings`)).data, { error: 'out' });
    assert.equal((await next.get(`/api/films/${film.slug}`)).data.access.ticket.state, 'out');

    srv.db.prepare('UPDATE loans SET taken_at = ?, due_at = ? WHERE ticket_id = ?').run(Date.now() - 1 - 3 * DAY, Date.now() - 1, a.id);
    const old = () => srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(a.id);
    // No sweep has run and nothing was returned: the page already says the tape is in.
    const page = (await next.get(`/api/films/${film.slug}`)).data.access;
    assert.deepEqual([page.canPlay, page.ticket.state, page.ticket.tape, page.ticket.dueBack], [true, 'ok', 'in', null]);
    assert.equal(old().ended_at, null);
    const took = await next.post(`/api/films/${film.slug}/screenings`);
    assert.equal(took.status, 200, JSON.stringify(took.data));
    assert.equal(took.data.took, true);
    assert.deepEqual([old().ended_at, old().ended_how], [old().due_at, 'due'], 'Play closed the old loan in the same step, at its due time');
    assert.equal((await next.get(master(film.slug))).status, 200);
    assert.equal((await first.get(master(film.slug))).status, 403);
    assert.deepEqual((await first.post(`/api/films/${film.slug}/screenings`)).data, { error: 'spent' });
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM loans WHERE film_id = ? AND ended_at IS NULL').get(film.id).n, 1);
  });

  test('unpublishing hides the page from link holders', async () => {
    const ticket = await newTicket();
    const b = browser(srv.base);
    await openTicket(b, ticket);
    await admin.patch(`/api/admin/films/${filmId}`, { published: false });
    assert.equal((await b.get('/api/films/arrival')).status, 404);
    await admin.patch(`/api/admin/films/${filmId}`, { published: true });
    assert.equal((await b.get('/api/films/arrival')).status, 200);
  });

  test('unknown codes are rejected without detail', async () => {
    const r = await browser(srv.base).post('/api/tickets/open', { code: 'nope' });
    assert.equal(r.status, 404);
  });

  test('your own preview plays without taking the tape, whether it is in or out', async () => {
    const film = await ownFilm('preview');
    const loans = () => srv.db.prepare('SELECT COUNT(*) AS n FROM loans WHERE film_id = ?').get(film.id).n;
    const screenings = () => srv.db.prepare('SELECT COUNT(*) AS n FROM screenings WHERE film_id = ?').get(film.id).n;
    const r = await admin.post(`/api/films/${film.slug}/screenings`);
    assert.deepEqual([r.status, r.data.preview, r.data.screeningId], [200, true, null]);
    assert.equal((await admin.get(master(film.slug))).status, 200);
    assert.deepEqual([loans(), screenings()], [0, 0], 'a preview takes nothing');

    // With the tape out with a friend, the preview still plays, and the friend's loan is untouched.
    const b = browser(srv.base);
    await openTicket(b, await newTicket({ filmId: film.id }), film.slug);
    assert.equal((await b.post(`/api/films/${film.slug}/screenings`)).status, 200);
    assert.equal((await admin.post(`/api/films/${film.slug}/screenings`)).data.preview, true);
    assert.equal((await admin.get(master(film.slug))).status, 200);
    assert.equal((await admin.get(`/api/films/${film.slug}`)).data.access.preview, true);
    assert.deepEqual([loans(), screenings()], [1, 1]);
    assert.equal((await b.get(master(film.slug))).status, 200);
  });
});

describe('admin protection', () => {
  test('admin API needs a session and the right password', async () => {
    const b = browser(srv.base);
    assert.equal((await b.get('/api/admin/films')).status, 401);
    assert.equal((await b.post('/api/admin/login', { password: 'wrong' })).status, 401);
  });

  test('mutating requests must be JSON', async () => {
    const res = await fetch(`${srv.base}/api/admin/login`, { method: 'POST', body: 'password=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(res.status, 415);
  });
});

test('cancelling a link blocks its page and the very next media request, and the admin shows no open play on it', async () => {
  // A link of its own, played and then cancelled, so there is always one to check.
  const film = await ownFilm('revoked');
  const ticket = await newTicket({ filmId: film.id });
  const b = browser(srv.base);
  await openTicket(b, ticket, film.slug);
  assert.equal((await b.post(`/api/films/${film.slug}/screenings`)).status, 200);
  assert.equal((await b.get(`/media/${film.slug}/hls/v_h264_720/seg_4.m4s`)).status, 200);
  await admin.post(`/api/admin/tickets/${ticket.id}/revoke`);
  assert.equal((await b.get(`/media/${film.slug}/hls/v_h264_720/seg_5.m4s`)).status, 403);
  assert.equal((await b.get(master(film.slug))).status, 403);
  assert.equal((await b.get(`/api/films/${film.slug}`)).status, 404);
  assert.equal((await browser(srv.base).post('/api/tickets/open', { code: ticket.code })).status, 410);
  const revoked = (await admin.get('/api/admin/tickets')).data.filter((t) => t.state === 'revoked');
  assert.ok(revoked.some((t) => t.id === ticket.id), 'the link cancelled here is listed');
  for (const t of revoked) assert.equal(t.openScreening, null);
});
