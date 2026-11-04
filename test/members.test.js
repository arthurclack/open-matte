// Films shown to members: milestone 2, slice 4. Written from docs/history/milestone-2.md
// ("Who can do what", "Changes to server/access.js", "Route changes", "Slice 4"),
// not from the implementation. No viewer browser here ever holds the admin cookie:
// the admin's preview shows and plays everything, so a pass there would prove nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';
import { adminBrowser, browser, enroll, makeFilm, newPerson, playbackFiles, setupLink, signIn, startServer, tempDir } from './helpers.js';

const mediaDir = tempDir();
const dataDir = tempDir();
// Arrival and Solaris are shown to members; Heat isn't; Stalker is, but is a draft.
const SLUGS = { arrival: 'Arrival', heat: 'Heat', solaris: 'Solaris', stalker: 'Stalker' };
const RECOMMENDATION = 'Watch it with the lights off.';
// Artwork: each folder's poster, and for Arrival a backdrop downloaded from TMDb.
const BACKDROP = 'backdrop-0123456789ab.jpg';
const artworkOf = (slug) => [`/media/${slug}/poster.jpg`, ...(slug === 'arrival' ? [`/artwork/arrival/${BACKDROP}`] : [])];

let srv;
let admin;
const films = {};

before(async () => {
  for (const [slug, title] of Object.entries(SLUGS)) makeFilm(mediaDir, slug, { title });
  srv = await startServer({ mediaDir, dataDir, limits: { scale: 100 } });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  for (const f of (await admin.get('/api/admin/films')).data) films[f.slug] = f.id;
  for (const slug of Object.keys(SLUGS)) assert.ok(films[slug], slug);
  for (const slug of ['arrival', 'heat', 'solaris']) await admin.patch(`/api/admin/films/${films[slug]}`, { published: true });
  for (const slug of ['arrival', 'solaris', 'stalker']) {
    const r = await admin.patch(`/api/admin/films/${films[slug]}`, { memberVisible: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  fs.mkdirSync(path.join(dataDir, 'artwork', 'arrival'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'artwork', 'arrival', BACKDROP), 'jpeg');
  srv.db.prepare('UPDATE films SET artwork = ? WHERE slug = ?').run(JSON.stringify({ backdrop: { file: BACKDROP } }), 'arrival');
});
after(() => srv.close());

let counter = 0;
const uniq = (name) => `${name} ${++counter}`;
const fresh = () => browser(srv.base);
const statuses = (b, urls) => Promise.all(urls.map(async (u) => (await b.get(u)).status));
const every = (urls, code) => urls.map(() => code);
const totals = () =>
  srv.db.prepare(`
    SELECT (SELECT COUNT(*) FROM session_tickets) AS sessionTickets, (SELECT COUNT(*) FROM events) AS events,
           (SELECT COUNT(*) FROM screenings) AS screenings, (SELECT COUNT(*) FROM tickets WHERE first_opened_at IS NOT NULL) AS opened`).get();
const me = async (b) => {
  const r = await b.get('/api/me');
  assert.equal(r.status, 200);
  return r.data;
};
const memberSlugs = async (b) => (await me(b)).memberFilms.map((f) => f.slug);
const ticketSlugs = async (b) => (await me(b)).tickets.map((t) => t.film.slug);
const setFilm = async (slug, body) => {
  const r = await admin.patch(`/api/admin/films/${films[slug]}`, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};

// A person with one passkey, signed in on their phone. device() signs another
// browser in as them.
async function member(name = uniq('Sam')) {
  const p = await newPerson(admin, name);
  const auth = softAuthenticator();
  const phone = fresh();
  const r = await enroll(phone, (await setupLink(admin, p.id)).token, { auth });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const device = async (b = fresh()) => {
    const s = await signIn(b, auth);
    assert.equal(s.status, 200, JSON.stringify(s.data));
    return b;
  };
  return { p, phone, device };
}

async function issue(fields = {}, slug = 'arrival') {
  const r = await admin.post('/api/admin/tickets', { filmId: films[slug], ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data[0];
}
async function opened(b, ticket, slug = 'arrival') {
  const r = await b.post('/api/tickets/open', { code: ticket.code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { slug });
}

// Listed and readable, but nothing plays: the page as a member film, its poster
// and backdrop, a 409 for Play and a 403 for every playback file.
async function readableOnly(b, slug = 'arrival') {
  const page = await b.get(`/api/films/${slug}`);
  assert.equal(page.status, 200, JSON.stringify(page.data));
  assert.equal(page.data.access.via, 'member');
  assert.equal(page.data.access.canPlay, false);
  assert.equal(page.data.access.ticket, null);
  assert.equal(page.data.film.title, SLUGS[slug]);
  assert.equal(page.data.film.recommendation, RECOMMENDATION);
  assert.ok(page.data.film.posterUrl, 'poster');
  const p = await b.post(`/api/films/${slug}/screenings`);
  assert.equal(p.status, 409, `Play: ${p.status} ${JSON.stringify(p.data)}`);
  assert.equal(p.data.error, 'no-ticket');
  assert.equal(p.data.masterUrl, undefined);
  assert.deepEqual(await statuses(b, playbackFiles(slug)), every(playbackFiles(slug), 403), 'playback files');
  assert.deepEqual(await statuses(b, artworkOf(slug)), every(artworkOf(slug), 200), 'artwork');
  assert.ok((await memberSlugs(b)).includes(slug), 'under Showing to members');
  assert.ok(!(await ticketSlugs(b)).includes(slug), 'not under Your tickets');
}

// Nothing of the film: no page, no Play, no playback file, no artwork, not listed.
async function hidden(b, slug = 'arrival') {
  const page = await b.get(`/api/films/${slug}`);
  assert.equal(page.status, 404, `page: ${page.status} ${JSON.stringify(page.data)}`);
  assert.equal(page.data.film, undefined);
  const p = await b.post(`/api/films/${slug}/screenings`);
  assert.equal(p.status, 404, `Play: ${p.status} ${JSON.stringify(p.data)}`);
  assert.deepEqual(await statuses(b, playbackFiles(slug)), every(playbackFiles(slug), 403), 'playback files');
  assert.deepEqual(await statuses(b, artworkOf(slug)), every(artworkOf(slug), 403), 'artwork');
  assert.ok(!(await memberSlugs(b)).includes(slug), 'not under Showing to members');
  assert.ok(!(await ticketSlugs(b)).includes(slug), 'not under Your tickets');
}

// A ticket shows it: the page, Play and every file.
async function playsEverything(b, slug = 'arrival') {
  const page = await b.get(`/api/films/${slug}`);
  assert.equal(page.status, 200, JSON.stringify(page.data));
  assert.equal(page.data.access.via, 'ticket');
  assert.equal(page.data.access.canPlay, true);
  const p = await b.post(`/api/films/${slug}/screenings`);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.deepEqual(await statuses(b, playbackFiles(slug)), every(playbackFiles(slug), 200), 'playback files');
  assert.deepEqual(await statuses(b, artworkOf(slug)), every(artworkOf(slug), 200), 'artwork');
  assert.ok((await ticketSlugs(b)).includes(slug), 'under Your tickets');
  assert.ok(!(await memberSlugs(b)).includes(slug), 'no longer under Showing to members');
  return p.data;
}

// ====================================================================== the switch
describe('Show to members', () => {
  test('migration 5 adds films.member_visible: off by default, and only 0 or 1', () => {
    assert.ok(srv.db.prepare('PRAGMA user_version').get().user_version >= 5);
    const row = (slug) => srv.db.prepare('SELECT member_visible FROM films WHERE slug = ?').get(slug).member_visible;
    assert.equal(row('heat'), 0, 'a new film starts hidden from members');
    assert.equal(row('arrival'), 1);
    assert.throws(() => srv.db.prepare('UPDATE films SET member_visible = 2 WHERE slug = ?').run('heat'), /CHECK/);
    assert.throws(() => srv.db.prepare('UPDATE films SET member_visible = NULL WHERE slug = ?').run('heat'), /NOT NULL/);
  });

  test('the admin sees it on the film and in the list, and a rescan keeps it', async () => {
    assert.equal((await admin.get(`/api/admin/films/${films.arrival}`)).data.memberVisible, true);
    assert.equal((await admin.get(`/api/admin/films/${films.heat}`)).data.memberVisible, false);
    const list = () => admin.get('/api/admin/films').then((r) => Object.fromEntries(r.data.map((f) => [f.slug, f.memberVisible])));
    assert.deepEqual(await list(), { arrival: true, heat: false, solaris: true, stalker: true });
    const scan = await admin.post('/api/admin/scan');
    assert.equal(scan.status, 200);
    assert.deepEqual(await list(), { arrival: true, heat: false, solaris: true, stalker: true });
    // Saving details or publishing leaves it alone.
    assert.equal((await setFilm('arrival', { synopsis: 'Linguist meets heptapods.' })).memberVisible, true);
    assert.equal((await setFilm('heat', { published: true })).memberVisible, false);
  });

  test('viewers can never set it', async () => {
    const { phone } = await member();
    const r = await phone.patch(`/api/admin/films/${films.heat}`, { memberVisible: true });
    assert.equal(r.status, 401);
    assert.equal(srv.db.prepare('SELECT member_visible FROM films WHERE slug = ?').get('heat').member_visible, 0);
  });
});

// ====================================================================== anonymous
describe('a browser that is not signed in', () => {
  test('sees nothing of a film shown to members', async () => {
    const b = fresh();
    const m = await me(b);
    assert.deepEqual(m.memberFilms, []);
    assert.deepEqual(m.tickets, []);
    await hidden(b, 'arrival');
    await hidden(b, 'solaris');
  });

  test('holding a link ticket for another film changes nothing', async () => {
    const b = fresh();
    await opened(b, await issue({}, 'heat'), 'heat');
    assert.deepEqual(await ticketSlugs(b), ['heat']);
    assert.deepEqual((await me(b)).memberFilms, []);
    await hidden(b, 'arrival');
  });
});

// ====================================================================== signed in
describe('a signed-in person with no ticket', () => {
  test('sees the film listed and can read its page, but nothing plays', async () => {
    const { phone } = await member();
    assert.deepEqual(await memberSlugs(phone), ['arrival', 'solaris'], 'published films shown to members, in the admin order');
    assert.deepEqual(await ticketSlugs(phone), []);
    await readableOnly(phone, 'arrival');
    await readableOnly(phone, 'solaris');
    await hidden(phone, 'heat');
  });

  test('the listing gives the film summary only', async () => {
    const { phone } = await member();
    const arrival = (await me(phone)).memberFilms.find((f) => f.slug === 'arrival');
    assert.deepEqual(Object.keys(arrival).sort(), ['directors', 'posterUrl', 'runtimeMinutes', 'slug', 'title', 'year']);
  });

  test('reading it records nothing: no event, no ticket opened, no screening', async () => {
    const { phone } = await member();
    const before = totals();
    await readableOnly(phone, 'arrival');
    await readableOnly(phone, 'arrival');
    assert.deepEqual(totals(), before);
  });

  test('every device the person signs in on sees it', async () => {
    const { device } = await member();
    await readableOnly(await device(), 'arrival');
  });

  test('a ticket for another film unlocks nothing of it, even while that film plays', async () => {
    const { p, phone } = await member();
    await issue({ personId: p.id }, 'heat');
    await playsEverything(phone, 'heat');
    await readableOnly(phone, 'arrival');
  });
});

// ====================================================================== with a ticket
describe('when the person has a ticket', () => {
  test('a ticket for them moves the film to Your tickets, and it plays', async () => {
    const { p, phone, device } = await member();
    await readableOnly(phone);
    await issue({ personId: p.id });
    await playsEverything(phone);
    assert.ok((await ticketSlugs(await device())).includes('arrival'), 'on their other devices too');
  });

  test('so does a link ticket opened in this browser', async () => {
    const { phone } = await member();
    await opened(phone, await issue());
    await playsEverything(phone);
  });

  test('a revoked ticket gives the listing back, and playback stops from the next request', async () => {
    const { p, phone } = await member();
    const t = await issue({ personId: p.id });
    await playsEverything(phone);
    assert.equal((await admin.post(`/api/admin/tickets/${t.id}/revoke`)).status, 200);
    await readableOnly(phone);
    assert.equal((await admin.post(`/api/admin/tickets/${t.id}/restore`)).status, 200);
    await playsEverything(phone);
  });

  test('a used-up ticket says so, rather than offering the film as a member film', async () => {
    const { p, phone } = await member();
    const t = await issue({ personId: p.id, screeningLimit: 1 });
    await playsEverything(phone);
    // The one screening's resume window has run out.
    srv.db.prepare('UPDATE screenings SET resumable_until = ? WHERE ticket_id = ?').run(Date.now() - 1, t.id);
    const page = await phone.get('/api/films/arrival');
    assert.equal(page.status, 200);
    assert.equal(page.data.access.via, 'ticket');
    assert.equal(page.data.access.ticket.state, 'used_up');
    const p2 = await phone.post('/api/films/arrival/screenings');
    assert.equal(p2.status, 409);
    assert.equal(p2.data.error, 'used_up');
    assert.deepEqual(await ticketSlugs(phone), ['arrival']);
    assert.ok(!(await memberSlugs(phone)).includes('arrival'));
  });
});

// ====================================================================== when it stops showing
describe('when a member film stops showing', () => {
  test('switched off, it is gone for members; switched on, it is back', async () => {
    const { phone } = await member();
    await readableOnly(phone, 'solaris');
    await setFilm('solaris', { memberVisible: false });
    await hidden(phone, 'solaris');
    await setFilm('solaris', { memberVisible: true });
    await readableOnly(phone, 'solaris');
  });

  test('switched off, a ticket for it still works', async () => {
    const { p, phone } = await member();
    await issue({ personId: p.id }, 'solaris');
    await setFilm('solaris', { memberVisible: false });
    try {
      await playsEverything(phone, 'solaris');
    } finally {
      await setFilm('solaris', { memberVisible: true });
    }
  });

  test('unpublished, it is gone; published again, it is back', async () => {
    const { phone } = await member();
    await setFilm('solaris', { published: false });
    await hidden(phone, 'solaris');
    await setFilm('solaris', { published: true });
    await readableOnly(phone, 'solaris');
  });

  test('a draft shown to members stays hidden until it is published', async () => {
    const { phone } = await member();
    await hidden(phone, 'stalker');
    await setFilm('stalker', { published: true });
    await readableOnly(phone, 'stalker');
    await setFilm('stalker', { published: false });
    await hidden(phone, 'stalker');
  });

  test('disabling the person: gone on their next request; enabled and signed in again, back', async () => {
    const { p, phone, device } = await member();
    await readableOnly(phone);
    assert.equal((await admin.post(`/api/admin/people/${p.id}/disable`)).status, 200);
    assert.equal((await me(phone)).person, null);
    await hidden(phone);
    assert.equal((await admin.post(`/api/admin/people/${p.id}/enable`)).status, 200);
    await readableOnly(await device());
  });

  test('signing out: gone in that browser', async () => {
    const { phone } = await member();
    await readableOnly(phone);
    assert.equal((await phone.post('/api/signout')).status, 200);
    await hidden(phone);
  });
});

// ====================================================================== the admin
test("the admin's own preview is unchanged", async () => {
  const page = await admin.get('/api/films/heat');
  assert.equal(page.status, 200);
  assert.equal(page.data.access.via, 'admin');
  const play = await admin.post('/api/films/arrival/screenings');
  assert.equal(play.status, 200);
  assert.equal(play.data.preview, true);
});
