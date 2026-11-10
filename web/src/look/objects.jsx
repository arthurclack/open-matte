import { Fragment, useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { drawGloss, drawGrain, drawTone, drawWear } from './paperCanvas.js';
import { KINDS, embossStrip, gunWheels, handWords, hash, objectWear, rubDown, stickerShift, typedStrikes } from './wear.js';
import { hostName, pickSize } from './words.js';
import './objects.css';

// The flat real objects of the video shop: the poster printed as a sleeve, a plain
// kraft sleeve with a typed label, the staff-pick card, black label-maker tape, the
// orange price-gun sticker, and the shop's name in its own printing. Nothing is drawn
// in 3D: each is a flat sheet with a cut edge, a slight lean, the grain of its stock
// and ink that isn't quite even, all seeded so it's the same every time. See README.md.
//
// Under the Content-Security-Policy: no data: or blob: images, so the grain is drawn
// on <canvas> elements (paperCanvas.js) and the ink's edges are SVG filters in the
// page (<InkFilters>, which the shell renders once).

// ------------------------------------------------------------ ink filters

// WebKit (Safari, and every browser on an iPhone or iPad) draws SVG filters at one
// pixel to a CSS pixel whatever the screen, which blurs type on a 2x or 3x screen:
// there the ink's edges are left plain, as the membership card does.
const WEBKIT = typeof navigator !== 'undefined' && /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Android/.test(navigator.userAgent);
const plainInk = () => WEBKIT && (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1) > 1;

// The custom properties that give an object's lettering its ink: printed (--kp), typed
// (--kt), the pen (--kh) and the gun (--kg). One of three variants, by seed.
export function inkVars(variant) {
  if (plainInk()) return {};
  return { '--kp': `url(#look-kp-${variant})`, '--kt': `url(#look-kt-${variant})`, '--kh': `url(#look-kh-${variant})`, '--kg': `url(#look-kg-${variant})` };
}

// The ink's edges, as SVG filters in the page: printing spreads a hair and follows
// the paper's fibres; the typewriter's ribbon leaves soft, fibrous edges; the felt-tip
// wobbles and its density changes along the line; the price gun's inked roller is
// blobbier. Rendered once, by the shell (site.jsx, admin/AdminApp.jsx).
export function InkFilters() {
  const variants = [0, 1, 2];
  return (
    <svg className="look-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {variants.map((V) => (
          <g key={V}>
            <filter id={`look-kp-${V}`} x="-4%" y="-12%" width="108%" height="124%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves="2" seed={11 + V} result="n" />
              <feDisplacementMap in="SourceGraphic" in2="n" scale="0.8" xChannelSelector="R" yChannelSelector="G" result="d" />
              <feGaussianBlur in="d" stdDeviation="0.34" result="b" />
              <feComponentTransfer in="b">
                <feFuncA type="linear" slope="1.5" intercept="-0.08" />
              </feComponentTransfer>
            </filter>
            <filter id={`look-kh-${V}`} x="-3%" y="-10%" width="106%" height="120%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed={31 + V} result="n" />
              <feDisplacementMap in="SourceGraphic" in2="n" scale="1.05" xChannelSelector="R" yChannelSelector="G" result="d" />
              <feGaussianBlur in="d" stdDeviation="0.3" result="b" />
              <feComponentTransfer in="b" result="s">
                <feFuncA type="linear" slope="1.7" intercept="-0.12" />
              </feComponentTransfer>
              <feTurbulence type="fractalNoise" baseFrequency="0.03 0.08" numOctaves="2" seed={51 + V} result="m" />
              <feColorMatrix in="m" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.28 0 0 0 1.12" result="ma" />
              <feComposite in="s" in2="ma" operator="in" />
            </filter>
            <filter id={`look-kt-${V}`} x="-3%" y="-15%" width="106%" height="130%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed={71 + V} result="n" />
              <feDisplacementMap in="SourceGraphic" in2="n" scale="0.75" xChannelSelector="R" yChannelSelector="G" result="d" />
              <feGaussianBlur in="d" stdDeviation="0.32" result="b" />
              <feComponentTransfer in="b">
                <feFuncA type="linear" slope="1.45" intercept="-0.06" />
              </feComponentTransfer>
            </filter>
            <filter id={`look-kg-${V}`} x="-4%" y="-15%" width="108%" height="130%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={91 + V} result="n" />
              <feDisplacementMap in="SourceGraphic" in2="n" scale="0.9" xChannelSelector="R" yChannelSelector="G" result="d" />
              <feGaussianBlur in="d" stdDeviation="0.5" result="b" />
              <feComponentTransfer in="b" result="s">
                <feFuncA type="linear" slope="1.9" intercept="-0.14" />
              </feComponentTransfer>
              <feTurbulence type="fractalNoise" baseFrequency="0.22 0.5" numOctaves="2" seed={95 + V} result="m" />
              <feColorMatrix in="m" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.45 0 0 0 1.16" result="ma" />
              <feComposite in="s" in2="ma" operator="in" />
            </filter>
          </g>
        ))}
        {/* The shop's logo printed in black ink (tokens.css --ink) from its own light
            parts: it is made for the dark header, as the membership card prints it. */}
        <filter id="look-logo" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="l" />
          <feComposite in="l" in2="SourceAlpha" operator="in" result="la" />
          <feFlood floodColor="#171513" />
          <feComposite in2="la" operator="in" />
        </filter>
      </defs>
    </svg>
  );
}

// ------------------------------------------------------------ lettering

// Typed on a typewriter: each strike lands a little harder or softer. Read as one
// piece of text; the strikes are hidden from screen readers.
export function Typed({ text, seed, min = 0.86 }) {
  const chars = useMemo(() => typedStrikes(String(text), seed, min), [text, seed, min]);
  return (
    <span className="typed">
      <span className="ob-sr">{text}</span>
      <span aria-hidden="true">
        {chars.map((c, i) => (c.o == null ? ' ' : <span key={i} className="tc" style={{ '--o': c.o, '--x': `${c.x}px`, '--y': `${c.y}px` }}>{c.ch}</span>))}
      </span>
    </span>
  );
}

// The price gun's wheels: every character the same narrow cell, each a little off.
export function Gun({ text, seed }) {
  const wheels = useMemo(() => gunWheels(text, seed), [text, seed]);
  return (
    <span className="gun">
      <span className="ob-sr">{text}</span>
      <span aria-hidden="true">
        {wheels.map((w, i) => (w.space ? <span key={i} className="gc gc--sp"> </span> : <span key={i} className="gc" style={{ '--y': `${w.y}px`, '--o': w.o, '--sx': w.sx }}>{w.ch}</span>))}
      </span>
    </span>
  );
}

// The one hand (Grape Nuts, the shopkeeper's felt-tip): words drift off the line and
// lean a little, as a pen does. Line breaks in the text are kept (a staff pick may
// have paragraphs).
export function Hand({ text, seed, className = '' }) {
  const lines = useMemo(() => String(text ?? '').split(/\r?\n/).map((line, n) => handWords(line, n ? `${seed}:${n}` : `${seed}`)), [text, seed]);
  return (
    <span className={`hand${className ? ` ${className}` : ''}`}>
      {lines.map((words, n) => (
        <Fragment key={n}>
          {n > 0 && <br />}
          {words.map((w, i) => (w.y == null ? ' ' : <span key={i} className="hw" style={{ '--y': `${w.y}px`, '--r': `${w.r}deg`, '--s': w.s, '--o': w.o }}>{w.text}</span>))}
        </Fragment>
      ))}
    </span>
  );
}

// Rub-down transfer letters, set by hand one at a time (the shop's name). Seeded by
// the name, so it's set the same on every page and on the membership card.
export function Rub({ text }) {
  const words = useMemo(() => rubDown(String(text), `shop:${text}`), [text]);
  return (
    <>
      <span className="ob-sr">{text}</span>
      <span aria-hidden="true">
        {words.map((letters, w) => (
          <span key={w}>
            {w > 0 && ' '}
            <span className="nw">
              {letters.map((l, i) => (
                <span key={i} className="rub" style={{ '--y': `${l.y}px`, '--r': `${l.r}deg`, '--m': `${l.m}px` }}>
                  {l.ch}
                </span>
              ))}
            </span>
          </span>
        ))}
      </span>
    </>
  );
}

// ------------------------------------------------------------ paper

// What each stock is, for the ink that wears back to it.
const STOCKS = { sleeve: '#e6e0d2', kraft: '#b39b78', pick: '#f3ecdf', label: '#eee7d7', sticker: '#f26b21', tape: '#262320' };

// A flat printed thing: a sheet of `kind` (sleeve, kraft, pick, label, sticker,
// tape), cut and leaning as its seed says, with the stock's grain and tone, and ink
// that wears back to the stock in places. `stuck` is laid on the sheet after the
// grain (a label on a sleeve). `as` is the element (figure, div, span...).
export function Paper({ kind, seed, as: Tag = 'div', className = '', style, children, stuck, grain, tone = true, wear = true, clip, ...rest }) {
  const sheetRef = useRef(null);
  const grainRef = useRef(null);
  const toneRef = useRef(null);
  const wearRef = useRef(null);
  const glossRef = useRef(null);
  const w = useMemo(() => objectWear(`${seed}`, KINDS[kind] ?? {}), [seed, kind]);
  const draw = useCallback(() => {
    const sheet = sheetRef.current;
    const width = sheet?.offsetWidth;
    const height = sheet?.offsetHeight;
    if (!width || !height) return;
    drawGrain(grainRef.current, width, height, { gx: w.gx, gy: w.gy, kraft: kind === 'kraft' });
    if (tone) drawTone(toneRef.current, width, height, seed);
    if (wear) drawWear(wearRef.current, width, height, seed, STOCKS[kind]);
    if (kind === 'tape') drawGloss(glossRef.current, width, height, seed);
  }, [w, kind, seed, tone, wear]);
  useEffect(() => {
    draw();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(draw);
    ro.observe(sheetRef.current);
    return () => ro.disconnect();
  }, [draw]);
  const vars = { '--rot': `${w.rot}deg`, '--rx': w.rx, '--ry': w.ry, ...inkVars(w.filter), ...style };
  // Inside a line of text (as="span"), every part is a span too; otherwise divs, which
  // may hold paragraphs and quotations.
  const Part = Tag === 'span' ? 'span' : 'div';
  return (
    <Tag className={`ob ob--${kind}${className ? ` ${className}` : ''}`} style={vars} data-seed={seed} {...rest}>
      <Part className="ob__body">
        <Part className="ob__sheet" ref={sheetRef} style={{ clipPath: clip ?? w.clip }}>
          {tone && <canvas className="ob__tone" ref={toneRef} aria-hidden="true" />}
          <Part className="ob__ink">{children}</Part>
          {wear && <canvas className="ob__wear" ref={wearRef} aria-hidden="true" />}
          {kind === 'tape' && <canvas className="ob__gloss" ref={glossRef} aria-hidden="true" />}
          <canvas className="ob__grain" ref={grainRef} aria-hidden="true" style={grain == null ? undefined : { opacity: grain }} />
          {stuck}
        </Part>
      </Part>
    </Tag>
  );
}

// ------------------------------------------------------------ the pieces

// A typed label, stuck on: a sleeve's title, or a line of the shop's own.
export function TypedLabel({ text, seed, className = '' }) {
  return (
    <Paper kind="label" seed={`${seed}:label`} className={className}>
      <Typed text={text} seed={`${seed}:label`} />
    </Paper>
  );
}

// The film's sleeve: its poster printed on card, or, for a film with no artwork, a
// plain kraft sleeve with the title on a typed label, and the shop's logo printed at
// its foot when it has one (`logo`: site.logo; otherwise nothing is printed there, as
// the owner decided on 10 Nov 2026). `width` in px (the CSS can also set --w). Beside
// the title it's decoration (the default); `label` names it instead. `thumb`: a
// thumbnail beside the title in a list (the back office's 44px), where a kraft sleeve
// is blank, since a label that small can't be read.
export function Sleeve({ film, seed = film?.slug ?? film?.title, width, className = '', label, thumb = false, logo = null }) {
  const named = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  const style = width ? { '--w': `${width}px` } : undefined;
  if (film?.posterUrl) {
    return (
      <Paper kind="sleeve" seed={`sleeve:${seed}`} className={className} style={style} {...named}>
        <img src={film.posterUrl} alt="" width="600" height="900" />
      </Paper>
    );
  }
  if (thumb) return <Paper kind="kraft" seed={`sleeve:${seed}`} className={className} style={style} {...named} />;
  return (
    <Paper
      kind="kraft"
      seed={`sleeve:${seed}`}
      className={className}
      style={style}
      {...named}
      stuck={
        <div className="ob__stuck sl__label">
          <TypedLabel text={film?.title ?? ''} seed={`sleeve:${seed}`} />
        </div>
      }
    >
      {logo && (
        <span className="sl__logo">
          <img src={logo.url} alt="" width={logo.width} height={logo.height} />
        </span>
      )}
    </Paper>
  );
}

// The staff-pick card: the owner's recommendation in their hand, "Staff pick" printed
// at the top in the shop's face, and "Picked by Arthur" (the owner's name, or the
// shop's) under it. Only for a film with a recommendation: don't render it without.
// A long one is written smaller (pickSize), so the card never towers over the page.
export function PickCard({ text, site, seed }) {
  const by = hostName(site);
  const head = `pick${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const size = pickSize(text);
  return (
    <Paper kind="pick" seed={`pick:${seed}`} as="figure" className={size ? `pick--${size}` : ''} aria-labelledby={head}>
      <p className="pick__head pr" id={head}>
        Staff pick
      </p>
      <blockquote className="pick__text">
        <Hand text={text} seed={`pick:${seed}`} />
      </blockquote>
      <p className="pick__by">
        <span className="pick__byk pr">Picked by</span> <Hand text={by} seed={`pick:${seed}:by`} />
      </p>
    </Paper>
  );
}

// The orange price-gun sticker: ONLY for the next deadline (words.js nextDeadline and
// stickerText give the words). "Due back" printed on the label roll, the date on the
// gun's wheels. Read as one line: "Due back Sun 8 Nov".
export function Sticker({ label, value, seed, className = '' }) {
  const shift = useMemo(() => stickerShift(`sticker:${seed}`), [seed]);
  return (
    <Paper kind="sticker" seed={`sticker:${seed}`} as="span" className={className} style={{ '--sy': `${shift}px` }}>
      <span className="stk__k pr">{label}</span> <span className="stk__v">
        <Gun text={value} seed={`sticker:${seed}`} />
      </span>
    </Paper>
  );
}

// One strip of black embossed label tape. `tail`: the blank a label maker runs out
// after the last letter, which a sticker goes over.
export function TapeStrip({ text, seed, tail = false }) {
  const strip = useMemo(() => embossStrip(String(text), `tape:${seed}`), [text, seed]);
  return (
    <Paper kind="tape" seed={`tape:${seed}`} as="span" className={tail ? 'tail' : ''} clip={strip.clip} tone={false} wear={false}>
      <span className="ob-sr">{text}</span>
      <span className="emb-line pr" aria-hidden="true">
        {strip.letters.map((l, i) => (
          <span key={i} className="emb" style={{ '--o': l.o, '--y': `${l.y}px`, ...(l.sx === 1 ? {} : { '--sx': l.sx }) }}>
            {l.ch === ' ' ? ' ' : l.ch}
          </span>
        ))}
      </span>
    </Paper>
  );
}

// The title on the counter: one or two strips of label tape (wear.js tapeLines cuts
// them), with the sticker, if there is one, stuck across the last strip's tail.
// sticker: { label, value } from words.js stickerText, or null.
export function LabelTape({ lines, sticker, seed, className = '' }) {
  const strips = lines.filter(Boolean);
  const last = strips.length - 1;
  return (
    <span className={`etape${className ? ` ${className}` : ''}`}>
      {strips.slice(0, -1).map((t, i) => (
        <TapeStrip key={i} text={t} seed={`${seed}:${i}`} />
      ))}
      {last >= 0 && (
        <span className="etape__end">
          <TapeStrip text={strips[last]} seed={`${seed}:${last}`} tail={Boolean(sticker)} />
          {sticker && <Sticker label={sticker.label} value={sticker.value} seed={seed} />}
        </span>
      )}
      {last < 0 && sticker && <Sticker label={sticker.label} value={sticker.value} seed={seed} />}
    </span>
  );
}

// ------------------------------------------------------------ the shop's name

// The shop in a bar: its logo, with or without its name beside it, or its name in its
// own printing (rub-down letters, Fraunces). Also the admin's preview of the header,
// so the two can't differ. site: { cinemaName, logo, logoWithName }.
export function ShopName({ site }) {
  const name = site?.cinemaName || ' ';
  const logo = site?.logo;
  const variant = useMemo(() => hash(`shop:${name}`) % 3, [name]);
  if (logo) {
    return (
      <span className="ui-shopname">
        {/* Beside the name the logo is decoration; on its own it is the name. */}
        <img className="ui-shopname__logo" src={logo.url} width={logo.width} height={logo.height} alt={site.logoWithName ? '' : name} />
        {site.logoWithName && (
          <span className="ui-shopname__print" style={inkVars(variant)}>
            <Rub text={name} />
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="ui-shopname">
      <span className="ui-shopname__print" style={inkVars(variant)}>
        <Rub text={name} />
      </span>
    </span>
  );
}
