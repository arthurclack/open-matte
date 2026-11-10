import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatMonthYear } from './api.js';
import {
  CARD_STOCK,
  SMALL_PRINT,
  SMALL_PRINT_SHORT,
  cardEdge,
  codabarPx,
  codabarText,
  fitCodabar,
  groupNumber,
  hash,
  labelLean,
  penWords,
  printInk,
  register,
  rng,
  rubDown,
  strikes,
} from './membershipCard.js';
import { prefersReducedMotion } from './motion.js';
import './membershipCard.css';

// The membership card: a printed card, front and back, that turns over. The front is
// all shop: its logo if it has one, its name, and "Membership card" knocked out of a
// solid band of its ink. The back is the member's: their name in ballpoint, the month
// they became a member typed, the membership number on a stuck-on barcode label, and
// one line of small print. Printed in the shop's accent colour, darkened until it
// reads on the card (printInk); a shop on Open Matte's own accent prints in blue.
//
// Under the page's Content-Security-Policy: no data: or blob: addresses, so the
// paper's grain is drawn on <canvas> elements in the card rather than as a background
// image, and the ink's edges are SVG filters in the page. The fonts come from this
// site (membershipCard.css).
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
  // The side lying still face up has no transform at all, so its text is drawn flat.
  const angle = side === 'front' ? 0 : 180;
  const faceStyle = (which) => {
    const deg = which === 'front' ? angle : angle - 180;
    return { transform: !turning && which === side ? 'none' : `rotateY(${deg}deg)` };
  };

  // ---------------------------------------------------------------- fitting
  // Again whenever the card's width or the screen's pixel ratio changes, and once the
  // fonts have come.
  const [width, setWidth] = useState(0);
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  const [faces, setFaces] = useState(0);
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
    fitShopName(frontRef.current);
    fitName(nameRef.current);
    const box = svgRef.current?.parentElement;
    if (!box) return;
    const cs = getComputedStyle(box);
    const available = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const pick = available > 0 ? fitCodabar(code, available, dpr) : null;
    setSnap(pick && { ...pick, dpr });
  }, [width, dpr, faces, code, shop, name]);
  useLayoutEffect(() => {
    fitBack(backRef.current);
  }, [snap, width, faces, shop, name]);
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

  const soft = WEBKIT && dpr > 1;
  const rootStyle = {
    '--mc-ink': ink,
    '--mc-kp': `url(#${uid}-kp)`,
    '--mc-kpt': soft ? 'none' : `url(#${uid}-kp)`,
    '--mc-kb': soft ? 'none' : `url(#${uid}-kb)`,
    '--mc-kt': soft ? 'none' : `url(#${uid}-kt)`,
  };

  return (
    <div className={`mc${turning ? ' is-turning' : ''}`} ref={rootRef} style={rootStyle} data-side={side}>
      <Filters uid={uid} seed={seed} ink={ink} />
      <div className="mc-stage" id={`${uid}-stage`}>
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
            since={formatMonthYear(membership.since)}
            sinceSaid={formatMonthYear(membership.since, { long: true })}
            waiting={pen === 'wait'}
            number={number}
            code={code}
            snap={snap}
            seed={`${seed}:back`}
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
  const wearRef = useRef(null);
  useEffect(() => {
    const c = wearRef.current;
    if (!c) return undefined;
    const draw = () => drawWear(c, seed);
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [seed]);
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
    <Paper sheetRef={sheetRef} seed={seed} className="mc-card mc-card--front" role="img" aria-label={`${shop} membership card, front`}>
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
      <div className="mc-band mc-plate2">
        <span className="mc-band-ink" aria-hidden="true" />
        <canvas className="mc-band-wear" ref={wearRef} aria-hidden="true" />
        <p className="mc-kind mc-pr">Membership card</p>
      </div>
    </Paper>
  );
}

function Back({ sheetRef, nameRef, barRef, svgRef, shop, name, since, sinceSaid, waiting, number, code, snap, seed }) {
  const words = useMemo(() => penWords(name, `${seed}:name`), [name, seed]);
  const typed = useMemo(() => strikes(since, `${seed}:since`), [since, seed]);
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
      className="mc-card mc-card--back"
      role="group"
      aria-label={`${shop} membership card, back`}
      stuck={
        // The label repeats the number for a scanner; a screen reader has heard it beside its label.
        <div className="mc-bar" aria-hidden="true" ref={barRef}>
          {/* A 1-pixel bar turned by a degree would smear across two pixels: on a screen with big pixels the label lies square. */}
          <Paper seed={`${seed}:bar`} className="mc-label" radius={1.2} grain={0.62} tone={false} style={{ '--mc-rot': `${snap?.n === 1 ? 0 : lean}deg` }}>
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
              <span className="mc-digits mc-typed">
                <Strikes chars={digits} />
              </span>
            </div>
          </Paper>
        </div>
      }
    >
      <p className={`mc-field mc-name${waiting ? ' is-waiting' : ''}`} ref={nameRef}>
        <span className="mc-k mc-plate2 mc-pr">Name</span>
        {/* dir="auto": a name in Arabic or Hebrew runs right to left, its words in its own order. */}
        <span className="mc-v" dir="auto">
          {words.map((w, i) =>
            w.y === undefined ? (
              ' '
            ) : (
              <span key={i} className="mc-hw" style={{ '--y': `${w.y}px`, '--r': `${w.r}deg`, '--s': w.s, '--o': w.o }}>
                {w.text}
              </span>
            ),
          )}
        </span>
      </p>
      <p className="mc-field mc-since">
        <span className="mc-k mc-plate2 mc-pr">Member since</span>
        <span className="mc-v mc-typed">
          <span className="visually-hidden">{sinceSaid}</span>
          <span aria-hidden="true">
            <Strikes chars={typed} />
          </span>
        </span>
      </p>
      <p className="mc-k mc-numk mc-plate2 mc-pr">
        Membership number<span className="visually-hidden"> {groupNumber(number)}</span>
      </p>
      {/* fitBack shows the short one when a long shop name won't fit. */}
      <p className="mc-small mc-pr">
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
// a touch off register, a cloudy tone under the ink and a fine grain over it, both
// drawn on canvases at its laid-out size.
function Paper({ sheetRef, seed, className, radius = 12, grain = 0.85, tone = true, style, stuck, children, ...attrs }) {
  const own = useRef(null);
  const ref = sheetRef || own;
  const toneRef = useRef(null);
  const grainRef = useRef(null);
  const edge = useMemo(() => cardEdge(seed, radius), [seed, radius]);
  const reg = useMemo(() => register(seed), [seed]);
  const draw = useCallback(() => {
    const sheet = ref.current;
    const w = sheet?.offsetWidth;
    const h = sheet?.offsetHeight;
    if (!w || !h) return;
    drawGrain(grainRef.current, w, h, reg);
    if (tone) drawTone(toneRef.current, w, h, seed);
  }, [ref, reg, seed, tone]);
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
        <div className="mc-ink">{children}</div>
        <canvas className="mc-grain" ref={grainRef} aria-hidden="true" style={{ opacity: grain }} />
        {stuck}
      </div>
    </div>
  );
}

// Value noise that wraps, so a tile never shows a seam.
function periodicNoise(R, size, cells) {
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

// The grain of card stock, once for every card: 256 pixels that tile, shown at half
// size, so a fibre is half a CSS pixel on any screen.
let grainTile = null;
function grainCanvas() {
  if (grainTile) return grainTile;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(S, S);
  const d = img.data;
  const R = rng('grain:paper');
  const mottle = periodicNoise(R, S, 8);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const v = (R() + R() + R()) / 3 - 0.5 + (mottle(x, y) - 0.5) * 0.17;
      const a = Math.min(1, Math.abs(v) * 2);
      if (v < 0) [d[i], d[i + 1], d[i + 2], d[i + 3]] = [64, 52, 40, a * a * 52];
      else [d[i], d[i + 1], d[i + 2], d[i + 3]] = [255, 252, 244, a * a * 60];
    }
  }
  g.putImageData(img, 0, 0);
  // A few fibres, wrapped at the tile's edges.
  for (let k = 0; k < 46; k++) {
    const x = R() * S;
    const y = R() * S;
    const len = R.range(3, 12);
    const ang = R() * Math.PI;
    const bend = R.range(-0.4, 0.4);
    const dark = R() < 0.45;
    g.strokeStyle = dark ? `rgba(70,58,44,${R.range(0.05, 0.1).toFixed(2)})` : `rgba(255,250,238,${R.range(0.06, 0.16).toFixed(2)})`;
    g.lineWidth = R.range(0.5, 0.9);
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.quadraticCurveTo(x + ox + Math.cos(ang + bend) * len * 0.5, y + oy + Math.sin(ang + bend) * len * 0.5, x + ox + Math.cos(ang) * len, y + oy + Math.sin(ang) * len);
        g.stroke();
      }
    }
  }
  grainTile = c;
  return c;
}

function drawGrain(canvas, w, h, { gx, gy }) {
  const tile = grainCanvas();
  const g = canvas?.getContext('2d');
  if (!tile || !g) return;
  canvas.width = Math.round(w * 2);
  canvas.height = Math.round(h * 2);
  const pattern = g.createPattern(tile, 'repeat');
  g.save();
  g.translate(-gx * 2, -gy * 2);
  g.fillStyle = pattern;
  g.fillRect(0, 0, canvas.width + gx * 2, canvas.height + gy * 2);
  g.restore();
}

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

// Solid print is never quite solid: the ink lies a little thinner in places, and here
// and there it missed the card altogether, leaving a pin-hole of bare card. Drawn in
// the card's own colour over the band's ink, one canvas pixel to a CSS pixel, seeded so
// a card is the same every time. Never more than 8% thinner outside the pin-holes: the
// ink rule (printInk) judges the band at 88%.
const STOCK_RGB = [1, 3, 5].map((i) => Number.parseInt(CARD_STOCK.slice(i, i + 2), 16));
function drawWear(canvas, seed) {
  const g = canvas?.getContext('2d');
  const W = Math.round(canvas?.offsetWidth || 0);
  const H = Math.round(canvas?.offsetHeight || 0);
  if (!g || !W || !H) return;
  canvas.width = W;
  canvas.height = H;
  const img = g.createImageData(W, H);
  const d = img.data;
  const R = rng(`${seed}:wear`);
  const n1 = periodicNoise(R, 400, 6);
  const n2 = periodicNoise(R, 400, 23);
  const [r, gr, b] = STOCK_RGB;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let a = (n1(x, y) * 0.7 + n2(x, y) * 0.3) * 0.08;
      if (R() < 0.004) a = R.range(0.5, 0.85);
      [d[i], d[i + 1], d[i + 2], d[i + 3]] = [r, gr, b, Math.round(a * 255)];
    }
  }
  g.putImageData(img, 0, 0);
}

// ------------------------------------------------------------ ink

// The ink's edges, as SVG filters in the page (a filter can't come from a data:
// address): printing spreads a hair and follows the card's fibres; the counter
// ballpoint wobbles, its pressure changes slowly along the name (never under 85%),
// and ink pools where the pen slowed; the typewriter's ribbon leaves soft, fibrous
// edges. And the logo, printed in the ink from its own light parts: it was made for
// the app's dark header.
function Filters({ uid, seed, ink }) {
  const V = hash(seed) % 3;
  return (
    <svg className="mc-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id={`${uid}-kp`} x="-4%" y="-12%" width="108%" height="124%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves="2" seed={11 + V} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="0.8" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation="0.34" result="b" />
          <feComponentTransfer in="b">
            <feFuncA type="linear" slope="1.5" intercept="-0.08" />
          </feComponentTransfer>
        </filter>
        <filter id={`${uid}-kb`} x="-3%" y="-12%" width="106%" height="124%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed={41 + V} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="0.95" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation="0.28" result="b" />
          <feComponentTransfer in="b" result="s">
            <feFuncA type="linear" slope="1.7" intercept="-0.12" />
          </feComponentTransfer>
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.05" numOctaves="1" seed={61 + V} result="m" />
          <feColorMatrix in="m" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.3 0 0 0 1.15" result="ma" />
          <feComposite in="s" in2="ma" operator="in" result="p" />
          <feMorphology in="d" operator="dilate" radius="0.5" result="fat" />
          <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="1" seed={81 + V} result="bn" />
          <feColorMatrix in="bn" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  9 0 0 0 -5.6" result="bm" />
          <feComposite in="fat" in2="bm" operator="in" result="pool" />
          <feMerge>
            <feMergeNode in="p" />
            <feMergeNode in="pool" />
          </feMerge>
        </filter>
        <filter id={`${uid}-kt`} x="-3%" y="-15%" width="106%" height="130%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed={71 + V} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="0.75" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation="0.32" result="b" />
          <feComponentTransfer in="b">
            <feFuncA type="linear" slope="1.45" intercept="-0.06" />
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
  const clear = () => !key || key.offsetTop - (topIn(t, key.offsetParent) + t.offsetHeight + 0.1 * size) >= 0.04 * sheet.clientWidth;
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
