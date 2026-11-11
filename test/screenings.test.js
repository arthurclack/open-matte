// The numbers behind a screening, checked at their exact values: the resume
// window and its setting, the quiet time before another device can take over,
// the limits on a progress report's position, and where "finished" begins. Then
// what the player is told when its screening ends under it, and the limit on
// pressing Play. Written from docs/access.md. A slip in any value's units (seconds
// for milliseconds, minutes for seconds) fails here.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';

const { FILM_SECONDS, addFilm, adminBrowser, browser, makeFilm, startServer, tempDir } = await import('./helpers.js');
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

// A film of its own for each test that presses Play: one test's screening is never
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
const windowOf = (id) => screening(id).resumable_until - screening(id).started_at;
const closeWindow = (id) => srv.db.prepare('UPDATE screenings SET resumable_until = ? WHERE id = ?').run(Date.now() - 1, id);

// ====================================================================== the resume window
describe('the resume window', () => {
  test('a screening can be resumed for 48 hours, counted from Play, and resuming never moves it', async () => {
    const b = await opened(await issue());
    const first = await play(b);
    assert.equal(windowOf(first.screeningId), 48 * HOUR);
    assert.equal(first.resumableUntil, screening(first.screeningId).resumable_until);
    const again = await play(b);
    assert.equal(again.resumed, true);
    assert.equal(again.resumableUntil, first.resumableUntil);
  });

  test('a new window applies to screenings started after the change, not to open ones', async () => {
    const film = await ownFilm('new-window');
    const before = await opened(await issue({ filmId: film.id }));
    const open = (await play(before, film.slug)).screeningId;
    assert.equal((await admin.patch('/api/admin/settings', { resumeWindowHours: 2 })).status, 200);
    try {
      const after = await opened(await issue({ filmId: film.id }));
      const started = (await play(after, film.slug)).screeningId;
      assert.equal(windowOf(started), 2 * HOUR, 'a new screening uses the new window');
      assert.equal(windowOf(open), 48 * HOUR, 'an open one keeps the window it started with');
      assert.equal((await play(before, film.slug)).resumableUntil, screening(open).started_at + 48 * HOUR, 'even when resumed');
    } finally {
      await admin.patch('/api/admin/settings', { resumeWindowHours: 48 });
    }
  });

  test('the setting is a whole number of hours from 1 to 720', async () => {
    for (const v of [0, 721, 1.5, '48', null]) {
      assert.equal((await admin.patch('/api/admin/settings', { resumeWindowHours: v })).status, 400, JSON.stringify(v));
    }
    for (const v of [1, 720, 48]) {
      const r = await admin.patch('/api/admin/settings', { resumeWindowHours: v });
      assert.equal(r.status, 200, JSON.stringify(r.data));
    }
  });

  test('when the window closes while the film plays, it stops and the player is told the screening ended', async () => {
    const film = await ownFilm('window-closes');
    for (const fields of [{ screeningLimit: 1 }, {}]) {
      const b = await opened(await issue({ filmId: film.id, ...fields }));
      const { screeningId } = await play(b, film.slug);
      assert.equal((await report(b, screeningId, { position: 30 })).status, 200);
      assert.equal((await b.get(segment(film.slug))).status, 200);
      closeWindow(screeningId);
      assert.equal((await b.get(segment(film.slug))).status, 403, 'the next media request is refused');
      // Not "used up", even for a ticket with one screening: the screening ended.
      const r = await report(b, screeningId, { position: FILM_SECONDS });
      assert.deepEqual([r.status, r.data.error], [409, 'screening-ended'], JSON.stringify(fields));
      assert.equal(screening(screeningId).finished_at, null, 'a refused report finishes nothing');
      assert.equal(screening(screeningId).position_seconds, 30, 'and moves nothing');

      const again = await b.post(`/api/films/${film.slug}/screenings`);
      if (fields.screeningLimit) {
        assert.deepEqual([again.status, again.data.error], [409, 'used_up']);
      } else {
        assert.equal(again.status, 200);
        assert.equal(again.data.resumed, false);
        assert.notEqual(again.data.screeningId, screeningId);
        assert.equal(again.data.position, 0, 'a new screening starts from the beginning');
      }
    }
  });
});

// ====================================================================== one device at a time
describe('one device at a time', () => {
  // Called directly with a clock, so no test waits 75 seconds.
  const access = () => createAccess(srv.db, createSettings(srv.db));
  const session = (b) => srv.db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(sha256(b.jar.get('om_session')));
  const row = (film) => srv.db.prepare('SELECT * FROM films WHERE id = ?').get(film.id);

  test('another device can take over 75 seconds after Play or the last report, and not a moment before', async () => {
    const a = access();
    const own = await ownFilm('takeover');
    const film = () => row(own);
    const ticket = await issue({ filmId: own.id });
    const laptop = session(await opened(ticket));
    const tv = session(await opened(ticket));
    const t0 = Date.now();

    const started = a.startScreening(laptop, film(), t0);
    assert.equal(started.resumed, false);
    assert.equal(a.startScreening(tv, film(), t0 + 75 * SECOND - 1).error, 'playing-elsewhere', 'busy for 75 seconds after Play');

    const t1 = t0 + 60 * SECOND;
    assert.deepEqual(a.heartbeat(laptop, started.screening.id, { position: 30 }, t1), { ok: true });
    assert.equal(a.startScreening(tv, film(), t1 + 75 * SECOND - 1).error, 'playing-elsewhere', 'and for 75 seconds after each report');

    const t2 = t1 + 75 * SECOND;
    const takeover = a.startScreening(tv, film(), t2);
    assert.equal(takeover.screening.id, started.screening.id);
    assert.equal(takeover.resumed, true);
    assert.equal(takeover.screening.position_seconds, 30);
    assert.equal(a.heartbeat(laptop, started.screening.id, { position: 31 }, t2).error, 'playing-elsewhere');

    // The device that took over holds it in turn.
    assert.equal(a.startScreening(laptop, film(), t2 + 75 * SECOND - 1).error, 'playing-elsewhere');
    assert.equal(a.startScreening(laptop, film(), t2 + 75 * SECOND).screening.id, started.screening.id);
  });

  test('a pause frees the screening straight away', async () => {
    const a = access();
    const own = await ownFilm('pause');
    const film = () => row(own);
    const ticket = await issue({ filmId: own.id });
    const laptop = session(await opened(ticket));
    const tv = session(await opened(ticket));
    const t0 = Date.now();
    const { screening: s } = a.startScreening(laptop, film(), t0);
    a.heartbeat(laptop, s.id, { position: 12, playing: false }, t0 + SECOND);
    assert.equal(a.startScreening(tv, film(), t0 + SECOND).screening.id, s.id);
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

// ====================================================================== given back while it plays
describe('giving back a screening that is playing', () => {
  test('stops it, says the screening ended, and Play starts a new one from the start; the expiry clock runs on', async () => {
    const film = await ownFilm('given-back');
    const t = await issue({ filmId: film.id, screeningLimit: 1, daysAfterFirstPlay: 2 });
    const b = await opened(t);
    const { screeningId } = await play(b, film.slug);
    assert.equal((await report(b, screeningId, { position: 50 })).status, 200);
    const firstPlayed = srv.db.prepare('SELECT first_played_at FROM tickets WHERE id = ?').get(t.id).first_played_at;

    assert.equal((await admin.post(`/api/admin/screenings/${screeningId}/void`)).status, 200);
    assert.equal((await b.get(segment(film.slug))).status, 403);
    // The ticket is fine, so not "no longer valid".
    const r = await report(b, screeningId, { position: 51 });
    assert.deepEqual([r.status, r.data.error], [409, 'screening-ended']);

    const page = (await b.get(`/api/films/${film.slug}`)).data.access;
    assert.equal(page.canPlay, true);
    assert.equal(page.ticket.state, 'ok');
    assert.equal(page.ticket.screeningsLeft, 1);
    assert.equal(page.ticket.openScreening, null);
    assert.equal(page.ticket.expiresAt, firstPlayed + 2 * DAY, 'the expiry clock still counts from the first play');

    const again = await play(b, film.slug);
    assert.equal(again.resumed, false);
    assert.notEqual(again.screeningId, screeningId);
    assert.equal(again.position, 0);
    assert.equal(srv.db.prepare('SELECT first_played_at FROM tickets WHERE id = ?').get(t.id).first_played_at, firstPlayed);
    assert.equal((await b.get(master(film.slug))).status, 200);
  });
});

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
