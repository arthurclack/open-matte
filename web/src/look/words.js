// The shop's words that depend on its settings or a tape's loan, apart from React:
// who the host is ("Picked by Arthur", "ask Arthur"), and which deadline the orange
// sticker shows. No DOM here, so the tests can load it in Node (test/look.test.js).
//
// A tape is what the server calls a ticket: these read the ticket as /api/me and the
// film page give it (state, tape, loanDays, startBy, dueBack). Nothing here renames a
// field.

import { formatDay, formatDayTime } from '../api.js';

const DAY = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------ the host

// The shop's name, as a sentence uses it.
export const shopName = (site) => site?.cinemaName?.trim() || 'this video shop';

// Who runs the shop, by name: the owner's own name (Settings, "Your name") or, when
// they haven't given one, the shop's name.
export const hostName = (site) => site?.ownerName?.trim() || site?.cinemaName?.trim() || 'the shop';

// Under the staff pick: "Picked by Arthur".
export const pickedBy = (site) => `Picked by ${hostName(site)}`;

// "ask Arthur", for "No tape yet: ask Arthur" and the like.
export const askHost = (site) => `ask ${hostName(site)}`;

// "No tape yet: ask Arthur", under a film on the shelf for members that this browser
// holds no tape for.
export const noTapeYet = (site) => `No tape yet: ${askHost(site)}`;

// A tape for one member, on black label tape once they're signed in: "For Sam only".
export const forOnly = (name) => `For ${name} only`;

// How big the staff pick is written: null for most, 'long' or 'longer' for one that
// would otherwise tower over the page (objects.css sets the sizes).
export const pickSize = (text) => {
  const n = String(text ?? '').length;
  return n > 520 ? 'longer' : n > 240 ? 'long' : null;
};

// ------------------------------------------------------------ the next deadline

// The words on the sticker for each kind of deadline: the field printed on the label
// roll, before the gun's date. "Back" is for a tape that is out with someone else.
export const DEADLINE_KEYS = { 'start-by': 'Start by', 'due-back': 'Due back', back: 'Back' };

// The line printed first on a two-line sticker, where the date needs a word before it:
// Play takes the tape out (and this is the date it would be due back), or it is out.
export const STICKER_TOPS = { take: 'Play takes it out.', out: 'Out on loan.' };

// Whether a moment is the last minute of a day here (23:59 or later): a date given on
// its own means "by the end of that day", so only such a deadline may drop its time.
export const endOfDay = (ms) => {
  const d = new Date(ms);
  return d.getHours() === 23 && d.getMinutes() === 59;
};

// The one deadline the orange sticker shows. There is one clock: the time the tape is
// due back. By the ticket's tape:
//   in     before Play: the date to start by, if the link has one still to come
//          (ticket.startBy); otherwise the date the tape would be due back if Play
//          were pressed now (now + ticket.loanDays), under "Play takes it out.";
//   yours  the date it is due back (ticket.dueBack);
//   out    out with someone else: the date it is due back, under "Out on loan.",
//          as "Back", never who has it.
// A film whose files are broken keeps its tape's date (yours, out); with the tape in
// there is nothing to play, so no date. Spent, missed or taken back: no sticker.
// -> { kind, key, top, at, withTime } or null. withTime: whether the sticker gives the
// time as well as the day: a start-by only when it isn't the end of a day here (the
// back office sets the end of a day where the owner is, which may be another time
// here, and slice 6 gives back time to the minute); a due date never, as the approved
// design has it ("Due back Sun 8 Nov"): the page gives its exact time in words nearby.
export function nextDeadline(ticket, now = Date.now()) {
  const t = ticket;
  if (!t) return null;
  const at = (kind, ms, top = null) => (ms > now ? { kind, key: DEADLINE_KEYS[kind], top, at: ms, withTime: kind === 'start-by' && !endOfDay(ms) } : null);
  if (t.tape === 'yours') return at('due-back', t.dueBack);
  if (t.tape === 'out') return at('back', t.dueBack, STICKER_TOPS.out);
  if (t.tape === 'in' && t.state === 'ok') {
    if (t.startBy && t.startBy > now) return at('start-by', t.startBy);
    if (t.loanDays) return at('due-back', now + t.loanDays * DAY, STICKER_TOPS.take);
  }
  return null;
}

// What the sticker says for a deadline: { top, label: 'Due back', value: 'Sun 8 Nov' },
// the props of <Sticker> (and LabelTape's sticker), in the browser's own way of writing
// dates (api.js). `top` is null for a one-line sticker. Null for no deadline.
export function stickerText(deadline) {
  if (!deadline) return null;
  return { top: deadline.top ?? null, label: deadline.key, value: deadline.withTime ? formatDayTime(deadline.at) : formatDay(deadline.at) };
}

// ------------------------------------------------------------ the machine

// The tape counter as the machine shows it: always hours, "0:18:04".
export function tapeCounter(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
