import { useLayoutEffect, useRef, useState } from 'react';
import { LabelTape, TapeStrip } from '../look/objects.jsx';
import { eNumber, tapeLines } from '../look/wear.js';
import { forOnly } from '../look/words.js';
import { tapeStrips } from './tapeWords.js';

// The friend's pages' own pieces, shared between them: the title on black label tape,
// cut for the width it gets, and the plain page for a short message.

// One wheel of the label maker (objects.css .emb: 0.68em of 18px), and what a strip
// adds round its letters (its padding and cut ends).
const CELL = 0.68 * 18;
const STRIP = 20;

// How many wheels fit the box `ref` is: on every strip, and on the last, beside the
// sticker stuck across its tail (measured once it's drawn: the date and its time vary).
function useCells(ref, redo) {
  const [fit, setFit] = useState({ cells: 18, lastCells: 18 });
  const measure = useRef(null);
  measure.current = () => {
    const box = ref.current;
    const width = box?.clientWidth;
    if (!width) return;
    const sticker = box.querySelector('.ob--sticker')?.getBoundingClientRect().width ?? 0;
    const cells = Math.max(4, Math.floor((width - STRIP) / CELL));
    const lastCells = Math.max(3, Math.floor((width - STRIP - 8 - sticker) / CELL));
    setFit((f) => (f.cells === cells && f.lastCells === lastCells ? f : { cells, lastCells }));
  };
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !ref.current) return undefined;
    const ro = new ResizeObserver(() => measure.current());
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  // Again whenever the sticker's words change, and once the faces have come.
  useLayoutEffect(() => {
    measure.current();
    let live = true;
    document.fonts?.ready.then(() => live && measure.current());
    return () => {
      live = false;
    };
  }, [redo]);
  return fit;
}

// The film's title on the counter: one or two strips of label tape (the E-number on its
// own when the sleeve is plain kraft, whose typed label has the title), the sticker for
// the next deadline across the last one's tail, and for a tape on someone's card, their
// name on a strip of its own ("For Sam only"). `sticker`: words.js stickerText, or null.
export function TitleTape({ film, sticker, forName, className = '' }) {
  const ref = useRef(null);
  const { cells, lastCells } = useCells(ref, sticker ? `${sticker.label} ${sticker.value}` : '');
  const lines = tapeLines({ title: film.title, poster: Boolean(film.posterUrl), e: eNumber(film.runtimeMinutes) }, { cells, lastCells: sticker ? lastCells : cells });
  const seed = `tape:${film.slug}`;
  return (
    <div className={`fl-tapeline${className ? ` ${className}` : ''}`} ref={ref}>
      <LabelTape lines={lines} sticker={sticker} seed={seed} />
      {forName && (
        <span className="etape fl-for">
          {tapeStrips(forOnly(forName), cells).map((line, i) => (
            <TapeStrip key={i} text={line} seed={`${seed}:for:${i}`} />
          ))}
        </span>
      )}
    </div>
  );
}

// A page with one thing to say: a heading, a few lines and a way on.
export function NarrowPage({ children, className = '' }) {
  return <div className={`fl-narrow ui-w${className ? ` ${className}` : ''}`}>{children}</div>;
}
