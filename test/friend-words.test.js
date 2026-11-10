// The friend's pages' words that depend on a tape's state and limits
// (web/src/pages/tapeWords.js): the film page's counter, the front page's lines under
// a sleeve, the player's reasons for stopping, the paused strip's time to come back,
// and a long name cut into strips of label tape. Stage 1 of the video shop: today's
// rules in the new words, nothing about version 2's loans.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';

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
const NBSP = ' ';

describe('the host at the start of a sentence', { skip }, () => {
  test("is the owner's name, else the shop's, else the shop, with a capital", () => {
    assert.equal(w.Host(SITE), 'Arthur');
    assert.equal(w.Host({ cinemaName: 'the lantern room' }), 'The lantern room');
    assert.equal(w.Host(null), 'The shop');
  });

  test('the privacy line keeps every disclosure, in the new nouns', () => {
    assert.equal(
      w.privacyLine(SITE, false),
      'Arthur can see when this tape is opened and played, the kind of device (such as “Safari on iPhone”), and roughly how far playback gets.',
    );
    assert.equal(
      w.privacyLine(SITE, true),
      "Arthur can see when this tape is opened and played, the kind of device (such as “Safari on iPhone”), roughly how far playback gets and, because you're signed in, that it was you.",
    );
  });
});

describe('the counter, for a tape that can play', { skip }, () => {
  test('before the first play: the window to come back, the start-by date with its time, and the days it lasts', () => {
    const startBy = NOW + 3 * DAY;
    const lines = w.clockLines({ state: 'ok', startBy, daysAfterFirstPlay: 4 }, { windowHours: 48, now: NOW });
    assert.deepEqual(lines, [
      'Once you press Play, you can pause and come back to it for 48 hours.',
      `Start watching by ${api.formatDayTime(startBy)}.`,
      "It's due back 4 days after you start.",
    ]);
  });

  test("a tape that lasts less than the window isn't promised the window", () => {
    assert.equal(w.clockLines({ state: 'ok', daysAfterFirstPlay: 1 }, { windowHours: 48, now: NOW })[0], "Once you press Play, you can pause and come back to it until it's due back.");
    const expiresAt = NOW + 10 * HOUR;
    assert.deepEqual(w.clockLines({ state: 'ok', expiresAt, firstPlayedAt: NOW - DAY, daysAfterFirstPlay: 2 }, { windowHours: 48, now: NOW }), [
      "Once you press Play, you can pause and come back to it until it's due back.",
      `It's due back ${api.formatDayTime(expiresAt)}.`,
    ]);
  });

  test('a paused play: when it can be picked up until, and when the tape is due back', () => {
    const resumableUntil = NOW + 47 * HOUR;
    const expiresAt = NOW + 3 * DAY;
    assert.deepEqual(w.clockLines({ state: 'ok', expiresAt, openScreening: { resumableUntil, position: 18 } }, { now: NOW }), [
      `You can pick up where you left off until ${api.formatDayTime(resumableUntil)}, on this device or another.`,
      `It's due back ${api.formatDayTime(expiresAt)}.`,
    ]);
  });

  test('no start-by line once it has been played, and no days line either', () => {
    const lines = w.clockLines({ state: 'ok', daysAfterFirstPlay: 4, firstPlayedAt: NOW - HOUR, expiresAt: NOW + 4 * DAY - HOUR }, { now: NOW });
    assert.ok(!lines.some((l) => /Start watching|after you start/.test(l)), lines.join(' '));
  });
});

describe("the counter, for a tape that can't play", { skip }, () => {
  test('a tape that can play has no such line', () => {
    assert.equal(w.goneLine({ state: 'ok' }, SITE), null);
  });

  test('used up: one play, or all of them, and whom to ask', () => {
    assert.deepEqual(w.goneLine({ state: 'used_up', screeningLimit: 1 }, SITE), { kind: 'info', lead: "You've used the play on this tape.", text: "If you'd like another, ask Arthur." });
    assert.equal(w.goneLine({ state: 'used_up', screeningLimit: 3 }, SITE).lead, "You've used all 3 plays on this tape.");
  });

  test('due back and gone: back to the shop, with the day it was due', () => {
    const expiresAt = NOW - 2 * DAY;
    assert.deepEqual(w.goneLine({ state: 'expired', expiresAt }, SITE), {
      kind: 'info',
      lead: 'This tape has gone back to the shop.',
      text: `It was due back on ${api.formatDate(expiresAt)}. If you'd like to see it again, ask Arthur.`,
    });
  });

  test('a start-by date missed: when, with its year', () => {
    const startBy = new Date(2025, 9, 5, 23, 59).getTime();
    const line = w.goneLine({ state: 'expired', startBy }, SITE);
    assert.equal(line.lead, `This tape needed to be started by ${api.formatDateTimeYear(startBy)}.`);
    assert.match(line.lead, /2025/);
    assert.equal(line.text, "If you'd still like to see it, ask Arthur.");
  });

  test("anything else isn't available right now: a warning", () => {
    assert.deepEqual(w.goneLine({ state: 'unavailable' }, SITE), { kind: 'warn', lead: "This film isn't available right now.", text: 'Try again later.' });
  });
});

describe('the lines under a sleeve on the front page', { skip }, () => {
  test('ready, with plays left or not, and the next deadline in words, its date kept whole', () => {
    const startBy = new Date(2026, 10, 13, 23, 59, 59, 999).getTime();
    assert.deepEqual(w.shelfLines({ state: 'ok', startBy }, { now: NOW }), ['Ready to play', `Start by ${api.formatDay(startBy).replace(/ /g, NBSP)}`]);
    assert.deepEqual(w.shelfLines({ state: 'ok', screeningLimit: 3, screeningsLeft: 2 }), ['2 plays left']);
  });

  test('paused: says so, and when to come back by', () => {
    const resumableUntil = Date.now() + 40 * HOUR;
    const [first, second] = w.shelfLines({ state: 'ok', openScreening: { resumableUntil, position: 18 } });
    assert.equal(first, 'Paused');
    assert.match(second, /^Come back by /);
  });

  test("gone: one plain line each, and never a deadline", () => {
    assert.deepEqual(w.shelfLines({ state: 'used_up' }), ['All plays used']);
    assert.deepEqual(w.shelfLines({ state: 'expired', expiresAt: NOW - DAY }), ['Gone back to the shop']);
    assert.deepEqual(w.shelfLines({ state: 'expired', startBy: NOW - DAY }), ['Not started in time']);
    assert.deepEqual(w.shelfLines({ state: 'unavailable' }), ['Not available right now']);
  });

  test('signed in, a tape from a link says it is on this device only', () => {
    assert.deepEqual(w.shelfLines({ state: 'ok', inAccount: false }, { signedIn: true }), ['Ready to play', 'On this device only']);
    assert.deepEqual(w.shelfLines({ state: 'ok', inAccount: true }, { signedIn: true }), ['Ready to play']);
    assert.deepEqual(w.shelfLines({ state: 'ok', inAccount: false }, { signedIn: false }), ['Ready to play']);
  });
});

describe("the player's reasons for stopping", { skip }, () => {
  test('every code the player knows, in the new words', () => {
    const m = w.haltMessages(SITE);
    assert.equal(m['playing-elsewhere'], 'This tape is now playing on another device.');
    assert.equal(m['screening-ended'], 'This play has ended.');
    assert.equal(m.expired, 'This tape has gone back to the shop.');
    assert.equal(m.revoked, 'Arthur has taken this tape back.');
    assert.equal(m['not-found'], 'This tape is no longer valid.');
    assert.equal(m['signed-out'], 'This browser has been signed out, so the film has stopped.');
    for (const code of ['unavailable', 'unpublished', 'forbidden', 'unsupported', 'error']) assert.ok(m[code], code);
  });

  test('no message says ticket, screening or cinema', () => {
    for (const text of Object.values(w.haltMessages(null))) assert.doesNotMatch(text, /ticket|screening|cinema/i, text);
  });
});

describe('the time left to come back, on the paused strip', { skip }, () => {
  test('hours and minutes, minutes alone, or under a minute', () => {
    assert.equal(w.timeLeft(NOW + 47 * HOUR + 12 * 60_000 + 30_000, NOW), '47 h 12 min');
    assert.equal(w.timeLeft(NOW + 2 * HOUR, NOW), '2 h');
    assert.equal(w.timeLeft(NOW + 35 * 60_000, NOW), '35 min');
    assert.equal(w.timeLeft(NOW + 20_000, NOW), 'under a minute');
  });

  test('nothing once it has passed, or with no time to go by', () => {
    assert.equal(w.timeLeft(NOW - 60_000, NOW), null);
    assert.equal(w.timeLeft(null, NOW), null);
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
