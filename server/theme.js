// The cinema's colours: an accent and a background, which stays dark. The other
// surfaces (raised, sunk, lines) are worked out from the background, and a pair
// of colours is refused if text, the status colours or the accent would be hard
// to read on it. With Open Matte's own colours nothing is written into the page:
// styles.css already has them.

export const DEFAULT_ACCENT = '#e8b04a';
export const DEFAULT_BACKGROUND = '#0d0c0f';
export const COLOR = /^#[0-9a-f]{6}$/i;

const WHITE = '#ffffff';
const BLACK = '#000000';

// styles.css's own values, which aren't quite what the mixes below give.
const DEFAULT_SURFACES = { '--bg-raised': '#17151b', '--bg-sunk': '#09080b', '--line': '#2a2730', '--line-strong': '#3a3642' };
const DEFAULT_ACCENTS = { '--accent-ink': '#1a1306', '--accent-hover': '#f2c46d' };
const DEFAULT_ICON_BACKGROUND = '#111014';

// The colours drawn on the background, and how much contrast each needs. Faint
// text is only ever used for things you can do without.
const ON_BACKGROUND = [
  { color: '#ece8e1', what: 'text', needs: 7 },
  { color: '#a59f97', what: 'secondary text', needs: 4.5 },
  { color: '#6f6a66', what: 'faint text', needs: 3 },
  { color: '#7fc28b', what: 'the green of good news', needs: 4.5 },
  { color: '#e8b04a', what: 'the amber of warnings', needs: 4.5 },
  { color: '#e5776d', what: 'the red of errors', needs: 4.5 },
];

// A stored colour, or the default if it isn't one (so nothing else ever reaches the page).
const valid = (v, fallback) => (typeof v === 'string' && COLOR.test(v) ? v.toLowerCase() : fallback);
const colors = ({ accentColor, backgroundColor } = {}) => ({
  accent: valid(accentColor, DEFAULT_ACCENT),
  bg: valid(backgroundColor, DEFAULT_BACKGROUND),
});

const channels = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const toHex = (cs) => `#${cs.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

// `amount` of `b` into `a`, channel by channel, in sRGB as it's stored.
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

// WCAG 2's contrast ratio, from 1 (the same) to 21 (black on white).
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function surfaces(bg) {
  if (bg === DEFAULT_BACKGROUND) return { '--bg': bg, ...DEFAULT_SURFACES };
  return {
    '--bg': bg,
    '--bg-raised': mix(bg, WHITE, 0.04),
    '--bg-sunk': mix(bg, BLACK, 0.3),
    '--line': mix(bg, WHITE, 0.12),
    '--line-strong': mix(bg, WHITE, 0.185),
  };
}

function accents(accent) {
  if (accent === DEFAULT_ACCENT) return { '--accent': accent, ...DEFAULT_ACCENTS };
  // The text on accent buttons: the accent's own darkest shade, or black when that isn't dark enough.
  const ink = mix(accent, BLACK, 0.89);
  return {
    '--accent': accent,
    '--accent-ink': contrast(ink, accent) >= 4.5 ? ink : BLACK,
    '--accent-hover': mix(accent, WHITE, 0.2),
  };
}

// The custom properties that differ from styles.css's: none for Open Matte's own colours.
export function palette(settings) {
  const { accent, bg } = colors(settings);
  return {
    ...(bg === DEFAULT_BACKGROUND ? {} : surfaces(bg)),
    ...(accent === DEFAULT_ACCENT ? {} : accents(accent)),
  };
}

// Rounded down, so a ratio just short of what's needed never reads as enough.
const ratio = (r) => `${(Math.floor(r * 10) / 10).toFixed(1)}:1`;

// What's wrong with a pair of colours, as sentences for the admin; empty when
// they're fine. Everything is checked on the background and on raised surfaces
// (cards, the ticket panel), which are a little lighter.
export function check(settings) {
  const { accent, bg } = colors(settings);
  const s = surfaces(bg);
  const a = accents(accent);
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
  if (onBg < 4.5) problems.push(`That accent colour is too close to the background to read (${ratio(onBg)}; it needs 4.5:1).`);
  const ink = contrast(a['--accent-ink'], accent);
  if (ink < 4.5) problems.push(`That accent colour is too dark for the text on its buttons to read (${ratio(ink)}; it needs 4.5:1). Choose a lighter colour.`);
  return problems;
}

// For <meta name="theme-color">: the browser's own bars match the page.
export const themeColor = (settings) => colors(settings).bg;

// web/public/favicon.svg in the cinema's colours. Open Matte's own give the same
// bytes as that file, final newline included.
export function faviconSvg(settings) {
  const { accent, bg } = colors(settings);
  const tile = bg === DEFAULT_BACKGROUND ? DEFAULT_ICON_BACKGROUND : mix(bg, WHITE, 0.02);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${tile}"/><rect x="5" y="9" width="22" height="14" rx="1.5" fill="none" stroke="${accent}" stroke-width="2"/><path d="M14 13v6l5-3z" fill="${accent}"/></svg>\n`;
}
