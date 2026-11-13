import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { scrollBehavior } from '../motion.js';
import { BUSY_WORDS, busyProps, busyRegion, notePress, pressedLast, sayBusy } from './busy.js';

// The interface layer's few pieces with behaviour or markup worth sharing (ui.css has
// the rest as classes): a system line, the pull-down menu, a scrolling row of tabs and
// the stepped triangle. See README.md.

// A button whose request is under way (`busy`): it keeps the focus and is drawn as a
// disabled one, a press on it does nothing, and the page's status region says so, in
// `busyText` (its own words for it, "Taking it back…") or "Just a moment…". `disabled`
// is for a button that can't be used for some other reason (nothing to save yet). Every
// other prop is the button's own: `type` included, so one in a form still submits it.
// A button that becomes `disabled` while it has the focus (Save, once there is nothing
// left to save) keeps it the same way until the focus moves on. See busy.js.
export function BusyButton({ busy = false, busyText, disabled = false, onClick, onFocus, onBlur, children, ...rest }) {
  const [focused, setFocused] = useState(false);
  const kept = Boolean(disabled) && focused;
  const pressed = useBusyNews(busy && !disabled, busyText);
  return (
    <button
      {...rest}
      {...busyProps({ busy: busy || kept, disabled: disabled && !kept, onClick: pressed(onClick) })}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
    >
      {children}
    </button>
  );
}

// The status region's part for a busy button, BusyButton's and others' (PlayTile, the
// telly's Resume, the name menu, the logo's upload): the region is made when the button
// is first drawn, and while `busy` it says `words`, if this was the busy button pressed
// last. Returns what wraps the button's press so that it counts as pressed.
export function useBusyNews(busy, words = BUSY_WORDS) {
  const token = useRef({});
  useEffect(() => {
    busyRegion();
  }, []);
  useEffect(() => (busy && pressedLast(token.current) ? sayBusy(words) : undefined), [busy, words]);
  return useCallback(
    (onPress) => (e) => {
      notePress(token.current);
      return onPress?.(e);
    },
    [],
  );
}

// The pull-down's mark: a stepped triangle, drawn in whole pixels.
export function Tri() {
  return (
    <svg className="ui-tri" viewBox="0 0 10 6" aria-hidden="true" focusable="false">
      <path d="M0 0h10v2H8v2H6v2H4V4H2V2H0z" />
    </svg>
  );
}

// A system line: a small block first, then plain words. kind: 'done' (a solid block),
// 'info' (an open box), 'warn' (amber) or 'bad' (warm red). A warning or an error
// starts with a word in bold (`lead`: "Not sent."), so the colour is never the only
// sign. `block` rules it above and below, for a line that needs more room. `role`:
// 'alert' for an error that has just happened, 'status' for news.
export function Line({ kind = 'info', lead, block = false, wide = false, role, className = '', children }) {
  const cls = ['ui-line', `ui-line--${kind}`, block && 'ui-line--block', wide && 'ui-line--wide', className].filter(Boolean).join(' ');
  return (
    <div className={cls} role={role}>
      <div>
        {lead && <b>{lead} </b>}
        {children}
      </div>
    </div>
  );
}

// The pull-down menu: a button, lit while open, and its list. Enter, Space or a click
// opens it with the focus still on the button, and Tab goes on into its items, as the
// name menu always has; the arrow keys open it on its first or last item and move
// through it, Home and End go to its ends. Escape closes it and gives the focus back to
// the button; the focus leaving it, or a press anywhere else, closes it. `label` is the
// button's words (a name may need an ellipsis); `items` are menu items: elements with
// className "ui-menu__item" and role="menuitem" (a Link, an <a> or a <button>), or
// <MenuSep />. Choosing one closes the menu and gives the focus back to the button.
// `busy`: what a choice in it started is under way (signing out): the button keeps the
// focus and doesn't open, as a BusyButton.
export function Menu({ label, items, disabled = false, busy = false, buttonClass = 'ui-item', after }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const id = `menu${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const focusItem = useRef(null);
  const pressed = useBusyNews(busy && !disabled);

  // Only the items drawn now: one shown only at some widths (.ui-wide, .ui-narrow) is
  // still in the list when it's hidden, and the arrows would stop on it.
  const entries = () => [...(listRef.current?.querySelectorAll('[role="menuitem"]') ?? [])].filter((el) => el.getClientRects().length > 0);
  useLayoutEffect(() => {
    if (!open || focusItem.current == null) return;
    const all = entries();
    all[focusItem.current === 'last' ? all.length - 1 : 0]?.focus();
    focusItem.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    // A press elsewhere, or the focus leaving the menu, closes it.
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    // Escape closes it from anywhere, the button included.
    const escape = (e) => {
      if (e.key !== 'Escape') return;
      if (ref.current?.contains(document.activeElement)) buttonRef.current?.focus();
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('focusin', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('focusin', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const onButtonKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    focusItem.current = e.key === 'ArrowDown' ? 'first' : 'last';
    if (open) {
      const all = entries();
      (e.key === 'ArrowDown' ? all[0] : all.at(-1))?.focus();
      focusItem.current = null;
    } else setOpen(true);
  };
  const onListKey = (e) => {
    const all = entries();
    const i = all.indexOf(document.activeElement);
    const go = (n) => {
      e.preventDefault();
      all[(n + all.length) % all.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(all.length - 1);
  };

  return (
    <div className="ui-menu" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className={`${buttonClass} ui-menu__btn`}
        id={`${id}-btn`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        {...busyProps({ busy, disabled, onClick: () => setOpen(!open) })}
        onKeyDown={(e) => !busy && onButtonKey(e)}
      >
        {label}
      </button>
      {open && (
        <div
          className="ui-menu__list"
          role="menu"
          id={`${id}-list`}
          aria-labelledby={`${id}-btn`}
          ref={listRef}
          onKeyDown={onListKey}
          onClick={pressed((e) => {
            if (!e.target.closest('[role="menuitem"]')) return;
            // The focus goes back to the menu's button, as Escape gives it back: the item
            // that had it goes with the list, and a busy button keeps it (Sign out).
            buttonRef.current?.focus();
            setOpen(false);
          })}
        >
          {items}
        </div>
      )}
      {after}
    </div>
  );
}

export function MenuSep() {
  return <div className="ui-menu__sep" role="separator" />;
}

// One row of tabs (ui.css .ui-tabs): on a phone it scrolls sideways, the current tab
// (aria-current or aria-selected) is scrolled into view within its row, never by
// moving the page, and so is any tab the keyboard reaches. Each end fades over as much
// of the row as is hidden past it. `watch`: what to follow (the address). `role` and
// `label` go on the row itself: role="tablist" with a label for tabs that switch panels
// in the page (links to other pages need neither).
// children: the tabs, each an element with className "ui-tab".
export function TabRow({ className = '', watch, role, label, children }) {
  const ref = useRef(null);
  const rowRef = useRef(null);
  const opened = useRef(false);

  const reveal = (tab, behavior) => {
    const row = rowRef.current;
    if (!row || !tab || row.scrollWidth <= row.clientWidth + 1) return;
    const cs = getComputedStyle(row);
    const pad = parseFloat(cs.scrollPaddingInlineStart) || 0;
    const padEnd = parseFloat(cs.scrollPaddingInlineEnd) || 0;
    const a = tab.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
    const b = a + tab.offsetWidth;
    let to = null;
    if (a - pad < row.scrollLeft) to = a - pad;
    else if (b + padEnd > row.scrollLeft + row.clientWidth) to = b + padEnd - row.clientWidth;
    if (to != null) row.scrollTo({ left: to, behavior });
  };

  // When the row first shows and whenever `watch` (the address) changes: at once the
  // first time, smoothly after that unless less motion is asked for.
  useLayoutEffect(() => {
    reveal(rowRef.current?.querySelector('[aria-current]:not([aria-current="false"]), [aria-selected="true"]'), opened.current ? scrollBehavior() : 'auto');
    opened.current = true;
  }, [watch]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const box = ref.current;
    const fade = () => {
      const max = row.scrollWidth - row.clientWidth;
      if (max <= 1) {
        box.removeAttribute('data-more');
        return;
      }
      box.setAttribute('data-more', '');
      box.style.setProperty('--more-before', `${Math.max(0, row.scrollLeft)}px`);
      box.style.setProperty('--more-after', `${Math.max(0, max - row.scrollLeft)}px`);
    };
    fade();
    row.addEventListener('scroll', fade, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fade);
    ro?.observe(row);
    return () => {
      row.removeEventListener('scroll', fade);
      ro?.disconnect();
    };
  }, []);

  return (
    <div className={`ui-tabs${className ? ` ${className}` : ''}`} ref={ref}>
      <div className="ui-tabs__row" ref={rowRef} role={role} aria-label={label} onFocus={(e) => reveal(e.target.closest('.ui-tab'), scrollBehavior())}>
        {children}
      </div>
    </div>
  );
}
