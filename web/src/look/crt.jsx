import { useEffect, useId, useRef } from 'react';
import { prefersReducedMotion } from '../motion.js';
import './objects.css';

// The shop's video machine: the only blue on the page, and only ever the machine's
// own screen. A flat blue (#2030c8) with what a tube does to it, kept subtle: static
// scanlines in whole device pixels, a soft bloom on the letters, darker edges. VT323
// at 20px and up, ligatures off. Nothing on it flickers or moves, and it is NEVER
// over the film's picture: while the film plays, the player is plain and the
// browser's own controls are as they were. See README.md.

// The pixel marks the machine draws: ▶ and ❚❚, in whole pixels.
export function PxPlay() {
  return (
    <svg className="px" viewBox="0 0 4 7" aria-hidden="true" focusable="false">
      <path d="M0 0h1v7H0zM1 1h1v5H1zM2 2h1v3H2zM3 3h1v1H3z" />
    </svg>
  );
}
export function PxPause() {
  return (
    <svg className="px" viewBox="0 0 6 7" aria-hidden="true" focusable="false">
      <path d="M0 0h2v7H0zM4 0h2v7H4z" />
    </svg>
  );
}

// A piece of the blue screen. `as` is its element; className adds to it.
export function CrtScreen({ as: Tag = 'div', className = '', children, ...rest }) {
  const Inner = Tag === 'button' || Tag === 'span' ? 'span' : 'div';
  return (
    <Tag className={`crt${className ? ` ${className}` : ''}`} {...rest}>
      <Inner className="crt__screen">{children}</Inner>
    </Tag>
  );
}

// The Play tile: a piece of the screen it turns into, PLAY lit and the tape counter
// (0:00:00) beside it. A real button. `label` names it for a screen reader when the
// words on it aren't enough ("Resume at 0:18"); `mode` is what it shows lit.
export function PlayTile({ onClick, disabled = false, counter = '0:00:00', label = 'Play', mode = 'PLAY', className = '' }) {
  return (
    <CrtScreen as="button" type="button" className={`crt-play${className ? ` ${className}` : ''}`} onClick={onClick} disabled={disabled} aria-label={label}>
      <span className="crt-play__in" aria-hidden="true">
        <span className="crt-play__mode osd-inv">
          {mode}
          <PxPlay />
        </span>
        <span className="crt-play__ctr">{counter}</span>
      </span>
    </CrtScreen>
  );
}

// The short PLAY screen when playback starts: PLAY and the counter for about 800 ms,
// then onDone, which shows the film. Under reduced motion it is skipped: onDone at once
// and nothing drawn. Never over the picture: it takes the picture's place first.
export const PLAY_SCREEN_MS = 800;
export function PlayScreen({ counter = '0:00:00', onDone, hold = PLAY_SCREEN_MS }) {
  const done = useRef(onDone);
  done.current = onDone;
  const skip = prefersReducedMotion();
  useEffect(() => {
    const t = setTimeout(() => done.current?.(), skip ? 0 : hold);
    return () => clearTimeout(t);
  }, [hold, skip]);
  if (skip) return null;
  return (
    <CrtScreen className="crt--picture crt-playscreen">
      <div className="osd osd--play" role="status">
        <p className="osd__mode">
          PLAY
          <PxPlay />
        </p>
        <p className="osd__counter">{counter}</p>
      </div>
    </CrtScreen>
  );
}

// The paused strip UNDER the picture: PAUSE, the lit way back in ("Resume at 0:18"),
// how long is left to come back, and (children) the VCR menu of audio, subtitles and
// picture. `left` is the words for the time ("47 h 12 min"); `aside` replaces the
// whole right-hand line if given.
export function OsdStrip({ at, onResume, left, aside, children, resumeLabel }) {
  return (
    <CrtScreen className="crt--strip">
      <div className="osd osd--pause">
        <div className="osd__state">
          <p className="osd__mode">
            PAUSE
            <PxPause />
          </p>
          {onResume && (
            <button type="button" className="osd__btn osd-inv" onClick={onResume} aria-label={resumeLabel}>
              {at ? `Resume at ${at}` : 'Resume'}
              <PxPlay />
            </button>
          )}
        </div>
        {children && <div className="osd__menu">{children}</div>}
        {(aside || left) && <p className="osd__left">{aside ?? `${left} to come back`}</p>}
      </div>
    </CrtScreen>
  );
}

// The machine's menu, as a VCR draws it: a vertical list, each item then its values.
// Each row is a real radio group: one tab stop (the chosen value), the arrow keys move
// along it and choose, Home and End go to its ends.
// rows: [{ id, label, value, options: [{ value, label }], onChange(value) }]
export function VcrMenu({ title, rows }) {
  const uid = `vcr${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <div className="osd-menu">
      {title && <p className="osd__title">{title}</p>}
      {rows.map((row, r) => (
        <VcrRow key={row.id ?? r} row={row} id={`${uid}-${r}`} />
      ))}
    </div>
  );
}

function VcrRow({ row, id }) {
  const ref = useRef(null);
  const choose = (value, focus) => {
    if (value !== row.value) row.onChange?.(value);
    if (focus) {
      const i = row.options.findIndex((o) => o.value === value);
      ref.current?.querySelectorAll('[role="radio"]')[i]?.focus();
    }
  };
  const onKeyDown = (e) => {
    const n = row.options.length;
    const i = row.options.findIndex((o) => o.value === row.value);
    let to = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = i < 0 ? n - 1 : (i - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    if (to == null) return;
    e.preventDefault();
    choose(row.options[to].value, true);
  };
  return (
    <div className="osd__row">
      <span className="osd__k" id={id}>
        {row.label}
      </span>
      <span className="osd__opts" role="radiogroup" aria-labelledby={id} ref={ref} onKeyDown={onKeyDown}>
        {row.options.map((o, n) => {
          const on = o.value === row.value;
          // The one tab stop: the chosen option, or the first when none is (audio the
          // browser has no track turned on for, say).
          const stop = on || (n === 0 && !row.options.some((x) => x.value === row.value));
          return (
            <button key={o.value} type="button" className="osd__opt" role="radio" aria-checked={on} tabIndex={stop ? 0 : -1} onClick={() => choose(o.value, false)}>
              {o.label}
            </button>
          );
        })}
      </span>
    </div>
  );
}

// Coming back to a paused tape: the telly at the counter, PAUSE and where it stopped,
// and the lit way back in.
export function ComingBack({ counter, at, onResume, resumeLabel }) {
  return (
    <div className="crt-telly">
      <CrtScreen className="crt--tube">
        <div className="osd crt-telly__in">
          <div className="crt-telly__top">
            <p className="osd__mode">
              PAUSE
              <PxPause />
            </p>
            <span className="crt-telly__ctr">{counter}</span>
          </div>
          <div className="crt-telly__bottom">
            <button type="button" className="osd__btn osd-inv" onClick={onResume} aria-label={resumeLabel}>
              {at ? `Resume at ${at}` : 'Resume'}
              <PxPlay />
            </button>
          </div>
        </div>
      </CrtScreen>
    </div>
  );
}

// The tape counter's words ("0:18:04") are words.js tapeCounter.
export { tapeCounter } from './words.js';
