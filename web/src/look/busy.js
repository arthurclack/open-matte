// A busy button (question 20, answer b): a button whose request is under way. It isn't
// `disabled`, which takes the focus away from a button that had it (Chromium drops it
// to the page), but `aria-disabled`: it keeps the focus, says it's unavailable, is drawn
// as a disabled one is (look/ui.css, objects.css, friend.css), and a press on it does
// nothing, not even send its form. While it is busy the page's one status region says
// so, as the app says news: a region there from the start, empty until there is news.
// Only the button that was pressed says so: buttons that wait on the same request (a
// question's Return it and Keep it) don't talk over it.
// A button that can't be used for some other reason (nothing to save, no password yet)
// is still `disabled`. BusyButton (look/ui.jsx) is the button; PlayTile, the Resume of
// ComingBack and the name menu's button use these helpers themselves.

// What the region says while a button is busy, when the button has no words of its own
// for it ("Taking it back…").
export const BUSY_WORDS = 'Just a moment…';

// The button's props for `busy` and `disabled`, and its press: ignored while busy.
export function busyProps({ busy = false, disabled = false, onClick } = {}) {
  const off = Boolean(disabled);
  return {
    disabled: off || undefined,
    'aria-disabled': busy && !off ? 'true' : undefined,
    onClick(e) {
      if (busy) {
        // A submit button's press would still send its form.
        e?.preventDefault?.();
        return undefined;
      }
      return onClick?.(e);
    },
  };
}

export const BUSY_REGION_ID = 'om-busy';

// The page's one region for it: made the first time a busy button is drawn, long before
// it is pressed, so a screen reader hears what is put in it later.
export function busyRegion(doc = globalThis.document) {
  if (!doc?.body) return null;
  let el = doc.getElementById(BUSY_REGION_ID);
  if (!el) {
    el = doc.createElement('div');
    el.id = BUSY_REGION_ID;
    el.className = 'visually-hidden';
    el.setAttribute('role', 'status');
    doc.body.append(el);
  }
  return el;
}

// The busy button pressed last, by a token of its own (any object): the one whose busy
// is said, when several wait on one request.
let lastPressed = null;
export function notePress(token) {
  lastPressed = token;
}
export const pressedLast = (token) => token != null && lastPressed === token;

// Says a button is busy, and stops saying it once it isn't: only what this button said,
// so another button's news is left alone.
export function sayBusy(words = BUSY_WORDS, doc = globalThis.document) {
  const el = busyRegion(doc);
  if (!el) return () => {};
  const text = words || BUSY_WORDS;
  el.textContent = text;
  return () => {
    if (el.textContent === text) el.textContent = '';
  };
}
