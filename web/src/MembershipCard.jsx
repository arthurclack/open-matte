import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatMonthYear } from './api.js';
import {
  PEN_INK,
  PEN_SHEEN,
  STAMP_INK,
  SMALL_PRINT,
  SMALL_PRINT_SHORT,
  ballpoint,
  cardEdge,
  cardThickness,
  codabarPx,
  codabarText,
  dateStamp,
  fitCodabar,
  groupNumber,
  hash,
  labelLean,
  laidDown,
  penWords,
  periodicNoise,
  printInk,
  register,
  rng,
  rubDown,
  slabPieces,
  stampCoverage,
  strikes,
} from './membershipCard.js';
import { prefersReducedMotion } from './motion.js';
import './membershipCard.css';

// The membership card: a printed card, front and back, that turns over. The front is
// all shop: its logo if it has one, its name, and "Membership card" knocked out of a
// solid band of its ink. The back is the member's: their name in ballpoint, the month
// they became a member stamped with the counter's date stamp, the membership number on
// a stuck-on barcode label, and one line of small print. Printed in the shop's accent
// colour, darkened until it reads on the card (printInk); a shop on Open Matte's own
// accent prints in blue. It is card, not paper: turning over, it shows its cut edge.
//
// The ink soaks into the card rather than lying on it: the card's ink layer is blended
// "multiply" over its shade and grain (membershipCard.css), so white on that layer is
// no ink at all, and the wear drawn over the ink in white (thinner ink in the card's
// fine mottle and along its fibres, pin-holes, the stamp's patches) only ever lightens
// ink. The stamp is its own little layer, blended the same way, so its wear can only
// lighten its own ink, never the print under it.
//
// Under the page's Content-Security-Policy: no data: or blob: addresses, so the
// paper's grain, the ink's wear and the ballpoint are drawn on <canvas> elements in the
// card rather than as background images, and the ink's edges are SVG filters in the
// page. The fonts come from this site (membershipCard.css).
//
// site: { cinemaName, accentColor, logo, logoWithName } as /api/me gives it.
// membership: { number, since } from /api/account or /api/enroll/finish.
// start: the side up at first. writeOn: write the name on once, as when the passkey
// has just been made. face="front": the front alone, nobody's (no membership needed),
// to be looked at rather than handled: no back, no Turn over. The sign-in pages use it
// as the button that signs in ("Show your card").

const TURN_MS = 460;
const WRITE_MS = 560;
// The longest the name waits for its pen before it's written on anyway, in whatever
// the device has instead.
const FONT_WAIT_MS = 1200;
// The fonts the card is printed in, asked for once the card is on the page, so it can
// be fitted again at their real sizes.
const FACES = ['800 16px Fraunces', '600 16px Fraunces', '16px "Grape Nuts"', '16px "Courier Prime"'];

// Asks for the card's fonts (membershipCard.css declares them, and it's in the page's
// stylesheet from the start), for a page about to show a card: the page that makes a passkey asks as it opens, so they
// are here by the time the name is written on. `text` is what they'll print.
// -> a promise that settles when they have come or failed.
export function loadCardFonts(text = 'Aa0') {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  return Promise.all(FACES.map((f) => document.fonts.load(f, text || 'Aa0').catch(() => {})));
}

// WebKit (Safari, and every browser on an iPhone or iPad) draws SVG filters at one
// pixel to a CSS pixel whatever the screen, which on a 2x or 3x screen blurs type: there
// the ink's printed edge is left off text. The plates stay off register.
const WEBKIT = typeof navigator !== 'undefined' && /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Android/.test(navigator.userAgent);

export default function MembershipCard({ site, name, membership, start = 'front', writeOn = false, face }) {
  const frontOnly = face === 'front';
  const shop = site?.cinemaName || 'this shop';
  const number = membership?.number ?? '';
  const seed = frontOnly ? 'front' : `member:${number}`;
  const ink = printInk(site?.accentColor).ink;
  const stamp = useMemo(() => (frontOnly ? null : dateStamp(formatMonthYear(membership?.since), `${seed}:back`)), [frontOnly, membership?.since, seed]);
  // Ids for the stage and the SVG filters: letters and digits only, for url(#…).
  const uid = `mc${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const rootRef = useRef(null);
  const frontRef = useRef(null);
  const backRef = useRef(null);
  const nameRef = useRef(null);
  const barRef = useRef(null);
  const svgRef = useRef(null);

  // ---------------------------------------------------------------- turning over
  // side: the side up, or on its way up. turning: while the card is moving.
  const [side, setSide] = useState(start === 'back' ? 'back' : 'front');
  const [turning, setTurning] = useState(false);
  const [said, setSaid] = useState('');
  const settle = useRef(null);
  useEffect(() => () => clearTimeout(settle.current), []);

  const turn = () => {
    const next = side === 'front' ? 'back' : 'front';
    setBackDrawn(true);
    setSide(next);
    setSaid(next === 'back' ? 'The back of the card' : 'The front of the card');
    clearTimeout(settle.current);
    // Less motion asked for: the sides simply swap.
    if (prefersReducedMotion()) return setTurning(false);
    // A press while it turns sends it back from where it has got to: the transition
    // reverses from there (membershipCard.css).
    setTurning(true);
    settle.current = setTimeout(() => setTurning(false), TURN_MS + 250);
  };
  const turned = (e) => {
    if (e.target !== e.currentTarget || e.propertyName !== 'transform') return;
    clearTimeout(settle.current);
    setTurning(false);
  };
  // The front's angle: 0 face up, 180 face down; the back is half a turn behind it.
  // A side face up has no transform at all, so lying still its text is drawn flat; and
  // a press mid-turn sends every part of the card back by the same path (a transition
  // reversed to where it began is shortened alike: 'none' there, not rotateY(0)).
  const angle = side === 'front' ? 0 : 180;
  const faceStyle = (which) => {
    const deg = which === 'front' ? angle : angle - 180;
    return { transform: deg === 0 ? 'none' : `rotateY(${deg}deg)` };
  };

  // ---------------------------------------------------------------- fitting
  // Again whenever the card's width or the screen's pixel ratio changes, and once the
  // fonts have come.
  const [width, setWidth] = useState(0);
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  const [faces, setFaces] = useState(0);
  // The back's paper, pen and stamp, face down, are drawn when the page is next idle, or
  // as the card turns, if that's sooner: they're never seen before then, and the page
  // shows sooner.
  const [backDrawn, setBackDrawn] = useState(start === 'back');
  useEffect(() => {
    if (backDrawn || frontOnly) return undefined;
    const now = () => setBackDrawn(true);
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(now, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(now, 300);
    return () => clearTimeout(id);
  }, [backDrawn, frontOnly]);
  useLayoutEffect(() => {
    const el = rootRef.current;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    let mq;
    const watch = () => {
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener('change', moved, { once: true });
    };
    const moved = () => {
      setDpr(window.devicePixelRatio || 1);
      watch();
    };
    watch();
    return () => mq.removeEventListener('change', moved);
  }, []);
  useEffect(() => {
    let live = true;
    if (!document.fonts) return undefined;
    loadCardFonts()
      .then(() => document.fonts.ready)
      .then(() => live && setFaces((n) => n + 1));
    return () => {
      live = false;
    };
  }, []);

  // The barcode in whole device pixels, for the width its label has.
  const code = codabarText(number);
  const [snap, setSnap] = useState(null);
  useLayoutEffect(() => {
    unsharpen(backRef.current);
    fitShopName(frontRef.current);
    fitName(nameRef.current);
    drawPen(nameRef.current, `${seed}:back:name`, dpr, faces > 0 && backDrawn);
    const box = svgRef.current?.parentElement;
    if (!box) return;
    const cs = getComputedStyle(box);
    const available = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const pick = available > 0 ? fitCodabar(code, available, dpr) : null;
    setSnap(pick && { ...pick, dpr });
  }, [width, dpr, faces, code, shop, name, backDrawn]);
  useLayoutEffect(() => {
    fitBack(backRef.current);
    if (WEBKIT && dpr > 1) sharpen(backRef.current, dpr);
  }, [snap, width, dpr, faces, code, shop, name, backDrawn]);
  // With one device pixel to a bar, the bars start on a whole pixel (a card that sits
  // at half a pixel would smear every bar across two). Only while the back lies still.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.style.transform = '';
    if (!snap || snap.n !== 1 || turning || side !== 'back') return;
    const fr = (svg.getBoundingClientRect().left * snap.dpr) % 1;
    if (fr > 0.01 && fr < 0.99) svg.style.transform = `translateX(${Math.round(((1 - fr) / snap.dpr) * 1000) / 1000}px)`;
  }, [snap, turning, side, width]);

  // ---------------------------------------------------------------- writing the name on
  // pen: 'wait' while the name waits, unseen, for its fonts (a new member never has
  // them yet); 'go' once they've come, or after FONT_WAIT_MS, when the card is fitted
  // again at their sizes and the name written on; 'still' with nothing to write (less
  // motion asked for: the name is simply there).
  const [pen, setPen] = useState(() => (writeOn && !prefersReducedMotion() && typeof Element !== 'undefined' && Element.prototype.animate ? 'wait' : 'still'));
  useEffect(() => {
    if (pen !== 'wait') return undefined;
    let live = true;
    const go = () => {
      if (!live) return;
      live = false;
      setFaces((n) => n + 1);
      setPen('go');
    };
    const timer = setTimeout(go, FONT_WAIT_MS);
    loadCardFonts(name).then(go);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pen, name]);
  // Word by word, as a pen goes (left to right, or right to left for a name in Arabic
  // or Hebrew), with a beat where it lifts between words. Once, in the same paint that
  // first shows the name, after it's been fitted (the fitting above runs first), so
  // it's never seen before it's written.
  useLayoutEffect(() => {
    const v = nameRef.current?.querySelector('.mc-v');
    if (pen !== 'go' || !v) return undefined;
    const words = [...v.querySelectorAll('.mc-hw')];
    const parts = words.length ? words : [v];
    const len = (e) => Math.max(1, [...e.textContent].length);
    const lift = 0.8;
    const total = parts.reduce((s, e) => s + len(e), 0) + (parts.length - 1) * lift;
    const from = getComputedStyle(v).direction === 'rtl' ? 'inset(-40% -10% -40% 100%)' : 'inset(-40% 100% -40% -10%)';
    let at = 0;
    const anims = parts.map((e) => {
      const d = (WRITE_MS * len(e)) / total;
      const a = e.animate([{ clipPath: from }, { clipPath: 'inset(-40% -10% -40% -10%)' }], { duration: d, delay: at, easing: 'linear', fill: 'backwards' });
      at += d + (WRITE_MS * lift) / total;
      return a;
    });
    return () => anims.forEach((a) => a.cancel());
    // Once, when the fonts have come, not when it's fitted again.
  }, [pen]);

  // The ink's edges as SVG filters (Filters). Where WebKit would draw them at one pixel
  // to a CSS pixel on a 2x or 3x screen, the back's printed words are set larger and
  // scaled down, so their bleed is drawn at the screen's pixels (sharpen); other text
  // and thin rules go without (they stay sharp), and the label printer's digits take a
  // hair of uneven spread instead (membershipCard.css). The pen and the print's wear are
  // drawn on canvases at the screen's own pixels, so they're the same everywhere.
  const soft = WEBKIT && dpr > 1;
  const f = (id, text = true) => (soft && text ? 'none' : `url(#${uid}-${id})`);
  const thick = cardThickness(width);
  const rootStyle = {
    '--mc-ink': ink,
    '--mc-ink-down': laidDown(ink),
    '--mc-stamp': STAMP_INK,
    '--mc-t': `${thick}px`,
    '--mc-kp': f('kp', false),
    '--mc-kpt': f('kp'),
    '--mc-kr': f('kr'),
    '--mc-kbl': f('kbl'),
    '--mc-ks': f('ks'),
    '--mc-kblz': soft ? `url(#${uid}-kblz)` : 'none',
    '--mc-unz': soft ? 1 / dpr : 1,
  };

  return (
    <div className={`mc${turning ? ' is-turning' : ''}${soft ? ' mc--soft' : ''}`} ref={rootRef} style={rootStyle} data-side={side}>
      <Filters uid={uid} seed={seed} ink={laidDown(ink)} z={soft ? dpr : 0} />
      <div className="mc-stage" id={`${uid}-stage`}>
        {!frontOnly && <Slab width={width} thickness={thick} angle={angle} />}
        <div className="mc-face mc-face--front" style={faceStyle('front')} aria-hidden={side !== 'front' || undefined} inert={side !== 'front'} onTransitionEnd={turned}>
          <Front sheetRef={frontRef} shop={shop} site={site} seed={`${seed}:front`} uid={uid} soft={soft} />
        </div>
        {!frontOnly && (
        <div className="mc-face mc-face--back" style={faceStyle('back')} aria-hidden={side !== 'back' || undefined} inert={side !== 'back'}>
          <Back
            sheetRef={backRef}
            nameRef={nameRef}
            barRef={barRef}
            svgRef={svgRef}
            shop={shop}
            name={name}
            sinceSaid={formatMonthYear(membership.since, { long: true })}
            waiting={pen === 'wait'}
            number={number}
            code={code}
            snap={snap}
            seed={`${seed}:back`}
            stamp={stamp}
            faces={faces}
            drawn={backDrawn}
          />
        </div>
        )}
      </div>
      {!frontOnly && (
        <>
          <div className="mc-ctl">
            <button type="button" className="btn" onClick={turn} aria-controls={`${uid}-stage`}>
              Turn over
            </button>
          </div>
          <p className="visually-hidden" aria-live="polite">
            {said}
          </p>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------ the two sides

function Front({ sheetRef, shop, site, seed, uid, soft }) {
  const logo = site?.logo || null;
  const kind = logo ? (site.logoWithName === false ? 'logo-only' : 'logo') : 'plain';
  const letters = useMemo(() => rubDown(shop, `shop:${shop}`), [shop]);
  let logoStyle;
  if (logo) {
    // As large as fits its box, in card widths, never stretched.
    const [mw, mh] = kind === 'logo' ? [58, 15] : [78, 30];
    const s = Math.min(mw / logo.width, mh / logo.height);
    logoStyle = { width: `${(logo.width * s).toFixed(2)}cqw`, height: `${(logo.height * s).toFixed(2)}cqw`, filter: soft ? `url(#${uid}-logo)` : `url(#${uid}-logo) url(#${uid}-kp)` };
  }
  return (
    <Paper sheetRef={sheetRef} seed={seed} className="mc-card mc-card--front" face holes role="img" aria-label={`${shop} membership card, front`}>
      <div className={`mc-front mc-front--${kind}`}>
        {logo && <img className="mc-logo mc-plate2" src={logo.url} alt="" width={logo.width} height={logo.height} style={logoStyle} />}
        {kind !== 'logo-only' && (
          <p className="mc-shop mc-plate2 mc-pr" dir="auto">
            <span>
              {letters.map((word, i) => (
                <span key={i}>
                  {i > 0 && ' '}
                  <span className="mc-nw">
                    {word.map((l, j) => (
                      <span key={j} className="mc-rub" style={{ '--y': `${l.y}px`, '--r': `${l.r}deg`, '--m': `${l.m}px` }}>
                        {l.ch}
                      </span>
                    ))}
                  </span>
                </span>
              ))}
            </span>
          </p>
        )}
      </div>
      <span className="mc-key" aria-hidden="true" />
      {/* The words are bare card: white, on the card's ink layer, is no ink at all. */}
      <div className="mc-band mc-plate2">
        <span className="mc-band-ink" aria-hidden="true" />
        <p className="mc-kind mc-pr">Membership card</p>
      </div>
    </Paper>
  );
}

function Back({ sheetRef, nameRef, barRef, svgRef, shop, name, sinceSaid, waiting, number, code, snap, seed, stamp, faces, drawn }) {
  const words = useMemo(() => penWords(name, `${seed}:name`), [name, seed]);
  const digits = useMemo(() => strikes(groupNumber(number), `${seed}:bar:n`), [number, seed]);
  const lean = labelLean(`${seed}:bar`);
  // Unsnapped (before layout, or too narrow for whole pixels): scaled to the label.
  const fallback = useMemo(() => codabarPx(code, 1, 2.5), [code]);
  const H = 34;
  const cssWidth = snap && Math.ceil((snap.width / snap.dpr) * 64) / 64;
  return (
    <Paper
      sheetRef={sheetRef}
      seed={seed}
      defer={!drawn}
      className="mc-card mc-card--back"
      face
      role="group"
      aria-label={`${shop} membership card, back`}
      stuck={
        // The label repeats the number for a scanner; a screen reader has heard it beside its label.
        <div className="mc-bar" aria-hidden="true" ref={barRef}>
          {/* A 1-pixel bar turned by a degree would smear across two pixels: on a screen with big pixels the label lies square. */}
          <Paper seed={`${seed}:bar`} defer={!drawn} className="mc-label" radius={1.2} grain={0.62} tone={false} style={{ '--mc-rot': `${snap?.n === 1 ? 0 : lean}deg` }}>
            <div className="mc-label-ink">
              <svg
                ref={svgRef}
                className="mc-codabar"
                data-code={code}
                data-snap={snap ? `${snap.n}:${snap.w}@${snap.dpr}` : undefined}
                viewBox={snap ? `0 0 ${cssWidth * snap.dpr} ${H}` : `0 0 ${fallback.width} ${H}`}
                preserveAspectRatio="none"
                shapeRendering="crispEdges"
                focusable="false"
                style={snap ? { width: `${cssWidth}px` } : undefined}
              >
                {(snap ? snap.bars : fallback.bars).map(([x, w]) => (
                  <rect key={x} x={x} y="0" width={w} height={H} />
                ))}
              </svg>
              <span className="mc-digits mc-typed mc-bl">
                <Strikes chars={digits} />
              </span>
            </div>
          </Paper>
        </div>
      }
    >
      <p className={`mc-field mc-name${waiting ? ' is-waiting' : ''}`} ref={nameRef}>
        <span className="mc-k mc-plate2 mc-bl">Name</span>
        {/* dir="auto": a name in Arabic or Hebrew runs right to left, its words in its own
            order. Each word is written in ballpoint on a canvas of its own (drawPen), over
            the word's own letters, which stay the text that's read and selected. */}
        <span className="mc-v" dir="auto">
          {words.map((w, i) =>
            w.y === undefined ? (
              ' '
            ) : (
              <span key={i} className="mc-hw" style={{ '--y': `${w.y}px`, '--r': `${w.r}deg`, '--s': w.s, '--o': w.o }}>
                {w.text}
                <span className="mc-pb" />
                <canvas className="mc-pen" aria-hidden="true" />
              </span>
            ),
          )}
        </span>
      </p>
      <p className="mc-field mc-since">
        <span className="mc-k mc-plate2 mc-bl">Member since</span>
        <span className="mc-v">
          <span className="visually-hidden">{sinceSaid}</span>
          <Stamp stamp={stamp} faces={faces} drawn={drawn} />
        </span>
      </p>
      <p className="mc-k mc-numk mc-plate2 mc-bl">
        Membership number<span className="visually-hidden"> {groupNumber(number)}</span>
      </p>
      {/* fitBack shows the short one when a long shop name won't fit. */}
      <p className="mc-small mc-bl">
        <span className="mc-small-full">
          {SMALL_PRINT[0]}
          <bdi>{shop}</bdi>
          {SMALL_PRINT[1]}
        </span>
        <span className="mc-small-short">{SMALL_PRINT_SHORT}</span>
      </p>
    </Paper>
  );
}

// The date stamp: one rubber band to a character (a fixed pitch, condensed capitals),
// each a hair high or low, the whole stamp a little crooked, and its ink drawn over in
// patches (drawStamp). Its own layer, blended into the card like the rest of the ink,
// so its wear lightens only its own ink. Read as one piece of text beside it
// ("November 2026").
function Stamp({ stamp, faces, drawn }) {
  const wearRef = useRef(null);
  const boxRef = useRef(null);
  useEffect(() => {
    const box = boxRef.current;
    const c = wearRef.current;
    if (!box || !c || !stamp || !drawn) return undefined;
    const draw = () => drawStamp(c, box, stamp);
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    return () => ro.disconnect();
  }, [stamp, faces, drawn]);
  if (!stamp) return null;
  return (
    <span aria-hidden="true" className="mc-stamp" ref={boxRef} style={{ '--mc-tilt': `${stamp.tilt}deg`, '--mc-sx': `${stamp.dx}px`, '--mc-sy': `${stamp.dy}px` }}>
      <span className="mc-stamp-ink">
        {stamp.bands.map((b, i) =>
          b.y === undefined ? (
            <span key={i} className="mc-sc mc-sc--sp">
              {b.ch}
            </span>
          ) : (
            <span key={i} className={`mc-sc${b.digit ? ' mc-sc--d' : ''}`} style={{ '--y': `${b.y}px`, '--sq': b.sx }}>
              {b.ch}
            </span>
          ),
        )}
      </span>
      <canvas className="mc-stamp-wear" ref={wearRef} />
    </span>
  );
}

const Strikes = ({ chars }) =>
  chars.map((c, i) =>
    c.o === undefined ? (
      ' '
    ) : (
      <span key={i} className="mc-tc" style={{ '--o': c.o, '--x': `${c.x}px`, '--y': `${c.y}px` }}>
        {c.ch}
      </span>
    ),
  );

// ------------------------------------------------------------ paper

// A cut sheet of card or label stock: its edge (never quite square), its two plates
// a touch off register, a cloudy tone and a fine grain, both drawn on canvases at its
// laid-out size, and over them its ink layer, blended into them (membershipCard.css).
// A card's face (`face`) also has the print's own wear over its ink (drawInkwear; with
// pin-holes in its solid print, `holes`) and the shade it takes as it turns away from
// the light. A sheet that isn't seen yet (`defer`) is drawn once it is about to be.
function Paper({ sheetRef, seed, className, radius = 12, grain = 0.85, tone = true, face = false, holes = false, defer = false, style, stuck, children, ...attrs }) {
  const own = useRef(null);
  const ref = sheetRef || own;
  const toneRef = useRef(null);
  const grainRef = useRef(null);
  const wearRef = useRef(null);
  const edge = useMemo(() => cardEdge(seed, radius), [seed, radius]);
  const reg = useMemo(() => register(seed), [seed]);
  const draw = useCallback(() => {
    const sheet = ref.current;
    const w = sheet?.offsetWidth;
    const h = sheet?.offsetHeight;
    if (!w || !h || defer) return;
    drawGrain(grainRef.current, w, h, reg);
    if (tone) drawTone(toneRef.current, w, h, seed);
    if (face) drawInkwear(wearRef.current, w, h, reg, seed, holes);
  }, [ref, reg, seed, tone, face, holes, defer]);
  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [draw, ref]);
  return (
    <div className={className} style={{ '--mc-rx': reg.x, '--mc-ry': reg.y, ...style }} {...attrs}>
      <div className="mc-sheet" ref={ref} style={{ clipPath: edge }}>
        {tone && <canvas className="mc-tone" ref={toneRef} aria-hidden="true" />}
        <canvas className="mc-grain" ref={grainRef} aria-hidden="true" style={{ opacity: grain }} />
        <div className="mc-ink">
          {children}
          {face && <canvas className="mc-inkwear" ref={wearRef} aria-hidden="true" />}
        </div>
        {stuck}
        {face && <span className="mc-shade" aria-hidden="true" />}
      </div>
    </div>
  );
}

// The grain of card stock, once for every card: 256 pixels that tile, shown at half
// size, so a fibre is half a CSS pixel on any screen. And with it, the print's wear:
// ink never lies quite evenly on card, so it took less in a fine mottle a pixel or three
// across, and where the card's light fibres are (white on the ink layer, 12% at most,
// within what the ink rule allows for: INK_THINNEST). Solid print shows the card's
// texture through it, as print soaked into card does.
let tiles = null;
const TILE = 256;
function paperTiles() {
  if (tiles) return tiles;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = TILE;
    c.height = TILE;
    return c;
  };
  const grain = make();
  const wear = make();
  const g = grain.getContext('2d');
  const k = wear.getContext('2d');
  if (!g || !k) return null;
  const img = g.createImageData(TILE, TILE);
  const d = img.data;
  const R = rng('grain:paper');
  const mottle = periodicNoise(R, TILE, 8);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = (y * TILE + x) * 4;
      const v = (R() + R() + R()) / 3 - 0.5 + (mottle(x, y) - 0.5) * 0.17;
      const a = Math.min(1, Math.abs(v) * 2);
      if (v < 0) [d[i], d[i + 1], d[i + 2], d[i + 3]] = [64, 52, 40, a * a * 52];
      else [d[i], d[i + 1], d[i + 2], d[i + 3]] = [255, 252, 244, a * a * 60];
    }
  }
  g.putImageData(img, 0, 0);
  // A few fibres, wrapped at the tile's edges.
  for (let n = 0; n < 46; n++) {
    const x = R() * TILE;
    const y = R() * TILE;
    const len = R.range(3, 12);
    const ang = R() * Math.PI;
    const bend = R.range(-0.4, 0.4);
    const dark = R() < 0.45;
    g.strokeStyle = dark ? `rgba(70,58,44,${R.range(0.05, 0.1).toFixed(2)})` : `rgba(255,250,238,${R.range(0.06, 0.16).toFixed(2)})`;
    g.lineWidth = R.range(0.5, 0.9);
    for (const ox of [-TILE, 0, TILE]) {
      for (const oy of [-TILE, 0, TILE]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.quadraticCurveTo(x + ox + Math.cos(ang + bend) * len * 0.5, y + oy + Math.sin(ang + bend) * len * 0.5, x + ox + Math.cos(ang) * len, y + oy + Math.sin(ang) * len);
        g.stroke();
      }
    }
  }
  const px = g.getImageData(0, 0, TILE, TILE).data;
  const out = k.createImageData(TILE, TILE);
  const o = out.data;
  // The mottle: bumps a pixel and a half, and three pixels, across (the tile is at twice
  // CSS size), worked out at half the tile's size and smoothed up.
  const HALF = TILE / 2;
  const fine = periodicNoise(R, HALF, 85);
  const mid = periodicNoise(R, HALF, 43);
  const mot = new Float32Array(HALF * HALF);
  for (let y = 0; y < HALF; y++) {
    for (let x = 0; x < HALF; x++) {
      const n = (fine(x, y) * 0.55 + mid(x, y) * 0.45 - 0.36) / 0.44;
      mot[y * HALF + x] = n <= 0 ? 0 : n >= 1 ? 0.1 : n * n * (3 - 2 * n) * 0.1;
    }
  }
  for (let i = 0; i < px.length; i += 4) {
    const x = ((i / 4) % TILE) / 2;
    const y = Math.floor(i / 4 / TILE) / 2;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = (x0 + 1) % HALF;
    const y1 = (y0 + 1) % HALF;
    const u = x - x0;
    const v = y - y0;
    const mottle = (mot[y0 * HALF + x0] * (1 - u) + mot[y0 * HALF + x1] * u) * (1 - v) + (mot[y1 * HALF + x0] * (1 - u) + mot[y1 * HALF + x1] * u) * v;
    const light = (px[i] + px[i + 1] + px[i + 2]) / 765;
    const fibre = light > 0.6 ? Math.min(0.05, (px[i + 3] / 255) * ((light - 0.6) / 0.4) * 0.6) : 0;
    o[i] = 255;
    o[i + 1] = 255;
    o[i + 2] = 255;
    o[i + 3] = Math.min(0.12, fibre + mottle) * 255;
  }
  k.putImageData(out, 0, 0);
  tiles = { grain, wear };
  return tiles;
}

// A tile over a canvas at twice the CSS size, starting where the sheet's grain does.
function fillTile(canvas, tile, w, h, { gx, gy }) {
  const g = canvas?.getContext('2d');
  if (!tile || !g) return null;
  canvas.width = Math.round(w * 2);
  canvas.height = Math.round(h * 2);
  const pattern = g.createPattern(tile, 'repeat');
  g.save();
  g.translate(-gx * 2, -gy * 2);
  g.fillStyle = pattern;
  g.fillRect(0, 0, canvas.width + gx * 2, canvas.height + gy * 2);
  g.restore();
  return g;
}

const drawGrain = (canvas, w, h, reg) => fillTile(canvas, paperTiles()?.grain, w, h, reg);

// No two sheets from one stack are quite the same: low clouds of lighter and darker,
// and a seeded cast, warmer or cooler. At half the sheet's size; it's soft anyway.
function drawTone(canvas, w, h, seed) {
  const g = canvas?.getContext('2d');
  if (!g) return;
  const W = Math.max(8, Math.round(w / 2));
  const H = Math.max(8, Math.round(h / 2));
  const s = W / w;
  canvas.width = W;
  canvas.height = H;
  const img = g.createImageData(W, H);
  const d = img.data;
  const R = rng(`${seed}:tone`);
  const n1 = periodicNoise(R, 512, 5);
  const n2 = periodicNoise(R, 512, 13);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = (n1(x / s, y / s) - 0.5) * 0.9 + (n2(x / s, y / s) - 0.5) * 0.5;
      if (v > 0) [d[i], d[i + 1], d[i + 2], d[i + 3]] = [255, 251, 242, v * 0.035 * 255];
      else [d[i], d[i + 1], d[i + 2], d[i + 3]] = [60, 48, 34, -v * 0.028 * 255];
    }
  }
  g.putImageData(img, 0, 0);
  const warm = R() < 0.5;
  const lift = R.range(-1, 1);
  g.fillStyle =
    lift > 0
      ? warm
        ? `rgba(255,244,222,${(lift * 0.07).toFixed(3)})`
        : `rgba(246,248,255,${(lift * 0.06).toFixed(3)})`
      : warm
        ? `rgba(92,64,30,${(-lift * 0.05).toFixed(3)})`
        : `rgba(40,44,52,${(-lift * 0.04).toFixed(3)})`;
  g.fillRect(0, 0, W, H);
}

// Print is never quite solid: the ink lies thinner in the card's mottle and along its
// light fibres (the tile), and in slow clouds (up to 3% more), never more than 15%
// thinner in all (INK_THINNEST, which the ink rule allows for); and on the front's solid
// print, here and there it missed the card altogether, leaving a pin-hole of bare card.
// All in white on the ink layer, which is no ink at all there: over bare card it shows
// nothing. Seeded, so a card is the same every time.
function drawInkwear(canvas, w, h, reg, seed, holes) {
  const g = fillTile(canvas, paperTiles()?.wear, w, h, reg);
  if (!g) return;
  const R = rng(`${seed}:wear`);
  const clouds = document.createElement('canvas');
  const cw = Math.max(4, Math.round(w / 8));
  const ch = Math.max(4, Math.round(h / 8));
  clouds.width = cw;
  clouds.height = ch;
  const cg = clouds.getContext('2d');
  if (cg) {
    const img = cg.createImageData(cw, ch);
    const n = periodicNoise(R, 400, 6);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4;
        img.data.set([255, 255, 255, Math.round(Math.max(0, n(x * 8, y * 8) - 0.35) * 1.55 * 0.03 * 255)], i);
      }
    }
    cg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(clouds, 0, 0, canvas.width, canvas.height);
  }
  if (!holes) return;
  // Pin-holes, half a pixel to a pixel across, now and then two or three together.
  const count = Math.round(w * h * 0.0032);
  for (let k = 0; k < count; k++) {
    const x = R() * canvas.width;
    const y = R() * canvas.height;
    const many = R() < 0.12 ? 1 + Math.floor(R() * 3) : 1;
    for (let m = 0; m < many; m++) {
      g.fillStyle = `rgba(255,255,255,${R.range(0.55, 0.9).toFixed(2)})`;
      g.beginPath();
      g.ellipse(x + R.range(-3, 3) * (m > 0), y + R.range(-3, 3) * (m > 0), R.range(0.9, 2), R.range(0.8, 1.6), R() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }
}

// Where a line of type's capitals sit in its line box, from the font's own measures:
// -> { base, cap } in CSS pixels, the baseline from the top and the capitals' height.
let measurer = null;
function capitals(cs, text) {
  const size = parseFloat(cs.fontSize) || 16;
  const lh = parseFloat(cs.lineHeight) || size * 1.1;
  measurer ||= document.createElement('canvas').getContext('2d');
  if (!measurer) return { base: lh * 0.82, cap: size * 0.72 };
  measurer.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const m = measurer.measureText(text);
  const asc = m.fontBoundingBoxAscent ?? size * 0.96;
  const desc = m.fontBoundingBoxDescent ?? size * 0.26;
  return { base: (lh - asc - desc) / 2 + asc, cap: m.actualBoundingBoxAscent || size * 0.72 };
}

// The stamp's patches, voids and the ring of its frame (stampCoverage), over the stamp
// at up to twice the CSS pixels: white where the ink film is thinner, only over the
// characters' own box, and the stamp's violet where the frame touched the card, a hair
// round them and within their line, clear of the label above and the rule below. Kept
// for the same stamp at the same size: it's the same every time.
const stamped = new Map();
function drawStamp(canvas, box, stamp) {
  const g = canvas?.getContext('2d');
  const ink = box.querySelector('.mc-stamp-ink');
  const w = ink?.offsetWidth;
  const h = ink?.offsetHeight;
  if (!g || !w || !h) return;
  const cs = getComputedStyle(ink);
  const size = parseFloat(cs.fontSize) || 16;
  const text = stamp.bands.map((b) => b.ch).join('').toUpperCase();
  const { base, cap } = capitals(cs, text);
  // The canvas reaches this far either side of the characters (membershipCard.css).
  const out = 0.16 * size;
  const scale = Math.min(2, Math.max(1, Math.ceil(window.devicePixelRatio || 1)));
  const key = `${stamp.seed}:${w}:${h}:${size}:${scale}:${base.toFixed(2)}:${cap.toFixed(2)}`;
  let cov = stamped.get(key);
  if (!cov) {
    const top = base - cap;
    cov = stampCoverage(stamp, {
      w: w + 2 * out,
      h,
      scale,
      ink: { x0: out, x1: out + w, y0: top - 0.05 * size, y1: base + 0.05 * size },
      frame: { x0: out - 0.1 * size, x1: out + w + 0.1 * size, y0: Math.max(0.7, top - 0.1 * size), y1: Math.min(h - 0.7, base + 0.09 * size), r: 0.12 * size },
    });
    if (stamped.size > 8) stamped.delete(stamped.keys().next().value);
    stamped.set(key, cov);
  }
  const { width, height, cover, ring } = cov;
  canvas.width = width;
  canvas.height = height;
  const img = g.createImageData(width, height);
  const d = img.data;
  const [r, gr, b] = [1, 3, 5].map((i) => Number.parseInt(STAMP_INK.slice(i, i + 2), 16));
  for (let p = 0; p < cover.length; p++) {
    const i = p * 4;
    if (ring[p] > 0.004) d.set([r, gr, b, Math.round(ring[p] * 255)], i);
    else if (cover[p] < 1) d.set([255, 255, 255, Math.round((1 - cover[p]) * 255)], i);
  }
  g.putImageData(img, 0, 0);
}

// The name in ballpoint (ballpoint, membershipCard.js), word by word, once it has been
// fitted and its fonts have come (`ready`; till then, and for a word carried on across
// lines or a canvas that can't be drawn on, the word keeps its own letters): each word's
// letters drawn as its font has them on the word's own canvas, at the screen's pixels,
// and the pen's ink laid over them there; the word's own letters, under it, go clear
// (.is-penned), and stay the text that's read and selected. A word's ink is kept, for
// the same word drawn the same size again.
const PEN_RGB = [PEN_INK, PEN_SHEEN].map((c) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16)));
const penned = new Map();
function drawPen(field, seed, dpr, ready) {
  const v = field?.querySelector('.mc-v');
  if (!v) return;
  const words = v.querySelectorAll('.mc-hw');
  for (const hw of words) hw.classList.remove('is-penned');
  if (!ready) return;
  const cs = getComputedStyle(v);
  const size = parseFloat(cs.fontSize) || 20;
  const lh = parseFloat(cs.lineHeight) || size * 1.05;
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const scale = Math.min(2, Math.max(1, Math.ceil(dpr || 1)));
  const [ink, shine] = PEN_RGB;
  for (const hw of words) {
    const c = hw.querySelector('.mc-pen');
    const probe = hw.querySelector('.mc-pb');
    const g = c?.getContext('2d', { willReadFrequently: true });
    const ww = hw.offsetWidth;
    const hh = hw.offsetHeight;
    if (!g || !probe || !ww || hh > lh * 1.5) {
      if (c) c.width = c.height = 0;
      continue;
    }
    // Room round the word for the pen's loops and tails.
    const px = Math.ceil(size * 0.3);
    const py = Math.ceil(size * 0.3);
    const W = Math.round((ww + 2 * px) * scale);
    const H = Math.round((hh + 2 * py) * scale);
    const rtl = getComputedStyle(hw).direction === 'rtl';
    const text = hw.textContent;
    // How far along the name the word starts, so the pen's pressure runs on.
    const at = (rtl ? v.offsetWidth - hw.offsetLeft - ww : hw.offsetLeft) + (hw.offsetTop > lh / 2 ? 400 : 0);
    const key = [text, font, scale, seed, at, W, H, probe.offsetTop, rtl].join('|');
    c.width = W;
    c.height = H;
    Object.assign(c.style, { left: `${-px}px`, top: `${-py}px`, width: `${W / scale}px`, height: `${H / scale}px` });
    let done = penned.get(key);
    if (!done) {
      g.setTransform(scale, 0, 0, scale, 0, 0);
      g.font = font;
      g.direction = rtl ? 'rtl' : 'ltr';
      g.textAlign = rtl ? 'right' : 'left';
      g.textBaseline = 'alphabetic';
      g.fillStyle = '#000';
      const ox = px + (rtl ? ww : 0);
      const oy = py + probe.offsetTop;
      g.fillText(text, ox, oy);
      g.setTransform(1, 0, 0, 1, 0, 0);
      // Only the letters' own box, and a little round it for the pen's blobs.
      const t = g.measureText(text);
      const m = 0.2 * size;
      const x0 = Math.max(0, Math.floor((ox - t.actualBoundingBoxLeft - m) * scale));
      const y0 = Math.max(0, Math.floor((oy - t.actualBoundingBoxAscent - m) * scale));
      const cw = Math.min(W, Math.ceil((ox + t.actualBoundingBoxRight + m) * scale)) - x0;
      const ch = Math.min(H, Math.ceil((oy + t.actualBoundingBoxDescent + m) * scale)) - y0;
      if (!(cw > 0 && ch > 0)) {
        c.width = c.height = 0;
        continue;
      }
      const all = g.getImageData(x0, y0, cw, ch).data;
      const mask = new Uint8ClampedArray(cw * ch);
      for (let p = 0; p < mask.length; p++) mask[p] = all[p * 4 + 3];
      const { film, sheen } = ballpoint(mask, cw, ch, scale, { size, seed, at: at + (x0 / scale - px) });
      const img = g.createImageData(cw, ch);
      const d = img.data;
      for (let p = 0; p < film.length; p++) {
        if (!film[p]) continue;
        const k = sheen[p];
        const i = p * 4;
        d[i] = ink[0] + (shine[0] - ink[0]) * k;
        d[i + 1] = ink[1] + (shine[1] - ink[1]) * k;
        d[i + 2] = ink[2] + (shine[2] - ink[2]) * k;
        d[i + 3] = film[p] * 255;
      }
      done = { img, x: x0, y: y0 };
      if (penned.size > 24) penned.delete(penned.keys().next().value);
      penned.set(key, done);
    }
    g.clearRect(0, 0, W, H);
    g.putImageData(done.img, done.x, done.y);
    hw.classList.add('is-penned');
  }
}

// ------------------------------------------------------------ the card's edge

// Turning over, the card shows its thickness: strips of cut card round its edge
// (slabPieces), drawn under the two faces and turning with them, the same angle by the
// same path. Its two faces lie card's thickness apart and turn about its middle
// (membershipCard.css). Only while it turns: lying still, the face up is drawn flat.
function Slab({ width, thickness, angle }) {
  const height = (width * 54) / 85.6;
  const pieces = useMemo(() => (width ? slabPieces({ width, height }) : []), [width, height]);
  return pieces.map((p) => (
    <span
      key={p.key}
      className={`mc-edge mc-edge--${p.key.length === 1 ? 'side' : 'corner'}`}
      aria-hidden="true"
      style={{ height: `${p.h}px`, marginTop: `${-p.h / 2}px`, transform: `translateZ(${-thickness / 2}px) rotateY(${angle}deg) ${p.place}` }}
    />
  ));
}

// ------------------------------------------------------------ ink

// The ink's edges, as SVG filters in the page (a filter can't come from a data:
// address). Print soaks in: its edge drawn a hair along the card's fibres, which run
// across the card, softened, and a touch darker right at the edge, where the press
// squeezed the ink (kp). Thin rules and the keyline take the soft edge alone, which
// leaves them even (kr). The back's small type bleeds as well: its edge a little rough,
// and the ink wicked a little way into the fibres, never more than about half a pixel,
// more in some letters than others, so it never fills a counter or joins two letters
// (kbl). The rubber date stamp prints a rounder, rougher edge (ks). And the logo,
// printed in the ink from its own light parts: it was made for the app's dark header.
function Filters({ uid, seed, ink, z }) {
  const V = hash(seed) % 3;
  return (
    <svg className="mc-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id={`${uid}-kp`} x="-4%" y="-14%" width="108%" height="128%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.7 1.6" numOctaves="2" seed={11 + V} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="0.9" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation="0.4" result="b" />
          <feComponentTransfer in="b" result="s">
            <feFuncA type="linear" slope="1.45" intercept="-0.06" />
          </feComponentTransfer>
          <feMorphology in="s" operator="erode" radius="0.7" result="in" />
          <feComposite in="s" in2="in" operator="out" result="rim" />
          <feColorMatrix in="rim" type="matrix" values="0.7 0 0 0 0  0 0.7 0 0 0  0 0 0.7 0 0  0 0 0 0.5 0" result="squash" />
          <feMerge>
            <feMergeNode in="s" />
            <feMergeNode in="squash" />
          </feMerge>
        </filter>
        <filter id={`${uid}-kr`} x="-2%" y="-40%" width="104%" height="180%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.6 1.4" numOctaves="2" seed={61 + V} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="0.6" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation="0.3" result="b" />
          <feComponentTransfer in="b">
            <feFuncA type="linear" slope="1.15" intercept="-0.01" />
          </feComponentTransfer>
        </filter>
        {bleed(`${uid}-kbl`, V, 1)}
        {z > 1 && bleed(`${uid}-kblz`, V, z)}
        <filter id={`${uid}-ks`} x="-8%" y="-20%" width="116%" height="140%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={51 + V} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.1" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation="0.42" result="b" />
          <feComponentTransfer in="b">
            <feFuncA type="linear" slope="1.6" intercept="-0.1" />
          </feComponentTransfer>
        </filter>
        <filter id={`${uid}-logo`} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="l" />
          <feComposite in="l" in2="SourceAlpha" operator="in" result="la" />
          <feFlood floodColor={ink} />
          <feComposite in2="la" operator="in" />
        </filter>
      </defs>
    </svg>
  );
}

// The back's small type's bleed (kbl), for type `z` times its size (sharpen): the same
// marks on the card, drawn at `z` times as many pixels.
function bleed(id, V, z) {
  const n = (v) => Math.round(v * 1000) / 1000;
  return (
    <filter id={id} x="-4%" y="-25%" width="108%" height="150%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency={`${n(0.8 / z)} ${n(1.7 / z)}`} numOctaves="2" seed={21 + V} result="n" />
      <feDisplacementMap in="SourceGraphic" in2="n" scale={n(0.6 * z)} xChannelSelector="R" yChannelSelector="G" result="d" />
      <feGaussianBlur in="d" stdDeviation={n(0.25 * z)} result="b" />
      <feComponentTransfer in="b" result="core">
        <feFuncA type="linear" slope="1.35" intercept="-0.04" />
      </feComponentTransfer>
      <feTurbulence type="fractalNoise" baseFrequency={`${n(0.9 / z)} ${n(1.6 / z)}`} numOctaves="2" seed={31 + V} result="f" />
      <feDisplacementMap in="d" in2="f" scale={n(1.1 * z)} xChannelSelector="R" yChannelSelector="G" result="wick" />
      <feGaussianBlur in="wick" stdDeviation={n(0.3 * z)} result="wb" />
      <feTurbulence type="fractalNoise" baseFrequency={n(0.06 / z)} numOctaves="1" seed={41 + V} result="u" />
      <feColorMatrix in="u" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.6 0 0 0 -0.35" result="um" />
      <feComposite in="wb" in2="um" operator="in" result="w2" />
      <feComponentTransfer in="w2" result="feather">
        <feFuncA type="linear" slope="0.6" />
      </feComponentTransfer>
      <feMerge>
        <feMergeNode in="feather" />
        <feMergeNode in="core" />
      </feMerge>
    </filter>
  );
}

// WebKit draws an SVG filter at one pixel to a CSS pixel, which on a 2x or 3x screen
// blurs type (WEBKIT). There, each line of the back's printed type is set `dpr` times as
// large, its bleed drawn by the same filter at `dpr` times its sizes (kblz), and scaled
// back down (membershipCard.css, .mc-big): the filter's pixels are the screen's own. It
// keeps its place on the card: scaled about the corner it's put by (the small print by
// its foot, the number's label by its right), the label beside the name about its
// baseline, with margins taking back the room the larger type would take. After the
// back is fitted, and undone before it's fitted again.
const SHARP = ['.mc-name .mc-k', '.mc-since .mc-k', '.mc-numk', '.mc-small'];
function unsharpen(sheet) {
  for (const el of sheet?.querySelectorAll('.mc-big') ?? []) {
    el.classList.remove('mc-big');
    for (const p of ['font-size', 'width', 'margin-top', 'margin-right', 'margin-bottom', 'transform-origin']) el.style.removeProperty(p);
  }
}
function sharpen(sheet, dpr) {
  if (!sheet) return;
  unsharpen(sheet);
  const k = dpr - 1;
  for (const sel of SHARP) {
    const el = sheet.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    // Its size to the fraction of a pixel (it's only ever moved, not turned, lying still).
    const { width: w, height: h } = el.getBoundingClientRect();
    const st = el.style;
    if (sel === '.mc-name .mc-k') {
      const { base } = capitals(cs, el.textContent);
      st.transformOrigin = `0 ${base * dpr}px`;
      st.marginTop = `${-k * base}px`;
      st.marginBottom = `${-k * (h - base)}px`;
      st.marginRight = `${-k * w}px`;
    } else if (sel === '.mc-since .mc-k') {
      st.transformOrigin = '0 0';
      st.marginBottom = `${-k * h}px`;
      st.marginRight = `${-k * w}px`;
    } else {
      // Placed on the card by itself: as wide again, a hair over, so it breaks its
      // lines where it did.
      st.width = `${w * dpr + 0.5}px`;
      st.transformOrigin = sel === '.mc-small' ? '0 100%' : '100% 0';
    }
    st.fontSize = `${parseFloat(cs.fontSize) * dpr}px`;
    el.classList.add('mc-big');
  }
}

// ------------------------------------------------------------ fitting

// The shop's name is set as large as fits its space, down to 12px, on three lines at
// most, with at least 4 card widths of bare card between its lowest descenders and the
// keyline. A word left on a line of its own: if up to 15% smaller saves the line, it's
// set there.
function fitShopName(sheet) {
  const n = sheet?.querySelector('.mc-shop');
  const t = n?.firstElementChild;
  const key = sheet?.querySelector('.mc-key');
  if (!t || !n.clientWidth) return;
  n.style.fontSize = '';
  let size = parseFloat(getComputedStyle(n).fontSize);
  const ratio = parseFloat(getComputedStyle(n).lineHeight) / size;
  const lines = (px) => Math.round(t.offsetHeight / (px * ratio));
  // In the card's own layout, not the screen's, so a card part-way through turning
  // over is fitted the same. Descenders hang about a tenth of the size below the line.
  // (The keyline is drawn 3px into its box: membershipCard.css.)
  const clear = () => !key || key.offsetTop + 3 - (topIn(t, key.offsetParent) + t.offsetHeight + 0.1 * size) >= 0.04 * sheet.clientWidth;
  const over = () => t.offsetHeight > n.clientHeight + 0.5 || t.offsetWidth > n.clientWidth + 0.5 || lines(size) > 3 || !clear();
  while (over() && size > 12) {
    size = Math.max(12, size - 0.5);
    n.style.fontSize = `${size}px`;
  }
  const l0 = lines(size);
  if (l0 > 1) {
    let s2 = size;
    while (s2 > Math.max(12, size * 0.85)) {
      s2 -= 0.5;
      n.style.fontSize = `${s2}px`;
      if (lines(s2) < l0) break;
    }
    if (lines(s2) < l0) size = s2;
    else n.style.fontSize = `${size}px`;
  }
}

// How far down `el` is in `root`, which holds it.
function topIn(el, root) {
  let y = 0;
  for (let e = el; e && e !== root; e = e.offsetParent) y += e.offsetTop;
  return y;
}

// A long name is written smaller, down to 20px, then carried on to a second line, and
// down to 16px to keep it to two lines and clear of Member since.
function fitName(f) {
  const v = f?.querySelector('.mc-v');
  const k = f?.querySelector('.mc-k');
  if (!v || !k || !f.clientWidth) return;
  v.style.fontSize = '';
  f.classList.remove('mc-name--wrap');
  const avail = f.clientWidth - k.offsetWidth - (parseFloat(getComputedStyle(f).columnGap) || 10);
  let size = parseFloat(getComputedStyle(v).fontSize);
  const set = (px) => {
    size = px;
    v.style.fontSize = `${px}px`;
  };
  while (v.scrollWidth > avail && size > 20) set(Math.max(20, size - 0.5));
  if (v.scrollWidth > avail) f.classList.add('mc-name--wrap');
  const lines = () => Math.round(v.getBoundingClientRect().height / (size * 1.05));
  while (f.classList.contains('mc-name--wrap') && lines() > 2 && size > 16) set(Math.max(16, size - 0.5));
  const since = f.parentElement?.querySelector(':scope > .mc-since');
  while (since && f.offsetTop + f.offsetHeight > since.offsetTop - 2 && size > 16) set(Math.max(16, size - 0.5));
}

// The small print may not run into the number label or Member since. In turn: the
// barcode gets shorter (to 26px) and the middle row moves up (never into the name);
// then the small print says "the shop on the front" instead of a long name; then the
// top and bottom margins narrow; then the barcode goes down to 22px.
function fitBack(sheet) {
  if (!sheet?.clientWidth) return;
  const q = (s) => sheet.querySelector(s);
  const small = q('.mc-small');
  const bar = q('.mc-bar');
  const since = q('.mc-since');
  const nameF = q('.mc-name');
  const svg = bar?.querySelector('svg');
  if (!small || !bar || !since || !nameF || !svg) return;
  const bottom = (e) => e.offsetTop + e.offsetHeight;
  const gap = Math.max(4, sheet.clientWidth * 0.012);
  const clash = () => Math.max(bottom(bar), bottom(since)) + gap > small.offsetTop;
  const lines = () => Math.round(small.offsetHeight / parseFloat(getComputedStyle(small).lineHeight));
  // Member since stops short of the number label.
  since.style.width = '';
  const across = bar.offsetLeft - gap - since.offsetLeft;
  if (since.offsetWidth > across) since.style.width = `${across}px`;
  let short = false;
  let edge = false;
  let minBar = 26;
  const run = () => {
    for (const p of ['--bar-h', '--mid', '--edge']) sheet.style.removeProperty(p);
    if (edge) sheet.style.setProperty('--edge', '4.5%');
    small.classList.toggle('mc-small--short', short);
    let h = parseFloat(getComputedStyle(svg).height);
    while (clash() && h > minBar) {
      h = Math.max(minBar, h - 1);
      sheet.style.setProperty('--bar-h', `${h}px`);
    }
    let mid = 0;
    const room = since.offsetTop - bottom(nameF) - gap;
    while (clash() && -mid < room) {
      mid = Math.max(-room, mid - 1);
      sheet.style.setProperty('--mid', `${mid}px`);
    }
  };
  run();
  if (clash() || lines() > 3) {
    short = true;
    run();
  }
  if (clash()) {
    edge = true;
    run();
  }
  if (clash()) {
    minBar = 22;
    run();
  }
}
