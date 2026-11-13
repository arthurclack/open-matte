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
// implementation. It gains rows as their routes arrive.
// Slice 6's is here. A link's start-by date is given back the time the tape was out
// on other links. While the tape is out nobody is told a start-by date at all; once
// it is back, the date a waiting link's holder reads is later by how long the tape
// was out and by nothing else: the same whoever had it and however it came back.
// Slice 5's are here. The film is on the members' shelf, and two members with no link
// read it: in or out and the date, and nothing else. The owner's own answers say who
// (the loans list, the film, Status, the preview of the film page), and each of those
// routes refuses everyone else. And a last suite asks every route a viewer can reach,
// as every kind of viewer, with the tape out to a member, to a browser and to a
// browser a member is signed in on, one after another on one film: the answers are
// the same whoever has it, the same again however it came back, and none holds the
// borrower's name, device, link (its label, note, id or code), loan id, session or
// takenAt.
// Slice 4's are here. Every link carries a "Picked for you" note of its own: each
// browser reads its own link's note and no other, the answers are the same once that
// note is set aside, the note a browser with two links reads doesn't depend on which
// of them lent, and no note or label is in a link's preview. And a response: handing
// a tape back with one is "nothing to return" for everyone but the borrower, a tape
// handed back with a response looks to everyone else like one returned without, and
// what was said reaches no viewer at all. Slice 3's are here: a return, whatever
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
// "Picked for you": a note on each link, for whoever has that link and nobody else.
// All of one length, so an answer's length can't differ by the note alone.
const NOTES = { lent: 'Picked for whoever has link A.', waiting: 'Picked for whoever has link B.', own: 'Picked for whoever has link C.' };
// What a borrower says when handing a tape back: for the owner alone.
const WORDS = 'Words that only the owner should ever read.';

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
// Two members with no link for the film, which is on the members' shelf.
let shelfReaders;
let shelfBefore;

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
  for (const secret of [...Object.values(NOTES), ...Object.values(LABELS)]) assert.ok(!html.includes(secret), `a link's preview holds "${secret}"`);
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
  // On the shelf for members (question 7): anyone signed in with no link for it sees it listed.
  await admin.patch(`/api/admin/films/${film.id}`, { published: true, memberVisible: true });

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
  t.lent = await issue({ label: LABELS.lent, pickNote: NOTES.lent, startBy, claimable: true });
  t.waiting = await issue({ label: LABELS.waiting, pickNote: NOTES.waiting, startBy, claimable: true });
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
  t.own = await issue({ label: LABELS.own, pickNote: NOTES.own, startBy, personId: second.p.id });

  shelfReaders = [(await member('Shelf Reader One')).b, (await member('Shelf Reader Two')).b];
  [shelfBefore] = json(await get(shelfReaders[0], '/api/me')).memberFilms;
  assert.deepEqual([shelfBefore.slug, shelfBefore.tape, shelfBefore.dueBack], [SLUG, 'in', null]);

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
// `withPlay`: left out where the tape is in for this browser's link, since Play would take it.
async function everyAnswer(b, ownCode, of = { slug: SLUG, screeningId, loan }, withPlay = true) {
  const answers = {
    'the film page': await get(b, `/api/films/${of.slug}`),
    'the film page, reading itself again': await get(b, `/api/films/${of.slug}?again=1`),
    ...(withPlay ? { Play: await post(b, `/api/films/${of.slug}/screenings`) } : {}),
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
    // Handing it back with a response: only the member who borrowed it can, and
    // nobody else learns whether this tape's borrower could.
    'returning the tape, with a response': await post(b, `/api/films/${of.slug}/return`, { takenAt: of.loan.taken_at, response: 'loved-it', message: WORDS }),
    'returning the tape, with a response and another takenAt': await post(b, `/api/films/${of.slug}/return`, { takenAt: of.loan.taken_at - 1, response: 'lets-talk' }),
    'returning a tape of a film that isn’t there, with a response': await post(b, '/api/films/no-such-film/return', { takenAt: of.loan.taken_at, response: 'not-for-me' }),
    'a return that says nothing': await post(b, `/api/films/${of.slug}/return`, {}),
    '/api/me': await get(b, '/api/me'),
    '/api/site': await get(b, '/api/site'),
    'the poster': await get(b, `/media/${of.slug}/poster.jpg`),
  };
  for (const file of playbackFiles(of.slug)) answers[file.replace(of.slug, '…')] = await get(b, file);
  if (ownCode) answers['opening their link again'] = await post(b, '/api/tickets/open', { code: ownCode });
  return answers;
}

// What a member with no link for the film can ask: the shelf (/api/me), the film's
// page, and everything that only ever answers a borrower. (Not the playback files:
// the count of refusals further down is of the browsers that hold a link.)
async function shelfAnswers(b, of = { slug: SLUG, screeningId, loan }) {
  return {
    '/api/me': await get(b, '/api/me'),
    'the film page': await get(b, `/api/films/${of.slug}`),
    'the film page, reading itself again': await get(b, `/api/films/${of.slug}?again=1`),
    Play: await post(b, `/api/films/${of.slug}/screenings`),
    'a progress report for the borrower’s play': await post(b, `/api/screenings/${of.screeningId}/heartbeat`, { position: 99 }),
    'keeping the link': await post(b, `/api/films/${of.slug}/keep`),
    'returning the tape, with the loan’s own takenAt': await post(b, `/api/films/${of.slug}/return`, { takenAt: of.loan.taken_at }),
    'returning the tape, with a response': await post(b, `/api/films/${of.slug}/return`, { takenAt: of.loan.taken_at, response: 'loved-it', message: WORDS }),
    'their account': await get(b, '/api/account'),
    '/api/site': await get(b, '/api/site'),
  };
}

// Every route that says who has a tape is the owner's: anyone else is refused, the same.
const OWNERS = (f) => ['/api/admin/loans', '/api/admin/loans?live=1', `/api/admin/loans?film=${f.id}`, '/api/admin/films', `/api/admin/films/${f.id}`, '/api/admin/tickets', '/api/admin/people', '/api/admin/booth', '/api/admin/responses', '/api/admin/activity?kind=loans'];
async function ownersAlone(b, f = film) {
  for (const url of OWNERS(f)) {
    const r = await get(b, url);
    assert.deepEqual([r.status, r.body, r.cookies], [401, '{"error":"not-signed-in"}', []], url);
  }
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
    'whether the borrower can respond': 'canRespond',
    'a response': '"responded"',
    'what a borrower said': WORDS,
    // What only the owner's answers hold (slice 5).
    'who has it': '"borrower"',
    'who that browser is signed in as': 'signedInAs',
    'the borrower’s other links': 'otherLinks',
    'when it was due, as the owner is told': 'dueAt',
    // Slice 6: the date a link was set to start by beside the date it goes by, and
    // whether its time stands still, are the owner's. A viewer reads one date, or none.
    'the date a link goes by, as the owner is told': 'effectiveStartBy',
    'whether a link’s time stands still': 'startByPaused',
    'the date a link was set to': 'startByAsSet',
  };
  for (const [name, secret] of Object.entries(secrets)) assert.ok(!text.includes(secret), `${what} mentions ${name}: ${text.slice(0, 300)}`);
}

// A browser reads the note on its own link, and no other link's.
function readsOnlyItsOwnNote(what, r, own) {
  for (const note of Object.values(NOTES)) if (note !== own) assert.ok(!r.body.includes(note), `${what} holds the note of a link that isn’t this browser’s: ${note}`);
}
// An answer with this browser's own note set aside: what is left must not differ.
const apartFromTheirNote = (r, own) => ({ ...r, body: r.body.replaceAll(JSON.stringify(own), '"(their own link’s note)"') });

// One comparison: what the out page must say, and that the pairs can't be told apart.
async function compare(expected) {
  const pages = {};
  // The same link in a second browser, and another link: byte for byte, apart from
  // each link's own "Picked for you" note.
  const same = await everyAnswer(sameLink, t.lent.code);
  const other = await everyAnswer(otherLink, t.waiting.code);
  assert.deepEqual(Object.keys(same), Object.keys(other));
  for (const what of Object.keys(same)) {
    assert.deepEqual(apartFromTheirNote(same[what], NOTES.lent), apartFromTheirNote(other[what], NOTES.waiting), `${what}: the link that lent, in another browser, and a link that waits`);
    saysNothingOfTheBorrower(what, same[what]);
    readsOnlyItsOwnNote(what, same[what], NOTES.lent);
    readsOnlyItsOwnNote(what, other[what], NOTES.waiting);
  }
  // Each reads its own link's note on the film page and in /api/me, and nowhere else.
  for (const [answers, note] of [[same, NOTES.lent], [other, NOTES.waiting]]) {
    assert.equal(json(answers['the film page']).access.ticket.pickNote, note);
    assert.equal(json(answers['/api/me']).tickets[0].ticket.pickNote, note);
    const elsewhere = Object.keys(answers).filter((what) => !what.startsWith('the film page') && what !== '/api/me');
    for (const what of elsewhere) assert.ok(!answers[what].body.includes(note), `${what} holds a note`);
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
    assert.deepEqual(alike(apartFromTheirNote(held[what], NOTES.lent)), alike(apartFromTheirNote(own[what], NOTES.own)), `${what}: a member holding the link that lent, and a member with their own link`);
    saysNothingOfTheBorrower(what, held[what]);
    saysNothingOfTheBorrower(what, own[what]);
    readsOnlyItsOwnNote(what, held[what], NOTES.lent);
    readsOnlyItsOwnNote(what, own[what], NOTES.own);
  }
  assert.equal(json(own['the film page']).access.ticket.pickNote, NOTES.own);
  assert.equal(json(held['the film page']).access.ticket.inAccount, false);
  assert.equal(json(own['the film page']).access.ticket.inAccount, true);
  pages.members = held;

  // The members' shelf: two members with no link for the film. In or out and the date
  // it's due back, the same for both, and nothing else about the tape anywhere.
  const [shelfOne, shelfTwo] = [await shelfAnswers(shelfReaders[0]), await shelfAnswers(shelfReaders[1])];
  // (Their own account says when each signed in, and has each one's own card number.)
  const apartFromWho = (r) => ({ ...alike(r), body: alike(r).body.replace(/"membership":\{[^}]*\}/, '"membership":{}').replace(/"(signedInAt|lastSeenAt|addedAt|lastUsedAt)":\d+/g, '"$1":…') });
  for (const what of Object.keys(shelfOne)) {
    assert.deepEqual(apartFromWho(shelfOne[what]), apartFromWho(shelfTwo[what]), `${what}: two members with no link`);
    saysNothingOfTheBorrower(what, shelfOne[what]);
    readsOnlyItsOwnNote(what, shelfOne[what], null);
    assert.deepEqual(shelfOne[what].cookies, [], what);
  }
  const shelf = json(shelfOne['/api/me']);
  assert.deepEqual([shelf.tickets, shelf.browserLoans, shelf.linkTickets], [[], [], []]);
  assert.deepEqual(shelf.memberFilms, [{ ...shelfBefore, tape: 'out', dueBack: expected.ticket.dueBack }], 'the listing as it was, out, and due back when the tape is');
  const listing = json(shelfOne['the film page']).access;
  assert.deepEqual([listing.via, listing.ticket, listing.canPlay, listing.canKeep], ['member', null, false, false]);
  assert.deepEqual(Object.keys(listing).sort(), ['canKeep', 'canPlay', 'mediaStatus', 'preview', 'published', 'ticket', 'ticketKept', 'via'], 'the listing’s page has nothing of the tape');
  assert.deepEqual([shelfOne.Play.status, json(shelfOne.Play)], [409, { error: 'no-ticket' }]);
  assert.deepEqual([shelfOne['a progress report for the borrower’s play'].status, json(shelfOne['a progress report for the borrower’s play'])], [404, { error: 'not-found' }]);
  for (const what of Object.keys(shelfOne).filter((k) => k.startsWith('returning'))) assert.deepEqual(json(shelfOne[what]), { error: 'nothing-to-return' }, what);
  // A browser's own loans are its own: nobody here has any.
  for (const answers of [same, other, held, own]) assert.deepEqual(json(answers['/api/me']).browserLoans, []);
  for (const answers of [same, other, held, own]) assert.deepEqual(json(answers['/api/me']).memberFilms, [], 'a film they hold a link for is among their links, not on the shelf');
  // And the routes that do say who are the owner's alone.
  for (const b of [sameLink, otherLink, memberSameLink, memberOwnLink, shelfReaders[0], borrower, { jar: new Map() }]) await ownersAlone(b);
  pages.shelf = shelfOne;

  // And what those answers are.
  for (const answers of [same, held]) {
    const page = json(answers['the film page']);
    assert.equal(answers['the film page'].status, 200);
    assert.deepEqual(page.access.ticket, { ...expected.ticket, pickNote: NOTES.lent, inAccount: false });
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
    assert.deepEqual(me.tickets.map((x) => [x.film.slug, x.ticket]), [[SLUG, { ...expected.ticket, pickNote: NOTES.lent, inAccount: false }]]);
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
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM responses').get().n, 0, 'nobody’s response was taken');
  return pages;
}

const OUT = (dueBack) => ({ state: 'out', tape: 'out', loanDays: null, startBy: null, dueBack, loan: null, returned: null, pickNote: null });

describe('while a tape is out, everyone but its borrower gets the same answer', () => {
  test('at once: "out", the date it is due back, and every other key null, whichever link has it', async () => {
    await compare({ ticket: OUT(loan.due_at), play: 'out' });
  });

  test('the borrower, and only the borrower, sees the loan; the owner sees who has it', async () => {
    const page = json(await get(borrower, `/api/films/${SLUG}`)).access;
    assert.equal(page.canPlay, true);
    assert.deepEqual(page.ticket, {
      state: 'ok', tape: 'yours', loanDays: null, startBy: null, dueBack: loan.due_at,
      loan: { takenAt: loan.taken_at, position: 17, finishedAt: null, toBrowser: true, canRespond: false },
      returned: null, pickNote: NOTES.lent, inAccount: false,
    });
    // The tape is this browser's, on a link anyone can use: it can't be handed back
    // with a response, signed in or not, and only the borrower is told so. Nothing changes.
    const refused = await post(borrower, `/api/films/${SLUG}/return`, { takenAt: loan.taken_at, response: 'loved-it', message: WORDS });
    assert.deepEqual([refused.status, json(refused)], [409, { error: 'cannot-respond' }]);
    assert.deepEqual({ ...srv.db.prepare('SELECT * FROM loans WHERE id = ?').get(loan.id) }, loan);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM responses').get().n, 0);
    // The back office, the Ledger: who, since when, the device.
    const events = (await admin.get(`/api/admin/activity?film=${film.id}`)).data.events;
    const lent = events.find((e) => e.type === 'lent');
    assert.deepEqual([lent.personName, lent.device, lent.ticketLabel, lent.at], [BORROWER_NAME, BORROWER_DEVICE, LABELS.lent, loan.taken_at]);
    const mine = (await admin.get(`/api/admin/tickets/${t.lent.id}`)).data;
    // The borrower's device, on the link's loan (1.x said it as openScreening.device),
    // and on the loan's play among the link's plays, which is what the link's page says
    // ("Now … on {device}", and its Plays table).
    assert.deepEqual([mine.loan.borrower.device, mine.firstPlayedAt], [BORROWER_DEVICE, loan.taken_at]);
    const play = mine.screenings.find((s) => s.id === mine.loan.screeningId);
    assert.deepEqual([play?.id, play?.device], [screeningId, BORROWER_DEVICE]);
    // With the browser's session no longer naming it (as once the clean-up has deleted
    // the session), the play's device is the one the loan kept.
    const sessionDevice = srv.db.prepare('SELECT device FROM sessions WHERE id_hash = ?').get(loan.session_hash).device;
    srv.db.prepare('UPDATE sessions SET device = NULL WHERE id_hash = ?').run(loan.session_hash);
    try {
      const again = (await admin.get(`/api/admin/tickets/${t.lent.id}`)).data;
      assert.equal(again.screenings.find((s) => s.id === again.loan.screeningId)?.device, loan.device);
      assert.equal(loan.device, BORROWER_DEVICE);
    } finally {
      srv.db.prepare('UPDATE sessions SET device = ? WHERE id_hash = ?').run(sessionDevice, loan.session_hash);
    }
    // Slice 5: the loans list, the film, the link, Status and the owner's own preview
    // of the film page. A browser's loan: its device, and the member signed in there.
    const who = { kind: 'browser', device: BORROWER_DEVICE, signedInAs: { id: srv.db.prepare('SELECT id FROM people WHERE name = ?').get(BORROWER_NAME).id, name: BORROWER_NAME, disabled: false } };
    const [listed] = (await admin.get(`/api/admin/loans?live=1&film=${film.id}`)).data.loans;
    assert.deepEqual([listed.id, listed.borrower, listed.takenAt, listed.dueAt, listed.ticket, listed.position, listed.live], [loan.id, who, loan.taken_at, loan.due_at, { id: t.lent.id, label: LABELS.lent }, 17, true]);
    assert.deepEqual((await admin.get(`/api/admin/films/${film.id}`)).data.tape, { state: 'out', loan: listed });
    assert.deepEqual([mine.linkState, mine.loan], ['has', listed]);
    assert.deepEqual((await admin.get('/api/admin/booth')).data.attention.tapes, { out: 1, next: { film: { id: film.id, slug: SLUG, title: 'The Tape' }, dueAt: loan.due_at } });
    const preview = json(await get(admin, `/api/films/${SLUG}`)).access;
    assert.deepEqual([preview.preview, preview.tape], [true, { out: true, borrower: who, takenAt: loan.taken_at, dueAt: loan.due_at }]);
    // Everyone else's film page has no such key, the borrower's own included.
    for (const b of [borrower, sameLink, otherLink, memberSameLink, memberOwnLink, shelfReaders[0]]) assert.ok(!('tape' in json(await get(b, `/api/films/${SLUG}`)).access));
  });

  test('after their links’ start-by date has passed with the tape still out: still "out", for the link that lent and the one that waits alike', async () => {
    // Two hours on: the links were made, and the tape went out, two hours ago, and the
    // start-by date was an hour ago.
    srv.db.prepare('UPDATE loans SET taken_at = taken_at - ?1, due_at = due_at - ?1 WHERE id = ?2').run(2 * HOUR, loan.id);
    srv.db.prepare('UPDATE tickets SET first_played_at = first_played_at - ? WHERE id = ?').run(2 * HOUR, t.lent.id);
    srv.db.prepare('UPDATE tickets SET created_at = created_at - ?, start_by = ? WHERE film_id = ?').run(2 * HOUR, Date.now() - HOUR, film.id);
    loan = { ...srv.db.prepare('SELECT * FROM loans WHERE id = ?').get(loan.id) };
    assert.ok(loan.taken_at < Date.now() - HOUR && loan.due_at > Date.now());
    // A link that lent stays lent, and one that didn't waits: so the date tells nothing.
    const admins = (await admin.get(`/api/admin/tickets?film=${film.id}`)).data;
    // The one that lent has it, and the others wait (1.x's state said 'ok' for all three).
    assert.deepEqual(admins.map((x) => x.linkState).toSorted(), ['has', 'waiting', 'waiting'], 'none shows as missed while the tape is out');
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
    assert.deepEqual(spent, { state: 'spent', tape: null, loanDays: null, startBy: null, dueBack: null, loan: null, returned: null, pickNote: NOTES.lent, inAccount: false });
    assert.deepEqual([same.Play.status, json(same.Play)], [409, { error: 'spent' }]);
    assert.deepEqual([json(same['keeping the link']), json(held['keeping the link'])], [{ error: 'sign-in-required' }, { error: 'cannot-keep' }], 'a link that has lent can’t be kept');
    // The other links: their own state, and nothing of the loan that was. Their
    // start-by date passed while the tape was out, so once it is back they have that
    // time back (slice 6): the tape is in for them, and the date they read is later
    // than the one their link was set to by how long the tape was out. The same date
    // for both, and neither the moment it was taken nor the moment it came back.
    // (Everything but Play, which would take the tape.)
    const set = srv.db.prepare('SELECT start_by FROM tickets WHERE id = ?').get(t.waiting.id).start_by;
    assert.equal(srv.db.prepare('SELECT start_by FROM tickets WHERE id = ?').get(t.own.id).start_by, set);
    assert.ok(set < Date.now(), 'the date as it was set has passed');
    for (const b of [otherLink, memberOwnLink]) {
      const answers = await everyAnswer(b, undefined, undefined, false);
      for (const what of Object.keys(answers)) {
        saysNothingOfTheBorrower(what, answers[what]);
        assert.ok(!answers[what].body.includes(String(at)), `${what}: says when it came back`);
      }
      const theirs = json(answers['the film page']).access.ticket;
      assert.deepEqual([theirs.state, theirs.tape, theirs.startBy, theirs.returned], ['ok', 'in', set + (at - loan.taken_at), null]);
    }
    // The members' shelf: the film is in, as it was before anyone took it. Not how, when or by whom.
    const shelf = await shelfAnswers(shelfReaders[0]);
    for (const what of Object.keys(shelf)) {
      saysNothingOfTheBorrower(what, shelf[what]);
      assert.ok(!shelf[what].body.includes(String(at)) && !shelf[what].body.includes('"returned":{'), `${what}: says when or how it came back`);
    }
    assert.deepEqual(json(shelf['/api/me']).memberFilms, [shelfBefore]);
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

  // ==================================================================== slice 4: picked for you
  // A browser may hold two links for one film, each with a note of its own. While the
  // tape is out with someone else it reads one of them, and which one must not depend
  // on which link lent: otherwise the note would say what "Out on loan" doesn't.
  test('a browser holding two links with a note each reads the same note whichever of them has the tape', async () => {
    const [first, second] = ['Picked for whoever has the older link.', 'Picked for whoever has the newer link.'];
    async function twoLinks(slug, lends) {
      const made = await addFilm(admin, mediaDir, slug, { title: TITLE, year: 2001 });
      const issue = async (fields) => (await admin.post('/api/admin/tickets', { filmId: made.id, loanDays: 5, ...fields })).data[0];
      const links = { older: await issue({ label: LABELS.lent, pickNote: first }), newer: await issue({ label: LABELS.waiting, pickNote: second }) };
      const asker = browser(srv.base);
      for (const link of Object.values(links)) assert.equal((await post(asker, '/api/tickets/open', { code: link.code })).status, 200);
      const borrower = browser(srv.base);
      borrower.ua = BORROWER_UA;
      assert.equal((await post(borrower, '/api/tickets/open', { code: links[lends].code })).status, 200);
      const played = await post(borrower, `/api/films/${slug}/screenings`);
      assert.equal(played.status, 200, played.body);
      const out = { ...srv.db.prepare('SELECT * FROM loans WHERE film_id = ?').get(made.id) };
      assert.equal(out.ticket_id, links[lends].id);
      return { slug, links, asker, borrower, loan: out, of: { slug, screeningId: json(played).screeningId, loan: out } };
    }
    const a = await twoLinks('note-tape-one', 'older');
    const b = await twoLinks('note-tape-two', 'newer');
    const fromOlder = await everyAnswer(a.asker, a.links.older.code, a.of);
    const fromNewer = await everyAnswer(b.asker, b.links.older.code, b.of);
    for (const what of Object.keys(fromOlder)) {
      assert.deepEqual(apartFromTheFilm(fromOlder[what], a), apartFromTheFilm(fromNewer[what], b), what);
      saysNothingOfTheBorrower(what, fromOlder[what], a.loan, 'nobody');
      saysNothingOfTheBorrower(what, fromNewer[what], b.loan, 'nobody');
    }
    // One note, the same in both: the older link's, as the tape's being in would show too.
    for (const answers of [fromOlder, fromNewer]) {
      assert.deepEqual(json(answers['the film page']).access.ticket, { ...OUT(json(answers['the film page']).access.ticket.dueBack), pickNote: first, inAccount: false });
      assert.ok(!answers['the film page'].body.includes(second) && !answers['/api/me'].body.includes(second));
    }
    // The borrower reads the note on the link they took the tape on.
    assert.equal(json(await get(a.borrower, `/api/films/${a.slug}`)).access.ticket.pickNote, first);
    assert.equal(json(await get(b.borrower, `/api/films/${b.slug}`)).access.ticket.pickNote, second);
  });

  // ==================================================================== slice 4: responses
  // Last, because it ends both loans. The member hands their tape back with a response;
  // the browser returns its tape with none (it can't respond). Everyone else gets the
  // same answers for both films: a tape that is in. What was said is in no answer to
  // any viewer, the one who said it included, and in no event.
  test('handed back with a response, or returned with none: nobody else can tell, and what was said reaches the owner alone', async () => {
    const [a, m] = [world.browser, world.member];
    const canRespond = async (w) => json(await get(w.who.b, `/api/films/${w.slug}`)).access.ticket.loan.canRespond;
    assert.deepEqual([await canRespond(a), await canRespond(m)], [false, true]);

    const plain = await post(a.who.b, `/api/films/${a.slug}/return`, { takenAt: a.loan.taken_at });
    const said = await post(m.who.b, `/api/films/${m.slug}/return`, { takenAt: m.loan.taken_at, response: 'not-for-me', message: WORDS });
    assert.deepEqual([plain.status, json(plain).responded, said.status, json(said).responded], [200, false, 200, true]);
    assert.deepEqual(Object.keys(json(said)).sort(), ['responded', 'returned']);
    assert.deepEqual(Object.keys(json(said).returned), ['at']);

    // The links that waited: the tape is in, for both alike. (Each return happened at
    // its own moment, which nobody but the borrower is told.)
    // (Everything but Play, which would take the tape.)
    const asked = async (b, w) => ({
      'the film page': await get(b, `/api/films/${w.slug}`),
      'the film page, reading itself again': await get(b, `/api/films/${w.slug}?again=1`),
      '/api/me': await get(b, '/api/me'),
      'a progress report for the play that was': await post(b, `/api/screenings/${w.screeningId}/heartbeat`, { position: 50 }),
      'returning the tape': await post(b, `/api/films/${w.slug}/return`, { takenAt: w.loan.taken_at }),
      'returning the tape, with a response': await post(b, `/api/films/${w.slug}/return`, { takenAt: w.loan.taken_at, response: 'loved-it', message: WORDS }),
      'the playlist': await get(b, `/media/${w.slug}/hls/master.m3u8`),
      'opening the link that lent': await post(b, '/api/tickets/open', { code: w.lent.code }),
    });
    const afterPlain = await asked(a.asker, a);
    const afterSaid = await asked(m.asker, m);
    // (A member's own link opens only for them, whatever became of its tape: the last
    // answer differs by the kind of link, not by what was said.)
    for (const what of Object.keys(afterPlain).filter((k) => k !== 'opening the link that lent')) {
      assert.deepEqual(apartFromTheFilm(afterPlain[what], a), apartFromTheFilm(afterSaid[what], m), what);
    }
    for (const [what, r] of [...Object.entries(afterPlain), ...Object.entries(afterSaid)]) {
      assert.ok(!/not-for-me|"responded"|canRespond|"returned":\{|"kind"|"message"/.test(r.body) && !r.body.includes(WORDS), `${what}: ${r.body.slice(0, 200)}`);
    }
    assert.deepEqual([json(afterPlain['the film page']).access.ticket.tape, json(afterSaid['the film page']).access.ticket.tape], ['in', 'in']);
    assert.deepEqual(json(afterSaid['returning the tape, with a response']), { error: 'nothing-to-return' });

    // The one who said it: their page says the tape was returned, and when. Not what they said.
    for (const [w, r] of [[a, plain], [m, said]]) {
      const mine = await asked(w.who.b, w);
      for (const what of Object.keys(mine)) assert.ok(!mine[what].body.includes(WORDS) && !/not-for-me|"responded"|"kind"|"message"/.test(mine[what].body), `${what}: ${mine[what].body.slice(0, 200)}`);
      assert.deepEqual(json(mine['the film page']).access.ticket.returned, { at: json(r).returned.at, how: 'returned' });
      // Twice: there is nothing left to return, and nothing more is taken.
      assert.deepEqual([mine['returning the tape, with a response'].status, json(mine['returning the tape, with a response'])], [409, { error: 'nothing-to-return' }]);
    }
    // The owner has it: once, from the member, with the loan it came with.
    const { responses, unread } = (await admin.get('/api/admin/responses')).data;
    assert.equal(unread, 1);
    assert.deepEqual(responses.map((r) => [r.kind, r.message, r.person.name, r.film.slug, r.loan.takenAt, r.loan.endedAt]), [['not-for-me', WORDS, NAMES.member, m.slug, m.loan.taken_at, json(said).returned.at]]);
    // The Ledger says that a response came with the tape, and never what it was.
    const events = srv.db.prepare('SELECT type, detail FROM events').all();
    for (const e of events) assert.ok(!String(e.detail).includes(WORDS) && !String(e.detail).includes('not-for-me'), `${e.type}: ${e.detail}`);
    const returned = (w) => JSON.parse(srv.db.prepare("SELECT detail FROM events WHERE type = 'returned' AND ticket_id = ?").get(w.lent.id).detail);
    assert.deepEqual([returned(a), returned(m)], [{ loanId: a.loan.id, how: 'returned', response: false }, { loanId: m.loan.id, how: 'returned', response: true }]);
  });
});

// ====================================================================== slice 6: a start-by date, given back
// A link that waited while the tape was out gets that time back on its start-by
// date. Four films, alike but for who has the tape and how it comes back, each with a
// link anyone can use that waits, its date an hour past with the tape still out.
// Every film's links were made, its tape taken and its tape back at the same
// moments, so anything that differs between them would say who, or how.
describe('a start-by date with the time the tape was out given back: how long it was out, and never who had it or how it came back', () => {
  const TITLE = 'Dated Tape';
  const DAY = 24 * HOUR;
  // The four films' clocks, the same for all: links made three hours ago, the tape
  // taken two hours ago, the waiting link's date an hour ago, and the tape back half
  // an hour ago. So it was out for an hour and a half, and the date is half an hour ahead.
  let made;
  let taken;
  let set;
  let cameBack;
  let goesBy;
  const worlds = [];
  const member = async (name) => {
    const p = await newPerson(admin, name);
    const b = browser(srv.base);
    b.ua = BORROWER_UA;
    const r = await enroll({ post: (url, body) => b.send('POST', url, JSON.stringify(body), { type: 'application/json', headers: { 'user-agent': BORROWER_UA } }) }, (await setupLink(admin, p.id)).token, { auth: softAuthenticator() });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return { p, b };
  };
  // What differs between the films, and nothing else: the slug (of one length in
  // all four) and the stamp on the poster's address, which is the film's own.
  const apartFromTheFilm = (r, w) => ({ ...r, body: r.body.replaceAll(w.slug, '…').replace(/poster\.jpg\?v=[^"]+/, 'poster.jpg?v=…') });
  const adminLink = async (ticket) => (await admin.get(`/api/admin/tickets/${ticket.id}`)).data;

  async function world(slug, kind, name) {
    const film2 = await addFilm(admin, mediaDir, slug, { title: TITLE, year: 2003 });
    const issue = async (fields) => (await admin.post('/api/admin/tickets', { filmId: film2.id, ...fields })).data[0];
    let who;
    if (kind === 'a browser') {
      who = { p: null, b: browser(srv.base) };
      who.b.ua = BORROWER_UA;
    } else {
      who = await member(name);
    }
    const lent = await issue({ label: LABELS.lent, pickNote: NOTES.lent, loanDays: 5, ...(kind === 'a member' ? { personId: who.p.id } : {}) });
    const waiting = await issue({ label: LABELS.waiting, pickNote: NOTES.waiting, startBy: Date.now() + HOUR });
    if (kind !== 'a member') assert.equal((await post(who.b, '/api/tickets/open', { code: lent.code })).status, 200);
    const asker = browser(srv.base);
    assert.equal((await post(asker, '/api/tickets/open', { code: waiting.code })).status, 200);
    const played = await post(who.b, `/api/films/${slug}/screenings`);
    assert.equal(played.status, 200, played.body);
    // The same clocks for every film.
    srv.db.prepare('UPDATE tickets SET created_at = ? WHERE film_id = ?').run(made, film2.id);
    srv.db.prepare('UPDATE tickets SET start_by = ? WHERE id = ?').run(set, waiting.id);
    srv.db.prepare('UPDATE tickets SET first_played_at = ? WHERE id = ?').run(taken, lent.id);
    srv.db.prepare('UPDATE loans SET taken_at = ?, due_at = ? WHERE ticket_id = ?').run(taken, taken + 5 * DAY, lent.id);
    const row = { ...srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(lent.id) };
    assert.equal(row.person_id, kind === 'a member' ? who.p.id : null);
    return { slug, kind, name, film: film2, who, lent, waiting, asker, loan: row, of: { slug, screeningId: json(played).screeningId, loan: row } };
  }

  before(async () => {
    const now = Date.now();
    [made, taken, set, cameBack] = [now - 3 * HOUR, now - 2 * HOUR, now - HOUR, now - HOUR / 2];
    goesBy = set + (cameBack - taken);
    worlds.push(await world('dated-tape-one', 'a member', 'Dated Member'));
    worlds.push(await world('dated-tape-two', 'a browser', 'nobody'));
    worlds.push(await world('dated-tape-six', 'a browser a member is signed in on', 'Dated Signed In'));
    worlds.push(await world('dated-tape-ten', 'a browser', 'nobody'));
  });

  test('while the tape is out, the date an hour past: "out" and the date it is due back, and no start-by date at all, whoever has it', async () => {
    const asked = [];
    for (const w of worlds) asked.push(await everyAnswer(w.asker, w.waiting.code, w.of));
    for (const [i, w] of worlds.entries()) {
      for (const what of Object.keys(asked[i])) {
        assert.deepEqual(apartFromTheFilm(asked[i][what], w), apartFromTheFilm(asked[0][what], worlds[0]), `${what}: out to ${w.kind}, and out to ${worlds[0].kind}`);
        saysNothingOfTheBorrower(what, asked[i][what], w.loan, w.name);
        assert.ok(!/"startBy":\d/.test(asked[i][what].body), `${what}: a start-by date while the tape is out`);
        assert.ok(!asked[i][what].body.includes(String(set)), `${what}: the date the link was set to`);
      }
      assert.deepEqual(json(asked[i]['the film page']).access.ticket, { ...OUT(taken + 5 * DAY), pickNote: NOTES.waiting, inAccount: false });
      assert.deepEqual([asked[i].Play.status, json(asked[i].Play)], [409, { error: 'out' }], 'not "expired": its date passed with the tape out');
      // The owner is told the link waits, and that its time stands still.
      const office = await adminLink(w.waiting);
      assert.deepEqual([office.linkState, office.startBy, office.startByPaused], ['waiting', set, true]);
      assert.ok(office.effectiveStartBy > Date.now());
    }
  });

  test('back at the same moment, four ways: the tape is in and the date is later by the time it was out, the same for all, with nothing of who, how or when', async () => {
    const [byMember, byBrowser, signedIn, due] = worlds;
    // Handed back with a response; taken back by the owner; returned; and due, with nothing written down.
    assert.equal((await post(byMember.who.b, `/api/films/${byMember.slug}/return`, { takenAt: taken, response: 'loved-it', message: WORDS })).status, 200);
    assert.equal((await admin.post(`/api/admin/loans/${byBrowser.loan.id}/take-back`, { ticketId: byBrowser.lent.id })).status, 200);
    assert.equal((await post(signedIn.who.b, `/api/films/${signedIn.slug}/return`, { takenAt: taken })).status, 200);
    for (const w of [byMember, byBrowser, signedIn]) srv.db.prepare('UPDATE loans SET ended_at = ? WHERE id = ?').run(cameBack, w.loan.id);
    srv.db.prepare('UPDATE loans SET due_at = ? WHERE id = ?').run(cameBack, due.loan.id);
    const ends = worlds.map((w) => {
      const l = srv.db.prepare('SELECT ended_at, ended_how FROM loans WHERE id = ?').get(w.loan.id);
      return [l.ended_at, l.ended_how];
    });
    assert.deepEqual(ends, [[cameBack, 'returned'], [cameBack, 'taken-back'], [cameBack, 'returned'], [null, null]]);

    // A tape that came due, before anything writes that down: the date is already the one it will be.
    const unwritten = json(await get(due.asker, `/api/films/${due.slug}`)).access.ticket;
    assert.deepEqual([unwritten.state, unwritten.tape, unwritten.startBy], ['ok', 'in', goesBy]);
    assert.equal(srv.db.prepare('SELECT ended_at FROM loans WHERE id = ?').get(due.loan.id).ended_at, null, 'reading wrote nothing');

    // Everything a browser can ask but Play, which would take the tape.
    const asked = [];
    for (const w of worlds) asked.push(await everyAnswer(w.asker, w.waiting.code, w.of, false));
    const expected = { state: 'ok', tape: 'in', loanDays: 3, startBy: goesBy, dueBack: null, loan: null, returned: null, pickNote: NOTES.waiting, inAccount: false };
    for (const [i, w] of worlds.entries()) {
      for (const what of Object.keys(asked[i])) {
        assert.deepEqual(apartFromTheFilm(asked[i][what], w), apartFromTheFilm(asked[0][what], worlds[0]), `${what}: back from ${w.kind}, and back from ${worlds[0].kind}`);
        saysNothingOfTheBorrower(what, asked[i][what], w.loan, w.name);
        for (const [name, secret] of Object.entries({ 'when it came back': String(cameBack), 'the date the link was set to': String(set), 'how it came back': 'taken-back', 'a return': '"returned":{', 'a response': 'loved-it' })) {
          assert.ok(!asked[i][what].body.includes(secret), `${what}, back from ${w.kind}: holds ${name}`);
        }
        assert.deepEqual(asked[i][what].cookies, [], what);
      }
      assert.deepEqual(json(asked[i]['the film page']).access.ticket, expected, w.kind);
      assert.deepEqual(json(asked[i]['/api/me']).tickets.find((x) => x.film.slug === w.slug).ticket, expected, w.kind);
      const office = await adminLink(w.waiting);
      assert.deepEqual([office.linkState, office.startBy, office.effectiveStartBy, office.startByPaused], ['opened', set, goesBy, false]);
    }
    // What the date does tell, and the plan accepts: how long the tape was out since
    // the link was made, an hour and a half. When, not who.
    assert.equal(goesBy - set, cameBack - taken);
    assert.equal(goesBy - set, 1.5 * HOUR);
    // (The due tape's end is written by now: a return that found nothing wrote it, as it was read.)
    assert.deepEqual({ ...srv.db.prepare('SELECT ended_at, ended_how FROM loans WHERE id = ?').get(due.loan.id) }, { ended_at: cameBack, ended_how: 'due' });
    assert.equal(json(await get(due.asker, `/api/films/${due.slug}`)).access.ticket.startBy, goesBy);
  });
});

// ====================================================================== slice 5: every route, whoever asks
// One film, on the members' shelf. Its tape goes out three times, to three kinds of
// borrower: a member on their own link, a browser on a link anyone can use, and a
// browser on such a link with a member signed in. Each plays differently (playing,
// paused, watched to the end) and the tape comes back differently (handed back with a
// response, taken back by the owner, due). Four viewers who never have it ask every
// route a viewer can reach, each time it is out and each time it is back in.
describe('the front page and the members’ shelf, whoever has the tape and however it came back', () => {
  const SHELF = 'shelf-tape';
  // Ids no answer could hold by chance: links from 7,000,001, loans from 8,000,001 and
  // members from 9,000,001.
  const FIRST = { link: 7000000, loan: 8000000, person: 9000000 };
  let made;
  const readers = {};
  const member = async (name, ua) => {
    const p = await newPerson(admin, name);
    const b = browser(srv.base);
    b.ua = ua;
    const r = await enroll({ post: (url, body) => b.send('POST', url, JSON.stringify(body), { type: 'application/json', headers: ua ? { 'user-agent': ua } : {} }) }, (await setupLink(admin, p.id)).token, { auth: softAuthenticator() });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return { p, b };
  };
  const issue = async (fields) => {
    const r = await admin.post('/api/admin/tickets', { filmId: made.id, loanDays: 5, ...fields });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data[0];
  };

  before(async () => {
    srv.db.prepare("INSERT INTO tickets (id, code, film_id, label, revoked_at, created_at) VALUES (?, 'a-code-nobody-was-ever-sent', ?, 'A placeholder', ?2 + 1, ?2 + 1)").run(FIRST.link, film.id);
    srv.db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'loans'").run(FIRST.loan);
    srv.db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'people'").run(FIRST.person);
    made = await addFilm(admin, mediaDir, SHELF, { title: 'Shelf Tape', year: 1984 });
    assert.equal((await admin.patch(`/api/admin/films/${made.id}`, { memberVisible: true })).status, 200);

    // Nobody here ever has the tape.
    readers['a stranger, with no session'] = { b: { jar: new Map() }, note: null };
    const waiting = await issue({ label: LABELS.waiting, pickNote: NOTES.waiting });
    const holder = browser(srv.base);
    assert.equal((await post(holder, '/api/tickets/open', { code: waiting.code })).status, 200);
    readers['a browser with a link that waits'] = { b: holder, code: waiting.code, note: NOTES.waiting, ticket: { pickNote: NOTES.waiting, inAccount: false } };
    const own = await member('Reader With A Link');
    await issue({ label: LABELS.own, pickNote: NOTES.own, personId: own.p.id });
    readers['a member with a link of their own'] = { b: own.b, note: NOTES.own, ticket: { pickNote: NOTES.own, inAccount: true } };
    readers['a member with no link'] = { b: (await member('Reader Of The Shelf')).b, note: null, shelf: true };
    assert.ok(waiting.id > FIRST.link && own.p.id > FIRST.person);
  });

  // Every route a viewer's browser can reach. `of`: the loan asked about (the one out
  // now, or the last one that was). Play is left out while the tape is in: it would take it.
  async function everyRoute({ b, code }, of, { withPlay }) {
    const a = {
      '/api/me': await get(b, '/api/me'),
      '/api/site': await get(b, '/api/site'),
      'the film page': await get(b, `/api/films/${SHELF}`),
      'the film page, reading itself again': await get(b, `/api/films/${SHELF}?again=1`),
      'a progress report for the borrower’s play': await post(b, `/api/screenings/${of.screeningId}/heartbeat`, { position: 5 }),
      'a pause for the borrower’s play': await post(b, `/api/screenings/${of.screeningId}/heartbeat`, { position: 5, playing: false }),
      'keeping the link': await post(b, `/api/films/${SHELF}/keep`),
      'returning the tape': await post(b, `/api/films/${SHELF}/return`, { takenAt: of.takenAt }),
      'returning the tape, with a response': await post(b, `/api/films/${SHELF}/return`, { takenAt: of.takenAt, response: 'still-thinking', message: WORDS }),
      'their account': await get(b, '/api/account'),
      'signing out everywhere, not signed in': b.jar.size ? null : await post(b, '/api/account/sign-out-everywhere'),
      'the poster': await get(b, `/media/${SHELF}/poster.jpg`),
      'the front page, as a page': await get(b, '/'),
      'the film’s page, as a page': await get(b, `/${SHELF}`),
      'the back office’s page': await get(b, '/admin/tapes'),
    };
    if (withPlay) a.Play = await post(b, `/api/films/${SHELF}/screenings`);
    if (code) a['opening their link again'] = await post(b, '/api/tickets/open', { code });
    if (code) a['their link’s page'] = await get(b, `/t/${code}`);
    for (const file of playbackFiles(SHELF)) a[file] = await get(b, file);
    for (const url of OWNERS(made)) a[`the owner’s ${url}`] = await get(b, url);
    for (const what of Object.keys(a)) if (a[what] === null) delete a[what];
    return a;
  }

  // One loan: who has it, on which link, and everything about it that is nobody else's.
  async function lend(n, kind) {
    const label = `Label of the link that lent, round ${n}`;
    const note = `Picked for whoever borrows in round ${n}.`;
    const name = `Borrower Of Round ${n}`;
    let who;
    if (kind === 'a browser') {
      who = { p: null, b: browser(srv.base) };
      who.b.ua = BORROWER_UA;
    } else {
      who = await member(name, BORROWER_UA);
    }
    const link = await issue({ label, pickNote: note, ...(kind === 'a member' ? { personId: who.p.id } : {}) });
    if (kind !== 'a member') assert.equal((await post(who.b, '/api/tickets/open', { code: link.code })).status, 200);
    const played = await post(who.b, `/api/films/${SHELF}/screenings`);
    assert.equal(played.status, 200, played.body);
    const row = { ...srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(link.id) };
    assert.equal(row.person_id, kind === 'a member' ? who.p.id : null);
    assert.ok(link.id > FIRST.link && row.id > FIRST.loan && (!who.p || who.p.id > FIRST.person));
    return { n, kind, who, link, label, note, name, row, screeningId: json(played).screeningId, takenAt: row.taken_at, dueAt: row.due_at };
  }

  // A number as a whole number in the text: 7000003, not the 7000003 inside 17000003456.
  const holdsId = (text, id) => new RegExp(`(?<![0-9])${id}(?![0-9])`).test(text);

  // Nothing in an answer to someone who isn't the borrower says anything of this loan.
  function saysNothingOf(loan, what, r) {
    const text = `${r.body} ${r.cookies.join(' ')}`;
    const secrets = {
      'the borrower’s name': loan.name,
      'the borrower’s device': BORROWER_DEVICE,
      'the label of the link that lent': loan.label,
      'the note on the link that lent': loan.note,
      'the code of the link that lent': loan.link.code,
      'the borrower’s session': loan.row.session_hash,
      'when the tape was taken': String(loan.takenAt),
      takenAt: 'takenAt',
      firstPlayedAt: 'firstPlayedAt',
      'the borrower’s place in the film': '"position"',
      'a loan': '"loan":{',
      'whether the borrower can respond': 'canRespond',
      'a response': '"responded"',
      'what a borrower said': WORDS,
      'who has it': '"borrower"',
      'who that browser is signed in as': 'signedInAs',
      'the borrower’s other links': 'otherLinks',
      'the due date, as the owner is told it': 'dueAt',
      'how it came back': '"endedHow"',
      'a browser’s own loans': '"browserLoans":["',
      'the date a link goes by, as the owner is told': 'effectiveStartBy',
      'whether a link’s time stands still': 'startByPaused',
      'the date a link was set to': 'startByAsSet',
    };
    for (const [name, secret] of Object.entries(secrets)) assert.ok(!text.includes(secret), `${what} mentions ${name}: ${text.slice(0, 300)}`);
    const ids = { 'the id of the link that lent': loan.link.id, 'the loan’s id': loan.row.id, 'the borrower’s id': loan.who.p?.id };
    for (const [name, id] of Object.entries(ids)) if (id != null) assert.ok(!holdsId(text, id), `${what} holds ${name}, ${id}: ${text.slice(0, 300)}`);
  }

  // What may differ from one loan to the next, and nothing else: the date the tape is
  // due back (and, in a member's own account, when their browser was last seen).
  const apartFromTheDate = (r, loan) => ({ ...r, body: r.body.replaceAll(String(loan?.dueAt), '"due"').replace(/"lastSeenAt":\d+/g, '"lastSeenAt":…') });

  test('out to a member, to a browser, or to a browser a member is signed in on: every viewer’s every answer is the same, and the same again once it is back', async () => {
    const asked = async (of, withPlay) => {
      const all = {};
      for (const [who, reader] of Object.entries(readers)) all[who] = await everyRoute(reader, of, { withPlay });
      return all;
    };
    const never = { screeningId: 987654321, takenAt: 1 };
    // With the tape in, before anyone has had it.
    const inAtFirst = await asked(never, false);
    const shelfOf = (answers) => json(answers['/api/me']).memberFilms.find((f) => f.slug === SHELF);
    const listed = shelfOf(inAtFirst['a member with no link']);
    assert.deepEqual([listed.tape, listed.dueBack], ['in', null]);

    const out = {};
    const back = {};
    const kinds = ['a member', 'a browser', 'a browser a member is signed in on'];
    for (const [i, kind] of kinds.entries()) {
      const loan = await lend(i + 1, kind);
      const { who } = loan;
      // Each plays differently: playing, paused, watched to the end.
      const played = [{ position: 12 }, { position: 30, playing: false }, { position: 100 }][i];
      assert.equal((await post(who.b, `/api/screenings/${loan.screeningId}/heartbeat`, played)).status, 200);

      out[kind] = await asked(loan, true);
      for (const [reader, answers] of Object.entries(out[kind])) {
        for (const [what, r] of Object.entries(answers)) {
          saysNothingOf(loan, `${reader}, with the tape out to ${kind}: ${what}`, r);
          readsOnlyItsOwnNote(what, r, readers[reader].note);
          assert.deepEqual(r.cookies, [], `${reader}: ${what}: no cookie`);
        }
        // What the plan says each is told: out, the date, and their own link's note.
        const me = json(answers['/api/me']);
        assert.deepEqual([me.browserLoans, me.admin], [[], false]);
        if (readers[reader].ticket) {
          const expected = { ...OUT(loan.dueAt), ...readers[reader].ticket };
          assert.deepEqual(json(answers['the film page']).access.ticket, expected, reader);
          assert.deepEqual(me.tickets.find((x) => x.film.slug === SHELF).ticket, expected, reader);
          assert.equal(shelfOf(answers), undefined, 'among their links, not on the shelf');
          assert.deepEqual([answers.Play.status, json(answers.Play)], [409, { error: 'out' }]);
        } else if (readers[reader].shelf) {
          assert.deepEqual(shelfOf(answers), { ...listed, tape: 'out', dueBack: loan.dueAt }, 'in or out, and the date: nothing else');
          assert.deepEqual([json(answers['the film page']).access.ticket, answers.Play.status, json(answers.Play)], [null, 409, { error: 'no-ticket' }]);
        } else {
          assert.deepEqual([me.person, me.tickets, me.memberFilms, me.linkTickets], [null, [], [], []]);
          assert.deepEqual([answers['the film page'].status, answers.Play.status], [404, 404]);
        }
        for (const url of OWNERS(made)) assert.deepEqual([answers[`the owner’s ${url}`].status, answers[`the owner’s ${url}`].body], [401, '{"error":"not-signed-in"}'], `${reader}: ${url}`);
        for (const file of playbackFiles(SHELF)) assert.deepEqual([answers[file].status, answers[file].body], [403, ''], `${reader}: ${file}`);
      }

      // The borrower is a viewer too. Their loan is theirs to see; the link's label and
      // id, the loan's id, their own id and their session are the owner's all the same.
      const mine = { '/api/me': await get(who.b, '/api/me'), 'the film page': await get(who.b, `/api/films/${SHELF}`), Play: await post(who.b, `/api/films/${SHELF}/screenings`), 'their account': await get(who.b, '/api/account') };
      for (const [what, r] of Object.entries(mine)) {
        for (const secret of [loan.label, loan.row.session_hash, '"borrower"', 'signedInAs', 'otherLinks', 'dueAt']) assert.ok(!r.body.includes(secret), `the borrower’s ${what} holds ${secret}`);
        for (const id of [loan.link.id, loan.row.id, who.p?.id]) if (id != null) assert.ok(!holdsId(r.body, id), `the borrower’s ${what} holds the id ${id}`);
      }
      const theirs = json(mine['/api/me']);
      assert.deepEqual([theirs.tickets[0].film.slug, theirs.tickets[0].ticket.tape, theirs.tickets[0].ticket.loan.takenAt], [SHELF, 'yours', loan.takenAt], 'what they have out comes first');
      assert.deepEqual(theirs.browserLoans, kind === 'a member' ? [] : ['Shelf Tape'], 'a browser’s own loan is named to that browser, for its sign-out');
      assert.ok(!('tape' in json(mine['the film page']).access));
      // And the owner is told who.
      const [told] = (await admin.get(`/api/admin/loans?live=1&film=${made.id}`)).data.loans;
      const person = who.p && { id: who.p.id, name: loan.name, disabled: false };
      assert.deepEqual(told.borrower, kind === 'a member' ? { kind: 'person', person } : { kind: 'browser', device: BORROWER_DEVICE, signedInAs: person });
      assert.deepEqual(json(await get(admin, `/api/films/${SHELF}`)).access.tape, { out: true, borrower: told.borrower, takenAt: loan.takenAt, dueAt: loan.dueAt });

      // It comes back: handed back with a response, taken back by the owner, or due.
      if (i === 0) assert.equal((await post(who.b, `/api/films/${SHELF}/return`, { takenAt: loan.takenAt, response: 'loved-it', message: WORDS })).status, 200);
      if (i === 1) assert.equal((await admin.post(`/api/admin/loans/${loan.row.id}/take-back`, { ticketId: loan.link.id })).status, 200);
      if (i === 2) {
        // Due, with nothing written down yet: the front page and the film's page already
        // say in, as before anyone had it, and reading them writes nothing.
        srv.db.prepare('UPDATE loans SET taken_at = taken_at - ?1, due_at = due_at - ?1 WHERE id = ?2').run(6 * 24 * HOUR, loan.row.id);
        for (const [reader, { b }] of Object.entries(readers)) {
          for (const [what, url] of [['/api/me', '/api/me'], ['the film page', `/api/films/${SHELF}`]]) {
            assert.deepEqual(apartFromTheDate(await get(b, url)), apartFromTheDate(inAtFirst[reader][what]), `${reader}: ${what}: due, and not yet written down`);
          }
        }
        assert.equal(srv.db.prepare('SELECT ended_at FROM loans WHERE id = ?').get(loan.row.id).ended_at, null);
      }
      back[kind] = await asked(loan, false);
      // (Written by now: a return or a keep that found nothing wrote it, as every step that could take a tape does.)
      if (i === 2) assert.equal(srv.db.prepare('SELECT ended_how FROM loans WHERE id = ?').get(loan.row.id).ended_how, 'due');
      for (const [reader, answers] of Object.entries(back[kind])) {
        for (const [what, r] of Object.entries(answers)) {
          // (The loan was moved six days back to bring it due: its times are no longer the ones to look for.)
          saysNothingOf(i === 2 ? { ...loan, takenAt: loan.takenAt - 6 * 24 * HOUR } : loan, `${reader}, with the tape back from ${kind}: ${what}`, r);
          assert.ok(!r.body.includes(String(loan.dueAt)) && !/"returned":\{|taken-back|loved-it/.test(r.body), `${reader}: ${what}: says when it was due, or how it came back`);
        }
      }
    }

    // Out: the same for every viewer whoever has it, however they are playing it.
    for (const reader of Object.keys(readers)) {
      const [first, ...rest] = kinds.map((kind) => [kind, out[kind][reader]]);
      const loanOf = (kind) => ({ dueAt: json(out[kind]['a member with no link']['/api/me']).memberFilms.find((f) => f.slug === SHELF).dueBack });
      for (const [kind, answers] of rest) {
        assert.deepEqual(Object.keys(answers), Object.keys(first[1]));
        for (const what of Object.keys(answers)) {
          assert.deepEqual(apartFromTheDate(answers[what], loanOf(kind)), apartFromTheDate(first[1][what], loanOf(first[0])), `${reader}: ${what}: out to ${kind}, and out to ${first[0]}`);
        }
      }
    }
    // In: as it was before anyone had it, however the tape came back.
    for (const kind of kinds) {
      for (const reader of Object.keys(readers)) {
        const answers = back[kind][reader];
        assert.deepEqual(Object.keys(answers), Object.keys(inAtFirst[reader]));
        for (const what of Object.keys(answers)) {
          assert.deepEqual(apartFromTheDate(answers[what]), apartFromTheDate(inAtFirst[reader][what]), `${reader}: ${what}: back from ${kind}, and before anyone had it`);
        }
      }
    }
    // The owner has all three, and how each came back.
    const history = (await admin.get(`/api/admin/loans?film=${made.id}`)).data.loans;
    // (In the order they were made: the third was moved six days back to bring it due.)
    assert.deepEqual(history.sort((x, y) => x.id - y.id).map((l) => [l.borrower.kind, l.endedHow, Boolean(l.response)]), [['person', 'returned', true], ['browser', 'taken-back', false], ['browser', 'due', false]]);
    assert.deepEqual((await admin.get(`/api/admin/films/${made.id}`)).data.lending, { sent: 5, cancelled: 1, opened: 5, lent: 3, finished: 1, responses: 1 }, 'five links, each opened by whoever it was for');
  });
});
