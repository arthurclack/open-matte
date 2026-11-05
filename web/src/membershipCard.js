// The membership card's workings, apart from React: the number's grouping, the
// Codabar barcode, the ink the card is printed in, and the seeded randomness that
// makes the print a little uneven but the same every time. No DOM here, so the tests
// can load it in Node (test/membership.test.js). The number itself is worked out by
// the server (server/membership.js).

// ------------------------------------------------------------ the number

// "5040 1811 463": 4, 4 and 3 digits.
export const groupNumber = (digits) => `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;

// ------------------------------------------------------------ Codabar

// Codabar, as a till's scanner reads it: each character is 7 elements (bar, space,
// bar, ...), each narrow or wide; here a set bit is wide, the first element the
// highest bit. Start A, stop B, digits between.
const CHARS = '0123456789-$:/.+ABCD';
const CODES = [0x003, 0x006, 0x009, 0x060, 0x012, 0x042, 0x021, 0x024, 0x030, 0x048, 0x00c, 0x018, 0x045, 0x051, 0x054, 0x015, 0x01a, 0x029, 0x00b, 0x00e];

// What the barcode spells: the start, the data, the stop.
export const codabarText = (data, start = 'A', stop = 'B') => `${start}${data}${stop}`;

// The bars of `text` (codabarText's) in whole device pixels: narrow `n`, wide `w`, one
// narrow space between characters, starting at x = 0. -> { bars: [[x, width]], width }.
// Codabar allows wide to narrow from 2:1 to 3:1; 2.5:1 is what's asked for, and on a
// screen it's the nearest whole pixels that fit.
export function codabarPx(text, n, w) {
  const bars = [];
  let x = 0;
  for (let i = 0; i < text.length; i++) {
    const k = CHARS.indexOf(text[i]);
    // A to D only start and stop it.
    if (k < 0 || (k >= 16 && i > 0 && i < text.length - 1)) throw new Error(`Codabar can't hold ${text[i]} there`);
    for (let e = 0; e < 7; e++) {
      const width = (CODES[k] >> (6 - e)) & 1 ? w : n;
      if (e % 2 === 0) bars.push([x, width]);
      x += width;
    }
    if (i < text.length - 1) x += n;
  }
  return { bars, width: x };
}

// The bars for a label `available` CSS pixels wide on a screen of `dpr` device pixels
// per CSS pixel, with a narrow bar's width of blank at each end so the label's edge
// never trims one. -> { n, w, bars, width } in device pixels, or null when even 1 px
// won't fit.
//
// First the widest narrow bar that fits at all (at 2:1), since a thin bar is what a
// scanner misses. Then, at that width, wide bars of 2.5 narrow ones (to the nearest
// whole pixel, 3 when narrow is 1), or as near as fits down to 2.25:1, the least the
// Codabar standard (AIM BC3) allows for bars this thin. Only when none of those fits
// does it print 2:1, rather than drop to bars half as thin: the label is sized
// (membershipCard.css) so that on a 2x or 3x screen, and at 1x on a 440px card, it
// never has to.
export function fitCodabar(text, available, dpr = 1) {
  const room = Math.floor(available * dpr);
  const fit = (n, w) => {
    const r = codabarPx(text, n, w);
    return r.width + 2 * n <= room ? { n, w, bars: r.bars.map(([x, bw]) => [x + n, bw]), width: r.width + 2 * n } : null;
  };
  for (let n = Math.max(1, Math.floor(room / 100)); n >= 1; n--) {
    if (!fit(n, 2 * n)) continue;
    for (let w = Math.round(2.5 * n); w >= Math.ceil(2.25 * n); w--) {
      const r = fit(n, w);
      if (r) return r;
    }
    return fit(n, 2 * n);
  }
  return null;
}

// ------------------------------------------------------------ the ink

// Open Matte's own accent (server/theme.js DEFAULT_ACCENT): a shop that hasn't chosen
// a colour prints in the blue of an old TV's blue screen instead.
export const DEFAULT_ACCENT = '#e8b04a';
export const PRINT_BLUE = '#2030c8';
// The card it's printed on.
export const CARD_STOCK = '#e9dfc9';

const HEX = /^#[0-9a-f]{6}$/i;
const channels = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const toHex = (cs) => `#${cs.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

// As server/theme.js has them: `amount` of `b` into `a`, and WCAG 2's contrast ratio.
export function mix(a, b, amount) {
  const [x, y] = [channels(a), channels(b)];
  return toHex(x.map((c, i) => c + (y[i] - c) * amount));
}
function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// OKLCH, to darken a colour without greying it: lightness down, hue and chroma kept
// (chroma only as far as a screen can show it).
const toLinear = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const toGamma = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function oklch(hex) {
  const [r, g, b] = channels(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}
function fromOklch(L, C, h) {
  const rgb = (c) => {
    const A = c * Math.cos(h);
    const B = c * Math.sin(h);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  };
  let c = C;
  let v = rgb(c);
  while (c > 0 && v.some((x) => x < -1e-4 || x > 1 + 1e-4)) {
    c = Math.max(0, c - 0.002);
    v = rgb(c);
  }
  return toHex(v.map((x) => toGamma(Math.min(1, Math.max(0, x)))));
}

// The ink a shop's cards are printed in, from its accent colour. The accent is chosen
// to read on the app's dark page, so it's usually too light for cream card: it is
// darkened, keeping its hue, until it reads. "Reads" is judged the hard way: the ink
// where it's thinnest (88% cover) on the card where its grain is darkest (10% shade),
// at 4.5:1, so plain text in it, and the card showing through the solid band, read
// at more than that. Open Matte's own accent prints in PRINT_BLUE.
// -> { ink, source: 'default' | 'accent' | 'black' }
export function printInk(accent, { stock = CARD_STOCK, need = 4.5, cover = 0.88, shade = 0.1 } = {}) {
  const a = typeof accent === 'string' && HEX.test(accent) ? accent.toLowerCase() : null;
  if (!a || a === DEFAULT_ACCENT) return { ink: PRINT_BLUE, source: 'default' };
  const paper = mix(stock, '#000000', shade);
  const worst = (ink) => contrast(mix(paper, ink, cover), paper);
  if (worst(a) >= need) return { ink: a, source: 'accent' };
  const [L0, C, h] = oklch(a);
  for (let L = Math.floor(L0 * 100); L >= 0; L--) {
    const ink = fromOklch(L / 100, C, h);
    if (worst(ink) >= need) return { ink, source: 'accent' };
  }
  return { ink: '#000000', source: 'black' };
}

// ------------------------------------------------------------ seeded unevenness

// A number from a string, then a generator of numbers from 0 to 1 from that: every
// card for the same number and shop is printed the same, render after render.
export function hash(s) {
  let h = 2166136261 >>> 0;
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
export function rng(seed) {
  let a = (typeof seed === 'number' ? seed : hash(seed)) >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.sign = () => (next() < 0.5 ? -1 : 1);
  return next;
}

const f2 = (n) => Math.round(n * 100) / 100;

// Where a sheet's grain starts (gx, gy, in CSS pixels), and the two plates'
// misregistration: how far the second colour sits off the first (x, y).
export function register(seed) {
  const r = rng(`${seed}:vars`);
  const gx = Math.round(r() * 128);
  const gy = Math.round(r() * 128);
  return { gx, gy, x: `${f2(r.range(0.25, 0.6) * r.sign())}px`, y: `${f2(r.range(0.2, 0.55) * r.sign())}px` };
}

// A guillotined card is never quite square: rounded corners of slightly different
// radii and a hair of wobble along each edge, as a clip-path polygon that fits any size.
export function cardEdge(seed, radius = 12) {
  const R = rng(`${seed}:edge`);
  const C = [0, 1, 2, 3].map(() => ({ r: Math.max(0.4, radius + R.range(-0.3, 0.5)), ox: R() * 0.45, oy: R() * 0.45 }));
  const pts = [];
  const P = (q) => `calc(${f2(q[0])}% + ${f2(q[1])}px) calc(${f2(q[2])}% + ${f2(q[3])}px)`;
  const arc = (cx, cy, r, a0, a1) => {
    const n = Math.max(2, Math.round(r / 1.5));
    for (let k = 0; k <= n; k++) {
      const t = a0 + ((a1 - a0) * k) / n;
      pts.push(P([cx[0], cx[1] + r * Math.cos(t), cy[0], cy[1] + r * Math.sin(t)]));
    }
  };
  const side = (from, to, nx, ny) => {
    for (let k = 1; k < 12; k++) {
      const t = k / 12;
      const j = R.range(-0.22, 0.22);
      pts.push(P([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t + nx * j, from[2] + (to[2] - from[2]) * t, from[3] + (to[3] - from[3]) * t + ny * j]));
    }
  };
  const [tl, tr, br, bl] = C;
  const Q = Math.PI / 2;
  arc([0, tl.r + tl.ox], [0, tl.r + tl.oy], tl.r, 2 * Q, 3 * Q);
  side([0, tl.r + tl.ox, 0, tl.oy], [100, -(tr.r + tr.ox), 0, tr.oy], 0, 1);
  arc([100, -(tr.r + tr.ox)], [0, tr.r + tr.oy], tr.r, 3 * Q, 4 * Q);
  side([100, -tr.ox, 0, tr.r + tr.oy], [100, -br.ox, 100, -(br.r + br.oy)], -1, 0);
  arc([100, -(br.r + br.ox)], [100, -(br.r + br.oy)], br.r, 0, Q);
  side([100, -(br.r + br.ox), 100, -br.oy], [0, bl.r + bl.ox, 100, -bl.oy], 0, -1);
  arc([0, bl.r + bl.ox], [100, -(bl.r + bl.oy)], bl.r, Q, 2 * Q);
  side([0, bl.ox, 100, -(bl.r + bl.oy)], [0, tl.ox, 0, tl.r + tl.oy], 1, 0);
  return `polygon(${pts.join(',')})`;
}

// The member's name in ballpoint: words drift a little off the line and lean, as a
// hand does. A double-barrelled name may break after its hyphen. -> [{ text, y, r, s, o }]
export function penWords(name, seed) {
  const R = rng(`${seed}:hand`);
  const phase = R() * 6.28;
  let i = 0;
  return name
    .split(/(\s+)/)
    .flatMap((t) => (/^\s+$/.test(t) ? [t] : t.split(/(?<=-)/)))
    .filter(Boolean)
    .map((t) => {
      if (/^\s+$/.test(t)) return { text: ' ' };
      const word = { text: t, y: f2(0.6 * Math.sin(i * 0.6 + phase) + R.range(-0.25, 0.25)), r: f2(R.range(-0.55, 0.55)), s: f2(1 + R.range(-0.018, 0.018)), o: f2(R.range(0.94, 1)) };
      i++;
      return word;
    });
}

// Typed on a typewriter: each strike lands a little harder or softer, never under `min`.
// -> [{ ch, o, x, y }]
export function strikes(text, seed, min = 0.86) {
  const R = rng(`${seed}:typed`);
  return [...text].map((ch) => {
    if (ch === ' ') return { ch };
    let o = R.range(min, 1);
    if (R() < 0.12) o = min + 0.02;
    return { ch, o: f2(o), y: f2(R.range(-0.25, 0.25)), x: f2(R.range(-0.15, 0.15)) };
  });
}

// What a reader takes for one letter: "é" made of e and an accent, a flag, a family
// emoji, a Hindi syllable with its vowel sign. Split anywhere inside one and it comes
// apart on the card.
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
export const graphemes = (s) => (segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : [...s]);

// Scripts whose letters stand on their own, so they can be set one at a time: Latin,
// Greek, Cyrillic and the like, and Chinese, Japanese and Korean. In Arabic, the
// Indian scripts, Thai and the rest, letters join or change shape beside their
// neighbours, and Arabic and Hebrew run right to left: there a whole word is set at
// once, or its letters would come out unjoined and in the wrong order.
const ONE_AT_A_TIME = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Script=Common}\p{Script=Inherited}]*$/u;
export const lettersStandAlone = (text) => ONE_AT_A_TIME.test(text) && !/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/.test(text);

// Rub-down transfer letters, set by hand one at a time: seeded by the shop's name, so
// every one of its cards matches. Where letters join (lettersStandAlone), each word is
// set as one piece. -> words of [{ ch, y, r, m }]
export function rubDown(text, seed) {
  const R = rng(`${seed}:rub`);
  const loose = lettersStandAlone(text);
  const set = (ch) => ({ ch, y: f2(R.range(-0.45, 0.45)), r: f2(R.range(-0.9, 0.9)), m: f2(R.range(-0.2, 0.5)) });
  return text.split(' ').map((word) => (loose ? graphemes(word).map(set) : [set(word)]));
}

// Which way, and how far, the number label leans against the card: 0.6 to 1 degree.
export function labelLean(seed) {
  const R = rng(`${seed}:tilt`);
  const s = rng(`${seed}:lean`).sign();
  return f2(s < 0 ? R.range(-1, -0.6) : R.range(0.6, 1));
}

// The small print, either side of the shop's name, which the card sets apart (<bdi>) so
// a name in Arabic or Hebrew keeps its own order and leaves the full stop where it is.
export const SMALL_PRINT = ['This card belongs to ', '. If you find it, please hand it back.'];
export const SMALL_PRINT_SHORT = 'This card belongs to the shop on the front. If you find it, please hand it back.';
