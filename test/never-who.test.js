// Never who has it: version 2 (docs/version-2.md, "Never who has it"). While a tape
// is out, only its borrower and the owner learn anything about the loan. Everyone
// else gets the same answer, whether the tape went out on another link or on their
// own link in another browser (question 12, answer a).
//
// Two browsers open one link anyone can use, and a third opens another. The first
// plays. For the other two, every row of the plan's table is compared: the same
// status and the same body. Then two members, one holding the borrower's link in
// their browser and one with a link of their own: the same, apart from whether the
// link is on their card. Both links carry a start-by date, and the comparison is made
// three times: at once, after the clock passes the start-by with the tape still out,
// and with the film's files marked broken. Written from the plan, not the
// implementation. It gains rows as their routes arrive: the "Picked for you" note in
// slice 4, the members' shelf in slice 5. Slice 3's are here: a return, whatever
// takenAt is sent, is "nothing to return" for everyone but the borrower; a due date
// the owner moves is the same new date for both; and when the tape comes back, by a
// return or a take-back, the reason reaches the borrower only. And a last suite, on
// films of its own, for who the borrower is: a member on their own link or a browser
// on a link anyone can use, the borrower's own second device, and a newcomer opening
// the link that lent or one that waits.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';
import { addFilm, adminBrowser, browser, enroll, makeFilm, newPerson, playbackFiles, setupLink, signIn, startServer, tempDir } from './helpers.js';

const HOUR = 60 * 60 * 1000;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SLUG = 'the-tape';
// The borrower's device, which no one else's answer may name. Everyone else's
// browser here sends no user agent, and is "Browser on unknown device".
const BORROWER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0';
const BORROWER_DEVICE = 'Edge on Windows';
const BORROWER_NAME = 'Bernadette Borrowdale';
const LABELS = { lent: 'Label of the link that lent', waiting: 'Label of the link that waits', own: 'Label of the member’s own link' };

const mediaDir = tempDir();
const webDist = tempDir();
let srv;
let admin;
let film;
// The links, and the browsers.
const t = {};
let borrower;
let sameLink;
let otherLink;
let memberSameLink;
let memberOwnLink;
let loan;
let screeningId;
let siteBefore;
let previewsBefore;

// A request as this browser, giving back everything a page could read: the status,
// the body as it was sent, and the headers that could differ.
async function ask(b, method, url, body) {
  const headers = {};
  if (b.jar.size) headers.cookie = [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  if (b.ua) headers['user-agent'] = b.ua;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(srv.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  // Kept, as a browser keeps them.
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    b.jar.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
  }
  return {
    status: res.status,
    body: await res.text(),
    type: res.headers.get('content-type'),
    length: res.headers.get('content-length'),
    cache: res.headers.get('cache-control'),
    cookies: res.headers.getSetCookie(),
  };
}
const get = (b, url) => ask(b, 'GET', url);
const post = (b, url, body = {}) => ask(b, 'POST', url, body);
const json = (r) => JSON.parse(r.body);

// The preview a chat app would fetch for a link: the page's title and its Open Graph
// tags, with the poster's address (which is the link's own, by design) left out.
async function preview(ticket) {
  const html = await (await fetch(`${srv.base}/t/${ticket.code}`)).text();
  const tags = [...html.matchAll(/<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)"/g)].map(([, k, v]) => [k, k === 'og:image' ? v.replace(/\/poster\/.*$/, '/poster/…') : v]);
  return { title: /<title>(.*?)<\/title>/.exec(html)?.[1], tags };
}

before(async () => {
  makeFilm(mediaDir, SLUG, { title: 'The Tape', year: 1999 });
  fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><html><head><title>app</title></head><body></body></html>');
  srv = await startServer({ mediaDir, webDist, limits: { scale: 100 } });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  film = (await admin.get('/api/admin/films')).data[0];
  await admin.patch(`/api/admin/films/${film.id}`, { published: true });

  const issue = async (fields) => {
    const r = await admin.post('/api/admin/tickets', { filmId: film.id, ...fields });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data[0];
  };
  const member = async (name, ua) => {
    const p = await newPerson(admin, name);
    const b = browser(srv.base);
    b.ua = ua;
    const r = await enroll({ post: (url, body) => b.send('POST', url, JSON.stringify(body), { type: 'application/json', headers: ua ? { 'user-agent': ua } : {} }) }, (await setupLink(admin, p.id)).token, { auth: softAuthenticator() });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return { p, b };
  };
  const open = async (b, ticket) => assert.deepEqual(json(await post(b, '/api/tickets/open', { code: ticket.code })), { slug: SLUG });

  // Both links for anyone carry a start-by date an hour from now, and can be kept: so a
  // keep offer, or a date, on one and not the other would show.
  const startBy = Date.now() + HOUR;
  t.lent = await issue({ label: LABELS.lent, startBy, claimable: true });
  t.waiting = await issue({ label: LABELS.waiting, startBy, claimable: true });
  previewsBefore = [await preview(t.lent), await preview(t.waiting)];

  // The borrower: a member, signed in, on a device with a name of its own.
  ({ b: borrower } = await member(BORROWER_NAME, BORROWER_UA));
  await open(borrower, t.lent);
  sameLink = browser(srv.base);
  await open(sameLink, t.lent);
  otherLink = browser(srv.base);
  await open(otherLink, t.waiting);
  // Two members who aren't the borrower: one opened the borrower's link in their
  // browser, the other has a link of their own for the film.
  const first = await member('Other Member One');
  memberSameLink = first.b;
  await open(memberSameLink, t.lent);
  const second = await member('Other Member Two');
  memberOwnLink = second.b;
  t.own = await issue({ label: LABELS.own, startBy, personId: second.p.id });

  siteBefore = (await get(otherLink, '/api/site')).body;
  const played = await post(borrower, `/api/films/${SLUG}/screenings`);
  assert.equal(played.status, 200, played.body);
  screeningId = json(played).screeningId;
  loan = { ...srv.db.prepare('SELECT * FROM loans WHERE film_id = ?').get(film.id) };
  assert.deepEqual([loan.ticket_id, loan.person_id, loan.session_hash, loan.device], [t.lent.id, null, sha256(borrower.jar.get('om_session')), BORROWER_DEVICE]);
  assert.equal((await post(borrower, `/api/screenings/${screeningId}/heartbeat`, { position: 17 })).status, 200);
});
after(() => srv.close());

// Everything a browser that isn't the borrower can ask, in the plan's order. `of` is
// the tape asked about: the film, its loan and the loan's play (this file's main one,
// unless another is given).
async function everyAnswer(b, ownCode, of = { slug: SLUG, screeningId, loan }) {
  const answers = {
    'the film page': await get(b, `/api/films/${of.slug}`),
    'the film page, reading itself again': await get(b, `/api/films/${of.slug}?again=1`),
    Play: await post(b, `/api/films/${of.slug}/screenings`),
    'a progress report for the borrower’s play': await post(b, `/api/screenings/${of.screeningId}/heartbeat`, { position: 99 }),
    'a pause for the borrower’s play': await post(b, `/api/screenings/${of.screeningId}/heartbeat`, { position: 99, playing: false }),
    'a progress report for a play that never was': await post(b, '/api/screenings/987654321/heartbeat', { position: 1 }),
    'keeping the link': await post(b, `/api/films/${of.slug}/keep`),
    // The return: the loan's own takenAt (which only the borrower's page is given),
    // another, the moment of asking, a film that isn't there, and no return at all.
    'returning the tape, with the loan’s own takenAt': await post(b, `/api/films/${of.slug}/return`, { takenAt: of.loan.taken_at }),
    'returning the tape, with another takenAt': await post(b, `/api/films/${of.slug}/return`, { takenAt: of.loan.taken_at + 1 }),
    'returning the tape, with a takenAt of 0': await post(b, `/api/films/${of.slug}/return`, { takenAt: 0 }),
    'returning a tape of a film that isn’t there': await post(b, '/api/films/no-such-film/return', { takenAt: of.loan.taken_at }),
    'a return that says nothing': await post(b, `/api/films/${of.slug}/return`, {}),
    '/api/me': await get(b, '/api/me'),
    '/api/site': await get(b, '/api/site'),
    'the poster': await get(b, `/media/${of.slug}/poster.jpg`),
  };
  for (const file of playbackFiles(of.slug)) answers[file.replace(of.slug, '…')] = await get(b, file);
  if (ownCode) answers['opening their link again'] = await post(b, '/api/tickets/open', { code: ownCode });
  return answers;
}

// Nothing in an answer says who has the tape, on which link, on what device, or since when.
function saysNothingOfTheBorrower(what, r, of = loan, name = BORROWER_NAME) {
  const text = `${r.body} ${r.cookies.join(' ')}`;
  const secrets = {
    'the borrower’s name': name,
    'the borrower’s device': BORROWER_DEVICE,
    'the label of the link that lent': LABELS.lent,
    'the label of the link that waits': LABELS.waiting,
    'the label of the member’s link': LABELS.own,
    'when the tape was taken': String(of.taken_at),
    'takenAt': 'takenAt',
    'firstPlayedAt': 'firstPlayedAt',
    'the borrower’s session': of.session_hash,
    'the borrower’s place in the film': '"position"',
  };
  for (const [name, secret] of Object.entries(secrets)) assert.ok(!text.includes(secret), `${what} mentions ${name}: ${text.slice(0, 300)}`);
}

// One comparison: what the out page must say, and that the pairs can't be told apart.
async function compare(expected) {
  const pages = {};
  // The same link in a second browser, and another link: byte for byte.
  const same = await everyAnswer(sameLink, t.lent.code);
  const other = await everyAnswer(otherLink, t.waiting.code);
  assert.deepEqual(Object.keys(same), Object.keys(other));
  for (const what of Object.keys(same)) {
    assert.deepEqual(same[what], other[what], `${what}: the link that lent, in another browser, and a link that waits`);
    saysNothingOfTheBorrower(what, same[what]);
  }
  pages.anonymous = same;

  // Two members: one holding the borrower's link, one with their own. The same, apart
  // from their names and whether the link is on their card.
  const held = await everyAnswer(memberSameLink);
  const own = await everyAnswer(memberOwnLink);
  // (linkTickets: the links for anyone this browser holds, for its own sign-out warning.)
  const alike = (r) => ({
    ...r,
    length: null,
    body: r.body.replace(/"person":\{"name":"[^"]*"\}/, '"person":{}').replace(/"inAccount":(true|false)/g, '"inAccount":…').replace(/"linkTickets":\[[^\]]*\]/, '"linkTickets":[…]'),
  });
  for (const what of Object.keys(held)) {
    assert.deepEqual(alike(held[what]), alike(own[what]), `${what}: a member holding the link that lent, and a member with their own link`);
    saysNothingOfTheBorrower(what, held[what]);
    saysNothingOfTheBorrower(what, own[what]);
  }
  assert.equal(json(held['the film page']).access.ticket.inAccount, false);
  assert.equal(json(own['the film page']).access.ticket.inAccount, true);
  pages.members = held;

  // And what those answers are.
  for (const answers of [same, held]) {
    const page = json(answers['the film page']);
    assert.equal(answers['the film page'].status, 200);
    assert.deepEqual(page.access.ticket, { ...expected.ticket, inAccount: false });
    assert.deepEqual([page.access.canPlay, page.access.canKeep, page.access.via, page.access.ticketKept], [false, false, 'ticket', false]);
    assert.deepEqual(Object.keys(page.access).sort(), ['canKeep', 'canPlay', 'mediaStatus', 'preview', 'published', 'ticket', 'ticketKept', 'via'], 'nothing about the tape but the link’s own keys');
    assert.deepEqual([answers.Play.status, json(answers.Play)], [409, { error: expected.play }]);
    for (const what of ['a progress report for the borrower’s play', 'a pause for the borrower’s play', 'a progress report for a play that never was']) {
      assert.deepEqual([answers[what].status, json(answers[what])], [404, { error: 'not-found' }], what);
    }
    for (const file of playbackFiles('…')) assert.deepEqual([answers[file].status, answers[file].body, answers[file].length], [403, '', '0'], file);
    // Nothing to return, also for no such film, whatever takenAt is sent: as keep answers.
    for (const what of Object.keys(answers).filter((k) => k.startsWith('returning'))) {
      assert.deepEqual([answers[what].status, json(answers[what])], [409, { error: 'nothing-to-return' }], what);
    }
    assert.equal(answers['a return that says nothing'].status, 400);
    assert.equal(answers['the poster'].status, 200);
    const me = json(answers['/api/me']);
    assert.deepEqual(me.tickets.map((x) => [x.film.slug, x.ticket]), [[SLUG, { ...expected.ticket, inAccount: false }]]);
    assert.equal(answers['/api/site'].body, siteBefore, 'the site says nothing about any loan');
    assert.equal(json(answers['/api/site']).loanDays, 3);
    for (const what of Object.keys(answers)) assert.deepEqual(answers[what].cookies, [], `${what}: no cookie is sent again to anyone but the borrower`);
  }
  // Keeping: signed out, a sign-in is asked for; signed in, it can't be kept. Never "playing elsewhere".
  assert.deepEqual([same['keeping the link'].status, json(same['keeping the link'])], [401, { error: 'sign-in-required' }]);
  assert.deepEqual([held['keeping the link'].status, json(held['keeping the link'])], [409, { error: 'cannot-keep' }]);
  // Opening the link again: the film's address, tape in or out, and nothing taken.
  assert.deepEqual([same['opening their link again'].status, json(same['opening their link again'])], [200, { slug: SLUG }]);
  // A link's preview in a chat app is what it was before the tape went out, for both links.
  assert.deepEqual([await preview(t.lent), await preview(t.waiting)], previewsBefore);
  assert.deepEqual(previewsBefore[0], previewsBefore[1], 'and the same for the link that lent and the one that didn’t');
  assert.deepEqual(previewsBefore[0].tags.find(([k]) => k === 'og:title'), ['og:title', 'The Tape (1999)']);
  // Nothing anyone asked moved the borrower's play, or wrote anything about the loan.
  assert.equal(srv.db.prepare('SELECT position_seconds FROM screenings WHERE id = ?').get(screeningId).position_seconds, 17);
  assert.deepEqual({ ...srv.db.prepare('SELECT * FROM loans WHERE id = ?').get(loan.id) }, loan);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM loans').get().n, 1);
  return pages;
}

const OUT = (dueBack) => ({ state: 'out', tape: 'out', loanDays: null, startBy: null, dueBack, loan: null, returned: null, expiresAt: null, openScreening: null });

describe('while a tape is out, everyone but its borrower gets the same answer', () => {
  test('at once: "out", the date it is due back, and every other key null, whichever link has it', async () => {
    await compare({ ticket: OUT(loan.due_at), play: 'out' });
  });

  test('the borrower, and only the borrower, sees the loan; the owner sees who has it', async () => {
    const page = json(await get(borrower, `/api/films/${SLUG}`)).access;
    assert.equal(page.canPlay, true);
    assert.deepEqual(page.ticket, {
      state: 'ok', tape: 'yours', loanDays: null, startBy: null, dueBack: loan.due_at,
      loan: { takenAt: loan.taken_at, position: 17, finishedAt: null, toBrowser: true },
      returned: null, inAccount: false, expiresAt: loan.due_at, openScreening: { resumableUntil: loan.due_at, position: 17 },
    });
    // The back office, the Ledger: who, since when, the device.
    const events = (await admin.get(`/api/admin/activity?film=${film.id}`)).data.events;
    const lent = events.find((e) => e.type === 'lent');
    assert.deepEqual([lent.personName, lent.device, lent.ticketLabel, lent.at], [BORROWER_NAME, BORROWER_DEVICE, LABELS.lent, loan.taken_at]);
    const mine = (await admin.get(`/api/admin/tickets/${t.lent.id}`)).data;
    assert.deepEqual([mine.openScreening.device, mine.firstPlayedAt], [BORROWER_DEVICE, loan.taken_at]);
  });

  test('after their links’ start-by date has passed with the tape still out: still "out", for the link that lent and the one that waits alike', async () => {
    // Two hours on: the tape went out two hours ago, and the start-by date was an hour ago.
    srv.db.prepare('UPDATE loans SET taken_at = taken_at - ?1, due_at = due_at - ?1 WHERE id = ?2').run(2 * HOUR, loan.id);
    srv.db.prepare('UPDATE tickets SET first_played_at = first_played_at - ? WHERE id = ?').run(2 * HOUR, t.lent.id);
    srv.db.prepare('UPDATE tickets SET start_by = ? WHERE film_id = ?').run(Date.now() - HOUR, film.id);
    loan = { ...srv.db.prepare('SELECT * FROM loans WHERE id = ?').get(loan.id) };
    assert.ok(loan.taken_at < Date.now() - HOUR && loan.due_at > Date.now());
    // A link that lent stays lent, and one that didn't waits: so the date tells nothing.
    const admins = (await admin.get(`/api/admin/tickets?film=${film.id}`)).data;
    assert.deepEqual(admins.map((x) => x.state), ['ok', 'ok', 'ok'], 'none shows as expired while the tape is out');
    await compare({ ticket: OUT(loan.due_at), play: 'out' });
  });

  test('with the film’s files broken: "unavailable", with the tape still out and the same date, for both alike', async () => {
    srv.db.prepare("UPDATE films SET media_status = 'error' WHERE id = ?").run(film.id);
    try {
      await compare({ ticket: { ...OUT(loan.due_at), state: 'unavailable' }, play: 'unavailable' });
      // The borrower still has the tape and its date.
      const mine = json(await get(borrower, `/api/films/${SLUG}`)).access.ticket;
      assert.deepEqual([mine.state, mine.tape, mine.dueBack, mine.loan.position], ['unavailable', 'yours', loan.due_at, 17]);
    } finally {
      srv.db.prepare("UPDATE films SET media_status = 'ok' WHERE id = ?").run(film.id);
    }
  });

  test('refused media says why only in the server’s log and on the owner’s Status page: one row, for everyone the tape is out for', async () => {
    const { refusals } = (await admin.get('/api/admin/booth')).data.attention;
    // One reason while the tape was out, and one while the film's files were broken:
    // never one for the link that lent and another for a link that waits.
    const reasons = Object.keys(refusals.byReason).sort();
    assert.deepEqual(reasons, ['the tape is out with someone else', 'ticket unavailable'], JSON.stringify(refusals.byReason));
    assert.equal(refusals.byReason['the tape is out with someone else'], 2 * 4 * playbackFiles(SLUG).length, 'two rounds, four browsers, every playback file');
    assert.ok(refusals.recent.every((r) => reasons.includes(r.reason) && r.film === SLUG && r.client === 'Browser on unknown device'));
    const text = JSON.stringify(refusals);
    for (const secret of [BORROWER_NAME, BORROWER_DEVICE, LABELS.lent, loan.session_hash]) assert.ok(!text.includes(secret), secret);
  });
});

// ====================================================================== slice 3: coming back
describe('when the owner moves the date, and when the tape comes back, only the borrower learns why', () => {
  test('a due date the owner moves: the same new date for both, and nothing else', async () => {
    const moved = await admin.patch(`/api/admin/tickets/${t.lent.id}`, { loanDays: 9 });
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    const before = loan.due_at;
    loan = { ...srv.db.prepare('SELECT * FROM loans WHERE id = ?').get(loan.id) };
    assert.equal(loan.due_at, loan.taken_at + 9 * 24 * HOUR);
    assert.notEqual(loan.due_at, before);
    await compare({ ticket: OUT(loan.due_at), play: 'out' });
    // The Ledger has it, for the owner alone.
    const changed = (await admin.get(`/api/admin/activity?kind=loans&film=${film.id}`)).data.events.find((e) => e.type === 'due-changed');
    assert.deepEqual(changed.detail, { loanId: loan.id, from: before, to: loan.due_at });
  });

  test('the borrower returns it: "returned" reaches the borrower only; another browser on the link that lent sees it spent, and not how, when or by whom', async () => {
    const back = await post(borrower, `/api/films/${SLUG}/return`, { takenAt: loan.taken_at });
    assert.equal(back.status, 200, back.body);
    const { at } = json(back).returned;
    assert.deepEqual([back.status, json(await post(borrower, `/api/screenings/${screeningId}/heartbeat`, { position: 18 }))], [200, { error: 'returned' }]);
    assert.deepEqual(json(await get(borrower, `/api/films/${SLUG}`)).access.ticket.returned, { at, how: 'returned' });

    // The link that lent, in the two browsers that aren't the borrower's: the same,
    // apart from the member's name. It is spent (which the plan accepts they can see).
    const same = await everyAnswer(sameLink);
    const held = await everyAnswer(memberSameLink);
    const alike = (r) => ({ ...r, length: null, body: r.body.replace(/"person":(\{"name":"[^"]*"\}|null)/, '"person":…') });
    for (const what of Object.keys(same)) {
      // (Keeping asks a signed-out browser to sign in first, whatever the link.)
      if (what !== 'keeping the link') assert.deepEqual(alike(same[what]), alike(held[what]), what);
      saysNothingOfTheBorrower(what, same[what]);
      saysNothingOfTheBorrower(what, held[what]);
      assert.ok(!same[what].body.includes(String(at)) && !same[what].body.includes('"returned":{'), `${what}: says when or how it came back`);
    }
    const spent = json(same['the film page']).access.ticket;
    assert.deepEqual(spent, { state: 'spent', tape: null, loanDays: null, startBy: null, dueBack: null, loan: null, returned: null, inAccount: false, expiresAt: null, openScreening: null });
    assert.deepEqual([same.Play.status, json(same.Play)], [409, { error: 'spent' }]);
    assert.deepEqual([json(same['keeping the link']), json(held['keeping the link'])], [{ error: 'sign-in-required' }, { error: 'cannot-keep' }], 'a link that has lent can’t be kept');
    // The other links: their own state, and nothing of the loan that was. (Their
    // start-by date passed while the tape was out, so once it is back they are expired.)
    for (const b of [otherLink, memberOwnLink]) {
      const answers = await everyAnswer(b);
      for (const what of Object.keys(answers)) {
        saysNothingOfTheBorrower(what, answers[what]);
        assert.ok(!answers[what].body.includes(String(at)), `${what}: says when it came back`);
      }
      assert.deepEqual([json(answers['the film page']).access.ticket.state, json(answers['the film page']).access.ticket.returned], ['expired', null]);
    }
    // Nobody but the borrower gets a reason from a progress report, or anything from a return.
    for (const answers of [same, held]) {
      assert.deepEqual([answers['a progress report for the borrower’s play'].status, json(answers['a progress report for the borrower’s play'])], [404, { error: 'not-found' }]);
      for (const what of Object.keys(answers).filter((k) => k.startsWith('returning'))) assert.deepEqual(json(answers[what]), { error: 'nothing-to-return' }, what);
    }
    // A stranger opening the spent link learns it has been used, and not the film.
    const stranger = await ask({ jar: new Map() }, 'POST', '/api/tickets/open', { code: t.lent.code });
    assert.deepEqual([stranger.status, stranger.body, stranger.cookies], [410, '{"error":"ticket-spent"}', []]);
    assert.deepEqual((await preview(t.lent)).tags.find(([k]) => k === 'og:title'), ['og:title', 'Open Matte'], 'and its preview is the shop');
  });

  test('the owner takes a tape back: "taken back" reaches the borrower only; everyone on that link sees no such film, the same', async () => {
    const second = await addFilm(admin, mediaDir, 'second-tape', { title: 'Second Tape' });
    const issue = async (fields) => (await admin.post('/api/admin/tickets', { filmId: second.id, ...fields })).data[0];
    const link = await issue({ label: LABELS.lent });
    const other = await issue({ label: LABELS.waiting });
    const b1 = browser(srv.base);
    b1.ua = BORROWER_UA;
    const b2 = browser(srv.base);
    const b3 = browser(srv.base);
    for (const [b, ticket] of [[b1, link], [b2, link], [b3, other]]) assert.equal((await post(b, '/api/tickets/open', { code: ticket.code })).status, 200);
    const played = json(await post(b1, '/api/films/second-tape/screenings'));
    const taken = { ...srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(link.id) };
    assert.equal((await admin.post(`/api/admin/loans/${taken.id}/take-back`, { ticketId: link.id })).status, 200);

    const reportOf = (b) => post(b, `/api/screenings/${played.screeningId}/heartbeat`, { position: 3 });
    const mine = await reportOf(b1);
    assert.deepEqual([mine.status, json(mine)], [409, { error: 'taken-back' }]);
    for (const b of [b2, b3]) {
      const theirs = await reportOf(b);
      assert.deepEqual([theirs.status, json(theirs)], [404, { error: 'not-found' }]);
    }
    // The borrower's page and the other holder's: no such film, byte for byte (question 6).
    const asked = async (b) => ({
      page: await get(b, '/api/films/second-tape'),
      play: await post(b, '/api/films/second-tape/screenings'),
      back: await post(b, '/api/films/second-tape/return', { takenAt: taken.taken_at }),
      open: await post(b, '/api/tickets/open', { code: link.code }),
      me: await get(b, '/api/me'),
      master: await get(b, '/media/second-tape/hls/master.m3u8'),
    });
    const [first, sameLinkAgain] = [await asked(b1), await asked(b2)];
    assert.deepEqual(first, sameLinkAgain);
    assert.deepEqual([first.page.status, first.page.body, first.play.status, first.back.body, first.open.body, first.master.status], [404, '{"error":"not-found"}', 404, '{"error":"nothing-to-return"}', '{"error":"ticket-revoked"}', 403]);
    // The other link: the tape is in, and nothing says it was ever out, or why it is back.
    const third = await asked(b3);
    assert.equal(json(third.page).access.ticket.tape, 'in');
    for (const r of Object.values(third)) assert.ok(!/taken-back|"returned":\{|Edge on Windows/.test(r.body) && !r.body.includes(String(taken.taken_at)), r.body.slice(0, 200));
  });
});

// ====================================================================== whoever the borrower is
// The suites above have one borrower: a browser, on a link anyone can use. Here the
// same questions are asked of two films side by side, alike but for who has the tape.
describe('whoever has the tape, and however they took it', () => {
  const TITLE = 'Twin Tape';
  const NAMES = { browser: 'Bridget Browserloan', member: 'Merle Memberloan', other: 'Odile Otherlink' };
  // One film: a link that lends and one for anyone that waits, the waiting one opened
  // by a browser that isn't signed in. `ownLink`: the link that lends is the
  // borrower's own, as a member; otherwise it is for anyone, and the borrower's
  // browser is signed in when it presses Play, so the loan is the browser's.
  const world = {};
  const member = async (name, ua) => {
    const p = await newPerson(admin, name);
    const auth = softAuthenticator();
    const b = browser(srv.base);
    b.ua = ua;
    const r = await enroll({ post: (url, body) => b.send('POST', url, JSON.stringify(body), { type: 'application/json', headers: ua ? { 'user-agent': ua } : {} }) }, (await setupLink(admin, p.id)).token, { auth });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return { p, b, auth };
  };
  async function tapeOut(slug, name, ownLink) {
    const made = await addFilm(admin, mediaDir, slug, { title: TITLE, year: 2001 });
    const issue = async (fields) => (await admin.post('/api/admin/tickets', { filmId: made.id, ...fields })).data[0];
    const who = await member(name, BORROWER_UA);
    const lent = await issue({ label: LABELS.lent, loanDays: 5, ...(ownLink ? { personId: who.p.id } : {}) });
    const waiting = await issue({ label: LABELS.waiting, loanDays: 5 });
    if (!ownLink) assert.equal((await post(who.b, '/api/tickets/open', { code: lent.code })).status, 200);
    const asker = browser(srv.base);
    assert.equal((await post(asker, '/api/tickets/open', { code: waiting.code })).status, 200);
    const played = await post(who.b, `/api/films/${slug}/screenings`);
    assert.equal(played.status, 200, played.body);
    const out = { ...srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(lent.id) };
    assert.equal(out.person_id, ownLink ? who.p.id : null);
    assert.equal((await post(who.b, `/api/screenings/${json(played).screeningId}/heartbeat`, { position: 12 })).status, 200);
    return { slug, film: made, who, lent, waiting, asker, loan: out, screeningId: json(played).screeningId, of: { slug, screeningId: json(played).screeningId, loan: out } };
  }
  const position = (w) => srv.db.prepare('SELECT position_seconds FROM screenings WHERE id = ?').get(w.screeningId).position_seconds;
  // What differs between the two films, and nothing else: the slug (of the same
  // length in both), the stamp on the poster's address, which is the film's own, and
  // the date the tape is due back.
  const apartFromTheFilm = (r, w) => ({ ...r, body: r.body.replaceAll(w.slug, '…').replace(/poster\.jpg\?v=[^"]+/, 'poster.jpg?v=…').replaceAll(String(w.loan.due_at), '"due"') });

  before(async () => {
    world.browser = await tapeOut('twin-tape-one', NAMES.browser, false);
    world.member = await tapeOut('twin-tape-two', NAMES.member, true);
  });

  test('out on a member’s own link, or out to a browser on a link anyone can use: a browser with a link that waits gets the same answers', async () => {
    const [a, m] = [world.browser, world.member];
    const byBrowser = await everyAnswer(a.asker, a.waiting.code, a.of);
    const byMember = await everyAnswer(m.asker, m.waiting.code, m.of);
    assert.deepEqual(Object.keys(byBrowser), Object.keys(byMember));
    for (const what of Object.keys(byBrowser)) {
      assert.deepEqual(apartFromTheFilm(byBrowser[what], a), apartFromTheFilm(byMember[what], m), what);
      saysNothingOfTheBorrower(what, byBrowser[what], a.loan, NAMES.browser);
      saysNothingOfTheBorrower(what, byMember[what], m.loan, NAMES.member);
      assert.deepEqual(byMember[what].cookies, [], what);
    }
    const page = json(byMember['the film page']).access;
    assert.deepEqual([page.canPlay, page.canKeep, page.ticket], [false, false, { ...OUT(m.loan.due_at), inAccount: false }]);
    assert.deepEqual([byMember.Play.status, json(byMember.Play)], [409, { error: 'out' }]);
    assert.deepEqual([byMember['a progress report for the borrower’s play'].status, json(byMember['a progress report for the borrower’s play'])], [404, { error: 'not-found' }]);
    assert.deepEqual([position(a), position(m)], [12, 12]);
  });

  // Question 12, with question 2: the borrower signed in before pressing Play on a link
  // anyone can use, so the tape is that browser's alone. Their own second device, on
  // the same link, is one more browser that isn't the borrower: it is told what any
  // other member holding that link is told, and never "playing elsewhere".
  test('the borrower’s own second device, on the link anyone can use that lent: the same as any other member holding that link', async () => {
    const w = world.browser;
    const second = browser(srv.base);
    assert.equal((await signIn(second, w.who.auth)).status, 200);
    const another = await member(NAMES.other);
    for (const b of [second, another.b]) assert.deepEqual(json(await post(b, '/api/tickets/open', { code: w.lent.code })), { slug: w.slug });

    const theirs = await everyAnswer(second, w.lent.code, w.of);
    const others = await everyAnswer(another.b, w.lent.code, w.of);
    const alike = (r) => ({ ...r, length: null, body: r.body.replace(/"person":\{"name":"[^"]*"\}/, '"person":{}') });
    for (const what of Object.keys(theirs)) {
      assert.deepEqual(alike(theirs[what]), alike(others[what]), what);
      saysNothingOfTheBorrower(what, others[what], w.loan, NAMES.browser);
      assert.deepEqual(theirs[what].cookies, [], `${what}: no cookie`);
    }
    assert.deepEqual(json(theirs['the film page']).access.ticket, { ...OUT(w.loan.due_at), inAccount: false });
    assert.deepEqual([theirs.Play.status, json(theirs.Play)], [409, { error: 'out' }], 'never "playing elsewhere"');
    for (const what of ['a progress report for the borrower’s play', 'a pause for the borrower’s play']) assert.deepEqual([theirs[what].status, json(theirs[what])], [404, { error: 'not-found' }], what);
    for (const what of Object.keys(theirs).filter((k) => k.startsWith('returning'))) assert.deepEqual([theirs[what].status, json(theirs[what])], [409, { error: 'nothing-to-return' }], what);
    assert.deepEqual([theirs['keeping the link'].status, json(theirs['keeping the link'])], [409, { error: 'cannot-keep' }]);
    for (const file of playbackFiles('…')) assert.equal(theirs[file].status, 403, file);
    // The borrower's play is where it was, and still theirs to carry on with.
    assert.equal(position(w), 12);
    assert.deepEqual({ ...srv.db.prepare('SELECT * FROM loans WHERE id = ?').get(w.loan.id) }, w.loan);
    assert.equal(json(await get(w.who.b, `/api/films/${w.slug}`)).access.ticket.tape, 'yours');
  });

  test('a newcomer opening the link that lent, or one that waits, while the tape is out: the film’s address and a new session, the same for both', async () => {
    for (const w of [world.browser, world.member]) {
      // (A member's own link opens only for them: a newcomer is asked to sign in, tape in or out.)
      const codes = w === world.member ? [w.waiting.code] : [w.lent.code, w.waiting.code];
      const opened = [];
      for (const code of codes) {
        const fresh = { jar: new Map() };
        const r = await ask(fresh, 'POST', '/api/tickets/open', { code });
        assert.deepEqual([r.status, r.body], [200, JSON.stringify({ slug: w.slug })]);
        assert.equal(r.cookies.length, 1);
        // The cookie's shape, apart from its token.
        opened.push({ ...r, cookies: r.cookies.map((c) => c.replace(/^om_session=[^;]+/, 'om_session=…')), page: await get(fresh, `/api/films/${w.slug}`) });
      }
      for (const o of opened) assert.deepEqual(o, opened[0]);
      assert.deepEqual(json(opened[0].page).access.ticket, { ...OUT(w.loan.due_at), inAccount: false });
      assert.match(opened[0].cookies[0], /^om_session=…; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
    }
    const signInFirst = await ask({ jar: new Map() }, 'POST', '/api/tickets/open', { code: world.member.lent.code });
    assert.deepEqual([signInFirst.status, signInFirst.body, signInFirst.cookies], [401, '{"error":"sign-in-required"}', []]);
  });
});
