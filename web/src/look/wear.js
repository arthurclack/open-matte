// The printed things' unevenness, apart from React and the DOM: how each flat object
// leans, where its edge wobbles, how its plates sit off register, how a typewriter,
// a price gun and a label maker each strike their letters, and what goes on a tape's
// label. All of it is seeded, so a film's sleeve, a tape's sticker or a shop's name
// is printed the same, render after render, on every device. No DOM here, so the
// tests can load it in Node (test/look.test.js).
//
// The membership card's own workings (membershipCard.js) are the model, and are
// reused where they already do the job: the seeded generator, the card's cut edge,
// the plates' misregistration, typed strikes, the pen and rub-down lettering.

import { cardEdge, graphemes, hash, penWords, register, rng, rubDown, strikes } from '../membershipCard.js';

export { graphemes, hash, penWords as handWords, rng, rubDown, strikes as typedStrikes };

const f2 = (n) => Math.round(n * 100) / 100;

// ------------------------------------------------------------ the object itself

// How a flat thing lies on the counter: its lean (degrees, from `tilt` [low, high]),
// its cut edge (a clip-path that fits any size; `radius` is its corners, in px), where
// its grain starts (gx, gy, px) and how far its second plate sits off the first (rx,
// ry, CSS lengths). `filter` is which of the three ink-edge filters it takes (0 to 2),
// so neighbours don't print alike.
export function objectWear(seed, { radius = 1, tilt = [0, 0] } = {}) {
  const R = rng(`${seed}:tilt`);
  const rot = tilt[0] === tilt[1] ? tilt[0] : f2(R.range(tilt[0], tilt[1]));
  const { gx, gy, x, y } = register(seed);
  return { rot, clip: cardEdge(seed, radius), gx, gy, rx: x, ry: y, filter: hash(seed) % 3 };
}

// What each kind of thing is cut and laid like: its corners, and how far it may lean.
// The sticker always leans the same way (the same gun, the same hand), never by the
// same amount; a sleeve hardly at all.
export const KINDS = {
  sleeve: { radius: 1.5, tilt: [-0.3, 0.3] },
  kraft: { radius: 1.5, tilt: [-0.3, 0.3] },
  pick: { radius: 0.6, tilt: [-1.1, -0.4] },
  label: { radius: 2.5, tilt: [-0.6, 0.6] },
  sticker: { radius: 2.5, tilt: [-3, -1.4] },
  tape: { radius: 1.2, tilt: [-1.1, 0.9] },
};

// ------------------------------------------------------------ the price gun

// A price gun prints from a band of wheels: each character sits on its own, a little
// high or low, a little lighter or darker, and wide letters are cut narrower to fit
// the pitch. -> [{ ch, space, y, o, sx }]
export function gunWheels(text, seed) {
  const R = rng(`${seed}:gun`);
  const sx = (ch) => (/[MWNmw]/.test(ch) ? 0.66 : /[ilrtfjI1.,:'’]/.test(ch) ? 1 : 0.8);
  return [...String(text)].map((ch) => (ch === ' ' ? { ch, space: true } : { ch, y: f2(R.range(-0.6, 0.6)), o: f2(R.range(0.95, 1)), sx: sx(ch) }));
}

// Where the sticker sits against what it's stuck to: a little up or down (px).
export function stickerShift(seed) {
  return f2(rng(`${seed}:stick`).range(-3, 2));
}

// ------------------------------------------------------------ label-maker tape

// Embossed label tape: one wheel per letter, so each sits a hair high or low and is
// whitened by its own amount; wide letters are cut a little narrower. Then the tape is
// cut with scissors, each end a little off square: `clip` is its polygon.
// -> { letters: [{ ch, o, y, sx }], clip }
export function embossStrip(text, seed) {
  const R = rng(`${seed}:emb`);
  const letters = [...String(text)].map((ch) => ({ ch, o: f2(R.range(0.84, 0.98)), y: f2(R.range(-0.4, 0.4)), sx: /[MWmw]/.test(ch) ? 0.84 : 1 }));
  const cut = () => (R() < 0.5 ? [f2(R.range(0, 0.8)), f2(R.range(1.5, 4))] : [f2(R.range(1.5, 4)), f2(R.range(0, 0.8))]);
  const [tl, bl] = cut();
  const [tr, br] = cut();
  return { letters, clip: `polygon(${tl}px 0, calc(100% - ${tr}px) 0, calc(100% - ${br}px) 100%, ${bl}px 100%)` };
}

// A PAL tape's length in minutes, printed on it: the shortest standard length that
// holds the film, "E-120" for a 92-minute film. Null for a film of no known length.
const E_LENGTHS = [30, 60, 90, 120, 180, 240, 300];
export function eNumber(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return `E-${E_LENGTHS.find((m) => m >= Math.ceil(minutes)) || 300}`;
}

// The strips a shop would cut for a tape: what it adds to its sleeve. With artwork,
// the title (shortened to fit, at a word) and the E-number; with a plain sleeve,
// whose typed label already carries the title, the E-number only. At most two strips.
// `cells` is how many wheels fit a strip; `lastCells`, the strip that carries the
// sticker. film: { title, poster (true when it has artwork), e (eNumber's) }.
const SMALL = new Set(['a', 'an', 'and', 'the', 'of', 'or', 'to', 'in', 'on', 'at', 'for', 'with']);
export function tapeLines(film, { cells = 18, lastCells = cells } = {}) {
  const e = film.e || '';
  if (!film.poster) return e ? [e] : [shorten(film.title, cells)];
  const one = e ? `${film.title}  ${e}` : film.title;
  if (one.length <= lastCells) return [one];
  const title = shorten(film.title, cells);
  return e ? [title, e] : [title];
}

function shorten(title, cells) {
  const t = String(title);
  if (t.length <= cells) return t;
  const keep = [];
  for (const w of t.split(' ')) {
    if (`${[...keep, w].join(' ')}…`.length > cells) break;
    keep.push(w);
  }
  while (keep.length > 1 && SMALL.has(keep.at(-1).replace(/[^a-z]/gi, '').toLowerCase())) keep.pop();
  return `${keep.length ? keep.join(' ').replace(/[:,;.\-–]$/, '') : t.slice(0, cells - 1)}…`;
}
