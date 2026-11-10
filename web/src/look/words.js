// The shop's words that depend on its settings or a tape's limits, apart from React:
// who the host is ("Picked by Arthur", "ask Arthur"), and which deadline the orange
// sticker shows. No DOM here, so the tests can load it in Node (test/look.test.js).
//
// A tape is what the server calls a ticket: these read the ticket as /api/me and the
// film page give it (startBy, expiresAt, firstPlayedAt, openScreening,
// screeningLimit, screeningsLeft). Nothing here renames a field.

import { formatDay, formatDayTime, plural } from '../api.js';

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

// The words on the sticker for each kind of deadline.
export const DEADLINE_KEYS = { 'start-by': 'Start by', 'due-back': 'Due back', 'come-back': 'Come back by' };

// Whether a moment is the last minute of a day here (23:59 or later): a date given on
// its own means "by the end of that day", so only such a deadline may drop its time.
export const endOfDay = (ms) => {
  const d = new Date(ms);
  return d.getHours() === 23 && d.getMinutes() === 59;
};

// The one deadline the orange sticker shows, for a tape that can still be played
// (ticket.state 'ok'): the soonest still to come of
//   start-by   before the first play, the date to start by (ticket.startBy, which the
//              server leaves out once it has been played);
//   due-back   when the tape ends: so many days after the first play
//              (ticket.expiresAt);
//   come-back  while a play is paused, the end of the window to resume it
//              (ticket.openScreening.resumableUntil, never later than expiresAt).
// When the window to come back ends as the tape does, it's due back.
// -> { kind, key, at, withTime } or null: null for a tape that has gone (expired, used
// up, taken back, off the shelf, unavailable), which has no deadline to show.
// withTime says whether the sticker gives the time as well as the day:
//   come-back  always ("Come back by Sat 7 Nov 19:40"): it falls at any time of day;
//   start-by   only when it isn't the end of a day here (the back office sets the end
//              of a day where the owner is, which may be another time here);
//   due-back   never, as the approved design has it ("Due back Sun 8 Nov"): the page
//              gives its exact time in words beside it.
export function nextDeadline(ticket, now = Date.now()) {
  if (!ticket || (ticket.state != null && ticket.state !== 'ok')) return null;
  const all = [];
  if (ticket.startBy && !ticket.firstPlayedAt) all.push({ kind: 'start-by', at: ticket.startBy });
  if (ticket.expiresAt) all.push({ kind: 'due-back', at: ticket.expiresAt });
  if (ticket.openScreening?.resumableUntil) all.push({ kind: 'come-back', at: ticket.openScreening.resumableUntil });
  // Soonest first; on a tie, the order above (a stable sort), so due-back beats come-back.
  const next = all.filter((d) => d.at > now).sort((a, b) => a.at - b.at)[0];
  if (!next) return null;
  const withTime = next.kind === 'come-back' || (next.kind === 'start-by' && !endOfDay(next.at));
  return { ...next, key: DEADLINE_KEYS[next.kind], withTime };
}

// What the sticker says for a deadline: { label: 'Due back', value: 'Sun 8 Nov' }, the
// props of <Sticker> (and LabelTape's sticker), in the browser's own way of writing
// dates (api.js). Null for no deadline.
export function stickerText(deadline) {
  if (!deadline) return null;
  return { label: deadline.key, value: deadline.withTime ? formatDayTime(deadline.at) : formatDay(deadline.at) };
}

// "2 plays left", beside Play, for a tape with a number of plays; null for one without.
export function playsLeft(ticket) {
  if (ticket?.screeningLimit == null || ticket.screeningsLeft == null) return null;
  return `${plural(ticket.screeningsLeft, 'play')} left`;
}

// ------------------------------------------------------------ the machine

// The tape counter as the machine shows it: always hours, "0:18:04".
export function tapeCounter(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
