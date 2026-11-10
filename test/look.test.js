// The video shop's look, the parts without a browser (web/src/look): the words that
// depend on the settings and a tape's limits (words.js), the printed things' seeded
// unevenness (wear.js), and lines in whole device pixels (devicePixels.js). See
// web/src/look/README.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';

// The web app's source isn't in the server's image, where docs/deploying.md runs the
// tests on the server's own Node: there these are skipped, not failed.
const LOOK = new URL('../web/src/look/', import.meta.url);
const present = fs.existsSync(new URL('words.js', LOOK));
const skip = present ? false : 'web/src is not here (the server image has no web source)';
const load = async (file) => (present ? import(new URL(file, LOOK)) : {});
const words = await load('words.js');
const wear = await load('wear.js');
const pixels = await load('devicePixels.js');
const api = present ? await import(new URL('../web/src/api.js', import.meta.url)) : {};

const HOUR = 3600_000;
const DAY = 24 * HOUR;
// Thu 5 Nov 2026, 19:40 where the tests run: dates are made in the local time zone,
// as a browser has them.
const NOW = new Date(2026, 10, 5, 19, 40).getTime();
// The end of a day as the back office sets a start-by date (admin/ui.jsx dateInputToMs).
const endOf = (y, m, d) => new Date(y, m, d, 23, 59, 59, 999).getTime();

describe('the host', { skip }, () => {
  test("is the owner's own name when they gave one, else the shop's, else the shop", () => {
    assert.equal(words.hostName({ cinemaName: 'The Lantern Room', ownerName: 'Arthur' }), 'Arthur');
    assert.equal(words.hostName({ cinemaName: 'The Lantern Room', ownerName: '  Arthur ' }), 'Arthur');
    assert.equal(words.hostName({ cinemaName: 'The Lantern Room', ownerName: '' }), 'The Lantern Room');
    assert.equal(words.hostName({ cinemaName: 'The Lantern Room', ownerName: '   ' }), 'The Lantern Room');
    assert.equal(words.hostName({ cinemaName: 'The Lantern Room' }), 'The Lantern Room', 'a server from before the setting');
    assert.equal(words.hostName(null), 'the shop', 'before the page knows the shop');
  });

  test('signs the staff pick and says whom to ask', () => {
    const site = { cinemaName: 'The Lantern Room', ownerName: 'Arthur' };
    assert.equal(words.pickedBy(site), 'Picked by Arthur');
    assert.equal(words.askHost(site), 'ask Arthur');
    assert.equal(words.noTapeYet(site), 'No tape yet: ask Arthur');
    assert.equal(words.pickedBy({ cinemaName: 'The Lantern Room', ownerName: '' }), 'Picked by The Lantern Room');
    assert.equal(words.noTapeYet({ cinemaName: 'The Lantern Room' }), 'No tape yet: ask The Lantern Room');
  });

  test("the shop's name in a sentence, and a tape for one member", () => {
    assert.equal(words.shopName({ cinemaName: ' The Lantern Room ' }), 'The Lantern Room');
    assert.equal(words.shopName({}), 'this video shop');
    assert.equal(words.forOnly('Sam'), 'For Sam only');
  });

  test('a long staff pick is written smaller, a usual one as it is', () => {
    assert.equal(words.pickSize('Watch it with the sound up.'), null);
    assert.equal(words.pickSize(''), null);
    assert.equal(words.pickSize(null), null);
    assert.equal(words.pickSize('a'.repeat(240)), null);
    assert.equal(words.pickSize('a'.repeat(241)), 'long');
    assert.equal(words.pickSize('a'.repeat(520)), 'long');
    assert.equal(words.pickSize('a'.repeat(521)), 'longer');
  });
});

describe('the sticker: the next deadline, and only that', { skip }, () => {
  const ok = (fields) => ({ state: 'ok', screeningLimit: null, screeningsLeft: null, startBy: null, expiresAt: null, firstPlayedAt: null, openScreening: null, ...fields });

  test('none for a tape with no limits in time', () => {
    assert.equal(words.nextDeadline(ok({}), NOW), null);
    assert.equal(words.nextDeadline(null, NOW), null);
    assert.equal(words.stickerText(null), null);
  });

  test('before the first play: the date to start by', () => {
    const startBy = endOf(2026, 10, 6);
    const d = words.nextDeadline(ok({ startBy }), NOW);
    assert.deepEqual(d, { kind: 'start-by', at: startBy, key: 'Start by', withTime: false });
    assert.deepEqual(words.stickerText(d), { label: 'Start by', value: api.formatDay(startBy) });
  });

  test("a start-by that isn't the end of a day here gives its time too", () => {
    // The owner's end of a day, in a time zone hours away.
    const startBy = new Date(2026, 10, 7, 5, 59, 59, 999).getTime();
    const d = words.nextDeadline(ok({ startBy }), NOW);
    assert.equal(d.withTime, true);
    assert.deepEqual(words.stickerText(d), { label: 'Start by', value: api.formatDayTime(startBy) });
    assert.equal(words.endOfDay(endOf(2026, 10, 6)), true);
    assert.equal(words.endOfDay(new Date(2026, 10, 6, 23, 59).getTime()), true);
    assert.equal(words.endOfDay(new Date(2026, 10, 6, 23, 58, 59).getTime()), false);
  });

  test('after the first play: when it is due back, as a day', () => {
    const expiresAt = NOW + 3 * DAY;
    const d = words.nextDeadline(ok({ firstPlayedAt: NOW, expiresAt }), NOW + HOUR);
    assert.deepEqual(d, { kind: 'due-back', at: expiresAt, key: 'Due back', withTime: false });
    assert.deepEqual(words.stickerText(d), { label: 'Due back', value: api.formatDay(expiresAt) });
  });

  test('once played, a start-by date no longer counts, even if the server sent one', () => {
    const d = words.nextDeadline(ok({ firstPlayedAt: NOW - HOUR, startBy: NOW + HOUR, expiresAt: NOW + 3 * DAY }), NOW);
    assert.equal(d.kind, 'due-back');
  });

  test('while paused: the time to come back by, when that is sooner', () => {
    const resumableUntil = NOW + 48 * HOUR;
    const d = words.nextDeadline(ok({ firstPlayedAt: NOW, expiresAt: NOW + 3 * DAY, openScreening: { resumableUntil, position: 18 } }), NOW + HOUR);
    assert.deepEqual(d, { kind: 'come-back', at: resumableUntil, key: 'Come back by', withTime: true });
    assert.deepEqual(words.stickerText(d), { label: 'Come back by', value: api.formatDayTime(resumableUntil) });
    // With no days after the first play, the window is the only deadline.
    assert.equal(words.nextDeadline(ok({ firstPlayedAt: NOW, openScreening: { resumableUntil, position: 18 } }), NOW).kind, 'come-back');
  });

  test('when the window to come back ends as the tape does, it is due back', () => {
    const expiresAt = NOW + DAY;
    // The server caps the window at the tape's end (server/films.js ticketForViewer).
    const d = words.nextDeadline(ok({ firstPlayedAt: NOW - 2 * DAY, expiresAt, openScreening: { resumableUntil: expiresAt, position: 18 } }), NOW);
    assert.equal(d.kind, 'due-back');
  });

  test('a deadline that has passed is never shown', () => {
    assert.equal(words.nextDeadline(ok({ startBy: NOW - 1 }), NOW), null);
    const d = words.nextDeadline(ok({ firstPlayedAt: NOW - 3 * DAY, expiresAt: NOW + DAY, openScreening: { resumableUntil: NOW - 1, position: 18 } }), NOW);
    assert.equal(d.kind, 'due-back');
  });

  test('a tape that has gone has no sticker: expired, used up, taken back, off the shelf, unavailable', () => {
    for (const state of ['expired', 'used_up', 'revoked', 'unpublished', 'unavailable']) {
      assert.equal(words.nextDeadline({ ...ok({ startBy: NOW + DAY, expiresAt: NOW + 2 * DAY }), state }, NOW), null, state);
    }
  });

  test('the words for each kind', () => {
    assert.deepEqual(words.DEADLINE_KEYS, { 'start-by': 'Start by', 'due-back': 'Due back', 'come-back': 'Come back by' });
  });
});

describe('beside Play, and on the machine', { skip }, () => {
  test('plays left, for a tape with a number of plays', () => {
    assert.equal(words.playsLeft({ screeningLimit: null, screeningsLeft: null }), null);
    assert.equal(words.playsLeft(null), null);
    assert.equal(words.playsLeft({ screeningLimit: 3, screeningsLeft: 2 }), '2 plays left');
    assert.equal(words.playsLeft({ screeningLimit: 3, screeningsLeft: 1 }), '1 play left');
    assert.equal(words.playsLeft({ screeningLimit: 1, screeningsLeft: 0 }), '0 plays left');
  });

  test('the tape counter always shows hours', () => {
    assert.equal(words.tapeCounter(0), '0:00:00');
    assert.equal(words.tapeCounter(18 * 60 + 4), '0:18:04');
    assert.equal(words.tapeCounter(3725.9), '1:02:05');
    assert.equal(words.tapeCounter(-5), '0:00:00');
    assert.equal(words.tapeCounter(Number.NaN), '0:00:00');
    assert.equal(words.tapeCounter(undefined), '0:00:00');
  });
});

describe('printed things: seeded, so the same every time', { skip }, () => {
  test('each kind of thing leans within its own range, the same way for the same seed', () => {
    for (const [kind, { tilt }] of Object.entries(wear.KINDS)) {
      for (const seed of ['sleeve:test-pattern', 'pick:nosferatu', 'sticker:42', 'tape:x:0']) {
        const a = wear.objectWear(seed, wear.KINDS[kind]);
        assert.deepEqual(a, wear.objectWear(seed, wear.KINDS[kind]), `${kind} ${seed}`);
        assert.ok(a.rot >= tilt[0] && a.rot <= tilt[1], `${kind} ${seed}: ${a.rot}`);
        assert.ok([0, 1, 2].includes(a.filter));
        assert.match(a.clip, /^polygon\(/);
      }
    }
    // The sticker always leans the same way (the same gun, the same hand).
    assert.ok(wear.KINDS.sticker.tilt.every((t) => t < 0));
  });

  test('two seeds print differently', () => {
    assert.notDeepEqual(wear.objectWear('sleeve:a', wear.KINDS.sleeve), wear.objectWear('sleeve:b', wear.KINDS.sleeve));
  });

  test("the price gun's wheels: one per character, wide letters narrower, spaces kept", () => {
    const w = wear.gunWheels('Sun 8 Nov', 'sticker:1');
    assert.equal(w.length, 9);
    assert.deepEqual(w, wear.gunWheels('Sun 8 Nov', 'sticker:1'));
    assert.equal(w[3].space, true);
    assert.equal(w.find((c) => c.ch === 'N').sx, 0.66);
    for (const c of w.filter((c) => !c.space)) assert.ok(Math.abs(c.y) <= 0.6 && c.o >= 0.95 && c.o <= 1, JSON.stringify(c));
    const shift = wear.stickerShift('sticker:1');
    assert.ok(shift >= -3 && shift <= 2);
  });

  test('label tape: one wheel per letter, cut a little off square', () => {
    const s = wear.embossStrip('Test Pattern', 'tape:1');
    assert.deepEqual(s, wear.embossStrip('Test Pattern', 'tape:1'));
    assert.equal(s.letters.length, 12);
    assert.equal(s.letters.map((l) => l.ch).join(''), 'Test Pattern');
    for (const l of s.letters) assert.ok(l.o >= 0.84 && l.o <= 0.98);
    assert.match(s.clip, /^polygon\([\d.]+px 0, calc\(100% - [\d.]+px\) 0, calc\(100% - [\d.]+px\) 100%, [\d.]+px 100%\)$/);
  });

  test("a tape's length, as a PAL tape has it printed", () => {
    assert.equal(wear.eNumber(1), 'E-30');
    assert.equal(wear.eNumber(30), 'E-30');
    assert.equal(wear.eNumber(30.5), 'E-60');
    assert.equal(wear.eNumber(92), 'E-120');
    assert.equal(wear.eNumber(400), 'E-300');
    for (const none of [0, -1, null, undefined, Number.NaN]) assert.equal(wear.eNumber(none), null);
  });

  test("the strips cut for a tape: the title and length, shortened at a word, at most two", () => {
    assert.deepEqual(wear.tapeLines({ title: 'Nosferatu', poster: true, e: 'E-120' }), ['Nosferatu  E-120']);
    assert.deepEqual(wear.tapeLines({ title: 'Test Pattern', poster: true, e: 'E-30' }), ['Test Pattern  E-30']);
    const long = wear.tapeLines({ title: 'Hedwig and the Angry Inch', poster: true, e: 'E-120' });
    assert.equal(long.length, 2);
    assert.equal(long[1], 'E-120');
    assert.ok(long[0].endsWith('…') && long[0].length <= 18, long[0]);
    assert.ok(!/ (and|the)…$/.test(long[0]), `not ending on a small word: ${long[0]}`);
    // A plain sleeve's typed label already has the title.
    assert.deepEqual(wear.tapeLines({ title: 'Hedwig and the Angry Inch', poster: false, e: 'E-120' }), ['E-120']);
    assert.deepEqual(wear.tapeLines({ title: 'Nosferatu', poster: false, e: null }), ['Nosferatu']);
    assert.deepEqual(wear.tapeLines({ title: 'Nosferatu', poster: true, e: null }), ['Nosferatu']);
  });
});

describe('lines in whole device pixels', { skip }, () => {
  test('the raster and the scanlines land on whole device pixels at every zoom, about 3 CSS pixels apart', () => {
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      const { line, pitch, soft } = pixels.pixelPitch(dpr);
      const whole = (n) => Math.abs(n * dpr - Math.round(n * dpr)) < 0.01;
      assert.ok(whole(line) && whole(pitch), `${dpr}: ${line}, ${pitch}`);
      assert.ok(line * dpr >= 1 - 0.01, `${dpr}: at least one device pixel`);
      assert.ok(Math.abs(pitch - 3) <= 0.5 / dpr + 0.01, `${dpr}: ${pitch}`);
      assert.ok(soft > line, `${dpr}: the soft step after the line`);
    }
    assert.deepEqual(pixels.pixelPitch(1), { line: 1, pitch: 3, soft: 1.5 });
    assert.deepEqual(pixels.pixelPitch(2), { line: 1, pitch: 3, soft: 1.25 });
    assert.deepEqual(pixels.pixelPitch(0), pixels.pixelPitch(1));
    assert.deepEqual(pixels.pixelPitch(undefined), pixels.pixelPitch(1));
  });
});

// The page's own custom properties (tokens.css and styles.css on :root, the theme's
// style, the body's device pixels) are inherited by everything. A printed thing's own
// (the membership card's --edge, the sleeve's --w...) are set on its own elements and
// read with a fallback for when they aren't: one of the page's of the same name would
// be read instead. Card margins once moved this way, to the top of the card.
describe("the page's custom properties never take a printed thing's own names", { skip }, () => {
  // Without its comments, which name these properties too.
  const src = (file) => fs.readFileSync(new URL(`../web/src/${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  test('none of the names the card and the printed things read with a fallback is set for the whole page', async () => {
    const own = new Set();
    for (const file of ['membershipCard.css', 'look/objects.css']) {
      for (const [, name] of src(file).matchAll(/var\((--[\w-]+),/g)) own.add(name);
    }
    assert.ok(own.has('--edge') && own.has('--w'), [...own].join(' '));
    const page = new Set();
    for (const file of ['look/tokens.css', 'styles.css', 'look/ui.css']) {
      for (const [, block] of src(file).matchAll(/(?:^|\n)\s*(?::root|\.ui80|html|body)\s*{([^}]*)}/g)) {
        for (const [, name] of block.matchAll(/(--[\w-]+)\s*:/g)) page.add(name);
      }
    }
    const { palette } = await import('../server/theme.js');
    for (const name of Object.keys(palette({ accentColor: '#4fb3d9', backgroundColor: '#0a131c' }))) page.add(name);
    for (const name of ['--ui-raster-line', '--ui-raster-pitch', '--scan-l', '--scan-p', '--scan-s']) page.add(name);
    assert.ok(page.has('--ui-edge') && page.has('--bg'), [...page].join(' '));
    assert.deepEqual([...own].filter((name) => page.has(name)), []);
  });
});
