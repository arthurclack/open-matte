// The friend's pages' words that depend on a tape's state and loan
// (web/src/pages/tapeWords.js): the film page's counter, the receipt (the till slip),
// the end of the film, the owner's preview, the front page's sections and the lines
// under a sleeve, the notices a link brings back, the sign-out questions, the player's
// reasons for stopping, and a long name cut into strips of label tape. Version 2's
// one clock (docs/version-2.md, slices 7 and 8): Play takes the tape out, and it is
// the borrower's until it's due back.
//
// (1.x's counter had a window to come back to a paused play, days after the first
// play and play limits, and the paused strip counted the time left to come back:
// clockLines' window, goneLine's "used all its plays" and timeLeft. All went with them.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { shown } from './shown.js';

// Dates in one time zone, as a browser has them.
process.env.TZ = 'Europe/London';

// The web app's source isn't in the server's image: there these are skipped, not failed.
const MODULE = new URL('../web/src/pages/tapeWords.js', import.meta.url);
const present = fs.existsSync(MODULE);
const skip = present ? false : 'web/src is not here (the server image has no web source)';
const w = present ? await import(MODULE) : {};
const api = present ? await import(new URL('../web/src/api.js', import.meta.url)) : {};

const HOUR = 3600_000;
const DAY = 24 * HOUR;
// Thu 5 Nov 2026, 19:40.
const NOW = new Date(2026, 10, 5, 19, 40).getTime();
const SITE = { cinemaName: 'The Lantern Room', ownerName: 'Arthur' };
const NBSP = '\u00a0';
// The ticket as the film page gives it, in each state (server/films.js ticketForViewer).
const IN = { state: 'ok', tape: 'in', loanDays: 3, startBy: null, dueBack: null, loan: null, returned: null, pickNote: null, inAccount: false };
const DUE = NOW + 3 * DAY;
const loan = (fields = {}) => ({ takenAt: NOW, position: 18, finishedAt: null, toBrowser: false, canRespond: true, ...fields });
const YOURS = { ...IN, tape: 'yours', loanDays: null, dueBack: DUE, loan: loan() };
const OUT = { ...IN, state: 'out', tape: 'out', loanDays: null, dueBack: DUE };
const NOTICES = ['unknown-ticket', 'ticket-revoked', 'ticket-spent', 'ticket-kept', 'film-unavailable', 'too-many-requests'];

describe('the host at the start of a sentence', { skip }, () => {
  test("is the owner's name, else the shop's, else the shop, with a capital", () => {
    assert.equal(w.Host(SITE), 'Arthur');
    assert.equal(w.Host({ cinemaName: 'the lantern room' }), 'The lantern room');
    assert.equal(w.Host(null), 'The shop');
  });

  // Question 10, answer (a): only the start changes, signed in or not.
  test('the privacy line keeps every disclosure: the link opened, the tape taken out and played', () => {
    assert.equal(
      w.privacyLine(SITE, false),
      'Arthur can see when this link is opened, when the tape is taken out and played, the kind of device (such as “Safari on iPhone”), and roughly how far playback gets.',
    );
    assert.equal(
      w.privacyLine(SITE, true),
      "Arthur can see when this link is opened, when the tape is taken out and played, the kind of device (such as “Safari on iPhone”), roughly how far playback gets and, because you're signed in, that it was you.",
    );
  });
});

describe('the counter: one clock', { skip }, () => {
  test('in, before Play: Play takes the tape out, for the link’s days, until a date that is now plus those days', () => {
    assert.deepEqual(w.clockLines(IN, { now: NOW }), [
      `Pressing Play takes the tape out. It's yours for 3 days, until ${api.formatDayTime(NOW + 3 * DAY)}, and nobody else can play it until it's back.`,
      'Pause and come back as often as you like, on one device at a time.',
    ]);
    assert.match(w.clockLines({ ...IN, loanDays: 1 }, { now: NOW })[0], /It's yours for 1 day, until /);
  });

  test('in, with a start-by date: "from then", and the date to start by with its time', () => {
    const startBy = NOW + 3 * DAY;
    assert.deepEqual(w.clockLines({ ...IN, startBy }, { now: NOW }), [
      "Pressing Play takes the tape out: it's yours for 3 days from then, and nobody else can play it until it's back.",
      `Start watching by ${api.formatDayTime(startBy)}.`,
    ]);
  });

  test("yours: until when, and where to pick it up; a member's on any of their devices, a browser's here", () => {
    assert.deepEqual(w.clockLines(YOURS, { now: NOW }), [`It's yours until ${api.formatDayTime(DUE)}.`, 'Pick up where you left off, on this device or another.']);
    assert.deepEqual(w.clockLines({ ...YOURS, loan: loan({ toBrowser: true, canRespond: false }) }, { now: NOW }), [
      `It's yours until ${api.formatDayTime(DUE)}.`,
      'Pick up where you left off.',
    ]);
  });

  test('watched to the end: still yours, to watch again, or hand back (a member) or return (a browser)', () => {
    const finished = { ...YOURS, loan: loan({ finishedAt: NOW + HOUR }) };
    assert.deepEqual(w.clockLines(finished), ["You've watched it to the end.", `It's still yours until ${api.formatDayTime(DUE)}, so you can watch it again, or hand it back now.`]);
    assert.match(w.clockLines({ ...finished, loan: loan({ finishedAt: NOW, canRespond: false, toBrowser: true }) })[1], /or return it now\.$/);
  });

  test('yours, with the film’s files broken: the clock runs, and it can be returned', () => {
    assert.deepEqual(w.clockLines({ ...YOURS, state: 'unavailable' }), [`It's still yours until ${api.formatDayTime(DUE)}, and you can return it now.`]);
  });

  test('out, spent, missed: no clock (the line says it)', () => {
    for (const t of [OUT, { ...IN, state: 'spent', tape: null }, { ...IN, state: 'expired', tape: null }, null]) assert.deepEqual(w.clockLines(t), []);
  });
});

describe("the counter's line, where Play would be", { skip }, () => {
  test('a tape that can play has none', () => {
    assert.equal(w.goneLine(IN, SITE), null);
    assert.equal(w.goneLine(YOURS, SITE), null);
  });

  // "What a viewer sees": the out page says the same to everyone but the borrower, and
  // only what is true for all of them. No "your link still works", no start-by.
  test('out on loan: the date it is due back, and nothing more', () => {
    assert.deepEqual(w.goneLine(OUT, SITE), { kind: 'info', lead: 'Out on loan.', text: `Due back by ${api.formatDayTime(DUE)}.`, more: null });
  });

  test('returned by its borrower: when, and the link has done its job', () => {
    const at = NOW + HOUR;
    assert.deepEqual(w.goneLine({ ...IN, state: 'spent', tape: null, returned: { at, how: 'returned' } }, SITE), {
      kind: 'done',
      lead: `Returned on ${api.formatDayTime(at)}.`,
      text: "Thank you. It's back in the shop.",
      more: "This link has done its job: it won't take the tape out again. If you'd like to watch it again, ask Arthur.",
    });
  });

  test('due, for its borrower: gone back to the shop, with the day it was due', () => {
    const at = NOW - 2 * DAY;
    assert.deepEqual(w.goneLine({ ...IN, state: 'spent', tape: null, returned: { at, how: 'due' } }, SITE), {
      kind: 'info',
      lead: 'This tape has gone back to the shop.',
      text: `It was due back on ${api.formatDate(at)}. If you'd like to see it again, ask Arthur.`,
      more: null,
    });
  });

  test('spent, for anyone else holding the link: it has been used, and nothing of how', () => {
    assert.deepEqual(w.goneLine({ ...IN, state: 'spent', tape: null }, SITE), {
      kind: 'info',
      lead: 'This link has been used.',
      text: "The tape it lent is back in the shop. If you'd like to see it, ask Arthur.",
      more: null,
    });
  });

  test('a start-by date missed: when, with its year', () => {
    const startBy = new Date(2025, 9, 5, 23, 59).getTime();
    const line = w.goneLine({ ...IN, state: 'expired', tape: null, startBy }, SITE);
    assert.equal(line.lead, `This tape needed to be started by ${api.formatDateTimeYear(startBy)}.`);
    assert.match(line.lead, /2025/);
    assert.equal(line.text, "If you'd still like to see it, ask Arthur.");
  });

  test("unavailable, in its three forms: a warning, then the tape's own news", () => {
    const warn = { kind: 'warn', lead: "This film isn't available right now.", text: 'Try again later.' };
    assert.deepEqual(w.goneLine({ ...IN, state: 'unavailable' }, SITE), { ...warn, more: 'Nothing has been taken out: the tape is still in, and your link still works.' });
    assert.deepEqual(w.goneLine({ ...OUT, state: 'unavailable' }, SITE), { ...warn, more: `It's out on loan, due back by ${api.formatDayTime(DUE)}.` });
    // The borrower's: the clock line and Return it now say the rest.
    assert.deepEqual(w.goneLine({ ...YOURS, state: 'unavailable' }, SITE), { ...warn, more: null });
    assert.deepEqual(w.goneLine({ ...IN, state: 'unavailable', tape: null }, SITE), { ...warn, more: null });
  });
});

describe('the receipt, Return it now, and the end of the film', { skip }, () => {
  // (Slice 7 printed the receipt as four plain lines, receiptLines. Slice 8b prints it
  // as the till slip, the mock-up's: the same facts, with the shop, the film and the
  // small print round them.)
  test('the till slip: the shop, when it was taken out, the film and its length, to whom, due back, the small print', () => {
    const film = { title: 'Test Pattern', runtimeMinutes: 1 };
    assert.deepEqual(w.slipLines(YOURS, { name: 'Sam Okafor', film, site: SITE }), [
      { text: 'The Lantern Room' },
      { text: api.formatDateTimeYear(NOW).replace(/ /g, NBSP) },
      { text: '', kind: 'rule' },
      { text: 'Test Pattern  E-30' },
      { text: 'Out to Sam Okafor' },
      { text: `Due back ${api.formatDayTime(DUE).replace(/ /g, NBSP)}`, kind: 'gap' },
      { text: 'Watch it as often as you like until then.', kind: 'small' },
      { text: 'Done early? Return it from its page.', kind: 'small' },
      { text: 'Thank you', kind: 'gap' },
    ]);
    // A link anyone can use lends to the browser, signed in or not (question 2).
    const toBrowser = w.slipLines({ ...YOURS, loan: loan({ toBrowser: true }) }, { name: 'Sam Okafor', film, site: SITE });
    assert.ok(toBrowser.some((l) => l.text === 'Out to this browser'));
    assert.ok(!toBrowser.some((l) => /Sam/.test(l.text)), 'no name on a browser’s slip');
    // Nobody signed in: this browser.
    assert.ok(w.slipLines(YOURS, { film, site: SITE }).some((l) => l.text === 'Out to this browser'));
    // A film of no known length: the title alone.
    assert.ok(w.slipLines(YOURS, { name: 'Sam', film: { title: 'Nosferatu' }, site: SITE }).some((l) => l.text === 'Nosferatu'));
    // Only the borrower has a receipt.
    assert.deepEqual(w.slipLines(OUT, { name: 'Sam Okafor', film, site: SITE }), []);
    assert.deepEqual(w.slipLines(IN, { name: 'Sam Okafor', film, site: SITE }), []);
    assert.equal(w.SLIP_CAPTIONS.kept, 'Printed when you pressed Play.');
    assert.equal(w.SLIP_CAPTIONS.fresh, 'Printed just now, when Play took the tape.');
  });

  // The slip is narrow: "Due back" may stand over its date, but a date never parts from
  // its time, however the browser joins them (Chromium "Sun 15 Nov, 22:28", WebKit "Sun
  // 15 Nov at 22:28"), and the moment it was taken out stays one line too.
  test('on the slip, a date and its time are one unit: the line breaks only after "Due back"', () => {
    const lines = w.slipLines(YOURS, { name: 'Sam', film: { title: 'Test Pattern', runtimeMinutes: 1 }, site: SITE });
    const due = lines.find((l) => l.text.startsWith('Due back ')).text;
    assert.doesNotMatch(due.slice('Due back '.length), / /, 'no breaking space inside the date');
    assert.doesNotMatch(lines[1].text, / /, 'nor inside when it was taken out');
  });

  test('Return it now asks first, on the page: the link is spent after', () => {
    assert.deepEqual(w.returnQuestion('Test Pattern'), { lead: 'Return Test Pattern now?', text: "It's back in the shop straight away, and this link won't take it out again." });
    assert.deepEqual(w.RETURN_ERRORS, {
      'nothing-to-return': { lead: 'Nothing to return.', text: "The tape isn't out with you any more." },
      'cannot-respond': { lead: "This tape can't be handed back with a note.", text: "Return it without one, or keep it until it's due back." },
    });
    assert.deepEqual(w.RETURN_FAILED, { lead: "Couldn't return it just now.", text: 'Try again in a moment.' });
  });

  test("the end: still theirs until it's due back, and keeping it says until when", () => {
    assert.deepEqual(w.endWords('Test Pattern', YOURS), {
      heading: "That's the end.",
      text: `Test Pattern is yours until ${api.formatDayTime(DUE)}, so you can watch it again.`,
      keep: `Keep it until ${api.formatDay(DUE)}`,
    });
  });
});

describe("the owner's preview", { skip }, () => {
  const taken = { takenAt: NOW, dueAt: DUE };
  test('says who has the tape, since when and until when, and that friends never see it', () => {
    const sam = { out: true, borrower: { kind: 'person', person: { id: 1, name: 'Sam Okafor', disabled: false } }, ...taken };
    assert.deepEqual(w.previewLine(sam), {
      lead: 'Out to Sam Okafor',
      text: `since ${api.formatDayTime(NOW)}, due back ${api.formatDayTime(DUE)}. Only you see who has it: friends see “Out on loan”.`,
    });
    const browser = { out: true, borrower: { kind: 'browser', device: 'Safari on iPhone', signedInAs: { id: 2, name: 'Jo', disabled: false } }, ...taken };
    assert.equal(w.previewLine(browser).lead, 'Out to a browser');
    assert.match(w.previewLine(browser).text, /^\(Safari on iPhone, signed in as Jo\) since /);
    assert.deepEqual(w.previewLine({ out: false, borrower: null, takenAt: null, dueAt: null }), { lead: 'In the shop.', text: 'Nobody has the tape out.' });
    assert.equal(w.previewClock(sam)[0], 'Your own previews never take the tape, so Sam Okafor keeps it.');
    assert.equal(w.previewClock(browser)[0], 'Your own previews never take the tape, so that browser keeps it.');
  });

  test('trying a link in a private window takes the tape, and the line says so', () => {
    assert.equal(
      w.previewClock(null)[1],
      'To try a link as a friend would, open it in a private window or another browser: pressing Play there takes the tape out, as it would for a friend.',
    );
  });
});

describe('the lines under a sleeve on the front page', { skip }, () => {
  // In and out in the words of the shelf for members, on the same page (memberShelfLines,
  // the mock-up's word map): slices 7 and 8 said 1.1.0's "Ready to play", and "Out on
  // loan" over "Back …" on two lines.
  test('in the shop, with a start-by date kept whole; never the date Play would give', () => {
    const startBy = new Date(2026, 10, 13, 23, 59, 59, 999).getTime();
    assert.deepEqual(w.shelfLines({ ...IN, startBy }, { now: NOW }), ['In the shop', `Start by ${api.formatDay(startBy).replace(/ /g, NBSP)}`]);
    assert.deepEqual(w.shelfLines(IN, { now: NOW }), ['In the shop']);
  });

  test('out with you, and when it is due back; out on loan, back a day, on one line as on the shelf for members', () => {
    assert.deepEqual(w.shelfLines(YOURS, { now: NOW }), ['Out with you', `Due back ${api.formatDay(DUE).replace(/ /g, NBSP)}`]);
    assert.deepEqual(w.shelfLines(OUT, { now: NOW }), [`Out on loan, back ${api.formatDay(DUE).replace(/ /g, NBSP)}`]);
    assert.equal(w.shelfLines(OUT, { now: NOW })[0], w.memberShelfLines({ tape: 'out', dueBack: DUE }, SITE, { now: NOW })[0]);
    assert.equal(w.shelfLines(IN, { now: NOW })[0], w.memberShelfLines({ tape: 'in' }, SITE, { now: NOW })[0]);
    // Unavailable while out: that first, then the day it's back.
    assert.deepEqual(w.shelfLines({ ...OUT, state: 'unavailable' }, { now: NOW }), ['Not available right now', `Back ${api.formatDay(DUE).replace(/ /g, NBSP)}`]);
  });

  test('gone: one plain line each, and never a deadline', () => {
    assert.deepEqual(w.shelfLines({ ...IN, state: 'spent', tape: null, returned: { at: NOW, how: 'returned' } }), ['Returned']);
    assert.deepEqual(w.shelfLines({ ...IN, state: 'spent', tape: null, returned: { at: NOW, how: 'due' } }), ['Gone back to the shop']);
    assert.deepEqual(w.shelfLines({ ...IN, state: 'spent', tape: null }), ['Link used']);
    assert.deepEqual(w.shelfLines({ ...IN, state: 'expired', tape: null, startBy: NOW - DAY }), ['Not started in time']);
    assert.deepEqual(w.shelfLines({ ...IN, state: 'unavailable' }), ['Not available right now']);
  });

  // (Slice 7's "On this device only", under a tape from a link when signed in, went in
  // slice 8: the front page is in sections, and "On this device" is that section's
  // heading. The sections are tested below.)
  test('a tape with a note from the host says so; the note itself is on the film page', () => {
    assert.deepEqual(w.shelfLines({ ...IN, pickNote: 'Play it loud.' }, { now: NOW, site: SITE }), ['In the shop', 'A note from Arthur is with it']);
    assert.deepEqual(w.shelfLines({ ...OUT, pickNote: 'Play it loud.' }, { now: NOW, site: SITE }), [`Out on loan, back ${api.formatDay(DUE).replace(/ /g, NBSP)}`, 'A note from Arthur is with it']);
    assert.doesNotMatch(w.shelfLines({ ...IN, pickNote: 'Play it loud.' }, { now: NOW, site: SITE }).join(' '), /loud/);
  });
});

describe("the front page's sections (slice 8)", { skip }, () => {
  const t = (fields) => ({ film: { slug: Math.random().toString(36) }, ticket: { ...IN, ...fields } });
  const cardOut = t({ tape: 'yours', inAccount: true, dueBack: DUE, loan: loan() });
  const browserOut = t({ tape: 'yours', inAccount: false, dueBack: DUE, loan: loan({ toBrowser: true }) });
  const sent = t({ inAccount: true });
  const sentOut = t({ ...OUT, inAccount: true });
  const opened = t({});
  const openedSpent = t({ state: 'spent', tape: null });

  test('what is out with you on your card, what is out to this browser, what was sent you, what this browser opened', () => {
    const s = w.shelfSections([cardOut, browserOut, sent, opened, sentOut, openedSpent]);
    assert.deepEqual(s.card, [cardOut]);
    assert.deepEqual(s.browser, [browserOut]);
    assert.deepEqual(s.picked, [sent, sentOut]);
    assert.deepEqual(s.links, [opened, openedSpent]);
    assert.deepEqual(w.shelfSections(undefined), { card: [], browser: [], picked: [], links: [] });
  });

  test("in the mock-up's words, without its invitation to sign in and keep what is out (question 2)", () => {
    const s = w.sectionWords(SITE, { signedIn: true });
    assert.deepEqual(s.card, { heading: 'On your card', sub: "What you have out, and when it's due back." });
    assert.deepEqual(s.browser, { heading: 'Out to this browser', sub: 'Tapes you took out from a link, here.' });
    assert.deepEqual(s.picked, { heading: 'Picked for you', sub: 'Tapes Arthur has sent you.' });
    // "On your card" is the section for what you have out (question 11's table), so this
    // line no longer says these tapes "aren't on your card" in 1.1.0's sense.
    assert.deepEqual(s.links, { heading: 'On this device', sub: 'Tapes you opened from a link in this browser.' });
    assert.equal(s.members.heading, 'On the shelf for members');
    assert.equal(s.members.sub, 'Films Arthur shows to members. You can read about them, but you need a tape to play one.');
    // Signed out, every tape this browser holds came from a link.
    assert.deepEqual(w.sectionWords(SITE, { signedIn: false }).links, { heading: 'Your tapes', sub: null });
    const all = JSON.stringify([w.sectionWords(SITE, { signedIn: true }), w.sectionWords(SITE)]);
    assert.doesNotMatch(all, /sign in|keep/i);
  });

  test('the shelf for members: in the shop, or out on loan and the day it is back, never who; then whom to ask (question 7)', () => {
    assert.deepEqual(w.memberShelfLines({ tape: 'in', dueBack: null }, SITE, { now: NOW }), ['In the shop', 'No tape yet: ask Arthur']);
    assert.deepEqual(w.memberShelfLines({ tape: 'out', dueBack: DUE }, SITE, { now: NOW }), [`Out on loan, back ${api.formatDay(DUE).replace(/ /g, NBSP)}`, 'No tape yet: ask Arthur']);
    // Past due, not yet written down: the server already says in; a date gone by is never shown.
    assert.deepEqual(w.memberShelfLines({ tape: 'out', dueBack: NOW - HOUR }, SITE, { now: NOW }), ['In the shop', 'No tape yet: ask Arthur']);
  });
});

describe('the notices (slice 8)', { skip }, () => {
  test('a spent link: it has been used, and its tape is back, nothing of the film', () => {
    assert.deepEqual(w.noticeFor('ticket-spent', SITE), {
      kind: 'info',
      lead: 'That link has been used.',
      text: "The tape it lent is back in the shop. If you'd like to watch it again, ask Arthur.",
    });
  });

  // Question 11's table splits "has taken that tape back" (after a take-back) from "has
  // cancelled that link" (before it lent). Opening a cancelled link answers 410
  // ticket-revoked either way, so the page can't tell them apart: it says what is true
  // of both, and never claims a tape was out.
  test('a cancelled link: cancelled, whether or not its tape was taken back', () => {
    const n = w.noticeFor('ticket-revoked', SITE);
    assert.equal(n.lead, 'Arthur has cancelled that link.');
    assert.doesNotMatch(`${n.lead} ${n.text}`, /taken|tape back|out/i);
  });

  test('every notice, word for word; a kept link "stays" in its 1.1.0 words (question 11)', () => {
    assert.deepEqual(w.noticeFor('unknown-ticket', SITE), { kind: 'bad', lead: "That link doesn't work.", text: 'Check that you copied all of it, or ask Arthur.' });
    assert.deepEqual(w.noticeFor('ticket-revoked', SITE), { kind: 'info', lead: 'Arthur has cancelled that link.', text: "If that's a surprise, ask Arthur." });
    assert.deepEqual(w.noticeFor('ticket-kept', SITE), { kind: 'info', lead: "That tape has been kept on someone's membership card.", text: 'It only works for them now. Ask Arthur.' });
    assert.deepEqual(w.noticeFor('film-unavailable', SITE), { kind: 'info', lead: "That film isn't available at the moment.", text: null });
    assert.deepEqual(w.noticeFor('too-many-requests', SITE), { kind: 'warn', lead: 'Too many attempts from this connection.', text: 'Wait a few minutes, then open the link again.' });
  });

  test('only the codes a link can bring back; anything else is no notice', () => {
    for (const key of ['unknown-ticket', 'ticket-revoked', 'ticket-spent', 'ticket-kept', 'film-unavailable', 'too-many-requests']) assert.ok(w.noticeFor(key, SITE), key);
    for (const key of ['__proto__', 'constructor', 'toString', '', null, undefined, 42]) assert.equal(w.noticeFor(key, SITE), null, String(key));
  });

  test("opening a link that can't reach the shop: opening never takes the tape", () => {
    assert.equal(w.UNREACHABLE.text, 'Check your connection, then try again. Opening a link never takes the tape.');
  });
});

describe('signing out names the tapes that go back (question 5, slice 8)', { skip }, () => {
  test('nothing to say: no question', () => {
    assert.equal(w.signOutWords({ linkTickets: [], browserLoans: [] }), null);
    assert.equal(w.signOutWords(null), null);
  });

  test('a tape out to this browser goes back, and its link is spent', () => {
    assert.equal(
      w.signOutWords({ linkTickets: ['Nosferatu'], browserLoans: ['Nosferatu'] }),
      "Sign out of this browser? Nosferatu is out to this browser, so it goes back to the shop, and the link that took it out won't take it out again.",
    );
    assert.equal(
      w.signOutWords({ linkTickets: ['Nosferatu', 'Sherlock Jr.'], browserLoans: ['Nosferatu', 'Sherlock Jr.'] }),
      "Sign out of this browser? Nosferatu and Sherlock Jr. are out to this browser, so they go back to the shop, and the links that took them out won't take them out again.",
    );
  });

  test('the other tapes it opened from links are forgotten, and their links still work', () => {
    assert.equal(
      w.signOutWords({ linkTickets: ['Hedwig and the Angry Inch', 'Nosferatu'], browserLoans: ['Nosferatu'] }),
      "Sign out of this browser? Nosferatu is out to this browser, so it goes back to the shop, and the link that took it out won't take it out again. Signing out also forgets 1 tape you opened from a link here (Hedwig and the Angry Inch). The link still works if you open it again.",
    );
    assert.equal(
      w.signOutWords({ linkTickets: ['A', 'B'], browserLoans: [] }),
      'Sign out of this browser? Signing out also forgets 2 tapes you opened from links here (A, B). The links still work if you open them again.',
    );
  });

  test('Sign out everywhere: always asked, and it says what goes back', () => {
    assert.equal(
      w.signOutWords({ linkTickets: [], browserLoans: [] }, { everywhere: true }),
      'Every browser signed in as you is signed out, this one included, and playback stops on them. Your passkeys still work. A tape taken out from a link on another of them goes back to the shop too.',
    );
    assert.match(w.signOutWords({ linkTickets: ['Nosferatu', 'A'], browserLoans: ['Nosferatu'] }, { everywhere: true }), /Nosferatu is out to this browser, so it goes back to the shop.*This browser also forgets the tapes you opened from links here; the links still work\.$/);
  });
});

describe("the player's reasons for stopping", { skip }, () => {
  test('every code the player knows, in the new words', () => {
    const m = w.haltMessages(SITE);
    assert.equal(m['playing-elsewhere'], 'This tape is now playing on another device.');
    assert.equal(m['screening-ended'], 'This play has ended.');
    assert.equal(m.expired, 'This tape has gone back to the shop.');
    assert.equal(m.revoked, 'Arthur has taken this tape back.');
    // Version 2's reasons, which reach the borrower only: taken back by the owner
    // (question 6: the player says who took it back), returned from their other
    // device, or due while it played.
    assert.equal(m['taken-back'], 'Arthur has taken this tape back.');
    assert.equal(m.returned, 'This tape has been returned.');
    assert.equal(m.due, 'This tape has gone back to the shop.');
    assert.equal(m['not-found'], 'This tape is no longer valid.');
    assert.equal(m['signed-out'], 'This browser has been signed out, so the film has stopped.');
    for (const code of ['unavailable', 'unpublished', 'forbidden', 'unsupported', 'error']) assert.ok(m[code], code);
  });

  test('no message says ticket, screening or cinema', () => {
    for (const text of Object.values(w.haltMessages(null))) assert.doesNotMatch(text, /ticket|screening|cinema/i, text);
  });

  // The paused strip shows the tape's due date, as the sticker does (Player.jsx).
  test('the time left to come back is gone with the window to come back', () => {
    assert.equal(w.timeLeft, undefined);
  });
});

describe('a friend reads "tape" for what was sent, and "link" where the tape is out (question 11, answer a)', { skip }, () => {
  test("the out page's words never claim the link still works, nor give a start-by", () => {
    const words = [w.goneLine(OUT, SITE), w.goneLine({ ...OUT, state: 'unavailable' }, SITE)].flatMap((l) => [l.lead, l.text, l.more]).filter(Boolean).join(' ');
    assert.doesNotMatch(words, /still works|start|once it's back|keep/i, words);
  });

  test('no word on the counter says ticket, screening or cinema', () => {
    const all = [
      ...w.clockLines(IN, { now: NOW }),
      ...w.clockLines(YOURS),
      ...w.clockLines({ ...YOURS, loan: loan({ finishedAt: NOW }) }),
      ...[OUT, { ...IN, state: 'spent', tape: null }, { ...IN, state: 'expired', tape: null, startBy: NOW }, { ...IN, state: 'unavailable' }].flatMap((t) => Object.values(w.goneLine(t, SITE))),
      ...w.slipLines(YOURS, { name: 'Sam', film: { title: 'Test Pattern', runtimeMinutes: 1 }, site: SITE }).map((l) => l.text),
      ...Object.values(w.sectionWords(SITE, { signedIn: true })).flatMap((x) => [x.heading, x.sub]),
      ...NOTICES.flatMap((k) => Object.values(w.noticeFor(k, SITE))),
      ...Object.values(w.RETURN_ERRORS).flatMap(Object.values),
      ...Object.values(w.RETURN_FAILED),
      ...Object.values(w.TAKEN_OUT),
      ...Object.values(w.nothingHereWords(SITE, { takenBack: true })),
      ...Object.values(w.signedOutWords(SITE, { toBrowser: true })),
      ...Object.values(w.signedOutWords(SITE)),
      ...Object.values(w.noTapesYet(SITE)),
      ...Object.values(w.PREVIEW_BANNER),
      ...Object.values(w.handBackWords(SITE)).flatMap((x) => (typeof x === 'string' ? [x] : Object.values(x))),
      ...Object.values(w.handedBackWords('Test Pattern', SITE)),
      w.signOutWords({ linkTickets: ['A', 'B'], browserLoans: ['A'] }),
      ...Object.values(w.endWords('Test Pattern', YOURS)),
      ...Object.values(w.returnQuestion('Test Pattern')),
      ...w.previewClock(null),
    ].filter((x) => typeof x === 'string');
    for (const text of all) assert.doesNotMatch(text, /ticket|screening|cinema/i, text);
  });
});

// The words the film page, Hand it back and the front page lay out, which lived in their
// JSX until the review of slices 7 to 9 found nothing pinned them: settled words ("Only
// Arthur sees this", 5 Nov 2026) could have changed with every test passing.
describe("the pages' own lines (slices 7 and 8)", { skip }, () => {
  const PAGES = new URL('../web/src/pages/', import.meta.url);
  const read = (file) => fs.readFileSync(new URL(file, PAGES), 'utf8');

  test('Hand it back: one of four responses required, only the host reads it, and the way to say nothing', () => {
    assert.deepEqual(w.handBackWords(SITE), {
      heading: 'Hand it back',
      lede: 'Tell Arthur how it was, and the tape goes back in.',
      legend: 'How was it?',
      missing: { lead: 'Not handed back yet.', text: "Choose how it was, or press Return it without a note if you'd rather not say." },
      missingField: 'Choose one of these.',
      message: 'Anything to add?',
      only: "Only Arthur sees this. It isn't on the film's page, and nobody else can read it.",
      returns: "Handing it back returns the tape straight away, and this link won't take it out again.",
      send: 'Hand it back',
      sending: 'Handing it back…',
      without: 'Return it without a note',
      notNow: 'Not now',
    });
    assert.deepEqual(w.handedBackWords('Test Pattern', SITE), {
      heading: 'Handed back',
      sub: 'Back in the shop',
      lead: 'Test Pattern is back in the shop.',
      text: 'Thank you. Arthur will see what you said in the back office.',
      said: 'You said',
      note: 'Your note',
      only: 'Only Arthur sees this.',
      home: 'Go to your tapes',
      film: 'Back to the film',
    });
  });

  // Host is for the start of a sentence; mid-sentence the host is as the shop writes it.
  test('a shop named in lower case, with no owner’s name, is written as it is mid-sentence and with a capital at the start', () => {
    const lower = { cinemaName: 'the lantern room' };
    assert.equal(w.handBackWords(lower).lede, 'Tell the lantern room how it was, and the tape goes back in.');
    assert.match(w.handBackWords(lower).only, /^Only the lantern room sees this\./);
    assert.equal(w.handedBackWords('X', lower).text, 'Thank you. The lantern room will see what you said in the back office.');
    assert.equal(w.handedBackWords('X', lower).only, 'Only the lantern room sees this.');
  });

  test('taken out; nothing on the shelf here; no tapes yet; the preview banner', () => {
    assert.deepEqual(w.TAKEN_OUT, { lead: 'Taken out.', text: "It's yours until it's due back, and nobody else can play it until then. Watch it as often as you like." });
    assert.deepEqual(w.nothingHereWords(SITE), {
      heading: 'Nothing on the shelf here',
      takenBack: null,
      text: 'If someone sent you a tape, open the link they gave you. A tape can also have gone back to the shop.',
    });
    assert.equal(w.nothingHereWords(SITE, { takenBack: true }).takenBack, 'Arthur has taken this tape back.');
    assert.deepEqual(w.noTapesYet(SITE), { lead: 'No tapes yet.', text: "When Arthur sends you a tape, it'll be here." });
    // The mock-up's banner, which says what the counter's own preview line says.
    assert.deepEqual(w.PREVIEW_BANNER, { lead: 'Preview.', text: "You're signed in to the back office here, so Play in this browser never takes a tape." });
  });

  // Question 5: a tape out to this browser from a link anyone can use went back when it
  // was signed out, and its link is spent, so neither signing in nor the link brings it
  // back. 1.1.0's lines are kept for a member's own tape, which signing in carries on.
  test('signed out while it played: a browser’s tape has gone back; a member’s own carries on once signed in', () => {
    assert.deepEqual(w.signedOutWords(SITE, { toBrowser: true }), {
      heading: 'This browser has been signed out',
      text: "The tape went back to the shop when this browser was signed out, and the link that took it out won't take it out again. If you'd like to watch it again, ask Arthur.",
      signIn: false,
    });
    assert.deepEqual(w.signedOutWords(SITE), {
      heading: 'This browser has been signed out',
      text: 'Sign in to carry on watching. If you opened the tape from a link, open the link again.',
      signIn: true,
    });
    assert.doesNotMatch(w.signedOutWords(SITE, { toBrowser: true }).text, /sign in|open the link again/i);
  });

  test('the pages lay these out, rather than words of their own', () => {
    const hand = read('HandBack.jsx');
    for (const k of ['heading', 'lede', 'legend', 'missingField', 'message', 'only', 'returns', 'without', 'notNow']) assert.match(hand, new RegExp(`\\{w\\.${k}\\}`), k);
    for (const k of ['heading', 'lead', 'text', 'said', 'note', 'only', 'home', 'film']) assert.match(hand, new RegExp(`d\\.${k}\\b`), k);
    const film = read('Film.jsx');
    assert.match(film, /TAKEN_OUT\.lead/);
    assert.match(film, /signedOutWords\(site, signedOut\)/);
    assert.match(film, /nothingHereWords\(site, \{ takenBack \}\)/);
    assert.match(read('Home.jsx'), /noTapesYet\(site\)\.lead/);
    assert.match(fs.readFileSync(new URL('../web/src/site.jsx', import.meta.url), 'utf8'), /PREVIEW_BANNER\.text/);
  });

  // As the back office's scan (test/office.test.js): every friend's page, and these
  // words, without 1.x's nouns or its clocks.
  const OLD = /\b(tickets?|screenings?|screened|cinemas?)\b/i;
  const RETIRED = [/plays? left/i, /come back by/i, /to come back\b/i, /come back to it/i, /days after the first play/i, /give back/i, /given back/i];
  const files = () => fs.readdirSync(PAGES).filter((f) => f.endsWith('.jsx') || f === 'tapeWords.js');

  test("no friend's page says ticket, screening or cinema, or 1.x's clocks", () => {
    assert.ok(files().length >= 9, files().join(' '));
    const found = [];
    for (const file of files()) {
      for (const text of shown(read(file))) {
        if (OLD.test(text)) found.push(`${file}: ${text}`);
        for (const re of RETIRED) if (re.test(text)) found.push(`${file}: ${text}`);
      }
    }
    assert.deepEqual(found, []);
  });

  // Question 11's table: "On your card" is the front page's section for what you have
  // out. The page no longer says a tape or a link is "on your card" in 1.1.0's sense
  // (kept, or for you alone): the "For Sam only" strip says that.
  test('"on your card" is only the heading of the section for what you have out', () => {
    const found = [];
    for (const file of files()) for (const text of shown(read(file))) if (/on your card/i.test(text) && text !== 'On your card') found.push(`${file}: ${text}`);
    assert.deepEqual(found, []);
  });
});

describe('a name cut into strips of label tape', { skip }, () => {
  test('a short one fits on one strip', () => {
    assert.deepEqual(w.tapeStrips('For Sam only', 18), ['For Sam only']);
  });

  test('a long one breaks between words, every strip within its wheels', () => {
    const strips = w.tapeStrips('For Wiremu Te Rangi-Hāpai Kingi-Williamson only', 18);
    assert.ok(strips.length > 1);
    for (const s of strips) assert.ok(s.length <= 18, s);
    assert.equal(strips.join(' '), 'For Wiremu Te Rangi-Hāpai Kingi-Williamson only');
  });

  test('a word longer than a strip is cut, and nothing is lost', () => {
    const strips = w.tapeStrips('For Abcdefghijklmnopqrstuvwxyz only', 8);
    for (const s of strips) assert.ok(s.length <= 8, s);
    assert.equal(strips.join('').replace(/ /g, ''), 'ForAbcdefghijklmnopqrstuvwxyzonly');
  });
});
