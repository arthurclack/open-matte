// What the back office says about links and loans, apart from React: who has a tape,
// a link's state, how a tape came back, the take-back question, the send form's
// warnings, the Ledger's rows for loans and the Responses page. No DOM here, so the
// tests can load it in Node (test/office.test.js), as facts.js.
//
// The words (docs/version-2.md, question 11, answer a): the back office says "link"
// for what you send and "tape" for the film's one copy. Sending a link ("Send a link",
// "Sent") takes nothing; "Lent" means Play took the tape. "Take the tape back" is only
// for a link that has the tape out; any other link is cancelled ("Cancel the link").
// Only the owner ever reads these: friends see "Out on loan", never who.
//
// They read what the back office's API gives (server/routes/admin.js and access.js
// adminLoans): a loan { film, ticket, borrower, takenAt, dueAt, endedAt, endedHow,
// live, playingNow, position, finished, response, otherLinks }, a link's linkState,
// a film's tape { state, loan }. Nothing here renames a field.

import { ApiError, formatClock, formatDay, formatDayTime, plural } from '../api.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ------------------------------------------------------------ who has it

// The borrower's name for a sentence: a member, or a browser on a link anyone can use.
export function borrowerName(borrower) {
  if (!borrower) return 'someone';
  return borrower.kind === 'person' ? borrower.person.name : 'a browser';
}

// The borrower as a list shows them: the member's name, or "A browser, from a link
// anyone can use", with what is known of that browser on a second line: your note on
// the link, the device, and whom it is signed in as while its session's row exists.
export function borrowerLines(borrower, label = null) {
  if (!borrower) return { who: 'Someone', about: '' };
  if (borrower.kind === 'person') return { who: borrower.person.name, about: borrower.person.disabled ? 'Card turned off' : '' };
  const about = [label && `Your note: ${label}`, borrower.device, borrower.signedInAs && `signed in as ${borrower.signedInAs.name}`].filter(Boolean).join(' · ');
  return { who: 'A browser, from a link anyone can use', about };
}

// "in 3 days", "tomorrow", "today", "in 5 hours": how long until a time, roughly.
export function inTime(ms, now = Date.now()) {
  const left = ms - now;
  if (left <= 0) return 'now';
  if (left < HOUR) return 'within the hour';
  if (left < DAY) return `in ${plural(Math.round(left / HOUR), 'hour')}`;
  const days = Math.round(left / DAY);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

// What the borrower is doing with it now, from the loan's playback.
export function loanNow(loan) {
  if (!loan?.live) return null;
  const at = loan.position ? ` at ${formatClock(loan.position)}` : '';
  if (loan.playingNow) return `Playing now${at}`;
  if (loan.finished) return `Watched to the end, stopped${at}`;
  return loan.position ? `Paused${at}` : 'Taken out, not watched yet';
}

// The Tape column on Films: in, out with whom since when and due back when, or off
// the shelf (with whoever still has it: the clock runs on). { tone, text, sub }.
export function tapeCell(tape) {
  const loan = tape?.loan;
  const out = loan
    ? `Out with ${loan.borrower?.kind === 'person' ? loan.borrower.person.name : 'a browser'} since ${formatDay(loan.takenAt)}, due back ${formatDay(loan.dueAt)}`
    : null;
  const sub = loan?.borrower?.kind === 'browser' ? borrowerLines(loan.borrower, loan.ticket?.label).about : '';
  if (tape?.state === 'off') return { tone: 'off', text: 'Off the shelf', sub: out ? `${out}${sub ? ` · ${sub}` : ''}` : '' };
  if (out) return { tone: 'info', text: out, sub };
  return { tone: 'done', text: 'In', sub: '' };
}

// ------------------------------------------------------------ a link's state

// The state table's back office column (docs/version-2.md, "A link's state"), as a
// word with the layer's block: solid for done, half for out or under way, a dash for
// off, amber for a warning, red for an error.
export const LINK_STATES = {
  unopened: ['off', 'Not opened yet'],
  opened: ['off', 'Opened'],
  waiting: ['info', 'Waiting: the tape is out'],
  has: ['info', 'Has the tape'],
  done: ['off', 'Done: the tape is back in'],
  missed: ['off', 'Start-by missed'],
  cancelled: ['bad', 'Cancelled'],
  off: ['warn', 'Film off the shelf'],
  unavailable: ['bad', 'Film unavailable'],
};

// A link's state: [tone, words]. A link whose tape was taken back is "Taken back",
// not merely cancelled.
export function linkStateWords(t) {
  if (t.linkState === 'cancelled' && t.loan?.endedHow === 'taken-back') return ['bad', 'Taken back'];
  return LINK_STATES[t.linkState] ?? ['off', t.linkState ?? 'Unknown'];
}

// How a tape came back, after "Back in: ".
export function endedWords(loan) {
  switch (loan?.endedHow) {
    case 'returned':
      return loan.response ? 'handed back with a response' : 'returned early';
    case 'due':
      return 'it was due';
    case 'taken-back':
      return 'you took it back';
    case 'signed-out':
      return 'its browser was signed out';
    case 'disabled':
      return 'their card was turned off';
    case 'before-2.0':
      return 'lent before the upgrade to version 2';
    default:
      return 'back in';
  }
}

// The line under a link's state in a list: when its tape is due back, how it came
// back and when, or, for a link that hasn't lent, the day to start by (as it goes by,
// slice 6), standing still while the tape is out with someone else.
export function linkStateNote(t) {
  const loan = t.loan;
  if (t.linkState === 'has' && loan) return `Due back ${formatDayTime(loan.dueAt)}`;
  if (loan && !loan.live && loan.endedAt) return `${endedWords(loan)}, ${formatDayTime(loan.endedAt)}`;
  const startBy = t.effectiveStartBy ?? t.startBy;
  if (!loan && startBy && ['unopened', 'opened', 'waiting'].includes(t.linkState)) return `Start by ${formatDay(startBy)}${t.startByPaused ? ', standing still' : ''}`;
  return '';
}

// "Due back after": the link's own days, or the shop's as it is when Play is pressed.
export const loanDaysWords = (days, shopDays) => (days ? plural(days, 'day') : shopDays ? `${plural(shopDays, 'day')} (the shop's)` : "The shop's");

// A link that hasn't lent: its start-by date, standing still while the tape is out
// with someone else (slice 6). `t` is the back office's link.
export function startByWords(t) {
  if (t.loan) return 'Met: the link has lent';
  const date = t.effectiveStartBy ?? t.startBy;
  if (!date) return 'Not set';
  // Moved by a minute or more: a date given back to the second reads the same.
  const moved = t.startBy && t.effectiveStartBy && formatDayTime(t.effectiveStartBy) !== formatDayTime(t.startBy);
  const parts = [formatDayTime(date)];
  if (t.startByPaused) parts.push('standing still while the tape is out with someone else');
  if (moved) parts.push(`set as ${formatDayTime(t.startBy)}, later by the time the tape was out`);
  return parts.join('; ');
}

// ------------------------------------------------------------ taking the tape back

// The question on the page before a tape is taken back (question 14): what the
// borrower will see, which of the member's other links for the film are cancelled
// with it, and which links anyone can use their browser also holds, which stay.
// `loan` as /api/admin/loans gives it, live; `title` the film's; `host` the name the
// friend's pages use for you (look/words.js hostName); `ticked` the held links you've
// ticked to cancel as well, by id. Returns { lead, lines, cancelled, held, keep } with
// cancelled and held as [{ id, name, state }].
//
// Their page then says "Nothing on the shelf here" (question 6) only when no link anyone
// can use stays in their browser: one that stays is on that page, with Play, and the tape
// is in again at once. The question says which, as the boxes are ticked.
export function takeBackWords(loan, title, host, { ticked = {} } = {}) {
  const b = loan.borrower;
  const person = b?.kind === 'person' ? b.person.name : null;
  const first = person ? person.split(' ')[0] : null;
  const whose = person ? `${first}'s` : "that browser's";
  const name = (o) => o.label || (o.kind === 'person' ? `${first ?? 'Their'}'s link` : 'A link anyone can use');
  const state = (o) => (LINK_STATES[o.linkState]?.[1] ?? o.linkState).toLowerCase();
  const others = loan.otherLinks ?? [];
  const cancelled = others.filter((o) => o.cancelledToo).map((o) => ({ id: o.id, name: name(o), state: state(o) }));
  const held = others.filter((o) => !o.cancelledToo).map((o) => ({ id: o.id, name: name(o), state: state(o) }));
  const staying = held.filter((o) => !ticked[o.id]).length;
  const one = staying === 1;
  const who = first ?? 'that browser';
  const page = staying
    ? `${person ? 'Their' : 'Its'} page for the film then shows ${one ? 'the link anyone can use' : 'the links anyone can use'} that ${person ? 'their browsers also hold' : 'it also holds'}, with Play: ${who} could take the tape out again straight away${one ? '' : ' on one of them'}, unless you tick ${one ? 'it' : 'them'} below.`
    : `${person ? 'Their' : 'Its'} page for the film then says “Nothing on the shelf here”, as for a cancelled link.`;
  const lines = [
    `It's back in straight away, and ${whose} link stops working, as cancelling it would. You can send a new link afterwards.`,
    `${person ? `If ${first} is watching` : "If it's playing in that browser"}, playback stops at the next report, and the player says “${host} has taken this tape back.” ${page}`,
  ];
  if (b?.kind === 'browser' && b.signedInAs) lines.push(`That browser is signed in as ${b.signedInAs.name}, so ${b.signedInAs.name.split(' ')[0]}'s own links for this film that haven't lent are cancelled with it.`);
  return {
    lead: `Take ${title} back from ${person ?? 'that browser'}?`,
    lines,
    cancelled,
    cancelledLead: cancelled.length ? `${plural(cancelled.length, 'other link')} for this film ${cancelled.length === 1 ? 'goes' : 'go'} with it, cancelled too:` : null,
    held,
    heldLead: held.length
      ? `${person ? `${first}'s browsers also hold` : 'That browser also holds'} ${held.length === 1 ? 'a link anyone can use' : `${held.length} links anyone can use`} for this film. ${held.length === 1 ? 'It stays' : 'They stay'}, because other people may hold ${held.length === 1 ? 'it' : 'them'} too, and ${who} could take the tape out on ${held.length === 1 ? 'it' : 'one of them'} straight away. Tick one to cancel it as well:`
      : null,
    take: 'Take it back',
    keep: 'Keep it out',
  };
}

// ------------------------------------------------------------ the send form

// What the send form warns about (proposals: first to press Play gets it, and question
// 9): the film's tape out, other links waiting, and a member's second link. `film` as
// the admin's films give it ({ title, tape, links }); `waiting` the film's links that
// haven't lent and could, as [{ person }]; `personId` the member chosen, if any.
export function sendWarnings(film, { waiting = [], person = null } = {}) {
  const out = [];
  const loan = film?.tape?.loan;
  if (loan && film.tape.state !== 'off') {
    out.push({
      kind: 'warn',
      lead: `${film.title} is out.`,
      text: `${loan.borrower?.kind === 'person' ? loan.borrower.person.name : 'A browser'} has it until ${formatDayTime(loan.dueAt)}. Whoever presses Play first after it's back gets it.`,
    });
  }
  const n = waiting.length;
  if (n) out.push({ kind: 'info', text: `It already has ${plural(n, 'link')} waiting for the tape. Whoever presses Play first on any of them takes it.` });
  if (person && waiting.some((w) => w.person?.id === person.id)) {
    out.push({ kind: 'warn', lead: `${person.name} already has a link for this film.`, text: 'This one waits: it lends only after the first has lent and the tape is back.' });
  }
  return out;
}

// "Picked for you": the hint under the field. On a link anyone can use, whoever has the
// link reads it (settled 10 Nov 2026), so the form says so.
export const pickHint = (person) =>
  person
    ? `Your note to ${person.name} about this film, on their link. It's kept apart from the staff pick, so editing one never changes the other.`
    : "Your note about this film, on the link. Whoever has the link reads it: if it's forwarded, so does whoever it's forwarded to. It's kept apart from the staff pick, so editing one never changes the other.";

// What the form says once the links are made. Sending takes nothing.
export function readyLines(film, { days, startBy = null } = {}) {
  const loan = film?.tape?.loan;
  const lines = [
    loan && film.tape.state !== 'off'
      ? `Sending it doesn't take the tape. It's out until ${formatDayTime(loan.dueAt)}; after that, whoever presses Play first gets it.`
      : "Sending it doesn't take the tape: pressing Play does, if it's in.",
  ];
  const due = days ? `Due back ${plural(days, 'day')} after they press Play.` : '';
  lines.push([startBy ? `Start by ${formatDay(startBy)}.` : '', due].filter(Boolean).join(' '));
  return lines.filter(Boolean);
}

// ------------------------------------------------------------ the ledger

// The Ledger's rows for links and loans (LOAN_EVENTS in server/access.js), and for
// keeping, giving and letting anyone use a link. `till`: the row is printed on a strip
// of till roll (lent, and back in), as the mock-up's ledger has them.
export function loanEventWords(e) {
  const d = e.detail || {};
  switch (e.type) {
    case 'ticket-sent':
      return { text: `You sent a link${d.loanDays ? `, due back ${plural(d.loanDays, 'day')} after Play` : ''}${d.note ? ', with a “Picked for you” note' : ''}` };
    case 'lent':
      return { text: `Lent, due back ${formatDayTime(d.dueAt)}`, till: true };
    case 'returned':
      return { text: `Back in: ${endedWords({ endedHow: d.how, response: d.response })}`, till: true };
    case 'due-changed':
      return { text: `You moved the due-back date from ${formatDayTime(d.from)} to ${formatDayTime(d.to)}` };
    case 'ticket-cancelled':
      return { text: 'You cancelled the link' };
    case 'ticket-restored':
      return { text: 'You restored the link' };
    case 'ticket-kept':
      return { text: 'Kept a link on their card' };
    case 'ticket-given':
      return { text: d.from === 'person' ? "You gave them a link that was someone else's" : 'You gave them a link that was for anyone' };
    case 'ticket-released':
      return { text: d.to === 'person' ? 'You gave their link to someone else' : 'You let anyone with the link use their link again' };
    default:
      return null;
  }
}

// ------------------------------------------------------------ responses

export const RESPONSE_WORDS = { 'loved-it': 'Loved it', 'still-thinking': 'Still thinking about it', 'not-for-me': 'Not for me', 'lets-talk': "Let's talk" };

// How early a tape was handed back: "2 days early", "a day early", "5 hours early".
export function handedBackWhen(at, dueAt) {
  const early = dueAt - at;
  if (!(early > 0)) return '';
  if (early >= 2 * DAY) return `${Math.floor(early / DAY)} days early`;
  if (early >= DAY) return 'a day early';
  if (early >= 2 * HOUR) return `${Math.floor(early / HOUR)} hours early`;
  return 'just before it was due';
}

// The Responses tab's name for a screen reader, and its count.
export const responsesTab = (unread) => (unread ? `Responses, ${unread} unread` : 'Responses');

// ------------------------------------------------------------ Status and Settings

// "3 tapes out. The next due back is Nosferatu, Fri 6 Nov 21:02." `tapes` as the
// booth's attention.tapes gives it.
export function tapesOutLine(tapes) {
  if (!tapes?.out) return { lead: 'No tapes out.', text: "Every film's tape is in." };
  return {
    lead: `${plural(tapes.out, 'tape')} out.`,
    next: tapes.next,
    text: "Tapes come back on their own when they're due.",
  };
}

// The sweeper's last run, in a sentence.
export function sweeperText(sweeper) {
  const run = sweeper?.lastRun;
  if (!run) return 'Not run yet since the server started. It writes down every minute which tapes have come back.';
  return `Checked ${formatDayTime(run.at)}: ${run.closed ? `wrote down ${plural(run.closed, 'tape')} that had come back` : 'nothing had come back unwritten'}. It runs every minute.`;
}

// A member's tapes when their browsers are signed out (Sign out everywhere, and taking
// back their keys): a tape on a link for them stays theirs, and one a browser of theirs
// took out on a link anyone can use goes back, its link spent (question 5).
export const browsersTapesWords = (name) =>
  `A tape out on a link for ${name} stays theirs; one a browser of theirs took out on a link anyone can use goes back to the shop, and that link won't take it out again.`;

// Turning a member's card off (question 5): every tape they have out comes back, the
// one a browser of theirs took out on a link anyone can use as well.
export const cardOffWords = (name) =>
  `Turn ${name}'s card off? ${name} is signed out everywhere and can't sign in, links only for ${name} stop working from the next request, and any tape ${name} has out comes back to the shop at once, including one a browser of theirs took out on a link anyone can use: that link won't take it out again. Other links anyone can use aren't affected. It doesn't remove passkeys: for a lost or stolen device, take back the keys instead (Help ${name} sign in again).`;

// What "Sign out every friend and member" does to the tapes that are out (question 5),
// from the live loans: browsers' tapes go back, members' own stay theirs.
export function signOutEveryoneWords(loans = []) {
  const browsers = loans.filter((l) => l.borrower?.kind === 'browser');
  const titles = [...new Set(browsers.map((l) => l.film.title))];
  const back = browsers.length
    ? ` ${titles.length === 1 ? `${titles[0]} is` : `${plural(browsers.length, 'tape')} (${titles.join(', ')}) are`} out to a browser on a link anyone can use, so ${browsers.length === 1 ? 'it goes' : 'they go'} back to the shop, and ${browsers.length === 1 ? 'that link' : 'those links'} won't take ${browsers.length === 1 ? 'it' : 'them'} out again.`
    : '';
  return `Sign out every friend and member? They'll need to open their link or sign in again.${back} A tape out to a member on their own link stays theirs.`;
}

// ------------------------------------------------------------ a request that failed

// A request that failed for no reason the page can name: the server's own trouble
// (500, `server-error`), an answer with no code (a proxy's page), or no answer at all
// (fetch's own "Failed to fetch" or "Load failed"). The words are the same for each:
// never a code or a browser's message. Any other code is the server's reason, which
// the page's own table puts in words, or which is already words.
export const SERVER_TROUBLE = "Couldn't reach the server just now, or it had a problem. Try again in a moment.";
export const requestError = (err) => (err instanceof ApiError && err.code && err.code !== 'server-error' ? err.message : SERVER_TROUBLE);
