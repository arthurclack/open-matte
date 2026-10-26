// The milestone-1 journey: import a film, publish it, issue a ticket, open it
// in another browser, play, then check limits, expiry and revocation.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { FILM_SECONDS, adminBrowser, browser, makeFilm, startServer, tempDir } from './helpers.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let srv;
let admin;
let filmId;
const mediaDir = tempDir();

const MASTER = '/media/arrival/hls/master.m3u8';
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

async function openTicket(b, ticket) {
  const r = await b.post('/api/tickets/open', { code: ticket.code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.slug, 'arrival');
}

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

describe('a ticket from opening to revocation', () => {
  let ticket;
  // The browser the friend is watching in. Reassigned when they switch device.
  let viewer;

  test('opening the link shows the page without using a screening', async () => {
    ticket = await newTicket({ label: 'Sam', screeningLimit: 1, daysAfterFirstPlay: 3 });
    viewer = browser(srv.base);
    await openTicket(viewer, ticket);

    const page = await viewer.get('/api/films/arrival');
    assert.equal(page.status, 200);
    assert.equal(page.data.film.recommendation, 'Watch it with the lights off.');
    assert.equal(page.data.access.canPlay, true);
    assert.equal(page.data.access.ticket.screeningsLeft, 1);
    assert.equal(page.data.access.ticket.firstPlayedAt, null, 'opening must not start the expiry clock');
    assert.equal(page.data.access.ticket.expiresAt, null);
    assert.equal(page.data.film.media.masterUrl, undefined, 'the playlist URL is only handed out on Play');

    assert.equal((await viewer.get('/media/arrival/poster.jpg')).status, 200);
    // A ticket alone doesn't unlock the stream: pressing Play does.
    assert.deepEqual(await statuses(viewer, PLAYBACK_FILES), PLAYBACK_FILES.map(() => 403));
  });

  test('pressing Play starts a screening and unlocks every playback file', async () => {
    const r = await viewer.post('/api/films/arrival/screenings');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.resumed, false);
    assert.equal(r.data.masterUrl, MASTER);
    assert.deepEqual(await statuses(viewer, PLAYBACK_FILES), PLAYBACK_FILES.map(() => 200));
    assert.equal((await viewer.get('/media/arrival/film.json')).status, 404);
    assert.equal((await viewer.get('/media/arrival/hls/../film.json')).status, 404);

    const t = (await admin.get(`/api/admin/tickets/${ticket.id}`)).data;
    assert.equal(t.screeningsUsed, 1);
    assert.ok(t.firstPlayedAt, 'the first screening starts the expiry clock');
    assert.ok(Math.abs(t.expiresAt - (t.firstPlayedAt + 3 * DAY)) < 1000);
    assert.equal(t.openScreening.playingNow, true);
  });

  test('refreshing resumes the same screening instead of using another', async () => {
    await viewer.post(`/api/screenings/${(await viewer.post('/api/films/arrival/screenings')).data.screeningId}/heartbeat`, { position: 40 });
    const again = await viewer.post('/api/films/arrival/screenings');
    assert.equal(again.data.resumed, true);
    assert.equal(again.data.position, 40);
    const t = (await admin.get(`/api/admin/tickets/${ticket.id}`)).data;
    assert.equal(t.screeningsUsed, 1);
  });

  test('a second device cannot watch at the same time, but can take over once the first pauses', async () => {
    const laptop = viewer;
    const tv = browser(srv.base);
    await openTicket(tv, ticket);
    const blocked = await tv.post('/api/films/arrival/screenings');
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.error, 'playing-elsewhere');
    assert.equal((await tv.get(MASTER)).status, 403);

    const { screeningId } = (await laptop.post('/api/films/arrival/screenings')).data;
    await laptop.post(`/api/screenings/${screeningId}/heartbeat`, { position: 50, playing: false });

    const takeover = await tv.post('/api/films/arrival/screenings');
    assert.equal(takeover.status, 200, JSON.stringify(takeover.data));
    assert.equal(takeover.data.resumed, true);
    assert.equal(takeover.data.screeningId, screeningId);
    assert.equal((await tv.get(MASTER)).status, 200);
    assert.equal((await laptop.get(MASTER)).status, 403, 'the previous device loses the stream');
    const hb = await laptop.post(`/api/screenings/${screeningId}/heartbeat`, { position: 51 });
    assert.equal(hb.data.error, 'playing-elsewhere');
    viewer = tv;
  });

  test('reaching 92% of the running time marks the screening finished, once', async () => {
    const { screeningId } = (await viewer.post('/api/films/arrival/screenings')).data;
    await viewer.post(`/api/screenings/${screeningId}/heartbeat`, { position: FILM_SECONDS * 0.9 });
    let events = (await admin.get(`/api/admin/activity?ticket=${ticket.id}`)).data;
    assert.equal(events.filter((e) => e.type === 'finished').length, 0);
    await viewer.post(`/api/screenings/${screeningId}/heartbeat`, { position: FILM_SECONDS * 0.93 });
    await viewer.post(`/api/screenings/${screeningId}/heartbeat`, { position: FILM_SECONDS });
    events = (await admin.get(`/api/admin/activity?ticket=${ticket.id}`)).data;
    assert.equal(events.filter((e) => e.type === 'finished').length, 1);
    assert.ok(events.some((e) => e.type === 'opened'));
    assert.ok(events.some((e) => e.type === 'play'));
  });

  test('when the resume window closes, the used-up ticket explains itself and plays nothing', async () => {
    srv.db.prepare('UPDATE screenings SET resumable_until = ? WHERE ticket_id = ?').run(Date.now() - 1, ticket.id);
    const page = await viewer.get('/api/films/arrival');
    assert.equal(page.status, 200);
    assert.equal(page.data.access.canPlay, false);
    assert.equal(page.data.access.ticket.state, 'used_up');
    const r = await viewer.post('/api/films/arrival/screenings');
    assert.equal(r.status, 409);
    assert.equal(r.data.error, 'used_up');
    assert.equal((await viewer.get(MASTER)).status, 403);
  });

  test('giving a screening back lets the viewer play again', async () => {
    const t = (await admin.get(`/api/admin/tickets/${ticket.id}`)).data;
    await admin.post(`/api/admin/screenings/${t.screenings[0].id}/void`);
    const r = await viewer.post('/api/films/arrival/screenings');
    assert.equal(r.status, 200);
    assert.equal(r.data.resumed, false);
  });

  test('ticket expiry overrides a resume window that is still open', async () => {
    srv.db.prepare('UPDATE tickets SET first_played_at = ? WHERE id = ?').run(Date.now() - 4 * DAY, ticket.id);
    const page = await viewer.get('/api/films/arrival');
    assert.equal(page.data.access.ticket.state, 'expired');
    assert.equal((await viewer.get(MASTER)).status, 403);
    srv.db.prepare('UPDATE tickets SET first_played_at = ? WHERE id = ?').run(Date.now() - HOUR, ticket.id);
    assert.equal((await viewer.get(MASTER)).status, 200);
  });

  test('revoking blocks the page and the very next media request', async () => {
    assert.equal((await viewer.get('/media/arrival/hls/v_h264_720/seg_4.m4s')).status, 200);
    await admin.post(`/api/admin/tickets/${ticket.id}/revoke`);
    assert.equal((await viewer.get('/media/arrival/hls/v_h264_720/seg_5.m4s')).status, 403);
    assert.deepEqual(await statuses(viewer, PLAYBACK_FILES), PLAYBACK_FILES.map(() => 403));
    assert.equal((await viewer.get('/api/films/arrival')).status, 404);
    const reopen = await browser(srv.base).post('/api/tickets/open', { code: ticket.code });
    assert.equal(reopen.status, 410);
  });
});

describe('ticket rules', () => {
  test('a start-by deadline that passes before the first screening expires the ticket', async () => {
    const ticket = await newTicket({ startBy: Date.now() - 1000 });
    const b = browser(srv.base);
    await openTicket(b, ticket);
    const page = await b.get('/api/films/arrival');
    assert.equal(page.data.access.ticket.state, 'expired');
    assert.equal((await b.post('/api/films/arrival/screenings')).data.error, 'expired');
  });

  test('a start-by deadline stops mattering once the first screening has started', async () => {
    const ticket = await newTicket({ startBy: Date.now() + HOUR });
    const b = browser(srv.base);
    await openTicket(b, ticket);
    assert.equal((await b.post('/api/films/arrival/screenings')).status, 200);
    srv.db.prepare('UPDATE tickets SET start_by = ? WHERE id = ?').run(Date.now() - 1000, ticket.id);
    assert.equal((await b.get(MASTER)).status, 200);
  });

  test('a limit of two screenings allows exactly two', async () => {
    const ticket = await newTicket({ screeningLimit: 2 });
    const b = browser(srv.base);
    await openTicket(b, ticket);
    for (let i = 0; i < 2; i++) {
      assert.equal((await b.post('/api/films/arrival/screenings')).data.resumed, false);
      srv.db.prepare('UPDATE screenings SET resumable_until = ? WHERE ticket_id = ?').run(Date.now() - 1, ticket.id);
    }
    assert.equal((await b.post('/api/films/arrival/screenings')).data.error, 'used_up');
  });

  test('unpublishing hides the page from ticket holders', async () => {
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

  test('an admin browser previews without using screenings', async () => {
    const r = await admin.post('/api/films/arrival/screenings');
    assert.equal(r.data.preview, true);
    assert.equal((await admin.get(MASTER)).status, 200);
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


test('a revoked ticket shows no open or playing screening in the admin', async () => {
  const tickets = (await admin.get('/api/admin/tickets')).data;
  for (const t of tickets.filter((t) => t.state === 'revoked')) assert.equal(t.openScreening, null);
});
