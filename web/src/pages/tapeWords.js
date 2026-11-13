// What the friend's pages say about a tape, apart from React: the lines on the film
// page's counter, the receipt (the till slip's lines), the end of the film, the owner's
// preview, the front page's sections and the lines under a sleeve, the notices a link
// brings back to the front page, the sign-out questions and the player's reasons for
// stopping. No DOM here, so the tests can load it in Node (test/friend-words.test.js).
//
// A tape is what the server calls a ticket: these read the ticket as /api/me and the
// film page give it (state, tape, loanDays, startBy, dueBack, loan, returned,
// inAccount). Nothing here renames a field.
//
// There is one clock (docs/version-2.md): the time the tape is due back. Play takes
// the tape out, if it is in, for the link's days; from then it is the borrower's until
// it's due back, to watch as often as they like. Anyone else with a link sees "Out on
// loan" and that date, never who has it.
//
// The words (question 11, answer a): what the owner sent is still "a tape" wherever
// that doesn't claim the tape is out; the pages for a tape that is out say "link" for
// the link, and "tape" for the film's one copy.

import { formatDate, formatDateTimeYear, formatDay, formatDayTime, plural } from '../api.js';
import { eNumber } from '../look/wear.js';
import { askHost, hostName, nextDeadline, noTapeYet, shopName, stickerText } from '../look/words.js';

const DAY = 24 * 60 * 60 * 1000;
const NBSP = '\u00a0';
// A date and its time kept on one line: a narrow column may break before it, never
// inside it ("Due back" over "Sun 15 Nov, 22:28", never "Sun 15 Nov," over "22:28").
const whole = (text) => text.replace(/ /g, NBSP);

// The host at the start of a sentence: "Arthur", "The Lantern Room", "The shop".
export const Host = (site) => {
  const name = hostName(site);
  return name.charAt(0).toUpperCase() + name.slice(1);
};

// The line telling a friend what the owner can see. Settled: reworded only for the new
// nouns, never cut. Question 10, answer (a): the link is opened, the tape is taken out
// and played; the rest word for word, signed in or not.
export function privacyLine(site, signedIn) {
  return `${Host(site)} can see when this link is opened, when the tape is taken out and played, the kind of device (such as “Safari on iPhone”), ${
    signedIn ? "roughly how far playback gets and, because you're signed in, that it was you." : 'and roughly how far playback gets.'
  }`;
}

// The counter's words for the tape's clock, as sentences of one paragraph:
//   in       what Play does, and the date it would be due back if pressed now (with a
//            start-by date, "from then", and the date to start by);
//   yours    when it's due back, and where to pick it up; once watched to the end,
//            that it is still theirs (the page sets the first sentence in bold);
//   anything else: none (goneLine has the words).
// `now` is the moment Play would be pressed.
export function clockLines(ticket, { now = Date.now() } = {}) {
  const t = ticket ?? {};
  if (t.tape === 'in' && t.state === 'ok') {
    const days = plural(t.loanDays ?? 3, 'day');
    if (t.startBy) {
      // With its time: the deadline is the end of a day where the owner is, which may be
      // another day, or another time of day, here.
      return [`Pressing Play takes the tape out: it's yours for ${days} from then, and nobody else can play it until it's back.`, `Start watching by ${formatDayTime(t.startBy)}.`];
    }
    return [
      `Pressing Play takes the tape out. It's yours for ${days}, until ${formatDayTime(now + (t.loanDays ?? 3) * DAY)}, and nobody else can play it until it's back.`,
      'Pause and come back as often as you like, on one device at a time.',
    ];
  }
  if (t.tape === 'yours') {
    const until = formatDayTime(t.dueBack);
    // Its files are broken: nothing plays, but the clock runs and it can be returned.
    if (t.state !== 'ok') return [`It's still yours until ${until}, and you can return it now.`];
    if (t.loan?.finishedAt) {
      return ["You've watched it to the end.", `It's still yours until ${until}, so you can watch it again, or ${t.loan.canRespond ? 'hand it back' : 'return it'} now.`];
    }
    // A tape out to a browser plays in that browser only; a member's, on any of theirs.
    return [`It's yours until ${until}.`, `Pick up where you left off${t.loan?.toBrowser ? '' : ', on this device or another'}.`];
  }
  return [];
}

// For a tape that can't be played here now: { kind, lead, text, more } for a system
// line on the counter, and `more`, a sentence under it or null. Null for a tape that
// can play (state 'ok'). Out on loan is the same for everyone but its borrower: the
// date it's due back, and nothing of who has it or on which link.
export function goneLine(ticket, site) {
  const t = ticket ?? {};
  const ask = askHost(site);
  switch (t.state) {
    case 'ok':
      return null;
    case 'out':
      return { kind: 'info', lead: 'Out on loan.', text: `Due back by ${formatDayTime(t.dueBack)}.`, more: null };
    case 'spent':
      // Only the borrower is told how it came back: returned, or due (every other end).
      if (t.returned?.how === 'returned') {
        return {
          kind: 'done',
          lead: `Returned on ${formatDayTime(t.returned.at)}.`,
          text: "Thank you. It's back in the shop.",
          more: `This link has done its job: it won't take the tape out again. If you'd like to watch it again, ${ask}.`,
        };
      }
      if (t.returned) {
        // With the year: a date that has passed may be last year's.
        return { kind: 'info', lead: 'This tape has gone back to the shop.', text: `It was due back on ${formatDate(t.returned.at)}. If you'd like to see it again, ${ask}.`, more: null };
      }
      return { kind: 'info', lead: 'This link has been used.', text: `The tape it lent is back in the shop. If you'd like to see it, ${ask}.`, more: null };
    case 'expired':
      return { kind: 'info', lead: `This tape needed to be started by ${formatDateTimeYear(t.startBy)}.`, text: `If you'd still like to see it, ${ask}.`, more: null };
    default: {
      // Unavailable: the film's files, not the loan. The tape keeps its date.
      const more =
        t.tape === 'out'
          ? `It's out on loan, due back by ${formatDayTime(t.dueBack)}.`
          : t.tape === 'in'
            ? 'Nothing has been taken out: the tape is still in, and your link still works.'
            : null;
      return { kind: 'warn', lead: "This film isn't available right now.", text: 'Try again later.', more };
    }
  }
}

// The receipt: the till slip printed when Play took the tape (objects.jsx TillSlip),
// line by line, as { text, kind }: the shop, when it was taken out (with the year, as a
// till prints it), a dotted rule, the film and its tape's length, to whom, when it's
// due back, then the small print and thanks. `kind`: 'rule', 'gap' (a line with space
// before it) or 'small'. `name`: the signed-in member's; a tape taken out on a link
// anyone can use is out to this browser, whoever is signed in (question 2). Empty for
// a tape that isn't this browser's.
export function slipLines(ticket, { name = null, film = null, site = null } = {}) {
  const t = ticket ?? {};
  if (t.tape !== 'yours' || !t.loan) return [];
  const e = film ? eNumber(film.runtimeMinutes) : null;
  return [
    { text: shopName(site) },
    { text: whole(formatDateTimeYear(t.loan.takenAt)) },
    { text: '', kind: 'rule' },
    ...(film ? [{ text: [film.title, e].filter(Boolean).join('  ') }] : []),
    { text: `Out to ${t.loan.toBrowser || !name ? 'this browser' : name}` },
    { text: `Due back ${whole(formatDayTime(t.dueBack))}`, kind: 'gap' },
    { text: 'Watch it as often as you like until then.', kind: 'small' },
    { text: 'Done early? Return it from its page.', kind: 'small' },
    { text: 'Thank you', kind: 'gap' },
  ];
}

// Under the slip where it's folded away on the film page, and where it has just printed.
export const SLIP_CAPTIONS = { kept: 'Printed when you pressed Play.', fresh: 'Printed just now, when Play took the tape.' };

// Return it now, asked on the page: the question, and what follows.
export const returnQuestion = (title) => ({ lead: `Return ${title} now?`, text: "It's back in the shop straight away, and this link won't take it out again." });

// What Return it now and Hand it back can be refused with, by the server's code.
export const RETURN_ERRORS = {
  'nothing-to-return': { lead: 'Nothing to return.', text: "The tape isn't out with you any more." },
  'cannot-respond': { lead: "This tape can't be handed back with a note.", text: "Return it without one, or keep it until it's due back." },
};
export const RETURN_FAILED = { lead: "Couldn't return it just now.", text: 'Try again in a moment.' };

// The end of the film, under the STOP strip: it's still theirs, and the three choices.
export function endWords(title, ticket) {
  const t = ticket ?? {};
  return {
    heading: "That's the end.",
    text: `${title} is yours until ${formatDayTime(t.dueBack)}, so you can watch it again.`,
    keep: `Keep it until ${formatDay(t.dueBack)}`,
  };
}

// The owner's preview: who has the tape, since when and until when, as a system line
// ({ lead, text }), and the words under Play. `tape` is access.tape, which only the
// owner's own browser is sent.
export function borrowerName(borrower) {
  if (!borrower) return null;
  if (borrower.kind === 'person') return borrower.person.name;
  return 'a browser';
}
export function previewLine(tape) {
  if (!tape?.out) return { lead: 'In the shop.', text: 'Nobody has the tape out.' };
  const b = tape.borrower;
  const about = b?.kind === 'browser' ? [b.device, b.signedInAs && `signed in as ${b.signedInAs.name}`].filter(Boolean).join(', ') : '';
  return {
    lead: `Out to ${borrowerName(b) ?? 'someone'}`,
    text: `${about ? `(${about}) ` : ''}since ${formatDayTime(tape.takenAt)}, due back ${formatDayTime(tape.dueAt)}. Only you see who has it: friends see “Out on loan”.`,
  };
}
export function previewClock(tape) {
  const keeper = tape?.out ? (tape.borrower?.kind === 'person' ? tape.borrower.person.name : 'that browser') : null;
  return [
    keeper ? `Your own previews never take the tape, so ${keeper} keeps it.` : 'Your own previews never take the tape.',
    'To try a link as a friend would, open it in a private window or another browser: pressing Play there takes the tape out, as it would for a friend.',
  ];
}

// The lines under a tape's sleeve on the front page, for screen readers as much as
// anyone: the sleeve and its sticker are hidden from them, so the date is here in
// words. A note from the host on the link ("Picked for you") is said too; the note
// itself is on the film's page. (Signed in, a tape from a link once said "On this
// device only" here: the front page's sections say it now, "On this device".)
// In and out are said as on the shelf for members below them (memberShelfLines), the
// mock-up's word map: "In the shop", and "Out on loan, back Sun 15 Nov" on one line.
export function shelfLines(ticket, { now = Date.now(), site = null } = {}) {
  const t = ticket ?? {};
  const lines = [];
  const due = stickerText(nextDeadline(t, now));
  // The date and time kept on one line: a narrow column breaks after "Start by".
  const dated = due && `${due.label} ${whole(due.value)}`;
  // Out with someone else: the day it's back is part of the first line.
  const outLine = t.state !== 'unavailable' && t.tape === 'out';
  if (t.state === 'spent') lines.push(t.returned?.how === 'returned' ? 'Returned' : t.returned ? 'Gone back to the shop' : 'Link used');
  else if (t.state === 'expired') lines.push('Not started in time');
  else if (t.state === 'unavailable') lines.push('Not available right now');
  else if (t.tape === 'yours') lines.push('Out with you');
  else if (outLine) lines.push(due ? `Out on loan, back ${whole(due.value)}` : 'Out on loan');
  else lines.push('In the shop');
  // Before Play the date it would be due isn't a deadline: only a start-by is.
  if (dated && !outLine && !(t.tape === 'in' && due.top)) lines.push(dated);
  if (t.pickNote) lines.push(`A note from ${hostName(site)} is with it`);
  return lines;
}

// The front page's sections, from /api/me's tickets (in the server's order: what this
// browser has out first, the soonest due back first, then the rest, newest first):
//   card     out with you on a tape on your card (a member's own link);
//   browser  out to this browser, from a link anyone can use (signed in or not: such a
//            tape is the browser's, question 2);
//   picked   the other tapes on your card, sent to you ("Picked for you");
//   links    the other tapes this browser opened from links.
// Every ticket is in exactly one, in its order.
export function shelfSections(tickets) {
  const s = { card: [], browser: [], picked: [], links: [] };
  for (const x of tickets ?? []) {
    const yours = x.ticket?.tape === 'yours';
    const mine = Boolean(x.ticket?.inAccount);
    s[yours ? (mine ? 'card' : 'browser') : mine ? 'picked' : 'links'].push(x);
  }
  return s;
}

// The headings and the line under each: what a section holds, in the mock-up's words.
// "Out to this browser" leaves out the mock-up's "Sign in to keep them on your
// membership card": a tape that is out never moves to a card (question 2, answer a).
export function sectionWords(site, { signedIn = false } = {}) {
  const host = hostName(site);
  return {
    card: { heading: 'On your card', sub: "What you have out, and when it's due back." },
    browser: { heading: 'Out to this browser', sub: 'Tapes you took out from a link, here.' },
    picked: { heading: 'Picked for you', sub: `Tapes ${host} has sent you.` },
    // Signed out, every tape here came from a link: they are simply this browser's.
    // ("On your card" is the section for what you have out, question 11's table: a
    // sub-line saying these "aren't on your card" used it in 1.1.0's sense, kept.)
    links: signedIn
      ? { heading: 'On this device', sub: 'Tapes you opened from a link in this browser.' }
      : { heading: 'Your tapes', sub: null },
    members: { heading: 'On the shelf for members', sub: `Films ${host} shows to members. You can read about them, but you need a tape to play one.` },
  };
}

// A film on the shelf for members, which this browser holds no tape for (question 7):
// in the shop, or out on loan and the day it's back, never who has it. Then whom to ask.
export function memberShelfLines(film, site, { now = Date.now() } = {}) {
  const back = film?.tape === 'out' ? stickerText(nextDeadline({ tape: 'out', dueBack: film.dueBack }, now)) : null;
  return [back ? `Out on loan, back ${whole(back.value)}` : 'In the shop', noTapeYet(site)];
}

// What a tape's link can bring someone back to the front page with (TicketOpen.jsx's
// ?notice=), as { kind, lead, text }, and nothing else: a link's ?notice= could name
// anything, __proto__ included. A cancelled link (`ticket-revoked`) says the link was
// cancelled, which is true whether it was cancelled before it lent or by taking its tape
// back: opening a cancelled link answers the same in both cases (a member's link
// answers anyone who has a copy, question 17), so the page can't tell the two apart,
// and "has taken that tape back" would claim a tape was out that may never have been.
export function noticeFor(key, site) {
  const ask = askHost(site);
  const notices = {
    'unknown-ticket': { kind: 'bad', lead: "That link doesn't work.", text: `Check that you copied all of it, or ${ask}.` },
    'ticket-revoked': { kind: 'info', lead: `${Host(site)} has cancelled that link.`, text: `If that's a surprise, ${ask}.` },
    // A link that has lent, opened in a browser that doesn't hold it.
    'ticket-spent': { kind: 'info', lead: 'That link has been used.', text: `The tape it lent is back in the shop. If you'd like to watch it again, ${ask}.` },
    'ticket-kept': { kind: 'info', lead: "That tape has been kept on someone's membership card.", text: `It only works for them now. Ask ${hostName(site)}.` },
    'film-unavailable': { kind: 'info', lead: "That film isn't available at the moment.", text: null },
    'too-many-requests': { kind: 'warn', lead: 'Too many attempts from this connection.', text: 'Wait a few minutes, then open the link again.' },
  };
  return typeof key === 'string' && Object.hasOwn(notices, key) ? notices[key] : null;
}

// "A", "A and B", "A, B and C".
const listOf = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? ''));

// Signing out of this browser, asked first when it does more than sign out: a tape out
// to this browser from a link goes back to the shop and its link is spent (question 5,
// from /api/me's browserLoans), and the other tapes it opened from links are forgotten,
// though their links still work (linkTickets). Null when there is nothing to say.
// `everywhere`: Sign out everywhere, which signs out the member's other browsers too,
// and is always asked.
export function signOutWords(me, { everywhere = false } = {}) {
  const loans = [...new Set(me?.browserLoans ?? [])];
  const links = [...new Set(me?.linkTickets ?? [])].filter((t) => !loans.includes(t));
  const parts = [];
  if (loans.length) {
    const one = loans.length === 1;
    parts.push(
      `${listOf(loans)} ${one ? 'is' : 'are'} out to this browser, so ${one ? 'it goes' : 'they go'} back to the shop, and ${one ? 'the link that took it out' : 'the links that took them out'} won't take ${one ? 'it' : 'them'} out again.`,
    );
  }
  if (everywhere) {
    return [
      'Every browser signed in as you is signed out, this one included, and playback stops on them. Your passkeys still work.',
      ...parts,
      'A tape taken out from a link on another of them goes back to the shop too.',
      ...(links.length ? ['This browser also forgets the tapes you opened from links here; the links still work.'] : []),
    ].join(' ');
  }
  if (links.length) {
    parts.push(
      links.length === 1
        ? `Signing out also forgets 1 tape you opened from a link here (${links[0]}). The link still works if you open it again.`
        : `Signing out also forgets ${links.length} tapes you opened from links here (${links.join(', ')}). The links still work if you open them again.`,
    );
  }
  return parts.length ? ['Sign out of this browser?', ...parts].join(' ') : null;
}

// Opening a link that couldn't reach the shop: opening never takes the tape, so trying
// again costs nothing.
export const UNREACHABLE = { lead: "Couldn't reach the shop just now.", text: 'Check your connection, then try again. Opening a link never takes the tape.' };

// ------------------------------------------------------------ the pages' own lines
// What the film page, Hand it back and the front page say in their JSX, kept here so
// test/friend-words.test.js pins them as it pins the rest.

// Right after Play took the tape, where the clock line would be (the mock-up's PLAY
// moment), until the first pause.
export const TAKEN_OUT = { lead: 'Taken out.', text: "It's yours until it's due back, and nobody else can play it until then. Watch it as often as you like." };

// No such film here: none, off the shelf, or no tape for it in this browser. A tape
// taken back looks the same (question 6); `takenBack`: the player on this page was
// stopped by it, and the page says who took it, as the player did.
export function nothingHereWords(site, { takenBack = false } = {}) {
  return {
    heading: 'Nothing on the shelf here',
    takenBack: takenBack ? `${Host(site)} has taken this tape back.` : null,
    text: 'If someone sent you a tape, open the link they gave you. A tape can also have gone back to the shop.',
  };
}

// The player stopped because this browser was signed out. A tape out to this browser
// from a link anyone can use went back then, and its link is spent (question 5): signing
// in or opening the link again won't bring it back. A member's own tape stays theirs,
// and signing in carries on. `signIn`: whether the page offers Sign in.
export function signedOutWords(site, { toBrowser = false } = {}) {
  const heading = 'This browser has been signed out';
  if (toBrowser) {
    return {
      heading,
      text: `The tape went back to the shop when this browser was signed out, and the link that took it out won't take it out again. If you'd like to watch it again, ${askHost(site)}.`,
      signIn: false,
    };
  }
  return { heading, text: 'Sign in to carry on watching. If you opened the tape from a link, open the link again.', signIn: true };
}

// The front page, signed in, with nothing on it yet.
export const noTapesYet = (site) => ({ lead: 'No tapes yet.', text: `When ${hostName(site)} sends you a tape, it'll be here.` });

// The banner over every page in a browser signed in to the back office as well as a
// card: the owner's previews never take a tape (as the counter's previewClock says).
export const PREVIEW_BANNER = { lead: 'Preview.', text: "You're signed in to the back office here, so Play in this browser never takes a tape." };

// Hand it back (HandBack.jsx): one of four responses required, a message optional, and
// only the owner reads either, which the screen says. The host mid-sentence is
// hostName; at the start of one, Host.
export function handBackWords(site) {
  const host = hostName(site);
  return {
    heading: 'Hand it back',
    lede: `Tell ${host} how it was, and the tape goes back in.`,
    legend: 'How was it?',
    missing: { lead: 'Not handed back yet.', text: "Choose how it was, or press Return it without a note if you'd rather not say." },
    missingField: 'Choose one of these.',
    message: 'Anything to add?',
    only: `Only ${host} sees this. It isn't on the film's page, and nobody else can read it.`,
    returns: "Handing it back returns the tape straight away, and this link won't take it out again.",
    send: 'Hand it back',
    sending: 'Handing it back…',
    without: 'Return it without a note',
    notNow: 'Not now',
  };
}

// Once handed back with a response: what was said, and who reads it.
export function handedBackWords(title, site) {
  return {
    heading: 'Handed back',
    sub: 'Back in the shop',
    lead: `${title} is back in the shop.`,
    text: `Thank you. ${Host(site)} will see what you said in the back office.`,
    said: 'You said',
    note: 'Your note',
    only: `Only ${hostName(site)} sees this.`,
    home: 'Go to your tapes',
    film: 'Back to the film',
  };
}

// The player's reasons for stopping, by the server's code (or the player's own).
export function haltMessages(site) {
  return {
    'playing-elsewhere': 'This tape is now playing on another device.',
    'screening-ended': 'This play has ended.',
    // It was due while the film played, and went back.
    due: 'This tape has gone back to the shop.',
    expired: 'This tape has gone back to the shop.',
    // Returned from another of the borrower's devices while this one played.
    returned: 'This tape has been returned.',
    'taken-back': `${Host(site)} has taken this tape back.`,
    revoked: `${Host(site)} has taken this tape back.`,
    unavailable: "This film isn't available right now.",
    unpublished: "This film isn't available right now.",
    forbidden: 'Playback stopped: this browser is no longer allowed to stream this film.',
    'not-found': 'This tape is no longer valid.',
    'signed-out': 'This browser has been signed out, so the film has stopped.',
    unsupported: "This browser can't play this film. Try a recent version of Safari, Chrome, Edge or Firefox.",
    error: 'Something went wrong during playback.',
  };
}

// Words cut into strips of label tape, `cells` wheels each, at the spaces: a long name
// on "For … only" takes two strips or more. A word longer than a strip is cut.
export function tapeStrips(text, cells) {
  const max = Math.max(4, Math.floor(cells) || 0);
  const out = [];
  let line = '';
  for (let word of String(text).split(/\s+/).filter(Boolean)) {
    while (word.length > max) {
      if (line) {
        out.push(line);
        line = '';
      }
      out.push(word.slice(0, max));
      word = word.slice(max);
    }
    if (!line) line = word;
    else if (`${line} ${word}`.length <= max) line = `${line} ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}
