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

// Ink soaks into card: it darkens what is under it rather than covering it, so the
// card's own shade and grain show through (the card's ink layer is blended "multiply",
// membershipCard.css). The colour `cover` (0 to 1) of `ink` makes on `paper`.
export function onCard(ink, cover, paper = CARD_STOCK) {
  const k = channels(ink);
  return toHex(channels(paper).map((p, i) => p * (1 - cover + (cover * k[i]) / 255)));
}

// How much of the card's cream the ink laid down allows for: 0, none (the cream deepens
// the ink fully, as it would on a press), 1, all of it (the ink shows exactly as
// chosen, as if on white). Half: soaked into the stock, the shop's ink comes out a
// little deeper and warmer than on a screen, and still plainly the shop's.
export const SOAK = 0.5;

// The ink to lay down on that layer for `ink` (the shop's printInk), so that soaked
// into the stock it shows as `ink` deepened by the cream: `ink` times the stock to the
// power 1 - SOAK. Ink can't be lighter than the card under it, so where a vivid ink is
// brighter than the stock in a channel (a pure blue's blue is over the cream's 201),
// less of the stock is allowed for, the same in every channel: it shows as true a hue
// as cream card can print, rather than clipped in one channel alone.
// -> { down, shown, soak }: the ink laid down, what it shows as on the plain stock, and
// how much of the stock was allowed for.
export function soakIn(ink, stock = CARD_STOCK, soak = SOAK) {
  const k = channels(ink);
  const s = channels(stock);
  let a = soak;
  k.forEach((c, i) => {
    if (c > 0 && s[i] < 255) a = Math.min(a, Math.log(255 / c) / Math.log(255 / s[i]));
  });
  a = Math.max(0, a);
  const down = k.map((c, i) => Math.min(255, c * (255 / s[i]) ** a));
  return { down: toHex(down), shown: toHex(down.map((c, i) => (c * s[i]) / 255)), soak: a };
}
export const laidDown = (ink, stock = CARD_STOCK) => soakIn(ink, stock).down;

// The print's own wear (MembershipCard.jsx, drawInkwear: thinner along the card's
// fibres and in slow clouds) never takes more than this much of the ink film away,
// outside its pin-holes: print where it lies thinnest still reads at 4.5:1 on the
// card's darkest grain, and so do the words knocked out of the band.
export const INK_THINNEST = 0.85;

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
const f3 = (n) => Math.round(n * 1000) / 1000;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const smooth = (t) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

// Value noise that wraps, so a tile never shows a seam: a function of (x, y) from 0 to
// 1, with `cells` bumps across every `size` pixels.
export function periodicNoise(R, size, cells) {
  const g = Array.from({ length: cells * cells }, () => R());
  const at = (i, j) => g[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
  return (x, y) => {
    const fx = (x / size) * cells;
    const fy = (y / size) * cells;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const a = at(i, j);
    const b = at(i + 1, j);
    const c = at(i, j + 1);
    const d = at(i + 1, j + 1);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  };
}

// Value noise from a seed, with no table to fill first: a smooth function of (x, y)
// from 0 to 1, with a bump every `cell` pixels. A small stamp or a word costs only the
// pixels it covers.
const lattice = (s, i, j) => {
  let h = s ^ Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
export function valueNoise(seed, cell) {
  const s = (typeof seed === 'number' ? seed : hash(seed)) | 0;
  return (x, y) => {
    const fx = x / cell;
    const fy = y / cell;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const a = lattice(s, i, j);
    const b = lattice(s, i + 1, j);
    const c = lattice(s, i, j + 1);
    const d = lattice(s, i + 1, j + 1);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  };
}

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

// ------------------------------------------------------------ the pen

// The counter's ballpoint: blue-black, as counter pens are, with the faint shine of its
// oily ink (PEN_SHEEN, on the side of a stroke that faces the light).
export const PEN_INK = '#1b2568';
export const PEN_SHEEN = '#5d6aa8';
const PEN = {
  // a stroke the pen didn't press into or slow down on: a little lighter than a
  // downstroke, or a turn, where the ball slows and the ink gathers
  light: 0.92,
  // the pen's pressure, coming and going every few pixels along the line
  press: 0.09,
  // where the pen eases off along the name, at most this much lighter
  ease: 0.03,
  // the card's grain: the ball misses its finest hollows, at most this much less
  grain: 0.06,
  // the ball lays its ink at the line's edges: this much less down its middle
  middle: 0.03,
  // where the ball ran dry for a moment: a short, light stretch of the line, and at
  // most this share of the ink (a short name is skipped no more than a long one)
  skip: 0.55,
  skips: 0.03,
  // the oily shine, at most, where the ink lies full
  sheen: 0.14,
};
// The lightest the pen leaves its ink but in a skip, and its shine: still 4.5:1 or
// more on the card's darkest grain (test/membership.test.js).
export const PEN_LIGHTEST = f3(PEN.light * (1 - PEN.press) * (1 - PEN.ease) * (1 - PEN.middle) * (1 - PEN.grain));
export const PEN_SHINE = PEN.sheen;

// The mean of each pixel's square of neighbours `r` either side (a box blur), with
// nothing beyond the edges.
function boxBlur(a, W, H, r) {
  const t = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let s = 0;
    for (let x = 0; x <= r && x < W; x++) s += a[row + x];
    for (let x = 0; x < W; x++) {
      t[row + x] = s * k;
      if (x + r + 1 < W) s += a[row + x + r + 1];
      if (x - r >= 0) s -= a[row + x - r];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = 0; y <= r && y < H; y++) s += t[y * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = s * k;
      if (y + r + 1 < H) s += t[(y + r + 1) * W + x];
      if (y - r >= 0) s -= t[(y - r) * W + x];
    }
  }
  return out;
}

// The ballpoint over one word of the name. `mask`: the word's letters as its font draws
// them, an alpha (0 to 255) to a pixel, `W` by `H` at `scale` pixels to a CSS pixel;
// `size`: the font size, in CSS pixels; `at`: how far along the name the word starts,
// in CSS pixels, so the pen's pressure runs on from word to word; `seed`: the member's.
// -> { film, sheen, inked, skipped }: for each pixel, how much of the pen's ink is there
// (0 to 1) and how much of its shine (0 to 1); and how many pixels it inked, and how
// many of those it skipped.
//
// A ballpoint's line is fine and even, but never quite: downstrokes, pressed harder, are
// full, and the rest a little lighter; the pen eases off now and then along the name;
// the ball lays its ink at the line's edges, a little thinner down the middle; where it
// ran dry for a moment, a short light skip runs along a stroke's middle (in a few per
// cent of the ink, however long or short the name); and now and then a stroke ends in a
// small blob of ink. Never lighter than PEN_LIGHTEST but in a skip.
export function ballpoint(mask, W, H, scale, { size = 24, seed = '', at = 0 } = {}) {
  const n = W * H;
  const film = new Float32Array(n);
  const sheen = new Float32Array(n);
  const solid = new Float32Array(n);
  const alpha = new Float32Array(n);
  // The ball's line has a firm edge, firmer than type's smoothing: a little more of the
  // edge is ink, none of it beyond the letter.
  for (let p = 0; p < n; p++) {
    alpha[p] = clamp((mask[p] / 255) * 1.3 - 0.06, 0, 1);
    solid[p] = mask[p] > 127 ? 1 : 0;
  }
  // The strokes' middles: ink all round, a little way in from the edges (and from the
  // same, which way the stroke's edge faces).
  const rc = Math.max(1, Math.round(0.5 * scale));
  const middle = boxBlur(solid, W, H, rc);
  // Downstrokes: ink a little way above and below as well; softened from stroke to stroke.
  const d = Math.max(1, Math.round(0.055 * size * scale));
  const down = new Float32Array(n);
  for (let p = d * W; p < n - d * W; p++) down[p] = solid[p] && solid[p - d * W] && solid[p + d * W] ? 1 : 0;
  const pressed = boxBlur(down, W, H, rc);
  // How much ink is round about: more at a turn, where the ball slowed; about half the
  // usual at a stroke's free end. The usual, from the strokes' middles.
  const near = boxBlur(alpha, W, H, Math.max(2, Math.round(0.11 * size * scale)));
  let along = 0;
  let m = 0;
  for (let p = 0; p < n; p++) {
    if (middle[p] > 0.999) {
      along += near[p];
      m++;
    }
  }
  along = m ? along / m : 1;
  const ease = valueNoise(`${seed}:ease`, 38);
  const press = valueNoise(`${seed}:press`, 5);
  const grain = valueNoise(`${seed}:grain`, 0.75);
  const dry = valueNoise(`${seed}:dry`, 2.4);
  const gate = valueNoise(`${seed}:gob`, 6);
  const S = 1 / scale;
  const eased = Float32Array.from({ length: W }, (_, x) => 1 - PEN.ease * smooth((ease(at + x * S, 0) - 0.45) / 0.4));
  const ends = [];
  const dried = new Float32Array(n);
  let inked = 0;
  let dry0 = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      const a = alpha[p];
      if (!a) continue;
      const u = at + x * S;
      const v = y * S;
      const full = Math.max(pressed[p], smooth((near[p] / along - 1.12) / 0.35));
      let f = a * (PEN.light + (1 - PEN.light) * full) * (1 - PEN.press * smooth((press(u, v) - 0.4) / 0.4)) * eased[x];
      if (solid[p]) {
        inked++;
        f *= 1 - PEN.grain * smooth((grain(u, v) - 0.55) / 0.3);
        if (middle[p] > 0.999) f *= 1 - PEN.middle;
        const k = smooth((dry(u, v) - 0.865) / 0.045);
        if (k > 0) {
          dried[p] = k;
          if (k > 0.5) dry0++;
        }
        if (near[p] < 0.6 * along) ends.push(p);
        // The shine, where the ink lies full, on the side of the stroke facing the
        // light (up and to the left).
        const lit = (0.6 * (middle[p + 1] - middle[p - 1]) + 0.8 * (middle[p + W] - middle[p - W])) * 1.6;
        if (lit > 0) sheen[p] = PEN.sheen * Math.min(1, lit) * smooth((f - 0.8) / 0.12);
      }
      film[p] = f;
    }
  }
  // The skips: where there'd be more than their share, only the driest of them.
  let from = 0;
  if (dry0 > PEN.skips * inked) {
    const ks = [];
    for (let p = 0; p < n; p++) if (dried[p]) ks.push(dried[p]);
    ks.sort((a, b) => b - a);
    from = ks[Math.floor(PEN.skips * inked)] ?? 0;
  }
  let skipped = 0;
  for (let p = 0; p < n; p++) {
    if (dried[p] <= from) continue;
    const k = from ? (dried[p] - from) / (1 - from) : dried[p];
    film[p] *= 1 - PEN.skip * k;
    if (k > 0.5) skipped++;
  }
  // Blobs: at the very tip of a free end (the least ink round about, and no other tip
  // close by), now and then (gate), a round drop a little wider than the stroke.
  ends.sort((p, q) => near[p] - near[q]);
  const tips = [];
  const apart = 0.12 * size * scale;
  for (const p of ends) {
    const x = p % W;
    const y = (p - x) / W;
    if (tips.some(([tx, ty]) => Math.abs(tx - x) < apart && Math.abs(ty - y) < apart)) continue;
    tips.push([x, y]);
  }
  const R = 0.032 * size * scale;
  const reach = Math.ceil(R + 1);
  for (const [ex, ey] of tips) {
    if (gate(at + ex * S, ey * S) < 0.72) continue;
    for (let y = Math.max(0, ey - reach); y <= Math.min(H - 1, ey + reach); y++) {
      for (let x = Math.max(0, ex - reach); x <= Math.min(W - 1, ex + reach); x++) {
        const v = clamp(R + 0.5 - Math.hypot(x - ex, y - ey), 0, 1);
        const p = y * W + x;
        if (v > film[p]) {
          film[p] = v;
          sheen[p] = 0;
        }
      }
    }
  }
  return { film, sheen, inked, skipped };
}

// ------------------------------------------------------------ the date stamp

// Member since is stamped at the counter with a band dater: the month on one rubber
// band, the year's last two digits on two more, in a stamp pad's violet (STAMP_INK).
// A little crooked, never quite where the last one went, and inked unevenly: lighter
// where the stamp rocked away from the card (rock), patchy where the pad was dry
// (patch), with a few small voids where the rubber took less ink, and on the heavy
// side, the faint ring of the stamp's frame. Its ink film is never thinner than
// STAMP_FAINTEST but in a void (STAMP_VOID at least, never bare card), and at that it
// still reads at 4.5:1 or more on the card's darkest grain.
// -> { tilt, dx, dy, rock: { angle, low }, patch: { low, high }, voids, ring, seed, bands }
export const STAMP_INK = '#46206a';
export const STAMP_FAINTEST = 0.72;
export const STAMP_VOID = 0.45;
// The dater's bands, in em: one to a letter, one to a digit, and the gap for a space.
// Each character is condensed to fit its band with room to spare, to 0.8 of its width
// at most: the wide ones (M, A, O and the like) more, as a dater's own type is cut.
export const STAMP_PITCH = { letter: 0.66, digit: 0.58, space: 0.3 };
export const STAMP_ROOM = { letter: 0.1, digit: 0.09 };
// The ink widths of Libre Franklin Bold's capitals and digits, in em.
export const STAMP_INK_EM = {
  A: 0.71, B: 0.611, C: 0.648, D: 0.637, E: 0.546, F: 0.527, G: 0.657, H: 0.612, I: 0.175, J: 0.351, K: 0.645, L: 0.524, M: 0.809,
  N: 0.62, O: 0.685, P: 0.607, Q: 0.685, R: 0.611, S: 0.607, T: 0.614, U: 0.598, V: 0.673, W: 1.021, X: 0.673, Y: 0.678, Z: 0.609,
  0: 0.619, 1: 0.435, 2: 0.564, 3: 0.598, 4: 0.621, 5: 0.604, 6: 0.603, 7: 0.555, 8: 0.603, 9: 0.601,
};
export function stampSqueeze(ch) {
  const kind = /\d/.test(ch) ? 'digit' : 'letter';
  return f3(Math.min(0.8, (STAMP_PITCH[kind] - STAMP_ROOM[kind]) / (STAMP_INK_EM[ch.toUpperCase()] ?? 0.75)));
}
export function dateStamp(text, seed) {
  const R = rng(`${seed}:stamp`);
  const stamp = {
    tilt: f2(R.sign() * R.range(1, 2.4)),
    dx: f2(R.range(-1, 3)),
    dy: f2(R.range(-1, 1)),
    // The light side's direction, in degrees (0: the right-hand side is lightest).
    rock: { angle: Math.round(R.range(0, 360)), low: f2(R.range(0.86, 0.9)) },
    patch: { low: 0.84, high: f2(R.range(0.9, 0.97)) },
    // How much of the characters' box the voids take, about.
    voids: f3(R.range(0.004, 0.01)),
    ring: f2(R() < 0.75 ? R.range(0.18, 0.3) : 0),
    seed: hash(`${seed}:stamp:noise`),
  };
  // One offset for each band: the month's, then each digit's (a dater's year has a
  // band for each of its last two digits; the first two are cast in).
  const offs = Array.from({ length: 4 }, () => f2(R.range(-0.5, 0.5)));
  const digits = [...text].filter((ch) => /\d/.test(ch)).length;
  let seen = 0;
  stamp.bands = [...text].map((ch) => {
    if (/\s/.test(ch)) return { ch };
    if (!/\d/.test(ch)) return { ch, y: offs[0], sx: stampSqueeze(ch) };
    seen++;
    return { ch, y: offs[seen <= digits - 2 ? 1 : seen - digits + 3], sx: stampSqueeze(ch), digit: true };
  });
  return stamp;
}

// The stamp's ink, pixel by pixel, over its canvas: `w` by `h` CSS pixels, drawn at
// `scale` pixels to one. `ink`: the box the characters' ink lies in ({ x0, y0, x1, y1 },
// in the canvas's CSS pixels): the patches and voids lie only there, so the wear never
// touches anything but the stamp's own characters. `frame`: the frame's rounded box
// ({ x0, y0, x1, y1, r }), whose ring is drawn only on the heavy side. -> { width,
// height, cover, ring }: for each pixel, how much of the ink film is there (0 to 1: 1
// outside `ink`, STAMP_VOID at least in a void, STAMP_FAINTEST at least elsewhere) and
// how much of the ring.
export function stampCoverage(stamp, { w, h, scale = 1, ink, frame }) {
  const W = Math.max(1, Math.round(w * scale));
  const H = Math.max(1, Math.round(h * scale));
  const blot = valueNoise(stamp.seed, 12.8);
  const speck = valueNoise(stamp.seed + 1, 3.4);
  const fine = valueNoise(stamp.seed + 2, 1.5);
  const gaps = valueNoise(stamp.seed + 3, 7.3);
  const a = (stamp.rock.angle * Math.PI) / 180;
  const [ca, sa] = [Math.cos(a), Math.sin(a)];
  const cx = (ink.x0 + ink.x1) / 2;
  const cy = (ink.y0 + ink.y1) / 2;
  const span = Math.abs(ca) * (ink.x1 - ink.x0) + Math.abs(sa) * (ink.y1 - ink.y0);
  // 0 on the heavy side, 1 on the light.
  const lightness = (x, y) => smooth(((x - cx) * ca + (y - cy) * sa) / span + 0.5);
  const cover = new Float32Array(W * H).fill(1);
  const ring = new Float32Array(W * H);
  // A void: where fine noise is highest, about stamp.voids of the box (calibrated on
  // this noise), a little more where the stamp rocked away.
  const edge = 0.955 - stamp.voids * 4;
  const film = (x, y, t) => {
    const n = clamp((blot(x, y) * 0.65 + speck(x, y) * 0.35 - 0.3) / 0.4, 0, 1);
    const patch = stamp.patch.low + (stamp.patch.high - stamp.patch.low) * (1 - n);
    const c = clamp((1 - (1 - stamp.rock.low) * t) * patch, STAMP_FAINTEST, 1);
    const v = fine(x, y) - edge - t * 0.012;
    return v > 0 ? c - (c - STAMP_VOID) * clamp(v / 0.012, 0, 1) : c;
  };
  const [i0, i1] = [Math.max(0, Math.floor(ink.x0 * scale)), Math.min(W, Math.ceil(ink.x1 * scale))];
  const [j0, j1] = [Math.max(0, Math.floor(ink.y0 * scale)), Math.min(H, Math.ceil(ink.y1 * scale))];
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const x = (i + 0.5) / scale;
      const y = (j + 0.5) / scale;
      if (x >= ink.x0 && x <= ink.x1 && y >= ink.y0 && y <= ink.y1) cover[j * W + i] = film(x, y, lightness(x, y));
    }
  }
  if (stamp.ring && frame) {
    const fx = (frame.x0 + frame.x1) / 2;
    const fy = (frame.y0 + frame.y1) / 2;
    const [hx, hy] = [(frame.x1 - frame.x0) / 2 - frame.r, (frame.y1 - frame.y0) / 2 - frame.r];
    const [k0, k1] = [Math.max(0, Math.floor((frame.x0 - 1) * scale)), Math.min(W, Math.ceil((frame.x1 + 1) * scale))];
    const [l0, l1] = [Math.max(0, Math.floor((frame.y0 - 1) * scale)), Math.min(H, Math.ceil((frame.y1 + 1) * scale))];
    for (let j = l0; j < l1; j++) {
      for (let i = k0; i < k1; i++) {
        const x = (i + 0.5) / scale;
        const y = (j + 0.5) / scale;
        // Distance from the rounded box's outline: a thin line, only along the heavy
        // edge, and broken.
        const qx = Math.abs(x - fx) - hx;
        const qy = Math.abs(y - fy) - hy;
        const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - frame.r;
        const line = clamp(1 - Math.abs(dist) / 0.55, 0, 1);
        if (!line) continue;
        const t = lightness(x, y);
        const heavy = clamp(1.1 - t * 3.6, 0, 1);
        if (!heavy) continue;
        ring[j * W + i] = line * stamp.ring * heavy * (gaps(x, y) > 0.45 ? 1 : 0.08);
      }
    }
  }
  return { width: W, height: H, cover, ring };
}

// ------------------------------------------------------------ the card's thickness

// The card as a thin slab, for turning over: ID-1 card is 0.76 mm thick on 85.6 mm, a
// little thicker here (5.7px on a 440px card) so it reads as card, not paper.
export const cardThickness = (width) => f2(Math.max(0, width) * 0.013);

// The cut edge round the card, as flat strips: one down each long side and `facets`
// round each corner of radius `radius`, each `thickness` wide (from one face to the
// other) and `h` long. `place` puts a strip, made upright at the card's centre, on the
// card's edge, facing out: a CSS transform in the card's own frame (its centre at 0,
// its faces at ±thickness / 2). The top and bottom edges never face anyone while the
// card turns about its upright axis, so they aren't drawn. -> [{ key, h, place }]
export function slabPieces({ width, height, radius = 12, facets = 3 }) {
  const hw = width / 2;
  const hh = height / 2;
  const r = clamp(radius, 0, Math.min(hw, hh));
  const pieces = [
    { key: 'l', h: f2(height - 2 * r + 0.8), place: `translateX(${f2(-hw)}px) rotateY(-90deg)` },
    { key: 'r', h: f2(height - 2 * r + 0.8), place: `translateX(${f2(hw)}px) rotateY(90deg)` },
  ];
  if (!r || !facets) return pieces;
  const step = 90 / facets;
  const half = (step / 2) * (Math.PI / 180);
  const len = f2(2 * r * Math.sin(half) + 0.8);
  const d = r * Math.cos(half);
  for (const [sx, sy, name] of [[-1, -1, 'tl'], [1, -1, 'tr'], [-1, 1, 'bl'], [1, 1, 'br']]) {
    for (let k = 0; k < facets; k++) {
      const deg = (k + 0.5) * step;
      const rad = (deg * Math.PI) / 180;
      const x = sx * (hw - r + d * Math.cos(rad));
      const y = sy * (hh - r + d * Math.sin(rad));
      pieces.push({ key: `${name}${k}`, h: len, place: `translate(${f2(x)}px, ${f2(y)}px) rotateZ(${f2(sx * sy * deg)}deg) rotateY(${sx < 0 ? -90 : 90}deg)` });
    }
  }
  return pieces;
}

// The small print, either side of the shop's name, which the card sets apart (<bdi>) so
// a name in Arabic or Hebrew keeps its own order and leaves the full stop where it is.
export const SMALL_PRINT = ['This card belongs to ', '. If you find it, please hand it back.'];
export const SMALL_PRINT_SHORT = 'This card belongs to the shop on the front. If you find it, please hand it back.';
