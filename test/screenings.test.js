// The numbers behind a loan and its playback, checked at their exact values: how
// long a tape is lent for and its setting, the quiet time before another of the
// borrower's devices can take over, the limits on a progress report's position, and
// where "finished" begins. Then what the player is told when its tape comes due under
// it, and the limit on pressing Play. Written from docs/version-2.md and
// docs/access.md. A slip in any value's units (seconds for milliseconds, hours for
// days) fails here.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';

const { FILM_SECONDS, addFilm, adminBrowser, browser, enroll, makeFilm, newPerson, setupLink, signIn, startServer, tempDir } = await import('./helpers.js');
const { createAccess } = await import('../server/access.js');
const { createSettings } = await import('../server/settings.js');

const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const DAY = 24 * HOUR;
const master = (slug) => `/media/${slug}/hls/master.m3u8`;
const segment = (slug) => `/media/${slug}/hls/v_h264_720/seg_2.m4s`;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const mediaDir = tempDir();
let srv;
let admin;
let filmId;

before(async () => {
  makeFilm(mediaDir, 'arrival');
  srv = await startServer({ mediaDir, limits: { scale: 100 } });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  filmId = (await admin.get('/api/admin/films')).data[0].id;
  await admin.patch(`/api/admin/films/${filmId}`, { published: true });
});
after(() => srv.close());

// A film of its own for each test that presses Play: one test's tape is never
// in another's way.
const ownFilm = (slug) => addFilm(admin, mediaDir, slug);
async function issue(fields = {}) {
  const r = await admin.post('/api/admin/tickets', { filmId, ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data[0];
}
async function opened(ticket, b = browser(srv.base)) {
  const r = await b.post('/api/tickets/open', { code: ticket.code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return b;
}
async function play(b, slug = 'arrival') {
  const r = await b.post(`/api/films/${slug}/screenings`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const report = (b, id, body) => b.post(`/api/screenings/${id}/heartbeat`, body);
const screening = (id) => srv.db.prepare('SELECT * FROM screenings WHERE id = ?').get(id);
const loanOf = (screeningId) => srv.db.prepare('SELECT * FROM loans WHERE screening_id = ?').get(screeningId);
const lentFor = (screeningId) => loanOf(screeningId).due_at - loanOf(screeningId).taken_at;
// The tape came due a moment ago: the whole loan moves back, so it still began before it was due.
const comeDue = (screeningId) => {
  const l = loanOf(screeningId);
  srv.db.prepare('UPDATE loans SET taken_at = ?, due_at = ? WHERE id = ?').run(Date.now() - 1 - (l.due_at - l.taken_at), Date.now() - 1, l.id);
};

// ====================================================================== the loan length
describe('how long a tape is lent for', () => {
  test('3 days, counted from the moment Play is pressed, and pressing Play again never moves the date', async () => {
    const b = await opened(await issue());
    const before = Date.now();
    const first = await play(b);
    assert.equal(first.took, true);
    assert.equal(lentFor(first.screeningId), 3 * DAY);
    assert.equal(first.dueBack, loanOf(first.screeningId).due_at);
    assert.equal(first.takenAt, loanOf(first.screeningId).taken_at);
    assert.ok(first.takenAt >= before && first.takenAt <= Date.now(), 'taken when Play was pressed');
    // 1.1.0's page reads the due time under this name until it is rebuilt.
    assert.equal(first.resumableUntil, first.dueBack);
    const again = await play(b);
    assert.deepEqual([again.resumed, again.took, again.screeningId], [true, false, first.screeningId]);
    assert.equal(again.dueBack, first.dueBack);
    assert.equal(again.takenAt, first.takenAt);
    assert.equal((await b.get('/api/site')).data.loanDays, 3, 'the shop’s default is sent to every browser');
    assert.equal(Object.hasOwn((await b.get('/api/site')).data, 'resumeWindowHours'), false, '1.x’s time to come back is gone');
  });

  test('a new default applies to tapes taken after the change, not to one that is out; a link’s own days win', async () => {
    const out = await ownFilm('loan-default-out');
    const later = await ownFilm('loan-default-later');
    const own = await ownFilm('loan-own-days');
    const before = await opened(await issue({ filmId: out.id }));
    const open = (await play(before, out.slug)).screeningId;
    // Sent before the change, with no days of its own: the default as it is when Play is pressed.
    const waiting = await opened(await issue({ filmId: later.id }));
    assert.equal((await waiting.get(`/api/films/${later.slug}`)).data.access.ticket.loanDays, 3);
    const fixed = await opened(await issue({ filmId: own.id, loanDays: 10 }));
    assert.equal((await admin.patch('/api/admin/settings', { loanDays: 7 })).status, 200);
    try {
      assert.equal((await waiting.get(`/api/films/${later.slug}`)).data.access.ticket.loanDays, 7, 'the page says what Play would lend');
      assert.equal(lentFor((await play(waiting, later.slug)).screeningId), 7 * DAY, 'a tape taken now uses the new default');
      assert.equal(lentFor(open), 3 * DAY, 'one that is out keeps its date');
      assert.equal((await play(before, out.slug)).dueBack, loanOf(open).taken_at + 3 * DAY, 'even when Play is pressed again');
      assert.equal((await fixed.get(`/api/films/${own.slug}`)).data.access.ticket.loanDays, 10);
      assert.equal(lentFor((await play(fixed, own.slug)).screeningId), 10 * DAY, 'a link sent with its own days lends for those');
    } finally {
      await admin.patch('/api/admin/settings', { loanDays: 3 });
    }
  });

  test('the setting, and a link’s own days, are whole numbers from 1 to 30', async () => {
    for (const v of [0, 31, 1.5, '3', null]) {
      assert.equal((await admin.patch('/api/admin/settings', { loanDays: v })).status, 400, JSON.stringify(v));
    }
    for (const v of [1, 30, 3]) {
      const r = await admin.patch('/api/admin/settings', { loanDays: v });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.loanDays, v);
    }
    for (const v of [0, 31, 1.5, 'three', -1]) {
      assert.equal((await admin.post('/api/admin/tickets', { filmId, loanDays: v })).status, 400, JSON.stringify(v));
    }
    const days = (id) => srv.db.prepare('SELECT loan_days FROM tickets WHERE id = ?').get(id).loan_days;
    assert.equal(days((await issue({ loanDays: 1 })).id), 1);
    assert.equal(days((await issue({ loanDays: 30 })).id), 30);
    // Left out, or empty as a form sends it: the shop's default, as it is when Play is pressed.
    for (const v of [undefined, null, '']) assert.equal(days((await issue({ loanDays: v })).id), null, JSON.stringify(v));
  });

  test('1.x’s "Time to come back" is retired: its Settings page may still send it, and it is never stored', async () => {
    const stored = () => srv.db.prepare("SELECT value FROM settings WHERE key = 'resumeWindowHours'").get();
    // As 1.1.0's Settings page saves: the retired field with the others, whatever it holds.
    for (const v of [48, 2, null, 'nonsense']) {
      const r = await admin.patch('/api/admin/settings', { cinemaName: 'Open Matte', resumeWindowHours: v });
      assert.equal(r.status, 200, JSON.stringify(v));
      assert.equal(Object.hasOwn(r.data, 'resumeWindowHours'), false);
      assert.equal(stored(), undefined);
    }
    // A shop upgraded from 1.x has the row: it stays, and nothing reads it.
    srv.db.prepare("INSERT INTO settings (key, value) VALUES ('resumeWindowHours', '2')").run();
    try {
      assert.equal(Object.hasOwn((await admin.get('/api/admin/settings')).data, 'resumeWindowHours'), false);
      assert.equal((await admin.get('/api/admin/settings')).data.loanDays, 3);
      assert.equal((await admin.patch('/api/admin/settings', { resumeWindowHours: 720 })).status, 200);
      assert.equal(stored().value, '2', 'the stored row is left as it was');
    } finally {
      srv.db.prepare("DELETE FROM settings WHERE key = 'resumeWindowHours'").run();
    }
    // A key that never was a setting is still refused.
    assert.equal((await admin.patch('/api/admin/settings', { resumeWindowMinutes: 5 })).status, 400);
  });

  test('when the tape comes due while the film plays, it stops, the player is told it was due, and the link is spent', async () => {
    const film = await ownFilm('comes-due');
    const b = await opened(await issue({ filmId: film.id }));
    const { screeningId } = await play(b, film.slug);
    assert.equal((await report(b, screeningId, { position: 30 })).status, 200);
    assert.equal((await b.get(segment(film.slug))).status, 200);
    comeDue(screeningId);
    assert.equal((await b.get(segment(film.slug))).status, 403, 'the next media request is refused');
    const r = await report(b, screeningId, { position: FILM_SECONDS });
    assert.deepEqual([r.status, r.data.error], [409, 'due']);
    assert.equal(screening(screeningId).finished_at, null, 'a refused report finishes nothing');
    assert.equal(screening(screeningId).position_seconds, 30, 'and moves nothing');
    assert.equal(loanOf(screeningId).ended_at, null, 'nothing has written the end: every read decides by the clock');

    // A link lends once: 1.x started a new play here, for a link with plays left.
    const again = await b.post(`/api/films/${film.slug}/screenings`);
    assert.deepEqual([again.status, again.data.error], [409, 'spent']);
    const loan = loanOf(screeningId);
    assert.deepEqual([loan.ended_at, loan.ended_how], [loan.due_at, 'due'], 'Play wrote the end down, dated when it was due');
    const page = (await b.get(`/api/films/${film.slug}`)).data.access;
    assert.equal(page.canPlay, false);
    assert.deepEqual([page.ticket.state, page.ticket.tape, page.ticket.dueBack, page.ticket.loan], ['spent', null, null, null]);
    assert.deepEqual(page.ticket.returned, { at: loan.due_at, how: 'due' }, 'the one who borrowed is told when it went back, and that it was due');
  });
});

// ====================================================================== one device at a time
describe('one device at a time', () => {
  // Called directly with a clock, so no test waits 75 seconds.
  const access = () => createAccess(srv.db, createSettings(srv.db));
  const session = (b) => srv.db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(sha256(b.jar.get('om_session')));
  const row = (film) => srv.db.prepare('SELECT * FROM films WHERE id = ?').get(film.id);
  // A member signed in on two devices with one (synced) passkey.
  async function twoDevices(name) {
    const p = await newPerson(admin, name);
    const auth = softAuthenticator();
    const laptop = browser(srv.base);
    assert.equal((await enroll(laptop, (await setupLink(admin, p.id)).token, { auth })).status, 200);
    const tv = browser(srv.base);
    assert.equal((await signIn(tv, auth)).status, 200);
    return { p, laptop: session(laptop), tv: session(tv) };
  }

  test('another of the borrower’s devices can take over 75 seconds after Play or the last report, and not a moment before', async () => {
    const a = access();
    const own = await ownFilm('takeover');
    const film = () => row(own);
    const { p, laptop, tv } = await twoDevices('Takeover Tess');
    await issue({ filmId: own.id, personId: p.id });
    const t0 = Date.now();

    const started = a.startScreening(laptop, film(), t0);
    assert.equal(started.resumed, false);
    assert.equal(started.loan.person_id, p.id, 'the tape is the member’s, on every device');
    assert.equal(a.startScreening(tv, film(), t0 + 75 * SECOND - 1).error, 'playing-elsewhere', 'busy for 75 seconds after Play');

    const t1 = t0 + 60 * SECOND;
    assert.deepEqual(a.heartbeat(laptop, started.screening.id, { position: 30 }, t1), { ok: true });
    assert.equal(a.startScreening(tv, film(), t1 + 75 * SECOND - 1).error, 'playing-elsewhere', 'and for 75 seconds after each report');

    const t2 = t1 + 75 * SECOND;
    const takeover = a.startScreening(tv, film(), t2);
    assert.equal(takeover.screening.id, started.screening.id);
    assert.equal(takeover.resumed, true);
    assert.equal(takeover.screening.position_seconds, 30);
    assert.equal(takeover.loan.id, started.loan.id, 'the same loan: taking over takes nothing');
    assert.equal(a.heartbeat(laptop, started.screening.id, { position: 31 }, t2).error, 'playing-elsewhere');

    // The device that took over holds it in turn.
    assert.equal(a.startScreening(laptop, film(), t2 + 75 * SECOND - 1).error, 'playing-elsewhere');
    assert.equal(a.startScreening(laptop, film(), t2 + 75 * SECOND).screening.id, started.screening.id);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM loans WHERE film_id = ?').get(own.id).n, 1);
  });

  test('a pause frees the screening straight away, for the borrower’s other device', async () => {
    const a = access();
    const own = await ownFilm('pause');
    const film = () => row(own);
    const { p, laptop, tv } = await twoDevices('Pausing Pat');
    await issue({ filmId: own.id, personId: p.id });
    const t0 = Date.now();
    const { screening: s } = a.startScreening(laptop, film(), t0);
    a.heartbeat(laptop, s.id, { position: 12, playing: false }, t0 + SECOND);
    assert.equal(a.startScreening(tv, film(), t0 + SECOND).screening.id, s.id);
  });

  // 1.x let a second browser on the same link take over after a pause or 75 quiet
  // seconds. On a link anyone can use the borrower is the browser that pressed Play:
  // any other browser sees the tape out, like anyone (docs/version-2.md, question 12).
  test('a second browser on a link anyone can use never takes over: not after a pause, nor after any wait', async () => {
    const a = access();
    const own = await ownFilm('no-takeover');
    const film = () => row(own);
    const ticket = await issue({ filmId: own.id });
    const first = session(await opened(ticket));
    const second = session(await opened(ticket));
    const t0 = Date.now();
    const { screening: s, loan } = a.startScreening(first, film(), t0);
    assert.deepEqual([loan.person_id, loan.session_hash], [null, first.id_hash], 'the borrower is the browser that pressed Play');
    assert.equal(a.startScreening(second, film(), t0 + SECOND).error, 'out');
    a.heartbeat(first, s.id, { position: 12, playing: false }, t0 + 2 * SECOND);
    assert.equal(a.startScreening(second, film(), t0 + 3 * SECOND).error, 'out', 'paused');
    assert.equal(a.startScreening(second, film(), t0 + DAY).error, 'out', 'a day of quiet');
    assert.equal(a.heartbeat(second, s.id, { position: 13 }, t0 + DAY).error, 'not-found', 'nor may it report on the borrower’s play');
    assert.equal(a.mayStream({ viewer: second }, film(), t0 + DAY), false);
    assert.equal(a.startScreening(first, film(), t0 + DAY).screening.id, s.id, 'the borrower carries on');
    assert.equal(screening(s.id).position_seconds, 12);
  });
});

// ====================================================================== progress reports
describe('progress reports', () => {
  test('a position is kept within the film, and anything but a number keeps the last one', async () => {
    const film = await ownFilm('position');
    const b = await opened(await issue({ filmId: film.id }));
    const { screeningId: id } = await play(b, film.slug);
    const at = () => [screening(id).position_seconds, screening(id).furthest_seconds];
    const sent = async (position) => assert.equal((await report(b, id, { position })).status, 200, JSON.stringify(position));

    await sent(40);
    assert.deepEqual(at(), [40, 40]);
    await sent(-5);
    assert.deepEqual(at(), [0, 40], 'never before the start');
    await sent(1e12);
    assert.deepEqual(at(), [FILM_SECONDS, FILM_SECONDS], 'never past the end');
    await sent(20);
    assert.deepEqual(at(), [20, FILM_SECONDS], 'the furthest point never goes back');
    for (const v of ['50', '', null, true, [7], {}, 'abc', { toString: 'x' }, [{ toString: 1 }]]) {
      await sent(v);
      assert.deepEqual(at(), [20, FILM_SECONDS], JSON.stringify(v));
    }
    assert.equal((await report(b, id, {})).status, 200, 'no position at all');
    assert.deepEqual(at(), [20, FILM_SECONDS]);
  });

  test('a screening is finished from 92% of the running time, and only once', async () => {
    const film = await ownFilm('finished');
    const t = await issue({ filmId: film.id });
    const b = await opened(t);
    const { screeningId: id } = await play(b, film.slug);
    const finished = () => srv.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'finished' AND screening_id = ?").get(id).n;

    await report(b, id, { position: 0.92 * FILM_SECONDS - 0.01 });
    assert.equal(screening(id).finished_at, null, 'just short of 92%');
    assert.equal(finished(), 0);
    await report(b, id, { position: 0.92 * FILM_SECONDS });
    assert.ok(screening(id).finished_at, 'at 92%');
    await report(b, id, { position: FILM_SECONDS });
    assert.equal(finished(), 1);
    assert.equal((await admin.get(`/api/admin/tickets/${t.id}`)).data.screenings[0].finishedAt, screening(id).finished_at);
  });
});

// Giving a play back ("Give back", 1.x's way to hand a used-up link another play) has
// no test here any more: play limits are gone, so there is nothing to give back. The
// route refuses a loan's playback (409 tape-out; test/loans.test.js, "while a link has
// the tape it can't change hands") and goes with its button in slice 9 (version-2.md,
// "What can happen to a tape").

// ====================================================================== pressing Play
describe('pressing Play', () => {
  test('is limited to 60 presses per 10 minutes from one connection', async () => {
    // A server of its own, with the real limits, so no other test's presses count.
    const dir = tempDir();
    makeFilm(dir, 'arrival');
    const own = await startServer({ mediaDir: dir });
    try {
      const boss = await adminBrowser(own.base);
      await boss.post('/api/admin/scan');
      const id = (await boss.get('/api/admin/films')).data[0].id;
      await boss.patch(`/api/admin/films/${id}`, { published: true });
      const ticket = (await boss.post('/api/admin/tickets', { filmId: id })).data[0];
      const b = browser(own.base);
      assert.equal((await b.post('/api/tickets/open', { code: ticket.code })).status, 200);

      for (let i = 0; i < 60; i++) assert.equal((await b.post('/api/films/arrival/screenings')).status, 200, `press ${i + 1}`);
      const over = await b.post('/api/films/arrival/screenings');
      assert.equal(over.status, 429);
      assert.equal(over.data.error, 'too-many-requests');
      assert.ok(Number(over.headers.get('retry-after')) > 0);
      // Progress reports and media requests go on as before.
      const screeningId = own.db.prepare('SELECT id FROM screenings').get().id;
      assert.equal((await b.post(`/api/screenings/${screeningId}/heartbeat`, { position: 10 })).status, 200);
      assert.equal((await b.get(master('arrival'))).status, 200);
    } finally {
      await own.close();
    }
  });
});
