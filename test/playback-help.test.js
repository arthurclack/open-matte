// Playback help's summary: milestone 3, slice 3. Written from docs/history/milestone-3.md
// (slice 3), not from the implementation. Copy summary hands a viewer text to
// paste into a message to the cinema, so it must leave out every address (they hold
// screening ids, ticket codes and the film's slug), names and the film's title.
// playbackSummary and scrub are plain functions: no DOM, no React, no hls.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';

// Times are written in the viewer's own time zone. In UTC they read the same as in an
// ISO date, so the tests don't depend on which the summary uses.
process.env.TZ = 'UTC';

// The web app's source isn't in the server's image, where docs/deploying.md runs the
// tests on the server's own Node: there these are skipped, not failed.
const MODULE = new URL('../web/src/playbackHelp.js', import.meta.url);
const present = fs.existsSync(MODULE);
const skip = present ? false : 'web/src is not here (the server image has no web source)';
const { playbackSummary, scrub } = present ? await import(MODULE) : {};

const REMOVED = '[address removed]';

// Addresses the player can meet: the master playlist with its screening id, a
// Media Source object's address, a playlist inlined as data, a ticket's link, a
// ticket's preview poster, a segment, a film's artwork and the cinema's logo.
const MASTER = 'https://www.openmatte.dev/media/x/master.m3u8?s=123';
const BLOB = 'blob:https://www.openmatte.dev/6c1f0d6e-2a4b-4f0e-9a51-3c2b1d0e9f7a';
const DATA = 'data:application/vnd.apple.mpegurl;base64,I0VYVE0zVQo=';
const TICKET = '/t/abcdefghjkmnp';
const POSTER = '/poster/1.xyz';
const SEGMENT = '/media/arrival/hls/v_h264_720/seg_3.m4s';
const ARTWORK = '/artwork/heat/poster-0123456789ab.jpg';
const LOGO = '/branding/logo-0123456789abcdef.png';
// Anything left of any of them.
const LEFTOVERS = [
  /\b(?:https?|blob|data):/i,
  /openmatte\.dev/,
  /\/(?:media|artwork|t|poster|branding)\//,
  /master\.m3u8/,
  /s=123/,
  /abcdefghjkmnp/,
  /1\.xyz/,
  /6c1f0d6e/,
  /base64|I0VYVE0zVQ/,
  /seg_3|poster-0123456789ab|logo-0123456789abcdef/,
];
function noAddress(text, what = text) {
  for (const re of LEFTOVERS) assert.doesNotMatch(text, re, what);
  // And no other absolute path of two segments.
  assert.doesNotMatch(text, /(?:^|\s)\/[^\s]*\/[^\s]*/m, what);
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const at = (h, m, s) => Date.UTC(2026, 10, 3, h, m, s);

// What the panel hands playbackSummary: a plain object of what it read from the
// <video>, hls.js and the browser. The spec names what goes in it but leaves the field
// names to the panel, so these are the ones web/src/playbackHelp.js documents (and the
// only thing here taken from it).
function info(over = {}) {
  return {
    at: at(21, 6, 0),
    engine: 'hls',
    hlsVersion: '1.6.15',
    rendition: { height: 1080, codec: 'hvc1.1.6.L120.B0', range: 'SDR', bitrate: 6_000_000 },
    quality: 'Auto',
    audio: 'English',
    subtitles: null,
    screen: { hdr: false, pixelRatio: 2, width: 1280, height: 720 },
    buffer: { ahead: 24, readyState: 4 },
    droppedFrames: { dropped: 3, total: 2400 },
    decode: [
      { codec: 'hvc1.1.6.L120.B0', supported: true },
      { codec: 'avc1.64001f', supported: true },
    ],
    nativeHls: '',
    userAgent: UA,
    errors: [],
    ...over,
  };
}

// The summary's lines, without blank ones.
const linesOf = (text) => text.split('\n').filter((l) => l.trim());
// The one line holding `needle`.
function lineWith(text, needle) {
  const found = linesOf(text).filter((l) => l.includes(needle));
  assert.equal(found.length, 1, `one line with ${needle}:\n${text}`);
  return found[0];
}

describe('scrub', { skip }, () => {
  test('text with no address in it comes back unchanged', () => {
    for (const text of [
      '',
      'English',
      'French (forced)',
      'English · 5.1',
      'Deutsch (Hörgeschädigte)',
      'networkError: fragLoadError',
      'MEDIA_ERR_DECODE',
      'playing-elsewhere',
      "switched to hls.js after Safari's player stopped",
      'AC-3 / E-AC-3',
      'and/or',
      '3/2400 frames dropped',
      UA,
    ]) {
      assert.equal(scrub(text), text);
    }
  });

  test('a web address, a blob: or a data: address is removed, query and all, whatever its case', () => {
    assert.equal(scrub(MASTER), REMOVED);
    assert.equal(scrub(BLOB), REMOVED);
    assert.equal(scrub(DATA), REMOVED);
    assert.equal(scrub('http://localhost:3000/media/arrival/hls/master.m3u8'), REMOVED);
    assert.equal(scrub('HTTPS://WWW.OPENMATTE.DEV/MEDIA/X/MASTER.M3U8?S=123'), REMOVED);
    assert.equal(scrub('BLOB:https://www.openmatte.dev/6c1f0d6e'), REMOVED);
    assert.equal(scrub('Data:text/vtt;base64,V0VCVlRU'), REMOVED);
  });

  test('an absolute path of two or more segments is removed: a ticket, a poster, a segment, artwork, the logo', () => {
    for (const p of [TICKET, POSTER, SEGMENT, ARTWORK, LOGO, '/media/x/master.m3u8?s=123']) assert.equal(scrub(p), REMOVED, p);
  });

  test('only the address goes: the words around it stay', () => {
    assert.equal(scrub(`Failed to load ${MASTER} (403)`), `Failed to load ${REMOVED} (403)`);
    assert.equal(scrub(`networkError: fragLoadError ${SEGMENT}`), `networkError: fragLoadError ${REMOVED}`);
    assert.equal(scrub(`see ${TICKET} again`), `see ${REMOVED} again`);
    assert.equal(scrub(`English ${BLOB}`), `English ${REMOVED}`);
  });

  test('every address in the text goes, not only the first', () => {
    assert.equal(scrub(`${MASTER} then ${BLOB} then ${DATA} then ${POSTER}`), `${REMOVED} then ${REMOVED} then ${REMOVED} then ${REMOVED}`);
    // The same address twice, as an error message might repeat it.
    assert.equal(scrub(`${TICKET} ${TICKET}`), `${REMOVED} ${REMOVED}`);
  });
});

describe('playbackSummary', { skip }, () => {
  test('is plain text, a "Label: value" line for each thing, with the player and the browser it ran in', () => {
    const summary = playbackSummary(info());
    assert.equal(typeof summary, 'string');
    assert.doesNotMatch(summary, /<[a-z/]/i, 'no markup');
    assert.doesNotMatch(summary, /undefined|NaN|\[object Object\]/, summary);
    assert.ok(lineWith(summary, UA).endsWith(`: ${UA}`), summary);
    assert.match(lineWith(summary, 'hls.js 1.6.15'), /^[^:\n]+: /);
    assert.match(lineWith(playbackSummary(info({ engine: 'native', hlsVersion: undefined })), "Safari's own"), /^[^:\n]+: /);
  });

  test('a summary full of addresses has none of them, and "[address removed]" in their place', () => {
    const summary = playbackSummary(
      info({
        audio: `English ${MASTER}`,
        subtitles: `French (forced) ${TICKET}`,
        errors: [
          { at: at(21, 4, 5), source: 'hls.js', detail: `networkError: manifestLoadError ${MASTER}`, fatal: false, status: 403 },
          { at: at(21, 4, 6), source: 'hls.js', detail: `networkError: fragLoadError ${SEGMENT}`, fatal: false, status: 404 },
          { at: at(21, 4, 7), source: 'hls.js', detail: `mediaError: bufferAppendError ${DATA}`, fatal: false, status: null },
          { at: at(21, 4, 8), source: 'video', detail: `MEDIA_ERR_SRC_NOT_SUPPORTED: Failed to load ${BLOB}`, fatal: true, status: null },
          { at: at(21, 4, 9), source: 'player', detail: `error ${POSTER} ${ARTWORK} ${LOGO}`, fatal: true, status: null },
          // An address in brackets or quotes is still an address.
          { at: at(21, 4, 10), source: 'video', detail: `MEDIA_ERR_NETWORK (${SEGMENT}) url="${TICKET}" src='${MASTER}'`, fatal: true, status: null },
        ],
      }),
    );
    noAddress(summary, summary);
    assert.match(lineWith(summary, 'English'), /English \[address removed\]/);
    assert.match(lineWith(summary, 'French (forced)'), /French \(forced\) \[address removed\]/);
    assert.ok(summary.includes(`networkError: manifestLoadError ${REMOVED}`), summary);
    assert.ok(summary.includes(`networkError: fragLoadError ${REMOVED}`), summary);
    assert.ok(summary.includes(`mediaError: bufferAppendError ${REMOVED}`), summary);
    assert.ok(summary.includes(`MEDIA_ERR_SRC_NOT_SUPPORTED: Failed to load ${REMOVED}`), summary);
    assert.ok(summary.includes(`error ${REMOVED} ${REMOVED} ${REMOVED}`), summary);
    assert.match(lineWith(summary, 'MEDIA_ERR_NETWORK'), /MEDIA_ERR_NETWORK .*\[address removed\]/);
  });

  test('labels with no address in them are kept as they are', () => {
    const summary = playbackSummary(info({ audio: 'English', subtitles: 'French (forced)' }));
    assert.match(lineWith(summary, 'English'), /^[^:\n]+: .*English/);
    assert.match(lineWith(summary, 'French (forced)'), /^[^:\n]+: .*French \(forced\)/);
    assert.ok(!summary.includes(REMOVED), summary);
    // No subtitles chosen: Off.
    assert.match(playbackSummary(info({ subtitles: null })), /^Subtitles: Off$/m);
    // Another language, accents and all.
    assert.ok(playbackSummary(info({ audio: 'Français · 5.1' })).includes('Français · 5.1'));
  });

  test('each error is a line at the end, oldest first, with its time, source, detail, whether it was fatal, and its status', () => {
    const errors = [
      { at: at(21, 4, 5), source: 'hls.js', detail: 'networkError: fragLoadError', fatal: false, status: 404 },
      { at: at(21, 4, 39), source: 'video', detail: 'MEDIA_ERR_DECODE', fatal: true, status: null },
      { at: at(21, 5, 30), source: 'player', detail: "switched to hls.js after Safari's player stopped", fatal: false, status: null },
      { at: at(21, 5, 58), source: 'hls.js', detail: 'networkError: levelLoadError', fatal: true, status: 503 },
      { at: at(21, 6, 0), source: 'player', detail: 'forbidden', fatal: true, status: 403 },
    ];
    const summary = playbackSummary(info({ errors }));
    const lines = linesOf(summary);
    const errorLines = lines.slice(-errors.length);
    errors.forEach((e, i) => {
      const line = errorLines[i];
      const time = new Date(e.at).toISOString().slice(11, 19);
      assert.ok(line.includes(time), `${time}: ${line}`);
      assert.ok(line.includes(e.source), `${e.source}: ${line}`);
      assert.ok(line.includes(e.detail), `${e.detail}: ${line}`);
      if (e.status !== null) assert.match(line, new RegExp(`\\b${e.status}\\b`), line);
      if (e.fatal) assert.match(line, /fatal/i, line);
      else assert.ok(!/fatal/i.test(line) || /(?:not|non)[ -]fatal|fatal:? (?:no|false)/i.test(line), `not fatal: ${line}`);
    });
    // Nothing of the errors comes before them.
    for (const line of lines.slice(0, -errors.length)) {
      for (const e of errors) assert.ok(!line.includes(e.detail), `${e.detail} before the errors: ${line}`);
    }
  });

  test('with no errors, the summary says None, at the end', () => {
    const summary = playbackSummary(info({ errors: [] }));
    const lines = linesOf(summary);
    assert.match(lines.at(-1), /\bNone\b/, summary);
    assert.equal(lines.filter((l) => /\bNone\b/.test(l)).length, 1, summary);
  });

  test("it writes what it was given about playback and nothing else: a title, a cinema's name or a screening's address passed by mistake stay out", () => {
    const summary = playbackSummary(
      info({
        title: 'Arrival',
        filmTitle: 'Arrival',
        slug: 'arrival',
        cinemaName: 'The Rex',
        screeningId: 'f3c1e2d4b5a6',
        masterUrl: MASTER,
        ticketLabel: 'For Jo',
        name: 'Jo Bloggs',
        cookie: 'om_session=abcdef0123456789',
      }),
    );
    for (const word of ['Arrival', 'arrival', 'The Rex', 'f3c1e2d4b5a6', 'For Jo', 'Jo Bloggs', 'om_session', 'abcdef0123456789']) {
      assert.ok(!summary.includes(word), `${word}:\n${summary}`);
    }
    noAddress(summary, summary);
  });
});
