// "Picked for you": version 2, slice 4 (docs/version-2.md, "Picked for you, and
// responses"). The owner's note to whoever has one link, about one film. Written from
// the plan, not the implementation, to its "done when": editing a note never changes
// the film's staff pick, nor the reverse; and neither the note nor the link's label
// is in a link's preview or in the members' listing. Around that: the note is the
// link's own (never another link's, never the label, which stays the owner's alone),
// a friend reads it on the film page and in /api/me in every state of the link, and
// the Ledger says that a link was sent with a note, never what the note said.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';
import { addFilm, adminBrowser, browser, enroll, newPerson, setupLink, signIn, startServer, tempDir, writeFilmJson } from './helpers.js';

const HOUR = 60 * 60 * 1000;
const STAFF_PICK = 'Watch it with the lights off.';

const mediaDir = tempDir();
const webDist = tempDir();
let srv;
let admin;

before(async () => {
  fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><html><head><title>app</title></head><body></body></html>');
  srv = await startServer({ mediaDir, webDist, limits: { scale: 100 } });
  admin = await adminBrowser(srv.base);
});
after(() => srv.close());

// A film of its own for every test (its staff pick is STAFF_PICK, from film.json).
const ownFilm = (slug, overrides) => addFilm(admin, mediaDir, slug, overrides);
async function issue(film, fields = {}) {
  const r = await admin.post('/api/admin/tickets', { filmId: film.id, ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data[0];
}
async function opened(ticket, b = browser(srv.base)) {
  const r = await b.post('/api/tickets/open', { code: ticket.code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return b;
}
async function member(name) {
  const p = await newPerson(admin, name);
  const auth = softAuthenticator();
  const phone = browser(srv.base);
  assert.equal((await enroll(phone, (await setupLink(admin, p.id)).token, { auth })).status, 200);
  const device = async (b = browser(srv.base)) => {
    assert.equal((await signIn(b, auth)).status, 200);
    return b;
  };
  return { p, phone, device };
}
const ticketRow = (ticket) => ({ ...srv.db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.id) });
const filmRow = (film) => ({ ...srv.db.prepare('SELECT * FROM films WHERE id = ?').get(film.id) });
const sentEvent = (ticket) => {
  const rows = srv.db.prepare("SELECT * FROM events WHERE ticket_id = ? AND type = 'ticket-sent'").all(ticket.id);
  assert.equal(rows.length, 1);
  return JSON.parse(rows[0].detail);
};
// Everything the Ledger has, as it is stored and as the owner's page is sent it.
async function ledger() {
  const stored = JSON.stringify(srv.db.prepare('SELECT * FROM events').all());
  const sent = JSON.stringify((await admin.get('/api/admin/activity?limit=1000&heartbeats=1')).data);
  return `${stored} ${sent}`;
}
// A request, with the body as it was sent: for looking through everything a viewer is given.
async function raw(b, method, url, body) {
  const headers = {};
  if (b?.jar.size) headers.cookie = [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(srv.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  return { status: res.status, text: await res.text() };
}
const page = async (b, film) => (await b.get(`/api/films/${film.slug}`)).data;
const listed = async (b, film) => (await b.get('/api/me')).data.tickets.find((x) => x.film.slug === film.slug)?.ticket;
// Everything a browser can read about a film and its own links, as text.
async function everythingFor(b, film, code) {
  const answers = [
    await raw(b, 'GET', `/api/films/${film.slug}`),
    await raw(b, 'GET', '/api/me'),
    await raw(b, 'GET', '/api/site'),
    await raw(b, 'GET', '/api/account'),
    await raw(b, 'GET', `/t/${code}`),
    await raw(b, 'GET', `/${film.slug}`),
    await raw(b, 'GET', '/'),
  ];
  return answers.map((r) => r.text).join('\n');
}
const holdsNone = (text, secrets, what) => {
  for (const secret of secrets) assert.ok(!text.includes(secret), `${what} holds "${secret}"`);
};

// ====================================================================== sending
describe('sending a link with a note', () => {
  test('the note is kept on the link, apart from its label; the Ledger says there was one, never what it said', async () => {
    const film = await ownFilm('note-sent');
    const NOTE = 'Sam, this is the one I told you about at the wedding.';
    const LABEL = 'Sam, from the wedding';
    const withNote = await issue(film, { label: LABEL, pickNote: NOTE });
    const without = await issue(film, { label: LABEL });

    assert.deepEqual([withNote.pickNote, withNote.label], [NOTE, LABEL]);
    assert.deepEqual([without.pickNote, without.label], [null, LABEL]);
    assert.deepEqual([ticketRow(withNote).pick_note, ticketRow(withNote).label], [NOTE, LABEL]);
    assert.equal(ticketRow(without).pick_note, null);
    // The owner reads it back on the link's page and in the list.
    assert.equal((await admin.get(`/api/admin/tickets/${withNote.id}`)).data.pickNote, NOTE);
    const list = (await admin.get(`/api/admin/tickets?film=${film.id}`)).data;
    assert.deepEqual(list.map((t) => [t.id, t.pickNote]).sort(), [[withNote.id, NOTE], [without.id, null]]);

    assert.deepEqual(sentEvent(withNote), { loanDays: null, note: true });
    assert.deepEqual(sentEvent(without), { loanDays: null, note: false });
    holdsNone(await ledger(), [NOTE], 'the Ledger');
    // Sending a note takes nothing, and changes nothing of the film.
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM loans WHERE film_id = ?').get(film.id).n, 0);
    assert.equal(filmRow(film).recommendation, STAFF_PICK);
  });

  test('spaces around it go; nothing but spaces is no note; several links sent together each carry it', async () => {
    const film = await ownFilm('note-trimmed');
    const several = (await admin.post('/api/admin/tickets', { filmId: film.id, count: 3, pickNote: '  \n A note for whoever has the link. \n ' })).data;
    assert.equal(several.length, 3);
    for (const t of several) {
      assert.equal(t.pickNote, 'A note for whoever has the link.');
      assert.equal(ticketRow(t).pick_note, 'A note for whoever has the link.');
      assert.equal(sentEvent(t).note, true);
    }
    for (const nothing of ['', '   ', '\n\t', null]) {
      const t = await issue(film, { pickNote: nothing });
      assert.equal(t.pickNote, null, JSON.stringify(nothing));
      assert.equal(ticketRow(t).pick_note, null);
      assert.equal(sentEvent(t).note, false);
    }
    // Line breaks inside the note are the owner's, and stay.
    const lines = await issue(film, { pickNote: 'First line.\n\nSecond line.' });
    assert.equal(lines.pickNote, 'First line.\n\nSecond line.');
  });

  test('up to 2,000 characters, kept whole; a longer note, or one that isn’t text, is refused and no link is made', async () => {
    const film = await ownFilm('note-refused');
    const count = () => srv.db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE film_id = ?').get(film.id).n;
    const longest = 'n'.repeat(2000);
    assert.equal((await issue(film, { pickNote: longest })).pickNote, longest, 'never cut short');
    assert.equal(count(), 1);

    for (const bad of ['n'.repeat(2001), 7, true, {}, ['a note']]) {
      const r = await admin.post('/api/admin/tickets', { filmId: film.id, count: 2, label: 'Refused', pickNote: bad });
      assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 40));
      assert.match(r.data.error, /“Picked for you” note/);
    }
    assert.equal(count(), 1, 'nothing was made');
    assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE label = 'Refused'").get().n, 0);
  });
});

// ====================================================================== editing
describe('editing a note, and the staff pick', () => {
  test('editing a note changes the note and nothing else: not the staff pick, the label, the start-by date or the days', async () => {
    const film = await ownFilm('note-edited');
    const startBy = Date.now() + 5 * 24 * HOUR;
    const t = await issue(film, { label: 'For Sam', startBy, loanDays: 5, pickNote: 'The first note.' });
    const others = [await issue(film, { pickNote: 'Another link’s note.' }), await issue(film)];
    const rest = ({ pick_note: _, ...row }) => row;
    const before = ticketRow(t);
    const filmBefore = filmRow(film);

    const r = await admin.patch(`/api/admin/tickets/${t.id}`, { pickNote: '  The second note. ' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.pickNote, 'The second note.');
    assert.equal(ticketRow(t).pick_note, 'The second note.');
    assert.deepEqual(rest(ticketRow(t)), rest(before), 'nothing else on the link moved');
    assert.deepEqual(filmRow(film), filmBefore, 'nothing on the film moved, the staff pick least of all');
    assert.equal(filmRow(film).recommendation, STAFF_PICK);
    assert.equal((await admin.get(`/api/admin/films/${film.id}`)).data.recommendation, STAFF_PICK);
    assert.deepEqual(others.map((o) => ticketRow(o).pick_note), ['Another link’s note.', null], 'nor any other link’s note');

    // Saving the link's other fields never touches the note: only a save that names it does.
    // (The last is what the link page sends with every save since slice 9, the note
    // aside; 1.1.0's sent a play limit and days after the first play, refused since.)
    for (const patch of [{ label: 'For Sam, again' }, { startBy: startBy + HOUR }, { loanDays: 6 }, { label: 'For Sam', startBy, loanDays: 6, claimable: false }]) {
      const saved = await admin.patch(`/api/admin/tickets/${t.id}`, patch);
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      assert.equal(ticketRow(t).pick_note, 'The second note.', JSON.stringify(patch));
    }
    // A note that is refused saves nothing else either.
    const refused = await admin.patch(`/api/admin/tickets/${t.id}`, { label: 'Not saved', pickNote: 'n'.repeat(2001) });
    assert.equal(refused.status, 400);
    assert.deepEqual([ticketRow(t).label, ticketRow(t).pick_note], ['For Sam', 'The second note.']);
    assert.equal((await admin.patch(`/api/admin/tickets/${t.id}`, { pickNote: 9 })).status, 400);

    // Taking the note away: null, or nothing but spaces. The label stays.
    for (const nothing of [null, '  ']) {
      assert.equal((await admin.patch(`/api/admin/tickets/${t.id}`, { pickNote: 'Back again.' })).data.pickNote, 'Back again.');
      const cleared = await admin.patch(`/api/admin/tickets/${t.id}`, { pickNote: nothing });
      assert.deepEqual([cleared.status, cleared.data.pickNote, ticketRow(t).pick_note, ticketRow(t).label], [200, null, null, 'For Sam']);
    }
    assert.equal(filmRow(film).recommendation, STAFF_PICK);
    // An edit is not an event, and no event has any of the words.
    holdsNone(await ledger(), ['The first note.', 'The second note.', 'Back again.', 'Another link’s note.'], 'the Ledger');
    assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM events WHERE ticket_id = ? AND type <> 'ticket-sent'").get(t.id).n, 0);
  });

  test('editing the staff pick never changes a note: by hand, by taking it away, or by a rescan of film.json', async () => {
    const film = await ownFilm('pick-edited');
    const sam = await member('Pick Sam');
    const forAnyone = await issue(film, { pickNote: 'A note on a link anyone can use.' });
    const forSam = await issue(film, { personId: sam.p.id, pickNote: 'A note for Sam.' });
    const b = await opened(forAnyone);
    const notes = () => [ticketRow(forAnyone).pick_note, ticketRow(forSam).pick_note];
    const NOTES = ['A note on a link anyone can use.', 'A note for Sam.'];
    // What a friend reads: the staff pick is the film's, the note is the link's.
    const reads = async (who) => (({ film: f, access }) => [f.recommendation, access.ticket.pickNote])(await page(who, film));
    assert.deepEqual(await reads(b), [STAFF_PICK, NOTES[0]]);
    assert.deepEqual(await reads(sam.phone), [STAFF_PICK, NOTES[1]]);

    const edited = await admin.patch(`/api/admin/films/${film.id}`, { recommendation: 'See it on the biggest screen you have.' });
    assert.equal(edited.status, 200, JSON.stringify(edited.data));
    assert.deepEqual(notes(), NOTES);
    assert.deepEqual(await reads(b), ['See it on the biggest screen you have.', NOTES[0]]);
    assert.deepEqual(await reads(sam.phone), ['See it on the biggest screen you have.', NOTES[1]]);

    assert.equal((await admin.patch(`/api/admin/films/${film.id}`, { recommendation: null })).status, 200);
    assert.deepEqual(notes(), NOTES);
    assert.deepEqual(await reads(b), [null, NOTES[0]], 'a film with no staff pick still has its links’ notes');

    // film.json changes, and the folder is scanned again.
    writeFilmJson(path.join(mediaDir, film.slug), { recommendation: 'From the file.', synopsis: 'A new synopsis.' });
    assert.equal((await admin.post('/api/admin/scan')).status, 200);
    assert.deepEqual(notes(), NOTES);
    assert.deepEqual((await reads(sam.phone))[1], NOTES[1]);
    // And the other way round once more, with the film as the scan left it.
    const filmNow = filmRow(film);
    assert.equal((await admin.patch(`/api/admin/tickets/${forSam.id}`, { pickNote: 'A new note for Sam.' })).status, 200);
    assert.deepEqual(filmRow(film), filmNow);
  });

  test('a note edited while the tape is out reaches the borrower at their next look, and moves nothing: not the loan, not the date', async () => {
    const film = await ownFilm('note-while-out');
    const t = await issue(film, { pickNote: 'Before.' });
    const b = await opened(t);
    assert.equal((await b.post(`/api/films/${film.slug}/screenings`)).status, 200);
    const loan = { ...srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(t.id) };

    assert.equal((await admin.patch(`/api/admin/tickets/${t.id}`, { pickNote: 'After.' })).status, 200);
    const mine = (await page(b, film)).access.ticket;
    assert.deepEqual([mine.tape, mine.pickNote, mine.dueBack], ['yours', 'After.', loan.due_at]);
    assert.deepEqual({ ...srv.db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(t.id) }, loan);
    assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM events WHERE ticket_id = ? AND type = 'due-changed'").get(t.id).n, 0);
  });
});

// ====================================================================== what a friend reads
describe('what a friend reads', () => {
  test('their own link’s note, on the film page and in /api/me, in every state of the link; never another link’s, and never a label', async () => {
    const film = await ownFilm('note-states');
    const [N1, N2] = ['The note on the first link.', 'The note on the second link.'];
    const [L1, L2] = ['The label of the first link', 'The label of the second link'];
    const first = await issue(film, { label: L1, pickNote: N1 });
    const second = await issue(film, { label: L2, pickNote: N2 });
    const b1 = await opened(first);
    const b2 = await opened(second);
    // Each browser, in each state: the note is its own link's, on the page and in /api/me.
    async function reads(expected) {
      for (const [b, tape, state, note, code, notTheirs] of [[b1, ...expected[0], N1, first.code, N2], [b2, ...expected[1], N2, second.code, N1]]) {
        const ticket = (await page(b, film)).access.ticket;
        assert.deepEqual([ticket.tape, ticket.state, ticket.pickNote], [tape, state, note]);
        assert.deepEqual(await listed(b, film), ticket, '/api/me has the same');
        holdsNone(await everythingFor(b, film, code), [notTheirs, L1, L2], `${state}, tape ${tape}: what this browser is sent`);
      }
    }
    await reads([['in', 'ok'], ['in', 'ok']]);

    const played = await b1.post(`/api/films/${film.slug}/screenings`);
    assert.equal(played.status, 200, JSON.stringify(played.data));
    assert.ok(!JSON.stringify(played.data).includes(N1), 'Play’s answer has no note');
    await reads([['yours', 'ok'], ['out', 'out']]);

    srv.db.prepare("UPDATE films SET media_status = 'error' WHERE id = ?").run(film.id);
    await reads([['yours', 'unavailable'], ['out', 'unavailable']]);
    srv.db.prepare("UPDATE films SET media_status = 'ok' WHERE id = ?").run(film.id);

    const back = await b1.post(`/api/films/${film.slug}/return`, { takenAt: played.data.takenAt });
    assert.equal(back.status, 200, JSON.stringify(back.data));
    await reads([[null, 'spent'], ['in', 'ok']]);

    // A link whose start-by date was missed still has its note.
    const late = await ownFilm('note-late');
    const missed = await issue(late, { label: L1, pickNote: N1, startBy: Date.now() - HOUR });
    const b3 = await opened(missed);
    const ticket = (await page(b3, late)).access.ticket;
    assert.deepEqual([ticket.state, ticket.tape, ticket.pickNote], ['expired', null, N1]);
    holdsNone(await everythingFor(b3, late, missed.code), [L1], 'a link past its start-by date');
  });

  test('a member’s own link: the note is theirs on every device, and nobody else is told a word of it', async () => {
    const film = await ownFilm('note-member');
    const sam = await member('Note Sam');
    const jo = await member('Note Jo');
    const NOTE = 'Sam: you will hate the first ten minutes. Stay.';
    const LABEL = 'Sam’s, with a warning';
    const t = await issue(film, { personId: sam.p.id, label: LABEL, pickNote: NOTE });

    const laptop = await sam.device();
    for (const b of [sam.phone, laptop]) {
      assert.equal((await page(b, film)).access.ticket.pickNote, NOTE);
      assert.equal((await listed(b, film)).pickNote, NOTE);
      holdsNone(await everythingFor(b, film, t.code), [LABEL], 'what the member is sent');
    }
    // Someone with a copy of the link's address: signed out, or signed in as someone else.
    const stranger = browser(srv.base);
    for (const [b, status, error] of [[stranger, 401, 'sign-in-required'], [jo.phone, 403, 'ticket-for-someone-else']]) {
      const r = await raw(b, 'POST', '/api/tickets/open', { code: t.code });
      assert.deepEqual([r.status, r.text], [status, JSON.stringify({ error })]);
      assert.equal((await raw(b, 'GET', `/api/films/${film.slug}`)).status, 404);
      holdsNone(await everythingFor(b, film, t.code), [NOTE, LABEL, 'pickNote":"'], 'what anyone else is sent');
    }
    // Opening a link answers with the film's address and nothing more, for its member too.
    assert.deepEqual((await sam.phone.post('/api/tickets/open', { code: t.code })).data, { slug: film.slug });
  });

  test('a link that is cancelled, or kept by someone else, takes its note with it', async () => {
    const film = await ownFilm('note-gone');
    const sam = await member('Keeper Sam');
    const [N1, N2] = ['The note on a link that gets cancelled.', 'The note on a link that gets kept.'];
    const cancelled = await issue(film, { pickNote: N1 });
    const b1 = await opened(cancelled);
    assert.equal((await page(b1, film)).access.ticket.pickNote, N1);
    assert.equal((await admin.post(`/api/admin/tickets/${cancelled.id}/revoke`)).status, 200);
    assert.deepEqual(await raw(b1, 'GET', `/api/films/${film.slug}`), { status: 404, text: '{"error":"not-found"}' });
    holdsNone(await everythingFor(b1, film, cancelled.code), [N1], 'a browser whose link was cancelled');
    assert.equal((await admin.get(`/api/admin/tickets/${cancelled.id}`)).data.pickNote, N1, 'the owner still has it');

    // Kept: the note goes with the link, to the member who kept it, and the browser
    // that opened it first is told only that it was kept.
    const kept = await issue(film, { pickNote: N2, claimable: true });
    const b2 = await opened(kept);
    await opened(kept, sam.phone);
    assert.equal((await sam.phone.post(`/api/films/${film.slug}/keep`)).status, 200);
    assert.equal((await page(sam.phone, film)).access.ticket.pickNote, N2);
    assert.deepEqual(await raw(b2, 'GET', `/api/films/${film.slug}`), { status: 410, text: '{"error":"ticket-kept"}' });
    holdsNone(await everythingFor(b2, film, kept.code), [N2], 'the browser that lost the link');
  });
});

// ====================================================================== changing hands
// Question 18, answer (c), built with slice 9: the give and release buttons show the
// link's note with "Take the note away" ticked, and POST …/holder takes pickNote in
// the same step. Left out, the note stays, as before slice 9.
describe('a link given to someone else, or let anyone use it (question 18)', () => {
  const holder = (t, body) => admin.post(`/api/admin/tickets/${t.id}/holder`, body);

  test('pickNote in the same step takes the note away or writes a new one for the new holder; left out, the note stays', async () => {
    const film = await ownFilm('note-hands');
    const sam = await member('Hands Sam');
    const jo = await member('Hands Jo');
    const FIRST = 'For whoever opened it first: the bit with the lighthouse.';
    const t = await issue(film, { pickNote: FIRST, label: 'Hands label' });

    // Given to Sam with the note taken away: Sam reads none, and the label stays.
    let r = await holder(t, { personId: sam.p.id, pickNote: null });
    assert.deepEqual([r.status, r.data.person.id, r.data.pickNote, r.data.label], [200, sam.p.id, null, 'Hands label']);
    assert.equal((await page(await sam.device(), film)).access.ticket.pickNote, null);

    // Given on to Jo with a new note: Jo reads it.
    const FOR_JO = 'Jo, the lighthouse bit is twenty minutes in.';
    r = await holder(t, { personId: jo.p.id, pickNote: `  ${FOR_JO}  ` });
    assert.deepEqual([r.status, r.data.person.id, r.data.pickNote], [200, jo.p.id, FOR_JO]);
    assert.equal((await page(await jo.device(), film)).access.ticket.pickNote, FOR_JO);

    // Let anyone use it, saying nothing of the note: it stays (1.x's request, and slices 4 to 8).
    r = await holder(t, { personId: null });
    assert.deepEqual([r.status, r.data.person, r.data.pickNote], [200, null, FOR_JO]);
    // Nothing but spaces is no note, as on send and edit.
    r = await holder(t, { personId: sam.p.id, pickNote: ' \n ' });
    assert.deepEqual([r.status, r.data.pickNote], [200, null]);

    // No event holds a note's words.
    const stored = JSON.stringify(srv.db.prepare('SELECT * FROM events WHERE ticket_id = ?').all(t.id));
    holdsNone(stored, [FIRST, FOR_JO], 'the Ledger');
  });

  test('a refused give leaves the note as it was: a note too long, a card turned off, the tape out, or no change of hands', async () => {
    const film = await ownFilm('note-hands-refused');
    const sam = await member('Refused Sam');
    const NOTE = 'Keep this note.';
    const t = await issue(film, { pickNote: NOTE });
    const unchanged = () => assert.deepEqual([ticketRow(t).pick_note, ticketRow(t).person_id], [NOTE, null]);

    assert.equal((await holder(t, { personId: sam.p.id, pickNote: 'n'.repeat(2001) })).status, 400);
    unchanged();
    assert.equal((await holder(t, { personId: sam.p.id, pickNote: 9 })).status, 400);
    unchanged();
    assert.equal((await holder(t, { personId: 987654, pickNote: null })).status, 400);
    unchanged();
    // Already for anyone with the link: nothing changes hands, so the note stays.
    assert.equal((await holder(t, { personId: null, pickNote: null })).status, 200);
    unchanged();
    // Still for anyone, but now keepable (or no longer): that isn't changing hands either,
    // so the note stays (the review of slices 7 to 9 found it taken away here).
    assert.equal((await holder(t, { personId: null, claimable: true, pickNote: null })).status, 200);
    assert.equal(ticketRow(t).claimable, 1);
    unchanged();
    assert.equal((await holder(t, { personId: null, claimable: false, pickNote: null })).status, 200);
    assert.equal(ticketRow(t).claimable, 0);
    unchanged();

    // While the link has the tape it can't change hands (question 2), and its note stays with it.
    const b = await opened(t);
    assert.equal((await b.post(`/api/films/${film.slug}/screenings`)).status, 200);
    const out = await holder(t, { personId: sam.p.id, pickNote: null });
    assert.deepEqual([out.status, out.data], [409, { error: 'tape-out' }]);
    unchanged();
    assert.equal((await page(b, film)).access.ticket.pickNote, NOTE);
  });
});

// ====================================================================== previews
describe('a link’s preview in a chat app', () => {
  // The whole page a chat app fetches, and the tags it reads.
  async function preview(ticket) {
    const html = await (await fetch(`${srv.base}/t/${ticket.code}`)).text();
    const tags = Object.fromEntries([...html.matchAll(/<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)"/g)].map(([, k, v]) => [k, v]));
    return { html, tags };
  }

  test('never the note, and never the label: with the tape in, out and back, for a link anyone can use and for a member’s own', async () => {
    const film = await ownFilm('note-preview', { title: 'Previewed', year: 1984 });
    const sam = await member('Preview Sam');
    const SECRETS = ['A note that must stay out of previews.', 'A label that must stay out of previews', 'A note for Sam that must stay out of previews.', 'Sam’s label that must stay out of previews'];
    const forAnyone = await issue(film, { pickNote: SECRETS[0], label: SECRETS[1] });
    const forSam = await issue(film, { personId: sam.p.id, pickNote: SECRETS[2], label: SECRETS[3] });
    const b = await opened(forAnyone);

    async function check(when, title) {
      const anyone = await preview(forAnyone);
      const member = await preview(forSam);
      for (const [what, p] of [['a link anyone can use', anyone], ['a member’s link', member]]) {
        holdsNone(p.html, SECRETS, `${when}: the preview of ${what}`);
        // No tag but the ones a preview has ever had: nowhere for a note to go.
        assert.deepEqual(Object.keys(p.tags).filter((k) => !['og:site_name', 'og:type', 'og:title', 'og:description', 'og:image', 'twitter:card'].includes(k)), [], when);
      }
      assert.equal(anyone.tags['og:title'], title, when);
      if (title !== 'Open Matte') assert.equal(anyone.tags['og:description'], 'A tape from Open Matte.', 'the same line for every link, note or no note');
      assert.deepEqual([member.tags['og:title'], member.tags['og:description']], ['Open Matte', undefined], 'a member’s link previews as the shop');
      // The poster's own address gives the picture and nothing else.
      const poster = anyone.tags['og:image'];
      if (poster) {
        const r = await fetch(poster);
        assert.equal(r.status, 200);
        holdsNone(`${await r.text()} ${JSON.stringify([...r.headers])}`, SECRETS, `${when}: the preview’s poster`);
      }
    }
    await check('with the tape in', 'Previewed (1984)');
    const played = await b.post(`/api/films/${film.slug}/screenings`);
    assert.equal(played.status, 200);
    await check('with the tape out', 'Previewed (1984)');
    assert.equal((await b.post(`/api/films/${film.slug}/return`, { takenAt: played.data.takenAt })).status, 200);
    await check('with the tape back, and the link spent', 'Open Matte');
    // A link with no note previews exactly as one with a note does.
    const plain = await ownFilm('note-preview-plain', { title: 'Previewed', year: 1984 });
    const noted = await ownFilm('note-preview-noted', { title: 'Previewed', year: 1984 });
    const tagsOf = async (f, fields) => (({ tags }) => ({ ...tags, 'og:image': tags['og:image'].replace(/\/poster\/.*$/, '/poster/…') }))(await preview(await issue(f, fields)));
    assert.deepEqual(await tagsOf(plain, {}), await tagsOf(noted, { pickNote: SECRETS[0], label: SECRETS[1] }));
  });
});

// ====================================================================== the members' shelf
describe('a film on the shelf for members', () => {
  test('the listing has no note and no label, whatever links other people have for the film', async () => {
    const film = await ownFilm('note-shelf');
    assert.equal((await admin.patch(`/api/admin/films/${film.id}`, { memberVisible: true })).status, 200);
    const sam = await member('Shelf Sam');
    const jo = await member('Shelf Jo');
    const SECRETS = ['A note for Sam, not for the shelf.', 'Sam’s label, not for the shelf', 'A note on a link for anyone, not for the shelf.', 'A label on a link for anyone, not for the shelf'];
    const forSam = await issue(film, { personId: sam.p.id, pickNote: SECRETS[0], label: SECRETS[1] });
    const forAnyone = await issue(film, { pickNote: SECRETS[2], label: SECRETS[3] });

    // Jo has no link: the listing, and the page, with nothing of anyone's link.
    const shelfOf = async (who) => (await who.get('/api/me')).data;
    const me = await shelfOf(jo.phone);
    assert.deepEqual(me.memberFilms.map((f) => f.slug), [film.slug]);
    // (tape and dueBack: slice 5, question 7. In or out and a date, and nothing of any link.)
    assert.deepEqual(Object.keys(me.memberFilms[0]).sort(), ['directors', 'dueBack', 'posterUrl', 'runtimeMinutes', 'slug', 'tape', 'title', 'year']);
    assert.deepEqual(me.tickets, []);
    const listing = await page(jo.phone, film);
    assert.deepEqual([listing.access.via, listing.access.ticket, listing.access.canPlay], ['member', null, false]);
    assert.equal(listing.film.recommendation, STAFF_PICK, 'the staff pick is the film’s, and on the shelf');
    holdsNone(await everythingFor(jo.phone, film, forSam.code), SECRETS, 'the members’ listing');
    holdsNone(await everythingFor(jo.phone, film, forAnyone.code), SECRETS.slice(0, 2), 'the members’ listing');

    // Sam has a link: it shows under their links, with its note, and not on the shelf.
    const sams = await shelfOf(sam.phone);
    assert.deepEqual([sams.memberFilms, sams.tickets.map((x) => x.ticket.pickNote)], [[], [SECRETS[0]]]);
    // Cancelled, Sam has the listing like anyone, and the note is gone from it.
    assert.equal((await admin.post(`/api/admin/tickets/${forSam.id}/revoke`)).status, 200);
    const after = await shelfOf(sam.phone);
    assert.deepEqual([after.memberFilms.map((f) => f.slug), after.tickets], [[film.slug], []]);
    assert.deepEqual((await page(sam.phone, film)).access.ticket, null);
    holdsNone(await everythingFor(sam.phone, film, forSam.code), SECRETS, 'the listing, after their link was cancelled');
  });
});
