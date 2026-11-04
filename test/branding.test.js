// Branding: milestone 3, slice 1. Written from docs/history/milestone-3.md (the Branding
// decisions and slice 1) and the fixes that followed its review, not from the
// implementation.
// Contrast is worked out here (WCAG 2), not taken from theme.js, so the checks are
// checked rather than repeated. Link previews are fetched the way a messaging app's
// server fetches them: no cookies, no scripts, and nothing it reads is written down.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { softAuthenticator } from './softauth.js';
import { adminBrowser, browser, enroll, makeFilm, newPerson, pngImage, setupLink, startServer, tempDir } from './helpers.js';

const { DEFAULT_ACCENT, DEFAULT_BACKGROUND, check, contrast, faviconSvg, palette } = await import('../server/theme.js');
const { imageInfo } = await import('../server/images.js');
const { createApp } = await import('../server/app.js');

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ====================================================================== colours
const DEFAULTS = { accentColor: '#e8b04a', backgroundColor: '#0d0c0f' };
// web/public/favicon.svg as it is today, final newline and all: a default cinema's
// drawn tab icon, to the byte.
const FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#111014"/><rect x="5" y="9" width="22" height="14" rx="1.5" fill="none" stroke="#e8b04a" stroke-width="2"/><path d="M14 13v6l5-3z" fill="#e8b04a"/></svg>\n';

// A custom pair that passes every check, and what the spec derives from each, worked
// out by hand (channel by channel, rounded; none of them lands on a half).
const ACCENT = '#4fb3d9';
const BACKGROUND = '#101820';
const BG_THEME = {
  // The five surfaces.
  '--bg': '#101820',
  '--bg-raised': '#1a2129',
  '--bg-sunk': '#0b1116',
  '--line': '#2d343b',
  '--line-strong': '#3c4349',
  // The background and the raised surface as r, g, b, for the shades over a backdrop.
  '--bg-rgb': '16, 24, 32',
  '--bg-raised-rgb': '26, 33, 41',
  // Notices' and badges' lines and tints (40% and 7% of each status colour), and the
  // poster placeholder's gradient (9.5% and 2% white).
  '--good-line': '#3c5c4b',
  '--good-tint': '#182427',
  '--warn-line': '#665531',
  '--warn-tint': '#1f2323',
  '--bad-line': '#653e3f',
  '--bad-tint': '#1f1f25',
  '--poster-from': '#272e35',
  '--poster-to': '#151d24',
};
const ACCENT_THEME = { '--accent': '#4fb3d9', '--accent-ink': '#091418', '--accent-hover': '#72c2e1' };
const THEME = { ...BG_THEME, ...ACCENT_THEME };
// The drawn icon's rounded square on BACKGROUND: mixed with 2% white.
const FAVICON_SQUARE = '#151d24';

const NUMBER = String.raw`\d+(?:\.\d+)?`;
const TOO_LIGHT = new RegExp(String.raw`^That background is too light: .+ would be hard to read on it \(${NUMBER}:1; it needs ${NUMBER}:1\)\. Choose a darker colour\.$`);
const TOO_CLOSE = new RegExp(String.raw`^That accent colour is too close to the background to read \(${NUMBER}:1; it needs 4\.5:1\)\.$`);

// WCAG 2 relative luminance and contrast, from sRGB.
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
function luminance(hex) {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const mix = (a, b, t) => toHex(channels(a).map((v, i) => Math.round(v + (channels(b)[i] - v) * t)));
// Equal but for rounding a half the other way.
const close = (a, b) => channels(a).every((v, i) => Math.abs(v - channels(b)[i]) <= 1);
// Too near the line to say which side the implementation's arithmetic puts it.
const borderline = (r, need) => Math.abs(r - need) / need < 0.02;
const raisedOf = (bg) => (bg === DEFAULTS.backgroundColor ? '#17151b' : mix(bg, '#ffffff', 0.04));
function hsl(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return toHex([f(0), f(8), f(4)].map((v) => Math.round(v * 255)));
}
// The status colours, which notices and badges are tinted with.
const STATUS = { good: '#7fc28b', warn: '#e8b04a', bad: '#e5776d' };
// What text and status colours need on the background and the raised surface.
const FOREGROUNDS = [
  ['text', '#ece8e1', 7],
  ['dim text', '#a59f97', 4.5],
  ['faint text', '#6f6a66', 3],
  ['good', '#7fc28b', 4.5],
  ['warn', '#e8b04a', 4.5],
  ['bad', '#e5776d', 4.5],
];

describe('colours', () => {
  test("Open Matte's own colours need no theme, and pass every check", () => {
    assert.equal(DEFAULT_ACCENT, '#e8b04a');
    assert.equal(DEFAULT_BACKGROUND, '#0d0c0f');
    assert.deepEqual(palette(DEFAULTS), {});
    assert.deepEqual(check(DEFAULTS), []);
  });

  test('contrast is the WCAG 2 ratio, whichever way round', () => {
    assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9);
    assert.ok(Math.abs(contrast('#ffffff', '#000000') - 21) < 1e-9);
    assert.ok(Math.abs(contrast('#777777', '#777777') - 1) < 1e-9);
    for (const [a, b] of [[DEFAULTS.accentColor, DEFAULTS.backgroundColor], ['#ece8e1', '#17151b'], ['#6f6a66', '#0d0c0f'], [ACCENT, BACKGROUND]]) {
      assert.ok(Math.abs(contrast(a, b) - ratio(a, b)) < 0.01, `${a} on ${b}: ${contrast(a, b)}, not ${ratio(a, b)}`);
      assert.ok(Math.abs(contrast(b, a) - ratio(a, b)) < 0.01, `${b} on ${a}`);
    }
  });

  test('a custom background derives the five surfaces, two of them as r, g, b, and the tints and stops, and nothing of the accent', () => {
    assert.deepEqual(palette({ accentColor: DEFAULTS.accentColor, backgroundColor: BACKGROUND }), BG_THEME);
    assert.deepEqual(check({ accentColor: DEFAULTS.accentColor, backgroundColor: BACKGROUND }), []);
  });

  test('every custom background tints everything from itself: notices, badges, the poster placeholder and the shades', () => {
    const backgrounds = [BACKGROUND, '#000000', '#ffffff', '#0d0c10', '#202020'];
    for (let h = 0; h < 360; h += 30) for (const l of [0.02, 0.08, 0.14, 0.4]) backgrounds.push(hsl(h, 0.35, l));
    for (const backgroundColor of backgrounds) {
      if (backgroundColor === DEFAULTS.backgroundColor) continue;
      // Whether check() would let it be saved doesn't matter: palette() derives from any background.
      const theme = palette({ accentColor: DEFAULTS.accentColor, backgroundColor });
      const what = `${backgroundColor}: ${JSON.stringify(theme)}`;
      assert.deepEqual(Object.keys(theme).sort(), Object.keys(BG_THEME).sort(), what);
      assert.equal(theme['--bg'], backgroundColor, what);
      assert.ok(close(theme['--bg-raised'], mix(backgroundColor, '#ffffff', 0.04)), what);
      // The r, g, b triples are those two colours, exactly.
      assert.equal(theme['--bg-rgb'], channels(theme['--bg']).join(', '), what);
      assert.equal(theme['--bg-raised-rgb'], channels(theme['--bg-raised']).join(', '), what);
      for (const [status, colour] of Object.entries(STATUS)) {
        assert.ok(close(theme[`--${status}-line`], mix(backgroundColor, colour, 0.4)), `${what}: ${status} line`);
        assert.ok(close(theme[`--${status}-tint`], mix(backgroundColor, colour, 0.07)), `${what}: ${status} tint`);
      }
      assert.ok(close(theme['--poster-from'], mix(backgroundColor, '#ffffff', 0.095)), what);
      assert.ok(close(theme['--poster-to'], mix(backgroundColor, '#ffffff', 0.02)), what);
    }
    // Open Matte's own background still needs none of them: styles.css has its colours.
    assert.deepEqual(palette(DEFAULTS), {});
  });

  test('a custom accent derives its ink and its hover, and nothing of the surfaces', () => {
    assert.deepEqual(palette({ accentColor: ACCENT, backgroundColor: DEFAULTS.backgroundColor }), ACCENT_THEME);
    assert.deepEqual(check({ accentColor: ACCENT, backgroundColor: DEFAULTS.backgroundColor }), []);
  });

  test('both custom: all eighteen variables, and they pass', () => {
    assert.deepEqual(palette({ accentColor: ACCENT, backgroundColor: BACKGROUND }), THEME);
    assert.deepEqual(check({ accentColor: ACCENT, backgroundColor: BACKGROUND }), []);
  });

  test('a background too light for the text or the status colours is refused, saying why', () => {
    // #3a3a3a: the dim text and "bad" fail. #202020: the faint text passes on it, but
    // not on the raised surface derived from it.
    for (const backgroundColor of ['#3a3a3a', '#202020']) {
      const problems = check({ accentColor: DEFAULTS.accentColor, backgroundColor });
      assert.ok(problems.length, backgroundColor);
      for (const p of problems) assert.match(p, TOO_LIGHT, backgroundColor);
    }
    // Too light for the accent as well.
    for (const backgroundColor of ['#808080', '#ffffff']) {
      const problems = check({ accentColor: DEFAULTS.accentColor, backgroundColor });
      assert.ok(problems.some((p) => TOO_LIGHT.test(p)), `${backgroundColor}: ${JSON.stringify(problems)}`);
    }
  });

  test('an accent too close to the background is refused, saying why: it is used for small text', () => {
    // #7a7a7a passes on the background but not on the raised surface.
    for (const accentColor of ['#3a3040', '#5c4a2a', '#0d0c0f', '#7a7a7a']) {
      const problems = check({ accentColor, backgroundColor: DEFAULTS.backgroundColor });
      assert.ok(problems.some((p) => TOO_CLOSE.test(p)), `${accentColor}: ${JSON.stringify(problems)}`);
      assert.ok(!problems.some((p) => TOO_LIGHT.test(p)), `${accentColor}: the background is fine`);
    }
    // Readable on Open Matte's background, not on a lighter one's raised surface.
    assert.deepEqual(check({ accentColor: '#848484', backgroundColor: DEFAULTS.backgroundColor }), []);
    assert.ok(check({ accentColor: '#848484', backgroundColor: BACKGROUND }).some((p) => TOO_CLOSE.test(p)));
  });

  test('every accent readable at 4.5:1 passes and gets ink readable on it; every other one is refused', () => {
    const accents = [];
    for (let h = 0; h < 360; h += 15) for (const s of [0.35, 0.7, 1]) for (const l of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) accents.push(hsl(h, s, l));
    let passed = 0;
    let refused = 0;
    for (const backgroundColor of [DEFAULTS.backgroundColor, BACKGROUND, '#000000']) {
      const surfaces = [backgroundColor, raisedOf(backgroundColor)];
      for (const accentColor of accents) {
        if (accentColor === DEFAULTS.accentColor) continue;
        const ratios = surfaces.map((s) => ratio(accentColor, s));
        if (ratios.some((r) => borderline(r, 4.5))) continue;
        const what = `${accentColor} on ${backgroundColor}`;
        const problems = check({ accentColor, backgroundColor });
        if (ratios.some((r) => r < 4.5)) {
          assert.ok(problems.some((p) => TOO_CLOSE.test(p)), `${what} is refused: ${JSON.stringify(problems)}`);
          refused++;
          continue;
        }
        assert.deepEqual(problems, [], what);
        const theme = palette({ accentColor, backgroundColor });
        const ink = theme['--accent-ink'];
        assert.equal(theme['--accent'], accentColor, what);
        assert.ok(ratio(ink, accentColor) >= 4.5, `${what}: ink ${ink} is ${ratio(ink, accentColor).toFixed(2)}:1`);
        // The accent darkened, or black when that isn't readable enough.
        const darkened = mix(accentColor, '#000000', 0.89);
        if (!borderline(ratio(darkened, accentColor), 4.5)) {
          if (ratio(darkened, accentColor) >= 4.5) assert.ok(close(ink, darkened), `${what}: ink ${ink}, not ${darkened}`);
          else assert.equal(ink, '#000000', what);
        }
        assert.ok(close(theme['--accent-hover'], mix(accentColor, '#ffffff', 0.2)), `${what}: hover ${theme['--accent-hover']}`);
        passed++;
      }
    }
    assert.ok(passed > 100 && refused > 100, `${passed} passed, ${refused} refused: enough of each to mean something`);
  });

  test('every background is checked for the text, the status colours and the accent, on it and on its raised surface', () => {
    const backgrounds = [];
    for (let v = 0; v <= 0x60; v += 4) backgrounds.push(toHex([v, v, v]));
    for (let h = 0; h < 360; h += 30) for (const l of [0.02, 0.05, 0.08, 0.11, 0.14, 0.2, 0.4]) backgrounds.push(hsl(h, 0.35, l));
    let passed = 0;
    let refused = 0;
    for (const backgroundColor of backgrounds) {
      if (backgroundColor === DEFAULTS.backgroundColor) continue;
      const surfaces = [backgroundColor, raisedOf(backgroundColor)];
      const results = surfaces.flatMap((s) => [
        ...FOREGROUNDS.map(([, colour, need]) => ({ kind: 'text', r: ratio(colour, s), need })),
        { kind: 'accent', r: ratio(DEFAULTS.accentColor, s), need: 4.5 },
      ]);
      if (results.some(({ r, need }) => borderline(r, need))) continue;
      const fails = (kind) => results.some((x) => x.kind === kind && x.r < x.need);
      const problems = check({ accentColor: DEFAULTS.accentColor, backgroundColor });
      const what = `${backgroundColor}: ${JSON.stringify(problems)}`;
      assert.equal(problems.some((p) => TOO_LIGHT.test(p)), fails('text'), what);
      // The accent is the warn colour too: a background too light for it may be told only that.
      if (!fails('accent')) assert.ok(!problems.some((p) => TOO_CLOSE.test(p)), what);
      else if (!fails('text')) assert.ok(problems.some((p) => TOO_CLOSE.test(p)), what);
      if (problems.length) refused++;
      else passed++;
    }
    assert.ok(passed > 20 && refused > 20, `${passed} passed, ${refused} refused`);
  });

  test("the drawn tab icon is Open Matte's own, to the byte, in Open Matte's colours", () => {
    assert.equal(faviconSvg(DEFAULTS), FAVICON);
    // The copy the Vite dev server serves is the same. The server's image has no web/
    // folder, and this suite runs there too (docs/deploying.md).
    const devCopy = new URL('../web/public/favicon.svg', import.meta.url);
    if (fs.existsSync(devCopy)) assert.equal(fs.readFileSync(devCopy, 'utf8'), FAVICON);
  });

  test("the drawn tab icon takes the cinema's accent for its frame and play mark, and its background for the square", () => {
    assert.equal(faviconSvg({ accentColor: ACCENT, backgroundColor: DEFAULTS.backgroundColor }), FAVICON.replaceAll('#e8b04a', ACCENT));
    assert.equal(faviconSvg({ accentColor: DEFAULTS.accentColor, backgroundColor: BACKGROUND }), FAVICON.replace('#111014', FAVICON_SQUARE));
    assert.equal(faviconSvg({ accentColor: ACCENT, backgroundColor: BACKGROUND }), FAVICON.replace('#111014', FAVICON_SQUARE).replaceAll('#e8b04a', ACCENT));
  });
});

// ====================================================================== image headers
// Just enough of each format for imageInfo, which reads headers and never decodes.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const u16 = (n) => [n >> 8, n & 0xff];
const u16le = (n) => Buffer.from([n & 0xff, n >> 8]);
const u24le = (n) => Buffer.from([n & 0xff, (n >> 8) & 0xff, n >> 16]);
const u32le = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const FILL = Buffer.from([0xff]); // a fill byte, allowed before any marker
function segment(marker, data) {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([head, data]);
}
// SOFn: precision, height, width, then three components.
const frame = (marker, width, height) => segment(marker, Buffer.from([8, ...u16(height), ...u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]));
const APP0 = segment(0xe0, Buffer.from('JFIF\0\x01\x02\0\0\x01\0\x01\0\0', 'latin1'));
const APP1 = segment(0xe1, Buffer.from('Exif\0\0MM\0*\0\0\0\x08', 'latin1'));
// Tables whose markers sit among the SOFn ones (DHT C4, DAC CC) but aren't frames.
// Read as a frame, this one would be 32767 × 32767.
const bait = (marker) => segment(marker, Buffer.from([0x10, 0x7f, 0xff, 0x7f, 0xff, 0x01, 0x02, 0x03]));
// The start of a scan, a little entropy-coded data (with a stuffed FF 00), the end.
const SCAN = Buffer.concat([segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]), EOI]);
function jpegImage(width, height, { progressive = false } = {}) {
  return progressive
    ? Buffer.concat([SOI, APP0, segment(0xdb, Buffer.alloc(65)), bait(0xc4), bait(0xcc), frame(0xc2, width, height), SCAN])
    : Buffer.concat([SOI, APP0, APP1, FILL, frame(0xc0, width, height), SCAN]);
}

const riffChunk = (fourcc, data) => Buffer.concat([Buffer.from(fourcc, 'latin1'), u32le(data.length), data, Buffer.alloc(data.length % 2)]);
function riff(...chunks) {
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  return Buffer.concat([Buffer.from('RIFF'), u32le(body.length), body]);
}
// Lossy: a key frame's tag, the start code, then 14-bit sizes whose top two bits are a scale.
const vp8 = (width, height) =>
  riffChunk('VP8 ', Buffer.concat([Buffer.from([0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a]), u16le(width | 0x4000), u16le(height | 0x8000), Buffer.alloc(10)]));
// Lossless: the signature byte, then width - 1 and height - 1 in 14 bits each, from the lowest bit up.
const vp8l = (width, height) => riffChunk('VP8L', Buffer.concat([Buffer.from([0x2f]), u32le((width - 1) | ((height - 1) << 14) | (1 << 28)), Buffer.alloc(8)]));
// Extended: flags, then the canvas, 24 bits each minus one. The image inside is
// smaller here, so reading it instead of the canvas would give the wrong size.
const vp8x = (width, height) => riffChunk('VP8X', Buffer.concat([Buffer.from([0x10, 0, 0, 0]), u24le(width - 1), u24le(height - 1)]));
function webpImage(width, height, kind = 'VP8X') {
  if (kind === 'VP8 ') return riff(vp8(width, height));
  if (kind === 'VP8L') return riff(vp8l(width, height));
  return riff(vp8x(width, height), riffChunk('ALPH', Buffer.alloc(4)), vp8(17, 17));
}

const info = (type, width, height) => ({ type, ext: { png: 'png', jpeg: 'jpg', webp: 'webp' }[type], mime: `image/${type}`, width, height });
const sizeEnd = (bytes, marker) => bytes.indexOf(Buffer.from([0xff, marker])) + 9;

describe('recognising images by their bytes', () => {
  const baseline = jpegImage(640, 480);
  const progressive = jpegImage(1200, 800, { progressive: true });
  const standalone = Buffer.concat([SOI, Buffer.from([0xff, 0x01, 0xff, 0xd3]), APP0, frame(0xc1, 33, 17), SCAN]);
  // What it is, its bytes, what imageInfo says, and where its size ends.
  const SAMPLES = [
    ['a PNG', pngImage(300, 120), info('png', 300, 120), 24],
    ['a JPEG with APP segments and a fill byte before its frame', baseline, info('jpeg', 640, 480), sizeEnd(baseline, 0xc0)],
    ['a progressive JPEG, after tables that are not frames', progressive, info('jpeg', 1200, 800), sizeEnd(progressive, 0xc2)],
    ['a JPEG with standalone markers before its frame', standalone, info('jpeg', 33, 17), sizeEnd(standalone, 0xc1)],
    ['an extended WebP (VP8X)', webpImage(1920, 1080), info('webp', 1920, 1080), 30],
    ['a lossy WebP (VP8)', webpImage(800, 600, 'VP8 '), info('webp', 800, 600), 30],
    ['a lossless WebP (VP8L)', webpImage(512, 16384, 'VP8L'), info('webp', 512, 16384), 25],
  ];

  test('PNG, JPEG and WebP give their type and their size in pixels', () => {
    for (const [what, bytes, expected] of SAMPLES) assert.deepEqual(imageInfo(bytes), expected, what);
  });

  test('a header cut short gives null, and never an exception', () => {
    for (const [what, bytes, expected, end] of SAMPLES) {
      assert.ok(end > 9 && end <= bytes.length, what);
      for (let n = 0; n <= bytes.length; n++) {
        let got;
        assert.doesNotThrow(() => {
          got = imageInfo(bytes.subarray(0, n));
        }, `${what}, cut to ${n} bytes`);
        if (n < end) assert.equal(got, null, `${what}, cut to ${n} bytes`);
        else assert.ok(got === null || isDeepStrictEqual(got, expected), `${what}, cut to ${n} bytes: ${JSON.stringify(got)}`);
      }
    }
  });

  test('anything else gives null: other formats, garbage, broken headers and images with no pixels', () => {
    const patched = (bytes, at, write) => {
      const b = Buffer.from(bytes);
      write(b, at);
      return b;
    };
    const png = pngImage(10, 10);
    const cases = {
      nothing: Buffer.alloc(0),
      text: Buffer.from('not really a jpeg'),
      'an SVG': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      'a GIF': Buffer.from('GIF89a\x20\x00\x20\x00\x80\x00\x00', 'latin1'),
      'a PNG signature alone': PNG_SIGNATURE,
      'a PNG whose first chunk is not IHDR': patched(png, 12, (b, at) => b.write('tEXt', at, 'latin1')),
      'a PNG 0 pixels wide': patched(png, 16, (b, at) => b.writeUInt32BE(0, at)),
      'a PNG 0 pixels high': patched(png, 20, (b, at) => b.writeUInt32BE(0, at)),
      'a JPEG that starts its scan before any frame': Buffer.concat([SOI, APP0, SCAN]),
      'a JPEG that ends before any frame': Buffer.concat([SOI, APP0, EOI]),
      'a JPEG frame 0 pixels high': Buffer.concat([SOI, frame(0xc0, 100, 0), SCAN]),
      'a JPEG frame 0 pixels wide': Buffer.concat([SOI, frame(0xc0, 0, 100), SCAN]),
      'a JPEG segment longer than the file': Buffer.concat([SOI, Buffer.from([0xff, 0xe0, 0xff, 0xf0, 0x00])]),
      'a JPEG segment of length 0': Buffer.concat([SOI, Buffer.from([0xff, 0xe0, 0x00, 0x00]), Buffer.alloc(16)]),
      'a JPEG segment of length 1': Buffer.concat([SOI, Buffer.from([0xff, 0xe0, 0x00, 0x01]), Buffer.alloc(16)]),
      'a JPEG of nothing but fill bytes': Buffer.concat([SOI, Buffer.alloc(64, 0xff)]),
      'a RIFF file that is not a WebP': Buffer.concat([Buffer.from('RIFF'), u32le(28), Buffer.from('WAVEfmt '), u32le(16), Buffer.alloc(16)]),
      'a WebP whose first chunk is not an image': riff(riffChunk('ALPH', Buffer.alloc(16))),
      'a lossy WebP without its start code': patched(webpImage(100, 100, 'VP8 '), 23, (b, at) => (b[at] = 0)),
      'a lossy WebP 0 pixels wide': riff(vp8(0, 10)),
      'a lossy WebP 0 pixels high': riff(vp8(10, 0)),
      'a lossless WebP without its signature': patched(webpImage(100, 100, 'VP8L'), 20, (b, at) => (b[at] = 0)),
    };
    for (const [what, bytes] of Object.entries(cases)) {
      let got;
      assert.doesNotThrow(() => {
        got = imageInfo(bytes);
      }, what);
      assert.equal(got, null, what);
    }
  });

  test('random bytes, behind a real signature or not, never throw, and never give a size that is not one', () => {
    const prefixes = [Buffer.alloc(0), PNG_SIGNATURE, SOI, Buffer.concat([SOI, FILL]), ...['VP8 ', 'VP8L', 'VP8X'].map((c) => Buffer.from(`RIFF\0\0\0\0WEBP${c}`, 'latin1'))];
    for (let i = 0; i < 3000; i++) {
      const input = Buffer.concat([prefixes[i % prefixes.length], crypto.randomBytes(crypto.randomInt(64))]);
      let got;
      assert.doesNotThrow(() => {
        got = imageInfo(input);
      }, input.toString('hex'));
      if (got === null) continue;
      assert.ok(['png', 'jpeg', 'webp'].includes(got.type), input.toString('hex'));
      for (const n of [got.width, got.height]) assert.ok(Number.isInteger(n) && n > 0, `${input.toString('hex')}: ${JSON.stringify(got)}`);
    }
  });
});

// ====================================================================== the server
const mediaDir = tempDir();
const dataDir = tempDir();
const webDist = tempDir();
const brandingDir = path.join(dataDir, 'branding');
// index.html as Vite builds it: the stylesheet link comes late in the head.
const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="referrer" content="no-referrer" />
    <meta name="color-scheme" content="dark" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>Open Matte</title>
    <script type="module" crossorigin src="/assets/index-C_YNhghY.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-DodpWqzH.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;
// Arrival's poster; Heat's, downloaded from TMDb, wins over its folder's; Stalker's is a PNG.
const POSTER = jpegImage(400, 600);
const TMDB_POSTER_FILE = 'poster-0123456789ab.jpg';
const TMDB_POSTER = jpegImage(500, 750, { progressive: true });
const PNG_POSTER = pngImage(20, 30, [1, 2, 3]);
// Solaris isn't published. Stalker has no year, Mirror no poster. Sneaky's poster
// becomes a link to a file outside its folder once it has been scanned.
const FILMS = {
  arrival: {},
  heat: { title: 'Heat', year: 1995 },
  solaris: { title: 'Solaris', year: 1972 },
  stalker: { title: 'Stalker', year: undefined, poster: 'poster.png' },
  mirror: { title: 'Mirror', year: 1975, poster: undefined },
  tomjerry: { title: 'Tom & "Jerry" <Live>', year: 1940 },
  sneaky: { title: 'Sneaky', year: 2001 },
};
// Words that would give a film away.
const FILM_WORDS = ['Arrival', 'Heat', 'Solaris', 'Stalker', 'Mirror', 'Jerry', 'Sneaky'];
// A code that is well-formed but isn't a ticket.
const UNKNOWN = 'zzzzzzzzzzzzz';
// Paths that get the page: a film's, the app's own, the admin's, a ticket's.
const PAGES = ['/', '/index.html', '/arrival', '/signin', '/enroll', '/account', '/admin', '/admin/tickets/4', `/t/${UNKNOWN}`];

let srv;
let admin;
const films = {};

before(async () => {
  fs.writeFileSync(path.join(webDist, 'index.html'), TEMPLATE);
  // The build's copy of the drawn icon, which the server's own must win over.
  fs.writeFileSync(path.join(webDist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><!-- the build\'s copy --></svg>');
  fs.mkdirSync(path.join(webDist, 'assets'));
  fs.writeFileSync(path.join(webDist, 'assets', 'index-DodpWqzH.css'), ':root{}');
  for (const [slug, fields] of Object.entries(FILMS)) makeFilm(mediaDir, slug, fields);
  fs.writeFileSync(path.join(mediaDir, 'arrival', 'poster.jpg'), POSTER);
  fs.writeFileSync(path.join(mediaDir, 'stalker', 'poster.png'), PNG_POSTER);
  srv = await startServer({ mediaDir, dataDir, webDist, limits: { scale: 100 } });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  for (const f of (await admin.get('/api/admin/films')).data) films[f.slug] = f.id;
  for (const slug of Object.keys(FILMS)) {
    assert.ok(films[slug], slug);
    if (slug === 'solaris') continue;
    const r = await admin.patch(`/api/admin/films/${films[slug]}`, { published: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  fs.mkdirSync(path.join(dataDir, 'artwork', 'heat'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'artwork', 'heat', TMDB_POSTER_FILE), TMDB_POSTER);
  srv.db.prepare('UPDATE films SET artwork = ? WHERE slug = ?').run(JSON.stringify({ poster: { file: TMDB_POSTER_FILE } }), 'heat');
  const outside = path.join(tempDir(), 'secret.jpg');
  fs.writeFileSync(outside, 'not for anyone');
  fs.rmSync(path.join(mediaDir, 'sneaky', 'poster.jpg'));
  fs.symlinkSync(outside, path.join(mediaDir, 'sneaky', 'poster.jpg'));
});
after(() => srv.close());

let counter = 0;
const uniq = (name) => `${name} ${++counter}`;
const fresh = () => browser(srv.base);
const settingsRows = () => srv.db.prepare('SELECT key, value FROM settings ORDER BY key').all();
const totals = () =>
  srv.db.prepare(`
    SELECT (SELECT COUNT(*) FROM sessions) AS sessions, (SELECT COUNT(*) FROM session_tickets) AS sessionTickets,
           (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM screenings) AS screenings,
           (SELECT COUNT(*) FROM tickets WHERE first_opened_at IS NOT NULL) AS opened`).get();
const colours = (s) => ({ accentColor: s.accentColor, backgroundColor: s.backgroundColor });
const adminSettings = async () => (await admin.get('/api/admin/settings')).data;
const adminTicket = async (id) => (await admin.get(`/api/admin/tickets/${id}`)).data;

async function save(patch) {
  const r = await admin.patch('/api/admin/settings', patch);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const upload = (kind, bytes, type = 'image/png', headers) => admin.upload(`/api/admin/branding/${kind}`, bytes, type, headers);
async function uploaded(kind, bytes, type) {
  const r = await upload(kind, bytes, type);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data[kind];
}
const remove = (kind) => admin.post(`/api/admin/branding/${kind}/remove`);
// Back to a new cinema's branding.
async function plain() {
  await save({ cinemaName: 'Open Matte', ...DEFAULTS, logoWithName: true });
  for (const kind of ['logo', 'icon']) {
    const r = await remove(kind);
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
}
const urlOf = (kind, bytes, ext) => `/branding/${kind}-${sha256(bytes).slice(0, 16)}.${ext}`;
const cookieOf = (b) => [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ');

// Any file, with no cookie (or b's) and any other headers: status, headers and bytes.
// Nothing it serves sets a cookie. Reading the whole body also checks the response
// is framed as it says: a stale Content-Length would hang here until the server
// dropped the connection.
async function fetchFile(url, b = null, headers = {}) {
  const res = await fetch(srv.base + url, { headers: { ...headers, ...(b ? { cookie: cookieOf(b) } : {}) } });
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(res.headers.getSetCookie(), [], `${url}: no cookie`);
  return { status: res.status, headers: res.headers, bytes };
}

// A ticket's preview poster has an address of its own, /poster/<ticket id>.<mac>, made
// for the preview: it holds no ticket code, and nothing in it opens the ticket. Only
// the server can make the mac, so the tests take addresses from the pages that give
// them out, and change them.
const POSTER_PATH = /^\/poster\/(\d{1,12})\.([A-Za-z0-9_-]{22})$/;
// Well-formed, but no ticket's poster.
const NO_POSTER = '/poster/999999999.AAAAAAAAAAAAAAAAAAAAAA';
const posterOf = (address, b) => fetchFile(address, b);
const refOf = (address) => {
  const [, id, mac] = POSTER_PATH.exec(address);
  return { id, mac };
};
// The mac with its i-th character changed to its neighbour in the alphabet: one bit,
// even in the last character.
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const flip = (mac, i) => mac.slice(0, i) + BASE64URL[BASE64URL.indexOf(mac[i]) ^ 1] + mac.slice(i + 1);
// Headers that describe or cache a file: an error must carry none of them.
const FILE_HEADERS = ['cache-control', 'etag', 'last-modified', 'accept-ranges'];
function notTheFile(f, what) {
  assert.doesNotMatch(f.headers.get('content-type') || '', /^image\//, `${what}: not an image`);
  for (const h of FILE_HEADERS) assert.equal(f.headers.get(h), null, `${what}: no ${h}`);
}

// ------------------------------------------------------------ reading a page
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) =>
    dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ENTITIES[name] ?? m,
  );
// The attributes of every <name ...> tag, decoded, with where it starts.
const tags = (html, name) =>
  [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map((m) => ({
    at: m.index,
    ...Object.fromEntries([...m[1].matchAll(/([a-z][a-z:-]*)\s*=\s*"([^"]*)"/gi)].map(([, k, v]) => [k.toLowerCase(), decode(v)])),
  }));

function parsePage(html, headers = null) {
  const titles = [...html.matchAll(/<title>(.*?)<\/title>/gs)].map((m) => m[1]);
  assert.equal(titles.length, 1, 'one title');
  assert.doesNotMatch(titles[0], /[<>"']|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i, 'the title is escaped');
  // Each meta tag by its property or name: og:title, theme-color...
  const meta = {};
  for (const m of tags(html, 'meta')) {
    const key = m.property ?? m.name;
    if (!key) continue;
    assert.ok(!(key in meta), `one ${key}`);
    meta[key] = m.content;
  }
  return { html, headers, title: decode(titles[0]), meta, links: tags(html, 'link') };
}

// A page as a link-preview fetcher gets it (or browser b, with its cookies): no
// cookie comes back, and no page names its own address.
async function page(url, b = null) {
  const r = b ? await b.get(url) : await fetch(srv.base + url).then(async (res) => ({ status: res.status, headers: res.headers, data: await res.text() }));
  assert.equal(r.status, 200, url);
  assert.match(r.headers.get('content-type'), /^text\/html/, url);
  assert.deepEqual(r.headers.getSetCookie(), [], `${url}: no cookie`);
  assert.doesNotMatch(r.data, /og:url/, `${url}: never og:url`);
  return parsePage(r.data, r.headers);
}

// The declarations of the page's theme <style>, or null when it sets none. Every page
// has one, empty with no colours set, for the admin to put saved colours in.
function themeOf(html) {
  const styles = [...html.matchAll(/<style id="theme">(.*?)<\/style>/gs)].map((m) => m[1]);
  assert.equal(styles.length, 1, 'one theme');
  const m = /^\s*:root\s*\{(.*)\}\s*$/s.exec(styles[0]);
  assert.ok(m, styles[0]);
  if (!m[1].trim()) return null;
  return Object.fromEntries(
    m[1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
  );
}
const iconLinks = (p) => p.links.filter((l) => l.rel === 'icon').map((l) => [l.href, l.type]);

// Every page that isn't a ticket's preview: the cinema, its logo if it has one, and
// nothing about any film or ticket.
function asCinema(p, { name = 'Open Matte', logo = null } = {}) {
  assert.equal(p.title, name);
  assert.equal(p.meta['og:site_name'], name);
  assert.equal(p.meta['og:type'], 'website');
  assert.equal(p.meta['og:title'], name);
  assert.equal(p.meta['og:image'], logo ? srv.base + logo.url : undefined);
  assert.doesNotMatch(p.html, /\/poster|A ticket from/, 'nothing about a ticket');
  for (const word of FILM_WORDS) assert.ok(!p.html.includes(word), `nothing about ${word}`);
}

// A ticket's preview: the film, from the cinema, with the poster at its own address,
// and the ticket's code nowhere in the page. Returns the poster's address (a path), or
// null for a film with no poster to show.
function asFilm(p, t, { title = 'Arrival (2016)', name = 'Open Matte', poster = true } = {}) {
  assert.equal(p.title, name, 'the tab still says the cinema');
  assert.equal(p.meta['og:site_name'], name);
  assert.equal(p.meta['og:type'], 'website');
  assert.equal(p.meta['og:title'], title);
  assert.equal(p.meta['og:description'], `A ticket from ${name}.`);
  assert.equal(p.meta['twitter:card'], 'summary');
  for (const directive of ['private', 'no-cache']) assert.match(p.headers.get('cache-control'), new RegExp(directive));
  assert.ok(!p.html.toLowerCase().includes(t.code), 'the code is nowhere in the page');
  if (!poster) {
    assert.doesNotMatch(p.html, /\/poster/, 'no poster');
    return null;
  }
  const image = p.meta['og:image'] ?? '';
  assert.ok(image.startsWith(`${srv.base}/poster/`), image);
  const address = image.slice(srv.base.length);
  assert.match(address, POSTER_PATH);
  assert.equal(Number(refOf(address).id), t.id, "the ticket's id");
  return address;
}

// The site's public settings as the page carries them, for the header's first paint:
// one JSON <script id="site-data"> in the head, with nothing in it that could end the
// script early (no <, nor > or &).
function siteDataOf(html) {
  const found = [...html.matchAll(/<script\b([^>]*)>(.*?)<\/script>/gs)].filter((m) => /\bid="site-data"/.test(m[1]));
  assert.equal(found.length, 1, 'one #site-data');
  const [m] = found;
  assert.match(m[1], /\btype="application\/json"/);
  assert.ok(m.index < html.indexOf('</head>'), 'in the head');
  assert.doesNotMatch(m[2], /[<>&]/, 'escaped');
  return JSON.parse(m[2]);
}

// ------------------------------------------------------------ tickets and people
async function issue(fields = {}, slug = 'arrival') {
  const r = await admin.post('/api/admin/tickets', { filmId: films[slug], ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data[0];
}
async function opened(b, ticket, slug = 'arrival') {
  const r = await b.post('/api/tickets/open', { code: ticket.code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { slug });
  return b;
}
// A person with a passkey, signed in on their phone.
async function member(name = uniq('Sam')) {
  const p = await newPerson(admin, name);
  const phone = fresh();
  const r = await enroll(phone, (await setupLink(admin, p.id)).token, { auth: softAuthenticator() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { p, phone };
}

// ====================================================================== settings
describe('colours, logo and icon in Settings', () => {
  test("a new cinema has Open Matte's colours, no logo or icon, and the name beside the logo", async () => {
    const expected = { accentColor: '#e8b04a', backgroundColor: '#0d0c0f', logoWithName: true, logo: null, icon: null };
    const pick = (o) => Object.fromEntries(Object.keys(expected).map((k) => [k, o[k]]));
    assert.deepEqual(pick((await fresh().get('/api/site')).data), expected);
    assert.deepEqual(pick((await fresh().get('/api/me')).data.site), expected);
    assert.deepEqual(pick(await adminSettings()), expected);
    // Serving pages and the drawn icon doesn't make the branding folder.
    await page('/');
    await fetchFile('/favicon.svg');
    assert.equal(fs.existsSync(brandingDir), false);
  });

  test('colours are saved in lower case, and reach every viewer through /api/site and /api/me', async () => {
    const r = await admin.patch('/api/admin/settings', { accentColor: '#4FB3D9', backgroundColor: '#101820' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const expected = { accentColor: ACCENT, backgroundColor: BACKGROUND };
    assert.deepEqual(colours(r.data), expected);
    assert.deepEqual(colours(await adminSettings()), expected);
    assert.deepEqual(colours((await fresh().get('/api/site')).data), expected);
    assert.deepEqual(colours((await fresh().get('/api/me')).data.site), expected);
    // Open Matte's colours in capitals are Open Matte's colours, and need no theme.
    await save({ accentColor: '#E8B04A', backgroundColor: '#0D0C0F' });
    assert.deepEqual(colours((await fresh().get('/api/site')).data), DEFAULTS);
    assert.equal(themeOf((await page('/')).html), null);
  });

  test("a colour that isn't #rrggbb is refused, and nothing in that save is written", async () => {
    const before = settingsRows();
    for (const value of ['e8b04a', '#e8b04', '#e8b04a0', '#fff', '#ggg000', 'red', 'rgb(232, 176, 74)', '', 0xe8b04a, null, true]) {
      for (const key of ['accentColor', 'backgroundColor']) {
        const r = await admin.patch('/api/admin/settings', { cinemaName: 'Never saved', [key]: value });
        assert.equal(r.status, 400, `${key}: ${JSON.stringify(value)}`);
      }
    }
    assert.deepEqual(settingsRows(), before);
    assert.equal((await fresh().get('/api/site')).data.cinemaName, 'Open Matte');
  });

  test('a colour that would be hard to read is refused, saying why, and nothing in that save is written', async () => {
    const before = settingsRows();
    const cases = [
      [{ backgroundColor: '#808080' }, TOO_LIGHT],
      [{ backgroundColor: '#3a3a3a' }, TOO_LIGHT],
      // Fine on itself; too light once raised.
      [{ backgroundColor: '#202020' }, TOO_LIGHT],
      [{ accentColor: '#3a3040' }, TOO_CLOSE],
      // Fine on the background; too close to the raised surface.
      [{ accentColor: '#7a7a7a' }, TOO_CLOSE],
    ];
    for (const [patch, reason] of cases) {
      const r = await admin.patch('/api/admin/settings', { cinemaName: 'Never saved', logoWithName: false, ...patch });
      assert.equal(r.status, 400, JSON.stringify(patch));
      assert.match(r.data.error, reason);
      assert.equal(r.data.error, check({ ...DEFAULTS, ...patch })[0], 'the first problem');
    }
    assert.deepEqual(settingsRows(), before);
  });

  test('the colours are checked as they would be saved: together, with whichever one is not being changed', async () => {
    // #848484 is readable on Open Matte's background, not on BACKGROUND's raised surface.
    await save({ backgroundColor: BACKGROUND });
    const r = await admin.patch('/api/admin/settings', { accentColor: '#848484' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, TOO_CLOSE);
    assert.deepEqual(colours(await adminSettings()), { accentColor: DEFAULTS.accentColor, backgroundColor: BACKGROUND });

    // #7a7a7a is refused on Open Matte's background, but fine with a black one in the same save.
    assert.equal((await admin.patch('/api/admin/settings', { accentColor: '#7a7a7a' })).status, 400);
    await save({ accentColor: '#7a7a7a', backgroundColor: '#000000' });
    // ...after which Open Matte's background alone is refused, for the accent's sake.
    const back = await admin.patch('/api/admin/settings', { backgroundColor: DEFAULTS.backgroundColor });
    assert.equal(back.status, 400);
    assert.match(back.data.error, TOO_CLOSE);
    await save(DEFAULTS);
  });

  test('whether the name shows beside the logo is saved, and must be true or false', async () => {
    assert.equal((await save({ logoWithName: false })).logoWithName, false);
    assert.equal((await fresh().get('/api/site')).data.logoWithName, false);
    assert.equal((await fresh().get('/api/me')).data.site.logoWithName, false);
    for (const value of ['no', 0, null]) assert.equal((await admin.patch('/api/admin/settings', { logoWithName: value })).status, 400, JSON.stringify(value));
    assert.equal((await save({ logoWithName: true })).logoWithName, true);
  });
});

// ====================================================================== checking colours
describe('checking colours before saving them', () => {
  const checkColours = (body, b = admin) => b.post('/api/admin/branding/check', body);

  test('good colours: no problems, and the theme to preview them with', async () => {
    const r = await checkColours({ accentColor: ACCENT, backgroundColor: BACKGROUND });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data, { problems: [], theme: THEME });
    assert.deepEqual((await checkColours(DEFAULTS)).data, { problems: [], theme: {} });
  });

  test('colours that would be hard to read: the reasons, and still the theme', async () => {
    for (const body of [{ accentColor: DEFAULTS.accentColor, backgroundColor: '#808080' }, { accentColor: '#3a3040', backgroundColor: BACKGROUND }]) {
      const r = await checkColours(body);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.ok(r.data.problems.length, JSON.stringify(body));
      assert.deepEqual(r.data, { problems: check(body), theme: palette(body) });
    }
  });

  test("a colour that isn't #rrggbb is a 400, and a browser without the admin's cookie gets a 401", async () => {
    for (const body of [{ accentColor: 'red', backgroundColor: DEFAULTS.backgroundColor }, { accentColor: '#e8b04', backgroundColor: DEFAULTS.backgroundColor }, { accentColor: DEFAULTS.accentColor }, {}]) {
      assert.equal((await checkColours(body)).status, 400, JSON.stringify(body));
    }
    const r = await checkColours({ accentColor: ACCENT, backgroundColor: BACKGROUND }, fresh());
    assert.equal(r.status, 401);
    assert.equal(r.data.theme, undefined);
  });

  test('checking saves nothing', async () => {
    const before = settingsRows();
    await checkColours({ accentColor: ACCENT, backgroundColor: BACKGROUND });
    await checkColours({ accentColor: '#3a3040', backgroundColor: '#808080' });
    assert.deepEqual(settingsRows(), before);
    assert.deepEqual(colours(await adminSettings()), DEFAULTS);
  });
});

// ====================================================================== uploads
describe('uploading a logo and a tab icon', () => {
  test('a PNG, JPEG or WebP logo is recognised by its bytes, and served to anyone, cached for good', async () => {
    assert.equal(fs.existsSync(brandingDir), false, 'no folder until the first image');
    const progressive = jpegImage(320, 90, { progressive: true });
    const images = [
      [pngImage(240, 80), 'image/png', 'png', 240, 80],
      [jpegImage(300, 100), 'image/jpeg', 'jpg', 300, 100],
      [webpImage(360, 120), 'image/webp', 'webp', 360, 120],
      [webpImage(200, 50, 'VP8L'), 'image/webp', 'webp', 200, 50],
      // The declared type only gets the bytes in: they decide.
      [webpImage(400, 100, 'VP8 '), 'image/png', 'webp', 400, 100],
      [progressive, 'image/webp', 'jpg', 320, 90],
    ];
    const mimes = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
    for (const [bytes, declared, ext, width, height] of images) {
      const r = await upload('logo', bytes, declared);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const logo = { url: urlOf('logo', bytes, ext), width, height };
      assert.deepEqual(r.data.logo, logo);
      assert.deepEqual(r.data, await adminSettings(), 'the same as Settings');
      assert.deepEqual((await fresh().get('/api/site')).data.logo, logo);
      assert.deepEqual((await fresh().get('/api/me')).data.site.logo, logo);

      const f = await fetchFile(logo.url);
      assert.equal(f.status, 200, logo.url);
      assert.equal(f.headers.get('content-type').split(';')[0], mimes[ext]);
      assert.equal(f.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.equal(f.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(f.bytes, bytes);
      assert.deepEqual(fs.readdirSync(brandingDir), [path.basename(logo.url)], 'only the current logo is kept');
    }
  });

  test("bytes that aren't a PNG, JPEG or WebP are refused, whatever they're labelled", async () => {
    await plain();
    const before = settingsRows();
    const refused = [
      [Buffer.from('not really a png'), 'image/png'],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/png'],
      [Buffer.from('GIF89a\x20\x00\x20\x00\x80\x00\x00', 'latin1'), 'image/webp'],
      [Buffer.alloc(0), 'image/png'],
      [pngImage(64, 64).subarray(0, 20), 'image/png'],
      [Buffer.concat([SOI, APP0, SCAN]), 'image/jpeg'],
    ];
    for (const [bytes, type] of refused) {
      for (const kind of ['logo', 'icon']) {
        const r = await upload(kind, bytes, type);
        assert.equal(r.status, 400, `${kind}: ${bytes.subarray(0, 12).toString('latin1')}`);
        assert.deepEqual(r.data, { error: "That isn't a PNG, JPEG or WebP image." });
      }
    }
    assert.deepEqual(settingsRows(), before);
    assert.deepEqual(fs.readdirSync(brandingDir), []);
  });

  test('an image smaller than 16 or larger than 8192 pixels either way is refused, giving its size', async () => {
    for (const [w, h] of [[15, 40], [40, 15], [8193, 16], [16, 8193]]) {
      const r = await upload('logo', pngImage(w, h));
      assert.equal(r.status, 400, `${w} × ${h}`);
      assert.match(r.data.error, new RegExp(`${w} × ${h}`));
    }
    assert.equal((await adminSettings()).logo, null);
    for (const [w, h] of [[16, 16], [8192, 16]]) assert.equal((await uploaded('logo', pngImage(w, h))).width, w);
    await plain();
  });

  test('the tab icon must be square, and at least 32 × 32', async () => {
    const r = await upload('icon', pngImage(300, 200));
    assert.equal(r.status, 400);
    assert.deepEqual(r.data, { error: 'The icon must be square; this one is 300 × 200.' });
    for (const size of [31, 16]) {
      const small = await upload('icon', pngImage(size, size));
      assert.equal(small.status, 400, `${size} × ${size}`);
      assert.match(small.data.error, new RegExp(`${size} × ${size}`));
    }
    assert.equal((await adminSettings()).icon, null);
    const bytes = pngImage(32, 32);
    assert.deepEqual(await uploaded('icon', bytes), { url: urlOf('icon', bytes, 'png'), width: 32, height: 32 });
    assert.equal((await adminSettings()).logo, null, 'the logo is a separate thing');
    await plain();
  });

  test('an image of more than 1 MB is refused; 1 MB exactly is fine', async () => {
    const padded = (n) => {
      const png = pngImage(64, 64);
      return Buffer.concat([png, Buffer.alloc(n - png.length)]);
    };
    for (const kind of ['logo', 'icon']) {
      const big = await upload(kind, padded(1048577));
      assert.equal(big.status, 413, kind);
      assert.deepEqual(big.data, { error: 'That image is larger than 1 MB.' });
    }
    assert.equal((await adminSettings()).logo, null);
    const exact = padded(1048576);
    assert.equal((await uploaded('logo', exact)).url, urlOf('logo', exact, 'png'));
    await plain();
  });

  test('only the three image types get past the JSON rule, and only to the two upload addresses', async () => {
    const before = settingsRows();
    const png = pngImage(64, 64);
    for (const type of ['text/plain', 'image/gif', 'image/svg+xml', 'image/avif', 'application/octet-stream', 'multipart/form-data; boundary=x']) {
      const r = await upload('logo', png, type);
      assert.equal(r.status, 415, type);
      assert.deepEqual(r.data, { error: 'json-required' });
    }
    for (const url of ['/api/admin/branding/logo/remove', '/api/admin/branding/icon/remove', '/api/admin/branding/check', '/api/admin/settings', '/api/tickets/open']) {
      assert.equal((await admin.upload(url, png)).status, 415, url);
    }
    for (const method of ['PUT', 'PATCH']) {
      assert.equal((await admin.send(method, '/api/admin/branding/logo', png, { type: 'image/png' })).status, 415, method);
    }
    assert.deepEqual(settingsRows(), before);
  });

  test("an upload or removal from another site is refused, even with the admin's cookie", async () => {
    const logo = await uploaded('logo', pngImage(120, 40));
    for (const site of ['cross-site', 'same-site']) {
      const headers = { 'sec-fetch-site': site };
      const r = await upload('logo', pngImage(120, 40, [9, 9, 9]), 'image/png', headers);
      assert.equal(r.status, 403, site);
      assert.deepEqual(r.data, { error: 'cross-site' });
      assert.equal((await admin.send('POST', '/api/admin/branding/logo/remove', {}, { headers })).status, 403, site);
    }
    assert.deepEqual((await adminSettings()).logo, logo);
    assert.equal((await upload('icon', pngImage(48, 48), 'image/png', { 'sec-fetch-site': 'same-origin' })).status, 200);
    await plain();
  });

  test('uploading and removing need the admin', async () => {
    const logo = await uploaded('logo', pngImage(120, 40));
    const viewer = await opened(fresh(), await issue());
    for (const b of [fresh(), viewer]) {
      for (const kind of ['logo', 'icon']) {
        const r = await b.upload(`/api/admin/branding/${kind}`, pngImage(64, 64, [5, 5, 5]));
        assert.equal(r.status, 401, kind);
        assert.equal((await b.post(`/api/admin/branding/${kind}/remove`)).status, 401, kind);
      }
    }
    assert.deepEqual((await adminSettings()).logo, logo);
    assert.equal((await adminSettings()).icon, null);
    await plain();
  });

  test('a new logo replaces the old one: the old address stops working and its file is deleted', async () => {
    const first = await uploaded('logo', pngImage(200, 100, [10, 20, 30]));
    const icon = await uploaded('icon', pngImage(64, 64, [40, 50, 60]));
    const bytes = pngImage(200, 100, [70, 80, 90]);
    const second = await uploaded('logo', bytes);
    assert.notEqual(second.url, first.url);
    assert.equal((await fetchFile(first.url)).status, 404);
    assert.equal((await fetchFile(second.url)).status, 200);
    assert.equal((await fetchFile(icon.url)).status, 200, 'the icon is left alone');
    const files = [second, icon].map((x) => path.basename(x.url)).sort();
    assert.deepEqual(fs.readdirSync(brandingDir).sort(), files);
    // The same image again is the same file, and stays.
    assert.deepEqual(await uploaded('logo', bytes), second);
    assert.equal((await fetchFile(second.url)).status, 200);
    assert.deepEqual(fs.readdirSync(brandingDir).sort(), files);
  });

  test('removing the logo or the icon forgets it, and its address stops working', async () => {
    const { logo, icon } = await adminSettings();
    assert.ok(logo && icon);
    for (const [kind, before] of [['logo', logo], ['icon', icon]]) {
      const r = await remove(kind);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data[kind], null);
      assert.deepEqual(r.data, await adminSettings(), 'the same as Settings');
      assert.equal((await fresh().get('/api/site')).data[kind], null);
      assert.equal((await fetchFile(before.url)).status, 404);
    }
    assert.deepEqual(fs.readdirSync(brandingDir), []);
    assert.equal((await remove('logo')).status, 200, 'nothing to remove is fine too');
  });

  test('Settings can neither set nor clear the logo or the icon', async () => {
    const logo = await uploaded('logo', pngImage(120, 40));
    const forged = { file: 'icon-0123456789abcdef.png', width: 64, height: 64 };
    fs.writeFileSync(path.join(brandingDir, forged.file), pngImage(64, 64));
    // Refused, not quietly ignored: only the upload routes set them.
    for (const patch of [{ logo: null }, { icon: forged }]) {
      const r = await admin.patch('/api/admin/settings', patch);
      assert.equal(r.status, 400, JSON.stringify(r.data));
    }
    const r = await admin.get('/api/admin/settings');
    assert.deepEqual(r.data.logo, logo);
    assert.equal(r.data.icon, null);
    assert.equal((await fetchFile(`/branding/${forged.file}`)).status, 404);
    fs.rmSync(path.join(brandingDir, forged.file));
    await plain();
  });

  test('only the current logo and icon are served: any other name is not found', async () => {
    const logo = await uploaded('logo', pngImage(120, 40));
    await uploaded('icon', pngImage(48, 48));
    const name = path.basename(logo.url);
    const hash = name.slice('logo-'.length, 'logo-'.length + 16);
    // Files that are there, with names that look right, but aren't the current logo.
    const strays = ['logo-0123456789abcdef.png', `.${name}.tmp`];
    for (const f of strays) fs.writeFileSync(path.join(brandingDir, f), pngImage(20, 20));
    const refused = [
      ...strays.map((f) => `/branding/${f}`),
      `/branding/icon-${hash}.png`,
      `/branding/logo-${hash}.jpg`,
      `/branding/logo-${hash}.PNG`,
      `/branding/LOGO-${hash}.png`,
      `/branding/${name}.tmp`,
      `/branding/${name}%00`,
      `/branding/${name}%2F`,
      `/branding/..%2Fartwork%2Fheat%2F${TMDB_POSTER_FILE}`,
      '/branding/..%2F..%2F..%2Fetc%2Fpasswd',
      '/branding/%2e%2e%2fopen-matte.db',
    ];
    for (const url of refused) {
      const f = await fetchFile(url);
      assert.equal(f.status, 404, url);
      assert.doesNotMatch(f.headers.get('content-type') || '', /^image\//, url);
    }
    assert.equal((await fetchFile(logo.url)).status, 200);
    for (const f of strays) fs.rmSync(path.join(brandingDir, f));
    await plain();
  });

  test('a current logo or icon whose file has gone is not found, and that is never cached, least of all for good', async () => {
    const logo = await uploaded('logo', pngImage(120, 40, [1, 1, 1]));
    const icon = await uploaded('icon', pngImage(48, 48, [2, 2, 2]));
    for (const { url } of [logo, icon]) {
      fs.rmSync(path.join(brandingDir, path.basename(url)));
      const f = await fetchFile(url);
      assert.equal(f.status, 404, url);
      notTheFile(f, url);
      assert.ok(!f.bytes.toString().includes(brandingDir) && !/ENOENT/.test(f.bytes.toString()), `${url}: never saying why`);
    }
    // The settings still name them: put back, they're served again.
    fs.writeFileSync(path.join(brandingDir, path.basename(logo.url)), pngImage(120, 40, [1, 1, 1]));
    assert.equal((await fetchFile(logo.url)).status, 200);
    await plain();
  });

  test("an image the server can no longer read is a plain 500 that arrives in full, with none of the file's headers", { skip: process.getuid?.() === 0 && 'root reads any file' }, async () => {
    const bytes = pngImage(120, 40, [5, 5, 5]);
    const { url } = await uploaded('logo', bytes);
    const file = path.join(brandingDir, path.basename(url));
    fs.chmodSync(file, 0o000);
    try {
      // Sent with the file's length, the empty answer would hang until the server dropped the connection.
      const res = await fetch(srv.base + url, { signal: AbortSignal.timeout(3000) });
      const f = { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
      assert.equal(f.status, 500);
      assert.notEqual(f.headers.get('content-length'), String(bytes.length));
      notTheFile(f, 'unreadable');
    } finally {
      fs.chmodSync(file, 0o644);
    }
    assert.equal((await fetchFile(url)).status, 200);
    await plain();
  });

  test("removing the logo answers as it should even when its file can't be deleted; the file left behind is never served", { skip: process.getuid?.() === 0 && 'root deletes any file' }, async () => {
    const logo = await uploaded('logo', pngImage(120, 40, [6, 6, 6]));
    const file = path.join(brandingDir, path.basename(logo.url));
    fs.chmodSync(brandingDir, 0o555);
    let r;
    try {
      r = await remove('logo');
    } finally {
      fs.chmodSync(brandingDir, 0o755);
    }
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.logo, null);
    assert.deepEqual(r.data, await adminSettings(), 'the same as Settings');
    assert.ok(fs.existsSync(file), 'left behind');
    assert.equal((await fetchFile(logo.url)).status, 404, 'never served');
    fs.rmSync(file);
    await plain();
  });

  test('a range past the end of an image is a 416 that gives its length, and a failed If-Match a 412; neither is described or cached as the image', async () => {
    const bytes = pngImage(120, 40, [3, 3, 3]);
    const { url } = await uploaded('logo', bytes);
    const beyond = await fetchFile(url, null, { range: 'bytes=99999999-' });
    assert.equal(beyond.status, 416);
    assert.equal(beyond.headers.get('content-range'), `bytes */${bytes.length}`);
    notTheFile(beyond, 'a range past the end');
    const changed = await fetchFile(url, null, { 'if-match': '"nope"' });
    assert.equal(changed.status, 412);
    assert.equal(changed.headers.get('content-range'), null);
    notTheFile(changed, 'a failed If-Match');
    // A range within it is still a part of it.
    const part = await fetchFile(url, null, { range: 'bytes=0-7' });
    assert.equal(part.status, 206);
    assert.deepEqual(part.bytes, bytes.subarray(0, 8));
    await plain();
  });
});

// ====================================================================== the page
describe('the page as the server sends it', () => {
  before(plain);

  test("a new cinema's page: its name for a title, Open Matte's drawn icon, and no theme", async () => {
    for (const url of PAGES) {
      const p = await page(url);
      asCinema(p);
      assert.equal(p.meta['theme-color'], DEFAULTS.backgroundColor, url);
      assert.deepEqual([...p.html.matchAll(/<style\b[^>]*>.*?<\/style>/gs)].map((m) => m[0]), ['<style id="theme">:root{}</style>'], `${url}: an empty theme`);
      assert.deepEqual(iconLinks(p), [['/favicon.svg', 'image/svg+xml']], url);
      assert.ok(!p.links.some((l) => l.rel === 'apple-touch-icon'), url);
      assert.ok(p.html.indexOf('name="theme-color"') < p.html.indexOf('</head>'), `${url}: in the head`);
      assert.match(p.headers.get('cache-control'), /no-cache/, url);
    }
    // /index.html is the same page, not the raw template.
    assert.equal((await page('/index.html')).html, (await page('/')).html);
  });

  test("the cinema's name is the page's title and its name in previews, escaped", async () => {
    const name = `Rosie & Jim's <"Picture"> House`;
    await save({ cinemaName: name });
    try {
      for (const url of ['/', '/index.html', '/arrival', `/t/${UNKNOWN}`]) {
        const p = await page(url);
        asCinema(p, { name });
        assert.ok(!p.html.includes(name), `${url}: never written as it is`);
      }
      const t = await issue();
      const p = await page(`/t/${t.code}`);
      asFilm(p, t, { name });
      assert.ok(!p.html.includes(name));
    } finally {
      await save({ cinemaName: 'Open Matte' });
    }
  });

  test("every page carries the site's public settings, exactly as /api/site gives them, so the header has them from the first paint", async () => {
    const t = await issue();
    const urls = [...PAGES, `/t/${t.code}`];
    const site = async () => (await fresh().get('/api/site')).data;
    for (const url of urls) assert.deepEqual(siteDataOf((await page(url)).html), await site(), url);
    try {
      // Every branding setting changed: still exactly /api/site.
      await save({ cinemaName: 'The Rex', accentColor: ACCENT, backgroundColor: BACKGROUND, logoWithName: false });
      const logo = await uploaded('logo', pngImage(300, 100));
      await uploaded('icon', pngImage(64, 64));
      const now = await site();
      assert.deepEqual(now.logo, logo);
      for (const url of urls) assert.deepEqual(siteDataOf((await page(url)).html), now, url);
      // The same for a viewer as for a stranger: it's the site's, not the browser's.
      const viewer = await opened(fresh(), await issue());
      assert.deepEqual(siteDataOf((await page('/arrival', viewer)).html), now);
    } finally {
      await plain();
    }
  });

  test('a cinema name that tries to end the script, or the head, cannot', async () => {
    const name = `Rex</script><script>alert(1)</script><!--<script></head>&amp;`;
    await save({ cinemaName: name });
    try {
      const t = await issue();
      for (const url of ['/', '/arrival', `/t/${UNKNOWN}`, `/t/${t.code}`]) {
        const p = await page(url);
        assert.equal(siteDataOf(p.html).cinemaName, name, url);
        assert.equal(p.title, name, url);
        assert.ok(!p.html.includes(name) && !p.html.includes('<script>alert'), `${url}: never written as it is`);
        // The template's script and the site's: no more.
        assert.equal([...p.html.matchAll(/<script\b/g)].length, 2, url);
        assert.equal(p.html.split('</head>').length, 2, `${url}: one </head>`);
      }
    } finally {
      await save({ cinemaName: 'Open Matte' });
    }
  });

  test('with a logo, every viewer page asks for it with the page, before the app has run; the admin and a cinema without one, never', async () => {
    const t = await issue();
    const urls = [...PAGES, `/t/${t.code}`];
    const admin = (url) => /^\/admin(\/|$)/.test(url);
    const preloads = (p) => p.links.filter((l) => l.rel === 'preload' && l.as === 'image');
    for (const url of urls) assert.deepEqual(preloads(await page(url)), [], url);
    const logo = await uploaded('logo', pngImage(600, 200, [4, 4, 4]));
    try {
      for (const url of urls) {
        const p = await page(url);
        assert.deepEqual(preloads(p).map((l) => l.href), admin(url) ? [] : [logo.url], url);
        if (!admin(url)) assert.ok(preloads(p)[0].at < p.html.indexOf('</head>'), `${url}: in the head`);
      }
    } finally {
      await remove('logo');
    }
    assert.deepEqual(preloads(await page('/')), []);
  });

  test('saved colours are in the page from its first byte, after the stylesheet, with a matching theme-color', async () => {
    await save({ accentColor: ACCENT, backgroundColor: BACKGROUND });
    for (const url of PAGES) {
      const p = await page(url);
      assert.deepEqual(themeOf(p.html), THEME, url);
      const style = p.html.indexOf('<style id="theme">');
      assert.ok(style > p.html.indexOf('<link rel="stylesheet"'), `${url}: after the stylesheet, so it wins`);
      assert.ok(style < p.html.indexOf('</head>'), `${url}: in the head`);
      assert.equal(p.meta['theme-color'], BACKGROUND, url);
    }
    // Only what differs from Open Matte's own.
    await save({ backgroundColor: DEFAULTS.backgroundColor });
    assert.deepEqual(themeOf((await page('/')).html), ACCENT_THEME);
    await save({ accentColor: DEFAULTS.accentColor, backgroundColor: BACKGROUND });
    assert.deepEqual(themeOf((await page('/')).html), BG_THEME);
    await save(DEFAULTS);
    assert.equal(themeOf((await page('/')).html), null);
  });

  test("with no icon uploaded, the tab shows Open Matte's icon in the cinema's colours, at an address that changes with them", async () => {
    const svg = async (url = '/favicon.svg') => {
      const f = await fetchFile(url);
      assert.equal(f.status, 200);
      assert.equal(f.headers.get('content-type').split(';')[0], 'image/svg+xml');
      assert.equal(f.headers.get('cache-control'), 'no-cache');
      return f.bytes.toString();
    };
    const href = async () => {
      const icons = iconLinks(await page('/'));
      assert.equal(icons.length, 1);
      assert.equal(icons[0][1], 'image/svg+xml');
      return icons[0][0];
    };
    assert.equal(await svg(), FAVICON, "Open Matte's own, not the build's copy");
    assert.equal(await href(), '/favicon.svg');

    await save({ accentColor: ACCENT });
    assert.equal(await svg(), FAVICON.replaceAll('#e8b04a', ACCENT));
    const first = await href();
    assert.match(first, /^\/favicon\.svg\?v=[0-9a-f]{8}$/);

    await save({ backgroundColor: BACKGROUND });
    assert.equal(await svg(), FAVICON.replace('#111014', FAVICON_SQUARE).replaceAll('#e8b04a', ACCENT));
    assert.equal(await svg('/favicon.svg?v=00000000'), await svg(), 'whatever the version says, the current icon');
    const second = await href();
    assert.match(second, /^\/favicon\.svg\?v=[0-9a-f]{8}$/);
    assert.notEqual(second, first);

    await save({ backgroundColor: DEFAULTS.backgroundColor });
    assert.equal(await href(), first, 'the same colours, the same address');
    await save(DEFAULTS);
    assert.equal(await href(), '/favicon.svg');
    assert.equal(await svg(), FAVICON);
  });

  test('an uploaded tab icon replaces the drawn one, and is the home-screen icon too', async () => {
    await save({ accentColor: ACCENT });
    const icon = await uploaded('icon', pngImage(512, 512));
    for (const url of ['/', '/arrival', `/t/${UNKNOWN}`]) {
      const p = await page(url);
      assert.deepEqual(iconLinks(p), [[icon.url, 'image/png']], url);
      assert.deepEqual(p.links.filter((l) => l.rel === 'apple-touch-icon').map((l) => l.href), [icon.url], url);
      assert.ok(!p.html.includes('/favicon.svg'), url);
    }
    await remove('icon');
    assert.match(iconLinks(await page('/'))[0][0], /^\/favicon\.svg\?v=[0-9a-f]{8}$/);
    await plain();
  });

  test("with a logo, every page that isn't a ticket's preview shows it in link previews", async () => {
    const logo = await uploaded('logo', pngImage(600, 200));
    for (const url of PAGES) asCinema(await page(url), { logo });
    // A ticket's preview shows its film's poster instead.
    const t = await issue();
    asFilm(await page(`/t/${t.code}`), t);
    await remove('logo');
    asCinema(await page('/'));
  });

  test("the page's ETag follows what it says, so no browser keeps an old name or colour", async () => {
    const first = await fetch(`${srv.base}/`);
    await first.text();
    const etag = first.headers.get('etag');
    assert.ok(etag);
    // fetch would otherwise add "Cache-Control: no-cache" to a conditional request,
    // which asks for a full answer.
    const revalidate = { 'if-none-match': etag, 'cache-control': 'max-age=0' };
    const same = await fetch(`${srv.base}/`, { headers: revalidate });
    assert.equal(same.status, 304, 'unchanged, so not sent again');
    await save({ accentColor: ACCENT });
    const changed = await fetch(`${srv.base}/`, { headers: revalidate });
    assert.equal(changed.status, 200);
    await changed.text();
    assert.notEqual(changed.headers.get('etag'), etag);
    await save(DEFAULTS);
  });

  test('a new build of the web app is picked up without a restart', async () => {
    const index = path.join(webDist, 'index.html');
    const touch = (seconds) => {
      const t = new Date(Date.now() + seconds * 1000);
      fs.utimesSync(index, t, t);
    };
    fs.writeFileSync(index, TEMPLATE.replace('<title>', '<meta name="build" content="second" />\n    <title>'));
    touch(60);
    try {
      const p = await page('/');
      assert.equal(p.meta.build, 'second');
      asCinema(p);
    } finally {
      fs.writeFileSync(index, TEMPLATE);
      touch(120);
    }
    assert.equal((await page('/')).meta.build, undefined);
  });
});

// ====================================================================== ticket previews
describe('ticket link previews', () => {
  before(plain);

  test('a ticket link for anyone previews its film: the title and year, from the cinema, with the poster at an address of its own', async () => {
    const t = await issue();
    const p = await page(`/t/${t.code}`);
    const address = asFilm(p, t);
    const poster = await posterOf(address);
    assert.equal(poster.status, 200);
    assert.deepEqual(poster.bytes, POSTER);
    assert.equal(poster.headers.get('content-type').split(';')[0], 'image/jpeg');
    assert.equal(poster.headers.get('cache-control'), 'public, max-age=600');
    assert.equal(poster.headers.get('x-content-type-options'), 'nosniff');
    // The same address each time; another ticket's is another.
    assert.equal(asFilm(await page(`/t/${t.code}`), t), address);
    const other = await issue();
    assert.notEqual(asFilm(await page(`/t/${other.code}`), other), address);
  });

  test("the poster's address works only as it was given: a wrong mac, another ticket's id or anything malformed is not found, saying nothing", async () => {
    const a = await issue();
    const b = await issue({}, 'heat');
    const addressA = asFilm(await page(`/t/${a.code}`), a);
    const addressB = asFilm(await page(`/t/${b.code}`), b, { title: 'Heat (1995)' });
    const { id, mac } = refOf(addressA);
    const other = refOf(addressB);
    const nothing = await posterOf(NO_POSTER);
    assert.equal(nothing.status, 404);
    const refused = [
      // One character of the mac changed: the first, one in the middle, the last.
      ...[0, 11, 21].map((i) => `${id}.${flip(mac, i)}`),
      // Another ticket's id with this mac, and this id with the other's mac.
      `${other.id}.${mac}`,
      `${id}.${other.mac}`,
      // An id that is no ticket's.
      `${Number(id) + 1000}.${mac}`,
      // Malformed.
      id,
      `${id}.`,
      `.${mac}`,
      `${id}.${mac.slice(0, 21)}`,
      `${id}.${mac}A`,
      `${id}.${mac}.jpg`,
      `${id},${mac}`,
      `${id}..${mac}`,
      `+${id}.${mac}`,
      `-${id}.${mac}`,
      `0x${Number(id).toString(16)}.${mac}`,
      `${'1'.repeat(13)}.${mac}`,
      `${id}.${mac.slice(0, 21)}=`,
      `${id}.${mac.slice(0, 21)}+`,
      `${id}.${mac.slice(0, 21)}%2F`,
      `${id}.${mac}%00`,
      `%20${id}.${mac}`,
      `${id}.${mac}%20`,
      // The ticket's code is no poster's address either.
      a.code,
      `${a.code}.${mac}`,
    ];
    if (mac.toUpperCase() !== mac) refused.push(`${id}.${mac.toUpperCase()}`);
    for (const ref of refused) {
      const f = await posterOf(`/poster/${ref}`);
      assert.equal(f.status, 404, ref);
      assert.deepEqual(f.bytes, nothing.bytes, `${ref}: never saying why`);
      assert.doesNotMatch(f.headers.get('content-type') || '', /^image\//, ref);
    }
    // As given, both still work.
    for (const address of [addressA, addressB]) assert.equal((await posterOf(address)).status, 200, address);
  });

  test('a range past the end of the poster is a 416, and a failed If-Match a 412; neither is described or cached as the poster', async () => {
    const t = await issue();
    const address = asFilm(await page(`/t/${t.code}`), t);
    const beyond = await fetchFile(address, null, { range: 'bytes=99999999-' });
    assert.equal(beyond.status, 416);
    assert.equal(beyond.headers.get('content-range'), `bytes */${POSTER.length}`);
    notTheFile(beyond, 'a range past the end');
    const changed = await fetchFile(address, null, { 'if-match': '"nope"' });
    assert.equal(changed.status, 412);
    notTheFile(changed, 'a failed If-Match');
  });

  test("the page of a ticket's link never holds its code, and the poster's address opens nothing: not the ticket, not a session", async () => {
    const t = await issue();
    // asFilm checks the page for the code, whatever its case.
    const address = asFilm(await page(`/t/${t.code}`), t);
    const { id, mac } = refOf(address);
    const b = fresh();
    assert.equal((await posterOf(address, b)).status, 200);
    for (const code of [`${id}.${mac}`, mac, id, `${id}${mac}`, address, srv.base + address]) {
      const r = await b.post('/api/tickets/open', { code });
      assert.notEqual(r.status, 200, code);
      assert.equal(r.data.slug, undefined, code);
    }
    for (const url of [`/t/${id}.${mac}`, `/t/${mac}`, `/t/${id}`]) asCinema(await page(url, b));
    assert.equal(b.jar.size, 0, 'no session');
    assert.deepEqual((await b.get('/api/me')).data.tickets, []);
    assert.equal((await b.get('/api/films/arrival')).status, 404);
    assert.equal((await adminTicket(t.id)).firstOpenedAt, null);
  });

  test('the key that makes poster addresses stays on the server, and is the same after a restart', async () => {
    const t = await issue();
    const address = asFilm(await page(`/t/${t.code}`), t);
    const rows = srv.db.prepare("SELECT value FROM settings WHERE key LIKE '%previewKey%'").all();
    assert.equal(rows.length, 1, 'kept with the settings');
    let key = rows[0].value;
    try {
      key = JSON.parse(key);
    } catch {
      // Stored as it is.
    }
    assert.ok(typeof key === 'string' && key.length >= 43, '32 random bytes, at least');
    const viewer = await opened(fresh(), await issue());
    const sent = [
      (await page(`/t/${t.code}`)).html,
      (await page('/admin', admin)).html,
      (await fresh().get('/api/site')).data,
      (await viewer.get('/api/me')).data,
      await adminSettings(),
      (await admin.get('/api/admin/tickets')).data,
      await adminTicket(t.id),
    ];
    for (const body of sent) assert.ok(!JSON.stringify(body).includes(key), JSON.stringify(body).slice(0, 80));
    // Another server on the same database, as after a restart: the same address.
    const app = createApp({ db: srv.db, mediaDir, dataDir, webDist, backupOptions: { backupDir: null }, metadataOptions: { envKey: '' }, webauthn: { publicUrl: '', rpId: '', production: false } });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const p = parsePage(await (await fetch(`${base}/t/${t.code}`)).text());
      assert.equal(p.meta['og:image'], base + address);
      assert.equal(srv.db.prepare("SELECT value FROM settings WHERE key LIKE '%previewKey%'").all().length, 1);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('/t/<code>/poster is no longer a poster: no image address holds a code', async () => {
    const t = await issue();
    asFilm(await page(`/t/${t.code}`), t);
    const f = await fetchFile(`/t/${t.code}/poster`);
    assert.doesNotMatch(f.headers.get('content-type') || '', /^image\//);
    assert.notDeepEqual(f.bytes, POSTER);
    // Just another address under /t/ that isn't a ticket's.
    if (f.status === 200) asCinema(await page(`/t/${t.code}/poster`));
    else assert.equal(f.status, 404);
  });

  test('reading the preview and its poster records nothing: no session, no "opened", no event, not even "last seen"', async () => {
    const t = await issue();
    const address = asFilm(await page(`/t/${t.code}`), t);
    // A browser holding a session from another ticket, last seen an hour ago.
    const b = await opened(fresh(), await issue({}, 'heat'), 'heat');
    const hash = sha256(b.jar.get('om_session'));
    const anHourAgo = Date.now() - 60 * 60 * 1000;
    srv.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(anHourAgo, hash);
    const before = totals();
    for (let i = 0; i < 3; i++) {
      assert.equal(asFilm(await page(`/t/${t.code}`), t), address);
      assert.equal(asFilm(await page(`/t/${t.code}`, b), t), address);
      assert.equal((await posterOf(address)).status, 200);
      assert.equal((await posterOf(address, b)).status, 200);
    }
    assert.deepEqual(totals(), before, 'no session, session_tickets row, screening, event or first open');
    const a = await adminTicket(t.id);
    assert.equal(a.firstOpenedAt, null);
    assert.equal(a.browsers, 0);
    assert.equal(a.lastActivity, null);
    assert.deepEqual((await admin.get(`/api/admin/activity?ticket=${t.id}`)).data.events, []);
    assert.equal(srv.db.prepare('SELECT last_seen_at FROM sessions WHERE id_hash = ?').get(hash).last_seen_at, anHourAgo);
  });

  test('an expired or used-up link ticket still previews its film, as opening it still shows the film', async () => {
    const expired = await issue({ startBy: Date.now() - 1000 });
    const usedUp = await issue({ screeningLimit: 1 });
    const b = await opened(fresh(), usedUp);
    assert.equal((await b.post('/api/films/arrival/screenings')).status, 200);
    srv.db.prepare('UPDATE screenings SET resumable_until = ? WHERE ticket_id = ?').run(Date.now() - 1, usedUp.id);
    assert.equal((await adminTicket(expired.id)).state, 'expired');
    assert.equal((await adminTicket(usedUp.id)).state, 'used_up');
    for (const t of [expired, usedUp]) {
      const address = asFilm(await page(`/t/${t.code}`), t);
      assert.equal((await posterOf(address)).status, 200);
    }
  });

  test("a ticket for one person previews as the cinema, even to them: neither the film nor the person's name, and no poster", async () => {
    const sam = await member('Samantha Previewson');
    // Kept: opened while it was for anyone, then kept in Sam's account. Its preview
    // gave out its poster's address while it was for anyone.
    const kept = await issue({ claimable: true });
    const keptPoster = asFilm(await page(`/t/${kept.code}`), kept);
    await opened(sam.phone, kept);
    const k = await sam.phone.post('/api/films/arrival/keep');
    assert.equal(k.status, 200, JSON.stringify(k.data));
    const forSam = await issue({ personId: sam.p.id });
    // Given: a ticket for anyone that the admin gave to Sam.
    const given = await issue();
    const givenPoster = asFilm(await page(`/t/${given.code}`), given);
    assert.equal((await admin.post(`/api/admin/tickets/${given.id}/holder`, { personId: sam.p.id })).status, 200);
    // Sam's phone, last seen an hour ago.
    const hash = sha256(sam.phone.jar.get('om_session'));
    const anHourAgo = Date.now() - 60 * 60 * 1000;
    srv.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(anHourAgo, hash);

    const unknown = await page(`/t/${UNKNOWN}`);
    asCinema(unknown);
    const nothing = await posterOf(NO_POSTER);
    assert.equal(nothing.status, 404);
    const before = totals();
    for (const [t, poster] of [[forSam, null], [kept, keptPoster], [given, givenPoster]]) {
      assert.equal((await adminTicket(t.id)).person?.id, sam.p.id);
      for (const b of [null, sam.phone]) {
        const p = await page(`/t/${t.code}`, b);
        asCinema(p);
        assert.equal(p.html, unknown.html, "the same page as for a code that isn't a ticket");
        assert.ok(!p.html.includes('Samantha'));
        // A ticket issued for Sam never had a preview to give its poster's address out.
        if (!poster) continue;
        const f = await posterOf(poster, b);
        assert.equal(f.status, 404);
        assert.deepEqual(f.bytes, nothing.bytes, 'never saying why');
      }
    }
    // None of that was recorded: no session, no "opened", no event, Sam's phone not even seen.
    assert.deepEqual(totals(), before, 'no session, session_tickets row, screening, event or first open');
    for (const t of [forSam, given]) assert.equal((await adminTicket(t.id)).firstOpenedAt, null);
    assert.equal(srv.db.prepare('SELECT last_seen_at FROM sessions WHERE id_hash = ?').get(hash).last_seen_at, anHourAgo);

    // Let anyone with the link use it again, and it previews the film again, with the same poster.
    assert.equal((await admin.post(`/api/admin/tickets/${given.id}/holder`, { personId: null })).status, 200);
    assert.equal(asFilm(await page(`/t/${given.code}`), given), givenPoster);
    assert.equal((await posterOf(givenPoster)).status, 200);
  });

  test("a revoked ticket, a film that isn't showing and a code that isn't a ticket preview as the cinema, and no poster", async () => {
    // Their posters' addresses, given out while they still previewed their films.
    const revoked = await issue();
    const revokedPoster = asFilm(await page(`/t/${revoked.code}`), revoked);
    assert.equal((await admin.post(`/api/admin/tickets/${revoked.id}/revoke`)).status, 200);
    const showSolaris = async (published) => assert.equal((await admin.patch(`/api/admin/films/${films.solaris}`, { published })).status, 200);
    await showSolaris(true);
    let unpublished;
    let unpublishedPoster;
    try {
      unpublished = await issue({}, 'solaris');
      unpublishedPoster = asFilm(await page(`/t/${unpublished.code}`), unpublished, { title: 'Solaris (1972)' });
    } finally {
      await showSolaris(false);
    }

    const unknown = await page(`/t/${UNKNOWN}`);
    const nothing = await posterOf(NO_POSTER);
    assert.equal(nothing.status, 404);
    const before = totals();
    for (const code of [revoked.code, unpublished.code, UNKNOWN, 'abcd', 'a'.repeat(64)]) {
      const p = await page(`/t/${code}`);
      asCinema(p);
      assert.equal(p.html, unknown.html, code);
    }
    for (const address of [revokedPoster, unpublishedPoster]) {
      const f = await posterOf(address);
      assert.equal(f.status, 404, address);
      assert.deepEqual(f.bytes, nothing.bytes, `${address}: never saying why`);
    }
    assert.deepEqual(totals(), before, 'no session, session_tickets row, screening, event or first open');
    for (const t of [revoked, unpublished]) assert.equal((await adminTicket(t.id)).firstOpenedAt, null);

    // Restored, it previews its film again, with the same poster.
    assert.equal((await admin.post(`/api/admin/tickets/${revoked.id}/restore`)).status, 200);
    assert.equal(asFilm(await page(`/t/${revoked.code}`), revoked), revokedPoster);
    assert.equal((await posterOf(revokedPoster)).status, 200);
  });

  test('the code in the address may be in capitals: the same preview, and the code in neither case in the page', async () => {
    const t = await issue();
    const upper = t.code.toUpperCase();
    assert.notEqual(upper, t.code);
    const address = asFilm(await page(`/t/${upper}`), t);
    assert.equal(address, asFilm(await page(`/t/${t.code}`), t));
    const poster = await posterOf(address);
    assert.equal(poster.status, 200);
    assert.deepEqual(poster.bytes, POSTER);
  });

  test('a code with a letter percent-encoded previews its film too, and the page holds the code in neither form', async () => {
    const t = await issue();
    const encoded = `%${t.code.charCodeAt(0).toString(16)}${t.code.slice(1)}`;
    const p = await page(`/t/${encoded}`);
    const address = asFilm(p, t);
    assert.ok(!p.html.toLowerCase().includes(encoded.toLowerCase()));
    assert.equal(address, asFilm(await page(`/t/${t.code}`), t));
    assert.equal((await posterOf(address)).status, 200);
  });

  test("an address that isn't a ticket code is just the cinema's page, and records nothing", async () => {
    const t = await issue();
    const unknown = await page(`/t/${UNKNOWN}`);
    const odd = ['abc', 'a'.repeat(65), `${t.code}-x`, `${t.code}_`, `${t.code}.`, `${t.code}%00`, "abcd'efgh", '%3Cscript%3Ealert(1)%3C%2Fscript%3E', `${t.code}%22%3E%3Cb%3E`];
    const before = totals();
    for (const code of odd) {
      const p = await page(`/t/${code}`);
      assert.equal(p.html, unknown.html, code);
      assert.ok(!p.html.includes('<script>alert') && !p.html.includes('<b>'), code);
    }
    // One segment after /t/, no more.
    asCinema(await page(`/t/${t.code}/more`));
    assert.deepEqual(totals(), before);
    assert.equal((await adminTicket(t.id)).firstOpenedAt, null);
  });

  test('a film with no year is previewed by its title alone, and one with no poster has no poster to show', async () => {
    const stalker = await issue({}, 'stalker');
    const png = await posterOf(asFilm(await page(`/t/${stalker.code}`), stalker, { title: 'Stalker' }));
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type').split(';')[0], 'image/png');
    assert.deepEqual(png.bytes, PNG_POSTER);

    const mirror = await issue({}, 'mirror');
    asFilm(await page(`/t/${mirror.code}`), mirror, { title: 'Mirror (1975)', poster: false });
  });

  test("a film whose folder is missing previews without a poster, unless TMDb's was downloaded", async () => {
    const arrival = await issue();
    const heat = await issue({}, 'heat');
    // Arrival's poster's address, given out while its folder was there.
    const arrivalPoster = asFilm(await page(`/t/${arrival.code}`), arrival);
    const setStatus = srv.db.prepare('UPDATE films SET media_status = ? WHERE slug = ?');
    const was = srv.db.prepare('SELECT slug, media_status FROM films WHERE slug IN (?, ?)').all('arrival', 'heat');
    try {
      for (const slug of ['arrival', 'heat']) setStatus.run('missing', slug);
      asFilm(await page(`/t/${arrival.code}`), arrival, { poster: false });
      assert.equal((await posterOf(arrivalPoster)).status, 404);
      const heatPoster = asFilm(await page(`/t/${heat.code}`), heat, { title: 'Heat (1995)' });
      assert.equal((await posterOf(heatPoster)).status, 200);
    } finally {
      for (const { slug, media_status } of was) setStatus.run(media_status, slug);
    }
    assert.equal((await posterOf(arrivalPoster)).status, 200, 'its folder back, its poster back');
  });

  test("the film's title is escaped like everything else", async () => {
    const t = await issue({}, 'tomjerry');
    const p = await page(`/t/${t.code}`);
    asFilm(p, t, { title: 'Tom & "Jerry" <Live> (1940)' });
    assert.ok(!p.html.includes('<Live>'));
  });

  test("the poster is the film's current one: TMDb's when it was downloaded, and never a file outside the film's folder", async () => {
    const heat = await issue({}, 'heat');
    const poster = await posterOf(asFilm(await page(`/t/${heat.code}`), heat, { title: 'Heat (1995)' }));
    assert.equal(poster.status, 200);
    assert.deepEqual(poster.bytes, TMDB_POSTER);
    assert.equal(poster.headers.get('content-type').split(';')[0], 'image/jpeg');

    // Sneaky's poster is a link to a file outside its folder. Its address, given out
    // while the poster was a file of the folder's own, serves nothing once it's the link again.
    const sneaky = await issue({}, 'sneaky');
    const link = path.join(mediaDir, 'sneaky', 'poster.jpg');
    const outside = fs.readlinkSync(link);
    let address;
    fs.rmSync(link);
    fs.writeFileSync(link, POSTER);
    try {
      address = asFilm(await page(`/t/${sneaky.code}`), sneaky, { title: 'Sneaky (2001)' });
      assert.equal((await posterOf(address)).status, 200);
    } finally {
      fs.rmSync(link);
      fs.symlinkSync(outside, link);
    }
    const linked = await posterOf(address);
    assert.equal(linked.status, 404);
    assert.ok(!linked.bytes.toString().includes('not for anyone'));
  });
});

// ====================================================================== the rate limit
describe('the preview rate limit', () => {
  const servers = [];
  after(() => Promise.all(servers.map((s) => s.close())));

  // A server of its own, so the count starts at nothing: one film, one ticket link
  // for anyone, and every limit at a tenth (six previews in ten minutes, and one
  // admin sign-in). get() fetches as a messaging app's server would, from the
  // address `from` as the proxy in front passes it on (X-Forwarded-For), or from
  // this machine.
  async function limited() {
    const dir = tempDir();
    makeFilm(dir, 'arrival');
    const s = await startServer({ mediaDir: dir, webDist, limits: { scale: 0.1 } });
    servers.push(s);
    const a = await adminBrowser(s.base);
    await a.post('/api/admin/scan');
    const film = (await a.get('/api/admin/films')).data[0];
    assert.equal((await a.patch(`/api/admin/films/${film.id}`, { published: true })).status, 200);
    const code = (await a.post('/api/admin/tickets', { filmId: film.id })).data[0].code;
    const get = async (url, from) => {
      const res = await fetch(s.base + url, { headers: from ? { 'x-forwarded-for': from } : {} });
      return { status: res.status, body: await res.text() };
    };
    // The page's preview, and its poster's address.
    const preview = async (from) => {
      const r = await get(`/t/${code}`, from);
      assert.equal(r.status, 200, 'never a 429 for a page');
      const p = parsePage(r.body);
      return { title: p.meta['og:title'], html: p.html, poster: p.meta['og:image'] && new URL(p.meta['og:image']).pathname };
    };
    return { code, get, preview };
  }

  test('the page and the poster count together, 60 in ten minutes; over the limit the page is still served, as the cinema, and the poster is not found', async () => {
    const { get, preview } = await limited();
    const first = await preview();
    assert.equal(first.title, 'Arrival (2016)');
    assert.match(first.poster, POSTER_PATH);
    // Posters until one is refused. At a tenth of the limit, six previews: the page,
    // then five posters.
    let n = 1;
    let poster;
    do {
      poster = await get(first.poster);
      n++;
    } while (poster.status === 200 && n < 61);
    assert.equal(poster.status, 404, `refused after ${n} requests`);
    assert.equal(n, 7, 'the page and five posters, and the sixth poster is refused');
    for (let i = 0; i < 5; i++) {
      const p = await preview();
      assert.equal(p.title, 'Open Matte');
      assert.ok(!p.html.includes('Arrival') && !p.html.includes('/poster'));
      assert.equal((await get(first.poster)).status, 404);
    }
  });

  test("page loads count on their own, codes that aren't tickets too; each visitor has a limit of their own", async () => {
    const { get, preview } = await limited();
    // The poster's address, as another visitor's preview gave it.
    const { poster } = await preview('203.0.113.1');
    assert.match(poster, POSTER_PATH);
    // Six page loads of a code that is no ticket use up this visitor's previews...
    const visitor = '198.51.100.7';
    for (let i = 0; i < 6; i++) {
      const r = await get(`/t/${UNKNOWN}`, visitor);
      assert.equal(r.status, 200);
      assert.equal(parsePage(r.body).meta['og:title'], 'Open Matte');
    }
    // ...so the ticket's page previews as the cinema, and its poster is not found.
    const over = await preview(visitor);
    assert.equal(over.title, 'Open Matte');
    assert.ok(!over.html.includes('Arrival') && !over.html.includes('/poster'));
    assert.equal((await get(poster, visitor)).status, 404);
    // Someone else still gets the film, and its poster.
    assert.equal((await preview('192.0.2.44')).title, 'Arrival (2016)');
    assert.equal((await get(poster, '192.0.2.44')).status, 200);
  });
});
