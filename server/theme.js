// The shop's colours: an accent ("Your colour" in Settings) and a background, which
// stays dark. The other surfaces (raised, sunk, the highest one, lines) and the
// tints of notices and badges are worked out from the background, and the accent
// tints the "lit" blocks of the interface (what is selected, and the main button) a
// little. The accent also prints the membership card (by the card's own rule,
// membershipCard.js printInk) and draws the tab icon on the background. A pair of
// colours is refused if text or the status colours would be hard to read on the
// background, or the accent hard to make out on it. With Open Matte's own colours
// nothing is written into the page: styles.css and web/src/look/tokens.css already
// have them.

export const DEFAULT_ACCENT = '#e8b04a';
// The video shop's room (web/src/look/tokens.css, --room). Before 1.1.0 the default
// was LEGACY_BACKGROUND: a shop still on that one never chose a colour of its own,
// so it is drawn in the room too (settings.js reads it as the default).
export const DEFAULT_BACKGROUND = '#171513';
export const LEGACY_BACKGROUND = '#0d0c0f';
export const COLOR = /^#[0-9a-f]{6}$/i;

const WHITE = '#ffffff';
const BLACK = '#000000';

// styles.css's own values for the room, which aren't quite what the mixes below give.
const DEFAULT_SURFACES = { '--bg-raised': '#1f1c19', '--bg-sunk': '#100e0d', '--bg-high': '#29251f', '--line': '#33312f', '--line-strong': '#42403f' };
const DEFAULT_ICON_BACKGROUND = '#111014';

// styles.css's status colours, which stay the same whatever the shop's colours.
const STATUS = { good: '#7fc28b', warn: '#e8b04a', bad: '#e5776d' };

// The lit block (web/src/look/tokens.css --ui-lit): the room's warm white, and its
// hover and pressed shades. The words in it are the room's own colour.
export const LIT = { base: '#e9dfc9', hover: '#f4edde', press: '#dcd2bc' };
// How much of the shop's accent a lit block may take, and the contrast its words keep.
export const LIT_SHARE = 0.22;
export const LIT_CONTRAST = 7;

// The colours drawn on the background, and how much contrast each needs: the
// room's three text colours (tokens.css --text, --text-2, --text-3) and the status
// colours. The faint text is small text too (footers, hints under fields, table
// headings), so it needs 4.5:1 like the secondary text, not the 3:1 of large text.
const ON_BACKGROUND = [
  { color: '#e9dfc9', what: 'text', needs: 7 },
  { color: '#b4ac9b', what: 'secondary text', needs: 4.5 },
  { color: '#9a9284', what: 'faint text', needs: 4.5 },
  { color: STATUS.good, what: 'the green of good news', needs: 4.5 },
  { color: STATUS.warn, what: 'the amber of warnings', needs: 4.5 },
  { color: STATUS.bad, what: 'the red of errors', needs: 4.5 },
];

// A stored colour, or the default if it isn't one (so nothing else ever reaches the
// page). The old default background is the default.
const valid = (v, fallback) => (typeof v === 'string' && COLOR.test(v) ? v.toLowerCase() : fallback);
const colors = ({ accentColor, backgroundColor } = {}) => {
  const bg = valid(backgroundColor, DEFAULT_BACKGROUND);
  return { accent: valid(accentColor, DEFAULT_ACCENT), bg: bg === LEGACY_BACKGROUND ? DEFAULT_BACKGROUND : bg };
};

const channels = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const toHex = (cs) => `#${cs.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`;

// `amount` of `b` into `a`, channel by channel, in sRGB as it's stored.
export function mix(a, b, amount) {
  const [x, y] = [channels(a), channels(b)];
  return toHex(x.map((c, i) => c + (y[i] - c) * amount));
}

const toLinear = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const toGamma = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function luminance(hex) {
  const [r, g, b] = channels(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG 2's contrast ratio, from 1 (the same) to 21 (black on white).
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// `amount` of `b` into `a` in OKLab, where a little of a colour looks like a little
// of it (in sRGB, a little red into warm white mostly darkens it).
function oklab(hex) {
  const [r, g, b] = channels(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return toHex(rgb.map((c) => toGamma(Math.min(1, Math.max(0, c)))));
}
export function mixOklab(a, b, amount) {
  const [x, y] = [oklab(a), oklab(b)];
  return fromOklab(x.map((c, i) => c + (y[i] - c) * amount));
}

// The lit block in the shop's colour: as much of the accent as keeps its words (the
// room's colour, `ink`) at LIT_CONTRAST or better, up to LIT_SHARE, in steps of 2%.
// -> { '--ui-lit', '--ui-lit-hover', '--ui-lit-press' }, and the share used.
export function litTint(accent, ink = DEFAULT_BACKGROUND) {
  let share = LIT_SHARE;
  let lit = mixOklab(LIT.base, accent, share);
  while (share > 0 && contrast(lit, ink) < LIT_CONTRAST) {
    share = Math.max(0, Math.round((share - 0.02) * 100) / 100);
    lit = mixOklab(LIT.base, accent, share);
  }
  return {
    share,
    vars: { '--ui-lit': lit, '--ui-lit-hover': mixOklab(LIT.hover, accent, share * 0.8), '--ui-lit-press': mixOklab(LIT.press, accent, share) },
  };
}

function surfaces(bg) {
  if (bg === DEFAULT_BACKGROUND) return { '--bg': bg, ...DEFAULT_SURFACES };
  return {
    '--bg': bg,
    '--bg-raised': mix(bg, WHITE, 0.04),
    '--bg-sunk': mix(bg, BLACK, 0.3),
    '--bg-high': mix(bg, WHITE, 0.078),
    '--line': mix(bg, WHITE, 0.12),
    '--line-strong': mix(bg, WHITE, 0.185),
  };
}

// Everything styles.css and tokens.css take from a background of the shop's own:
// the surfaces (tokens.css calls them the room, --room, --surface, --deep and
// --raised), the status colours' borders and tints (notices, badges, the preview
// line), the placeholder poster's gradient, and the background and raised surface
// as "r, g, b" for the see-through layers, which add their own alpha. styles.css has
// hand-picked values of all of these for the room.
function fromBackground(bg) {
  const s = surfaces(bg);
  const status = Object.entries(STATUS).flatMap(([name, color]) => [
    [`--${name}-line`, mix(bg, color, 0.4)],
    [`--${name}-tint`, mix(bg, color, 0.07)],
  ]);
  return {
    ...s,
    ...Object.fromEntries(status),
    '--poster-from': mix(bg, WHITE, 0.095),
    '--poster-to': mix(bg, WHITE, 0.02),
    '--bg-rgb': channels(bg).join(', '),
    '--bg-raised-rgb': channels(s['--bg-raised']).join(', '),
  };
}

// Nothing in the stylesheets draws the accent itself any more (1.1.0): only the lit
// blocks take a little of it.
const accents = (accent, bg) => litTint(accent, bg).vars;

// The custom properties that differ from the stylesheets': none for Open Matte's own
// colours. Open Matte's own accent leaves the lit blocks warm white: a shop that
// hasn't chosen a colour has none to tint them with.
export function palette(settings) {
  const { accent, bg } = colors(settings);
  return {
    ...(bg === DEFAULT_BACKGROUND ? {} : fromBackground(bg)),
    ...(accent === DEFAULT_ACCENT ? {} : accents(accent, bg)),
  };
}

// Rounded down, so a ratio just short of what's needed never reads as enough.
const ratio = (r) => `${(Math.floor(r * 10) / 10).toFixed(1)}:1`;

// What's wrong with a pair of colours, as sentences for the admin; empty when
// they're fine. Everything is checked on the background and on raised surfaces
// (menus, cards), which are a little lighter. The accent is held to 4.5:1 there, as
// it was when it was the colour of small text and buttons (before 1.1.0), so every
// colour refused then is refused now. (1.0 also refused an accent too dark for the
// words on its buttons; every one of those is too close to any background allowed
// here, so it is refused all the same, with this one reason.)
export function check(settings) {
  const { accent, bg } = colors(settings);
  const s = surfaces(bg);
  const worst = (color) => Math.min(contrast(color, s['--bg']), contrast(color, s['--bg-raised']));
  const problems = [];
  for (const { color, what, needs } of ON_BACKGROUND) {
    const r = worst(color);
    if (r < needs) {
      problems.push(`That background is too light: ${what} would be hard to read on it (${ratio(r)}; it needs ${needs}:1). Choose a darker colour.`);
      break;
    }
  }
  const onBg = worst(accent);
  if (onBg < 4.5) problems.push(`Your colour is too close to the background for the tab icon to show up (${ratio(onBg)}; it needs 4.5:1). Choose a lighter colour.`);
  return problems;
}

// For <meta name="theme-color">: the browser's own bars match the page.
export const themeColor = (settings) => colors(settings).bg;

// web/public/favicon.svg in the shop's colours. Open Matte's own give the same
// bytes as that file, final newline included.
export function faviconSvg(settings) {
  const { accent, bg } = colors(settings);
  const tile = bg === DEFAULT_BACKGROUND ? DEFAULT_ICON_BACKGROUND : mix(bg, WHITE, 0.02);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${tile}"/><rect x="5" y="9" width="22" height="14" rx="1.5" fill="none" stroke="${accent}" stroke-width="2"/><path d="M14 13v6l5-3z" fill="${accent}"/></svg>\n`;
}
