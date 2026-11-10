// What the friend's pages say about a tape, apart from React: the lines on the film
// page's counter, the lines under a sleeve on the front page, the player's reasons for
// stopping, and how long is left to come back. No DOM here, so the tests can load it in
// Node (test/friend-words.test.js).
//
// A tape is what the server calls a ticket: these read the ticket as /api/me and the
// film page give it (state, startBy, expiresAt, firstPlayedAt, daysAfterFirstPlay,
// openScreening, screeningLimit, screeningsLeft, inAccount). Nothing here renames a field.

import { formatDate, formatDateTimeYear, formatDayTime, plural } from '../api.js';
import { askHost, hostName, nextDeadline, playsLeft, stickerText } from '../look/words.js';

const HOUR = 60 * 60 * 1000;

// The host at the start of a sentence: "Arthur", "The Lantern Room", "The shop".
export const Host = (site) => {
  const name = hostName(site);
  return name.charAt(0).toUpperCase() + name.slice(1);
};

// The line telling a friend what the owner can see. Settled: reworded only for the new
// nouns, never cut.
export function privacyLine(site, signedIn) {
  return `${Host(site)} can see when this tape is opened and played, the kind of device (such as “Safari on iPhone”), ${
    signedIn ? "roughly how far playback gets and, because you're signed in, that it was you." : 'and roughly how far playback gets.'
  }`;
}

// The counter's words for a tape that can play (state 'ok'), in order. `open`: a play
// is open (paused here or elsewhere). Each line keeps the exact time in words, where
// the sticker gives only the day.
export function clockLines(ticket, { windowHours = 48, now = Date.now() } = {}) {
  const t = ticket ?? {};
  const lines = [];
  if (t.openScreening) {
    lines.push(`You can pick up where you left off until ${formatDayTime(t.openScreening.resumableUntil)}, on this device or another.`);
  } else {
    // The tape's own end comes first if it's sooner than the window to come back: what
    // it has left, or once played the days it lasts.
    const tapeLeft = t.expiresAt ? t.expiresAt - now : (t.daysAfterFirstPlay ?? Infinity) * 24 * HOUR;
    lines.push(
      tapeLeft < windowHours * HOUR
        ? "Once you press Play, you can pause and come back to it until it's due back."
        : `Once you press Play, you can pause and come back to it for ${plural(windowHours, 'hour')}.`,
    );
    // With its time: the deadline is the end of a day where the owner is, which may be
    // another day, or another time of day, here.
    if (t.startBy) lines.push(`Start watching by ${formatDayTime(t.startBy)}.`);
    if (t.daysAfterFirstPlay && !t.firstPlayedAt) lines.push(`It's due back ${plural(t.daysAfterFirstPlay, 'day')} after you start.`);
  }
  if (t.expiresAt) lines.push(`It's due back ${formatDayTime(t.expiresAt)}.`);
  return lines;
}

// For a tape that can't play any more, or not now: { kind, lead, text, ask } for a
// system line on the counter, and whether to say whom to ask. Null for a tape that can
// play. The tape's place on the counter is then empty.
export function goneLine(ticket, site) {
  const t = ticket ?? {};
  switch (t.state) {
    case 'used_up':
      return {
        kind: 'info',
        lead: t.screeningLimit === 1 ? "You've used the play on this tape." : `You've used all ${t.screeningLimit} plays on this tape.`,
        text: `If you'd like another, ${askHost(site)}.`,
      };
    case 'expired':
      // With the year: a deadline that has passed may be last year's.
      return t.expiresAt
        ? { kind: 'info', lead: 'This tape has gone back to the shop.', text: `It was due back on ${formatDate(t.expiresAt)}. If you'd like to see it again, ${askHost(site)}.` }
        : { kind: 'info', lead: `This tape needed to be started by ${formatDateTimeYear(t.startBy)}.`, text: `If you'd still like to see it, ${askHost(site)}.` };
    case 'ok':
      return null;
    default:
      return { kind: 'warn', lead: "This film isn't available right now.", text: 'Try again later.' };
  }
}

// The lines under a tape's sleeve on the front page, for screen readers as much as
// anyone: the sleeve and its sticker are hidden from them, so the deadline is here in
// words. `signedIn`: a tape from a link lives in this browser only, which then matters.
export function shelfLines(ticket, { signedIn = false, now = Date.now() } = {}) {
  const t = ticket ?? {};
  const lines = [];
  if (t.state === 'used_up') lines.push('All plays used');
  else if (t.state === 'expired') lines.push(t.expiresAt ? 'Gone back to the shop' : 'Not started in time');
  else if (t.state && t.state !== 'ok') lines.push('Not available right now');
  else {
    const due = stickerText(nextDeadline(t, now));
    lines.push(t.openScreening ? 'Paused' : (playsLeft(t) ?? 'Ready to play'));
    // The date and time kept on one line: a narrow column breaks after "Start by".
    if (due) lines.push(`${due.label} ${due.value.replace(/ /g, '\u00a0')}`);
  }
  if (signedIn && !t.inAccount) lines.push('On this device only');
  return lines;
}

// The player's reasons for stopping, by the server's code (or the player's own).
export function haltMessages(site) {
  return {
    'playing-elsewhere': 'This tape is now playing on another device.',
    'screening-ended': 'This play has ended.',
    expired: 'This tape has gone back to the shop.',
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

// How long is left to come back to a paused play, for the paused strip: "47 h 12 min",
// "35 min", "under a minute". Null once it has passed or with no time to go by.
export function timeLeft(until, now = Date.now()) {
  if (!until) return null;
  const mins = Math.floor((until - now) / 60000);
  if (mins < 0) return null;
  if (mins < 1) return 'under a minute';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
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
