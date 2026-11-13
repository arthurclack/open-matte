// The back office in the video shop's look (web/src/admin), the parts without a
// browser: what it reads off the booth for its status line and the attention strip
// on Films (admin/facts.js), what it says about links and loans (admin/loanWords.js,
// version 2's slice 9), and that the words it shows are the shop's: a link is what you
// send and the tape is the film's one copy (docs/version-2.md, question 11); send,
// not issue or lend; the shelf, not publishing. See web/src/look/README.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { shown, withoutComments } from './shown.js';

// Dates in one time zone, as a browser has them.
process.env.TZ = 'Europe/London';

// The web app's source isn't in the server's image, where docs/deploying.md runs the
// tests on the server's own Node: there these are skipped, not failed.
const ADMIN = new URL('../web/src/admin/', import.meta.url);
const present = fs.existsSync(new URL('facts.js', ADMIN));
const skip = present ? false : 'web/src is not here (the server image has no web source)';
const facts = present ? await import(new URL('facts.js', ADMIN)) : {};
const words = present ? await import(new URL('loanWords.js', ADMIN)) : {};
const api = present ? await import(new URL('../web/src/api.js', import.meta.url)) : {};

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 10, 5, 19, 52).getTime();

// A booth's server part, as GET /api/admin/booth gives it (server/booth.js), all well.
const well = () => ({
  media: { readable: true, folders: 6, error: null, lastScan: { at: NOW - HOUR, films: 6, missing: 0 }, dir: '/srv/media' },
  disk: { data: { free: 40e9, total: 64e9, dir: '/data' }, media: { free: 1.1e12, total: 3.6e12, dir: '/srv/media' } },
  backups: { enabled: true, running: false, lastError: null, newest: { at: NOW - 17 * HOUR, name: 'open-matte-2026-11-05.db' }, count: 14, copy: { configured: false } },
  retention: { lastError: null, lastRun: null, settings: null },
  version: { app: '1.1.0' },
});

describe('the status line: whether the server is well (admin/facts.js serverTrouble)', { skip }, () => {
  test('a server whose every check is well has nothing to look at', () => {
    assert.equal(facts.serverTrouble(well(), NOW), 0);
    // Backups turned off, and no off-server copy set up: nothing was asked of them.
    const off = well();
    off.backups = { enabled: false, copy: { configured: false } };
    assert.equal(facts.serverTrouble(off, NOW), 0);
    assert.equal(facts.serverTrouble(null, NOW), 0);
  });

  test('each check that wants a look counts once, as Status shows it', () => {
    const cases = [
      ['the media folder unreadable', (s) => Object.assign(s.media, { readable: false, error: 'permission denied' })],
      ['the data disk nearly full', (s) => Object.assign(s.disk.data, { free: 5e9, total: 64e9 })],
      ['the media disk unknown', (s) => Object.assign(s.disk.media, { error: 'timed out' })],
      ['no backup yet', (s) => Object.assign(s.backups, { newest: null })],
      ['the backup a day and a bit old', (s) => Object.assign(s.backups.newest, { at: NOW - 27 * HOUR })],
      ['the last backup failed', (s) => Object.assign(s.backups, { lastError: { message: 'disk full' } })],
      ['the off-server copy two days old', (s) => Object.assign(s.backups, { copy: { configured: true, newest: { at: NOW - 49 * HOUR, name: 'x.db' } } })],
      ['the off-server copy missing', (s) => Object.assign(s.backups, { copy: { configured: true, newest: null } })],
      ['the clean-up failed', (s) => Object.assign(s.retention, { lastError: 'locked' })],
      // Version 2: the check, every minute, for tapes that have come back.
      ['the last check for tapes back in failed', (s) => Object.assign(s, { sweeper: { lastRun: null, lastError: { message: 'locked', at: NOW } } })],
    ];
    for (const [what, spoil] of cases) {
      const s = well();
      spoil(s);
      assert.equal(facts.serverTrouble(s, NOW), 1, what);
    }
    const all = well();
    for (const [, spoil] of cases.slice(0, 3)) spoil(all);
    assert.equal(facts.serverTrouble(all, NOW), 3);
  });

  test('a recent backup and a copy seen today are well; a tenth of a disk free is low', () => {
    assert.equal(facts.backupLate({ at: NOW - 25 * HOUR }, NOW), false);
    assert.equal(facts.backupLate({ at: NOW - 27 * HOUR }, NOW), true);
    assert.equal(facts.copyOld({ at: NOW - 47 * HOUR }, NOW), false);
    assert.equal(facts.diskLow({ free: 9, total: 100 }), true);
    assert.equal(facts.diskLow({ free: 10, total: 100 }), false);
    assert.equal(facts.diskLow({ free: 10, total: 0 }), false);
  });
});

describe('the attention strip on Films (admin/facts.js attentionLine)', { skip }, () => {
  const quiet = () => ({ links: { waiting: [], expired: [] }, tickets: [], refusals: { total: 0, since: NOW - HOUR } });
  const at = () => '08:12';

  test('says nothing when all is quiet', () => {
    assert.deepEqual(facts.attentionLine(quiet(), at), []);
  });

  // 1.1.0 said "1 tape's start-by date is close": a start-by date is a link's (slice 9).
  test('says each thing in a few words, in links, not tickets or tapes', () => {
    const a = quiet();
    a.links.waiting = [{ purpose: 'setup' }];
    a.links.expired = [{ purpose: 'recovery' }, { purpose: 'setup' }];
    a.tickets = [{ id: 1 }];
    a.refusals.total = 3;
    assert.deepEqual(facts.attentionLine(a, at), ['1 setup link waiting', '2 links expired unused', "1 link's start-by date is close", '3 media requests refused since 08:12']);
    a.links.waiting = [{ purpose: 'setup' }, { purpose: 'recovery' }];
    a.tickets = [{ id: 1 }, { id: 2 }];
    a.refusals.total = 1;
    assert.deepEqual(facts.attentionLine(a, at), ['2 links waiting', '2 links expired unused', "2 links' start-by dates are close", '1 media request refused since 08:12']);
  });
});

// ====================================================================== links and loans
// admin/loanWords.js: what the back office says about links and loans (version 2,
// slice 9). The shapes are the API's (server/access.js adminLoans, routes/admin.js).
const person = (id, name, extra = {}) => ({ id, name, disabled: false, ...extra });
const SAM = person(3, 'Sam Okafor');
const JO = person(1, 'Jo');
const TAKEN = NOW - HOUR;
const DUE = TAKEN + 3 * DAY;
const loanOf = (fields = {}) => ({
  id: 41,
  film: { id: 7, slug: 'test-pattern', title: 'Test Pattern' },
  ticket: { id: 12, label: null },
  borrower: { kind: 'person', person: SAM },
  takenAt: TAKEN,
  dueAt: DUE,
  endedAt: null,
  endedHow: null,
  live: true,
  playingNow: false,
  position: 18,
  finished: false,
  response: null,
  otherLinks: [],
  ...fields,
});
const BROWSER = { kind: 'browser', device: 'Chrome on Android TV', signedInAs: null };

describe('who has a tape, and its state (admin/loanWords.js)', { skip }, () => {
  test('the Tape column on Films: in, out with whom since when and due back when, or off the shelf with whoever still has it', () => {
    const out = `Out with Sam Okafor since ${api.formatDay(TAKEN)}, due back ${api.formatDay(DUE)}`;
    assert.deepEqual(words.tapeCell({ state: 'in', loan: null }), { tone: 'done', text: 'In', sub: '' });
    assert.deepEqual(words.tapeCell({ state: 'out', loan: loanOf() }), { tone: 'info', text: out, sub: '' });
    // A browser's: your note on the link, and the device, under it.
    const mum = loanOf({ borrower: BROWSER, ticket: { id: 13, label: 'Mum' } });
    assert.deepEqual(words.tapeCell({ state: 'out', loan: mum }), {
      tone: 'info',
      text: `Out with a browser since ${api.formatDay(TAKEN)}, due back ${api.formatDay(DUE)}`,
      sub: 'Your note: Mum · Chrome on Android TV',
    });
    // Off the shelf, the clock runs on: who has it is still said.
    assert.deepEqual(words.tapeCell({ state: 'off', loan: null }), { tone: 'off', text: 'Off the shelf', sub: '' });
    assert.deepEqual(words.tapeCell({ state: 'off', loan: loanOf() }), { tone: 'off', text: 'Off the shelf', sub: out });
  });

  test('a borrower: a member by name, or a browser with your note, its device and whom it is signed in as', () => {
    assert.deepEqual(words.borrowerLines({ kind: 'person', person: SAM }), { who: 'Sam Okafor', about: '' });
    assert.deepEqual(words.borrowerLines({ kind: 'person', person: { ...SAM, disabled: true } }), { who: 'Sam Okafor', about: 'Card turned off' });
    assert.deepEqual(words.borrowerLines({ ...BROWSER, signedInAs: JO }, 'Kitchen TV'), {
      who: 'A browser, from a link anyone can use',
      about: 'Your note: Kitchen TV · Chrome on Android TV · signed in as Jo',
    });
    // After the clean-up deletes its session: the device alone.
    assert.deepEqual(words.borrowerLines({ kind: 'browser', device: 'Safari on iPhone', signedInAs: null }), { who: 'A browser, from a link anyone can use', about: 'Safari on iPhone' });
  });

  test('what the borrower is doing now, from the loan', () => {
    assert.equal(words.loanNow(loanOf({ playingNow: true })), 'Playing now at 0:18');
    assert.equal(words.loanNow(loanOf()), 'Paused at 0:18');
    assert.equal(words.loanNow(loanOf({ finished: true, position: 40 })), 'Watched to the end, stopped at 0:40');
    assert.equal(words.loanNow(loanOf({ position: 0 })), 'Taken out, not watched yet');
    assert.equal(words.loanNow(loanOf({ live: false })), null);
  });

  test("a link's state in the back office's words, one for each of linkState's", () => {
    const state = (linkState, loan = null) => words.linkStateWords({ linkState, loan });
    assert.deepEqual(state('unopened'), ['off', 'Not opened yet']);
    assert.deepEqual(state('opened'), ['off', 'Opened']);
    assert.deepEqual(state('waiting'), ['info', 'Waiting: the tape is out']);
    assert.deepEqual(state('has'), ['info', 'Has the tape']);
    assert.deepEqual(state('done'), ['off', 'Done: the tape is back in']);
    assert.deepEqual(state('missed'), ['off', 'Start-by missed']);
    assert.deepEqual(state('cancelled'), ['bad', 'Cancelled']);
    assert.deepEqual(state('cancelled', loanOf({ live: false, endedHow: 'taken-back', endedAt: NOW })), ['bad', 'Taken back']);
    assert.deepEqual(state('off'), ['warn', 'Film off the shelf']);
    assert.deepEqual(state('unavailable'), ['bad', 'Film unavailable']);
    assert.deepEqual(Object.keys(words.LINK_STATES).sort(), ['cancelled', 'done', 'has', 'missed', 'off', 'opened', 'unavailable', 'unopened', 'waiting']);
  });

  test('how a tape came back, for each way a loan ends', () => {
    const how = (endedHow, response = null) => words.endedWords({ endedHow, response });
    assert.equal(how('returned'), 'returned early');
    assert.equal(how('returned', { kind: 'loved-it' }), 'handed back with a response');
    assert.equal(how('due'), 'it was due');
    assert.equal(how('taken-back'), 'you took it back');
    assert.equal(how('signed-out'), 'its browser was signed out');
    assert.equal(how('disabled'), 'their card was turned off');
    assert.equal(how('before-2.0'), 'lent before the upgrade to version 2');
    const back = { linkState: 'done', loan: loanOf({ live: false, endedHow: 'due', endedAt: DUE }) };
    assert.equal(words.linkStateNote(back), `it was due, ${api.formatDayTime(DUE)}`);
    assert.equal(words.linkStateNote({ linkState: 'has', loan: loanOf() }), `Due back ${api.formatDayTime(DUE)}`);
    assert.equal(words.linkStateNote({ linkState: 'unopened', loan: null }), '');
    // A link that hasn't lent: the day to start by, as it goes by, under its state (the
    // mock-up's Start by column), standing still while the tape is out with someone else.
    const date = NOW + 2 * DAY;
    assert.equal(words.linkStateNote({ linkState: 'opened', loan: null, startBy: date, effectiveStartBy: date }), `Start by ${api.formatDay(date)}`);
    assert.equal(words.linkStateNote({ linkState: 'waiting', loan: null, startBy: date, effectiveStartBy: date + DAY, startByPaused: true }), `Start by ${api.formatDay(date + DAY)}, standing still`);
    assert.equal(words.linkStateNote({ linkState: 'missed', loan: null, startBy: NOW - DAY, effectiveStartBy: NOW - DAY }), '');
    assert.equal(words.linkStateNote({ linkState: 'cancelled', loan: null, startBy: date, effectiveStartBy: date }), '');
  });

  test("Due back after: the link's own days, or the shop's", () => {
    assert.equal(words.loanDaysWords(5, 3), '5 days');
    assert.equal(words.loanDaysWords(1, 3), '1 day');
    assert.equal(words.loanDaysWords(null, 3), "3 days (the shop's)");
  });

  test('a start-by date: as it goes by, standing still while the tape is out, and later than set once time is given back', () => {
    const date = NOW + 2 * DAY;
    assert.equal(words.startByWords({ startBy: null, effectiveStartBy: null }), 'Not set');
    assert.equal(words.startByWords({ startBy: date, effectiveStartBy: date }), api.formatDayTime(date));
    assert.equal(
      words.startByWords({ startBy: date, effectiveStartBy: date + 5 * HOUR, startByPaused: true }),
      `${api.formatDayTime(date + 5 * HOUR)}; standing still while the tape is out with someone else; set as ${api.formatDayTime(date)}, later by the time the tape was out`,
    );
    assert.equal(words.startByWords({ startBy: date, effectiveStartBy: null, loan: loanOf() }), 'Met: the link has lent');
    // Given back to the second: the same minute is no move.
    assert.equal(words.startByWords({ startBy: date, effectiveStartBy: date + 900, startByPaused: false }), api.formatDayTime(date + 900));
  });
});

describe('taking a tape back: the question on the page (question 14)', { skip }, () => {
  test("a member's tape: what they will see, their other links that go with it, and the links anyone can use that stay", () => {
    const loan = loanOf({
      otherLinks: [
        { id: 20, label: null, kind: 'person', linkState: 'waiting', cancelledToo: true },
        { id: 21, label: 'Kitchen TV', kind: 'anyone', linkState: 'waiting', cancelledToo: false },
      ],
    });
    const w = words.takeBackWords(loan, 'Test Pattern', 'Arthur');
    assert.equal(w.lead, 'Take Test Pattern back from Sam Okafor?');
    assert.deepEqual(w.lines, [
      "It's back in straight away, and Sam's link stops working, as cancelling it would. You can send a new link afterwards.",
      // Kitchen TV, a link anyone can use, stays in Sam's browser unless it's ticked: Sam's
      // page then shows it, with Play (below for the other forms).
      'If Sam is watching, playback stops at the next report, and the player says “Arthur has taken this tape back.” Their page for the film then shows the link anyone can use that their browsers also hold, with Play: Sam could take the tape out again straight away, unless you tick it below.',
    ]);
    assert.equal(w.cancelledLead, '1 other link for this film goes with it, cancelled too:');
    assert.deepEqual(w.cancelled, [{ id: 20, name: "Sam's link", state: 'waiting: the tape is out' }]);
    assert.match(w.heldLead, /^Sam's browsers also hold a link anyone can use for this film\. It stays, because other people may hold it too/);
    assert.deepEqual(w.held, [{ id: 21, name: 'Kitchen TV', state: 'waiting: the tape is out' }]);
    assert.deepEqual([w.take, w.keep], ['Take it back', 'Keep it out']);
  });

  // A link anyone can use that stays in their browser is on their page at once, with
  // Play: "Nothing on the shelf here" is said only when none stays, and the question
  // follows the boxes as they are ticked (the review of slices 7 to 9).
  test('their page: "Nothing on the shelf here" only when no link anyone can use stays in their browser', () => {
    const held = (n) => Array.from({ length: n }, (_, i) => ({ id: 30 + i, label: null, kind: 'anyone', linkState: 'opened', cancelledToo: false }));
    const one = words.takeBackWords(loanOf({ otherLinks: held(1) }), 'Test Pattern', 'Arthur');
    assert.equal(
      one.lines[1],
      'If Sam is watching, playback stops at the next report, and the player says “Arthur has taken this tape back.” Their page for the film then shows the link anyone can use that their browsers also hold, with Play: Sam could take the tape out again straight away, unless you tick it below.',
    );
    assert.match(one.heldLead, /and Sam could take the tape out on it straight away\. Tick one to cancel it as well:$/);
    assert.doesNotMatch(one.heldLead, /once it's back/);
    // Ticked: nothing stays, so nothing is on the shelf there.
    const ticked = words.takeBackWords(loanOf({ otherLinks: held(1) }), 'Test Pattern', 'Arthur', { ticked: { 30: true } });
    assert.match(ticked.lines[1], /Their page for the film then says “Nothing on the shelf here”, as for a cancelled link\.$/);
    // Two, one ticked: the other stays.
    const two = words.takeBackWords(loanOf({ otherLinks: held(2) }), 'Test Pattern', 'Arthur', { ticked: { 30: true } });
    assert.match(two.lines[1], /shows the link anyone can use that their browsers also hold, with Play: Sam could take the tape out again straight away, unless you tick it below\.$/);
    const both = words.takeBackWords(loanOf({ otherLinks: held(2) }), 'Test Pattern', 'Arthur');
    assert.match(both.lines[1], /shows the links anyone can use that their browsers also hold, with Play: Sam could take the tape out again straight away on one of them, unless you tick them below\.$/);
    // A browser's tape.
    const browser = words.takeBackWords(loanOf({ borrower: BROWSER, otherLinks: held(1) }), 'Nosferatu', 'Arthur');
    assert.match(browser.lines[1], /Its page for the film then shows the link anyone can use that it also holds, with Play: that browser could take the tape out again straight away, unless you tick it below\.$/);
  });

  test("a browser's tape: 'that browser', and the member signed in on it loses their own links too (question 16)", () => {
    const plain = words.takeBackWords(loanOf({ borrower: BROWSER }), 'Nosferatu', 'The Lantern Room');
    assert.equal(plain.lead, 'Take Nosferatu back from that browser?');
    assert.match(plain.lines[0], /^It's back in straight away, and that browser's link stops working/);
    assert.match(plain.lines[1], /^If it's playing in that browser, playback stops at the next report, and the player says “The Lantern Room has taken this tape back\.” Its page/);
    assert.equal(plain.lines.length, 2);
    assert.equal(plain.cancelledLead, null);
    assert.equal(plain.heldLead, null);
    const signedIn = words.takeBackWords(loanOf({ borrower: { ...BROWSER, signedInAs: JO } }), 'Nosferatu', 'Arthur');
    assert.equal(signedIn.lines[2], "That browser is signed in as Jo, so Jo's own links for this film that haven't lent are cancelled with it.");
  });
});

describe('the send form (admin/loanWords.js)', { skip }, () => {
  const film = (loan = null, state = loan ? 'out' : 'in') => ({ id: 7, title: 'Test Pattern', tape: { state, loan } });

  test('it warns, and only warns, when the film is out, when links are waiting, and when the member has one waiting already (question 9)', () => {
    assert.deepEqual(words.sendWarnings(film()), []);
    assert.deepEqual(words.sendWarnings(film(loanOf())), [
      { kind: 'warn', lead: 'Test Pattern is out.', text: `Sam Okafor has it until ${api.formatDayTime(DUE)}. Whoever presses Play first after it's back gets it.` },
    ]);
    // Never who for a browser: the back office may say it, but "A browser" is all it knows.
    assert.equal(words.sendWarnings(film(loanOf({ borrower: BROWSER })))[0].text.split(' has it')[0], 'A browser');
    const waiting = [{ person: null }, { person: JO }];
    assert.deepEqual(words.sendWarnings(film(), { waiting }), [
      { kind: 'info', text: 'It already has 2 links waiting for the tape. Whoever presses Play first on any of them takes it.' },
    ]);
    assert.deepEqual(words.sendWarnings(film(), { waiting, person: JO })[1], {
      kind: 'warn',
      lead: 'Jo already has a link for this film.',
      text: 'This one waits: it lends only after the first has lent and the tape is back.',
    });
    assert.equal(words.sendWarnings(film(), { waiting, person: SAM }).length, 1);
    // Off the shelf with its tape out: friends can't open it, so nothing to warn.
    assert.deepEqual(words.sendWarnings(film(loanOf(), 'off')), []);
  });

  test("Picked for you's hint: a member's note is theirs; on a link anyone can use, whoever has the link reads it (settled 10 Nov 2026)", () => {
    // On their link: the note is the link's (pick_note), and the back office says link for
    // a link (question 11). Slice 9 said "on their tape", the mock-up's words.
    assert.match(words.pickHint(JO), /^Your note to Jo about this film, on their link\. It's kept apart from the staff pick/);
    assert.match(words.pickHint(null), /^Your note about this film, on the link\. Whoever has the link reads it: if it's forwarded, so does whoever it's forwarded to\./);
  });

  test("once made: sending doesn't take the tape", () => {
    assert.deepEqual(words.readyLines(film(), { days: 3 }), ["Sending it doesn't take the tape: pressing Play does, if it's in.", 'Due back 3 days after they press Play.']);
    const start = NOW + 9 * DAY;
    assert.deepEqual(words.readyLines(film(loanOf()), { days: 1, startBy: start }), [
      `Sending it doesn't take the tape. It's out until ${api.formatDayTime(DUE)}; after that, whoever presses Play first gets it.`,
      `Start by ${api.formatDay(start)}. Due back 1 day after they press Play.`,
    ]);
  });
});

describe("the Ledger's rows for links and loans", { skip }, () => {
  test('each kind of loan event in words; lent and back in are printed on the till roll; never what was said', () => {
    const row = (type, detail) => words.loanEventWords({ type, detail });
    assert.deepEqual(row('ticket-sent', { loanDays: 3, note: true }), { text: 'You sent a link, due back 3 days after Play, with a “Picked for you” note' });
    assert.deepEqual(row('ticket-sent', { loanDays: null, note: false }), { text: 'You sent a link' });
    assert.deepEqual(row('lent', { loanId: 1, dueAt: DUE }), { text: `Lent, due back ${api.formatDayTime(DUE)}`, till: true });
    assert.deepEqual(row('returned', { loanId: 1, how: 'returned', response: true }), { text: 'Back in: handed back with a response', till: true });
    assert.deepEqual(row('returned', { loanId: 1, how: 'due', response: false }), { text: 'Back in: it was due', till: true });
    assert.deepEqual(row('returned', { loanId: 1, how: 'taken-back', response: false }), { text: 'Back in: you took it back', till: true });
    assert.deepEqual(row('due-changed', { loanId: 1, from: DUE, to: DUE + DAY }), {
      text: `You moved the due-back date from ${api.formatDayTime(DUE)} to ${api.formatDayTime(DUE + DAY)}`,
    });
    assert.deepEqual(row('ticket-cancelled'), { text: 'You cancelled the link' });
    assert.deepEqual(row('ticket-restored'), { text: 'You restored the link' });
    assert.deepEqual(row('ticket-kept'), { text: 'Kept a link on their card' });
    assert.deepEqual(row('ticket-given', { from: 'anyone' }), { text: 'You gave them a link that was for anyone' });
    assert.deepEqual(row('ticket-released', { to: 'anyone' }), { text: 'You let anyone with the link use their link again' });
    assert.equal(row('signed-in'), null);
  });
});

describe('responses, Status and Settings (admin/loanWords.js)', { skip }, () => {
  test('the four responses, how early a tape was handed back, and the tab for a screen reader', () => {
    assert.deepEqual(words.RESPONSE_WORDS, { 'loved-it': 'Loved it', 'still-thinking': 'Still thinking about it', 'not-for-me': 'Not for me', 'lets-talk': "Let's talk" });
    assert.equal(words.handedBackWhen(DUE - 2 * DAY - HOUR, DUE), '2 days early');
    assert.equal(words.handedBackWhen(DUE - DAY - HOUR, DUE), 'a day early');
    assert.equal(words.handedBackWhen(DUE - 5 * HOUR, DUE), '5 hours early');
    assert.equal(words.handedBackWhen(DUE - 30 * 60_000, DUE), 'just before it was due');
    assert.equal(words.responsesTab(2), 'Responses, 2 unread');
    assert.equal(words.responsesTab(0), 'Responses');
  });

  test('Status: tapes out and the next due back; the check for tapes back in', () => {
    assert.deepEqual(words.tapesOutLine({ out: 0, next: null }), { lead: 'No tapes out.', text: "Every film's tape is in." });
    const next = { film: { id: 7, title: 'Nosferatu' }, dueAt: DUE };
    assert.deepEqual(words.tapesOutLine({ out: 3, next }), { lead: '3 tapes out.', next, text: "Tapes come back on their own when they're due." });
    assert.match(words.sweeperText(null), /^Not run yet since the server started/);
    assert.equal(words.sweeperText({ lastRun: { at: NOW, closed: 2 } }), `Checked ${api.formatDayTime(NOW)}: wrote down 2 tapes that had come back. It runs every minute.`);
  });

  // Question 5: a member's card turned off sends back every tape they have out, the one
  // a browser of theirs took out on a link anyone can use too (test/loans.test.js); 1.1.0
  // said links anyone can use "aren't affected", which version 2 makes false.
  test("a member's page: turning the card off, and signing their browsers out, say what happens to their tapes", () => {
    assert.equal(
      words.cardOffWords('Sam'),
      "Turn Sam's card off? Sam is signed out everywhere and can't sign in, links only for Sam stop working from the next request, and any tape Sam has out comes back to the shop at once, including one a browser of theirs took out on a link anyone can use: that link won't take it out again. Other links anyone can use aren't affected. It doesn't remove passkeys: for a lost or stolen device, take back the keys instead (Help Sam sign in again).",
    );
    assert.equal(
      words.browsersTapesWords('Sam'),
      "A tape out on a link for Sam stays theirs; one a browser of theirs took out on a link anyone can use goes back to the shop, and that link won't take it out again.",
    );
    const page = fs.readFileSync(new URL('PersonDetail.jsx', ADMIN), 'utf8');
    // Sign out everywhere, and taking back the keys (which signs their browsers out), both say it.
    assert.equal(page.match(/browsersTapesWords\(name\)/g)?.length, 2);
    assert.match(page, /window\.confirm\(cardOffWords\(name\)\)/);
  });

  test("a request that failed for no reason the page can name says so in words, never a code or the browser's message", () => {
    const trouble = "Couldn't reach the server just now, or it had a problem. Try again in a moment.";
    assert.equal(words.SERVER_TROUBLE, trouble);
    assert.equal(words.requestError(new api.ApiError(500, 'server-error')), trouble);
    assert.equal(words.requestError(new api.ApiError(502)), trouble);
    assert.equal(words.requestError(new TypeError('Failed to fetch')), trouble);
    assert.equal(words.requestError(new TypeError('Load failed')), trouble);
    // The server's own reason, for the page's table (or already in words).
    assert.equal(words.requestError(new api.ApiError(409, 'not-out')), 'not-out');
    assert.equal(words.requestError(new api.ApiError(404, 'Loan not found')), 'Loan not found');
    // Every action and every page load in the back office goes through it (ui.jsx).
    assert.equal(fs.readFileSync(new URL('ui.jsx', ADMIN), 'utf8').match(/requestError\(err\)/g)?.length, 2);
  });

  test("Settings: what signing everyone out does to the tapes that are out (question 5)", () => {
    const browser = loanOf({ borrower: BROWSER, film: { id: 8, title: 'Nosferatu' } });
    assert.equal(
      words.signOutEveryoneWords([loanOf(), browser]),
      "Sign out every friend and member? They'll need to open their link or sign in again. Nosferatu is out to a browser on a link anyone can use, so it goes back to the shop, and that link won't take it out again. A tape out to a member on their own link stays theirs.",
    );
    assert.equal(words.signOutEveryoneWords([]), "Sign out every friend and member? They'll need to open their link or sign in again. A tape out to a member on their own link stays theirs.");
  });
});

// What the back office shows: the words in its JSX and its sentences in quotes, with
// comments, addresses (/api/admin/tickets) and code left out, in every .jsx file and
// in loanWords.js. The word map: ticket → link (what you send) and tape (the film's
// one copy), cinema → video shop, issue (and 1.1.0's "lend") → send a link, revoke →
// cancel the link or take the tape back, publish → put on the shelf, screening →
// play, Projection booth → Status, Activity → Ledger. Routes, API fields and event
// kinds keep their names (they aren't shown).
describe("the back office's words are the video shop's", { skip }, () => {
  const OLD = /\b(tickets?|cinemas?|screenings?|screened|issued?|issuing|revoked?|revoking|unpublish(?:ed)?|publish(?:ed)?|projection booth|draft|lend|lending)\b/i;
  // Version 2 (slice 9): 1.x's clocks and play limits went, and what you send is a link.
  // "Tape" stays for the film's copy ("Take the tape back", "Tapes out"); these are the
  // ways 1.1.0 used it for a link, and its clocks.
  const RETIRED = [
    /lend a tape/i,
    /tapes? ready/i,
    /how many tapes/i,
    /tapes lent/i,
    /active tapes/i,
    /days after the first play/i,
    /give back/i,
    /unnamed tape/i,
    /tapes? for anyone/i,
    /tapes? only for/i,
    /tape link/i,
    /restore the tape/i,
    /holding this tape/i,
    /this tape's activity/i,
    /come back to it until/i,
    /can come back until/i,
    /plays? left/i,
    /\bno limit\b/i,
    /tapes keep working/i,
    // A note on a link is on the link (the review of slices 7 to 9).
    /\bon (their|the|\w+'s) tape\b/i,
  ];
  const files = () => fs.readdirSync(ADMIN).filter((f) => f.endsWith('.jsx') || f === 'loanWords.js');

  test('no screen of the back office says ticket, cinema, issue, lend, revoke, publish, screening or projection booth', () => {
    assert.ok(files().length >= 16, files().join(' '));
    const found = [];
    for (const file of files()) {
      for (const text of shown(fs.readFileSync(new URL(file, ADMIN), 'utf8'))) if (OLD.test(text)) found.push(`${file}: ${text}`);
    }
    assert.deepEqual(found, []);
  });

  test("no screen says 1.x's clocks and play limits, or calls a link a tape", () => {
    const found = [];
    for (const file of files()) {
      for (const text of shown(fs.readFileSync(new URL(file, ADMIN), 'utf8'))) for (const re of RETIRED) if (re.test(text)) found.push(`${file}: ${text}`);
    }
    assert.deepEqual(found, []);
  });

  // Each new screen's words in its own file, at the start of an element's text: a word
  // that is on several screens (Sent, Picked for you) changed on one of them is caught.
  // (Slice 9 only asked whether each phrase was anywhere in the back office.)
  const SAYS = {
    'Tickets.jsx': ['Send a link for', 'Out now', 'Links sent', 'Sent', 'Last activity', 'Due back after', 'How many links', 'Picked for you'],
    'TicketDetail.jsx': ['This link has the tape', 'Cancel the link', 'Restore the link', 'Who can use it', 'Take the note away', 'Picked for you', 'Due back after (days)', 'Sent', 'Took the tape'],
    'Loans.jsx': ['The tape', 'Take the tape back', 'Who has it', 'Due back'],
    'FilmDetail.jsx': ['Send a link', 'Links sent for it', "How it's been lent", 'Responses'],
    'Responses.jsx': ['Mark as read', 'Delete', 'Not read yet', 'No responses yet.'],
    'AdminApp.jsx': ['Responses'],
    'People.jsx': ['Tapes out'],
    'Settings.jsx': ['Links keep working', 'Due back after, for new links (days)'],
  };
  const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  test('the new screens say what the plan has them say, each on its own screen (question 11)', () => {
    // "N links ready." is written with the count: "${plural(n, 'link')} ready.".
    assert.match(fs.readFileSync(new URL('Tickets.jsx', ADMIN), 'utf8'), /plural\(issued\.tickets\.length, 'link'\)\} ready\./);
    const missing = [];
    for (const [file, phrases] of Object.entries(SAYS)) {
      const src = withoutComments(fs.readFileSync(new URL(file, ADMIN), 'utf8'));
      for (const phrase of phrases) if (!new RegExp(`>\\s*${escape(phrase)}(?![A-Za-z])`).test(src)) missing.push(`${file}: ${phrase}`);
    }
    assert.deepEqual(missing, []);
  });

  // The scan itself: JSX text beside a {…} expression is read, and so are the words in
  // quotes inside it (the review of slices 7 to 9 found both unread).
  test('the word scan reads text beside an expression, and the quotes inside it', () => {
    const src = "<p className=\"x\">While this ticket has 2 plays left{person ? '' : ', and it is issued'}: a tape.</p>";
    const texts = shown(src);
    assert.ok(texts.some((t) => /While this ticket has 2 plays left : a tape\./.test(t)), texts.join(' | '));
    assert.ok(texts.some((t) => t === ', and it is issued'), texts.join(' | '));
    assert.ok(shown('<th>Screened</th>').some((t) => OLD.test(t)));
  });
});
