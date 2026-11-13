// Busy buttons (docs/version-2.md, question 20, answer b): a button whose request is
// under way keeps the focus. It is aria-disabled, never disabled (which drops the focus
// in Chromium), a press on it does nothing, not even send its form, and the page's one
// status region says it is busy. web/src/look/busy.js holds the rules, and BusyButton
// (look/ui.jsx) is the button; these are the parts without a browser, and a scan of
// every page for a button still disabled while its request runs. The browser's part
// (the focus kept through a slow request and an error, one request for a double
// press) is e2e/busy.spec.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { withoutComments } from './shown.js';

const WEB = new URL('../web/src/', import.meta.url);
const present = fs.existsSync(new URL('look/busy.js', WEB));
const skip = present ? false : 'web/src is not here (the server image has no web source)';
const busy = present ? await import(new URL('look/busy.js', WEB)) : {};

// A press, as React hands it to onClick.
const press = () => {
  const e = { prevented: false, preventDefault() {
    e.prevented = true;
  } };
  return e;
};

describe('a busy button', { skip }, () => {
  test('is aria-disabled, not disabled, and a press on it does nothing, not even send its form', () => {
    let pressed = 0;
    const p = busy.busyProps({ busy: true, onClick: () => pressed++ });
    assert.deepEqual([p.disabled, p['aria-disabled']], [undefined, 'true']);
    const e = press();
    assert.equal(p.onClick(e), undefined);
    assert.deepEqual([pressed, e.prevented], [0, true]);
  });

  test('when it isn’t busy, it is a plain button: its press is its own, and what it returns', () => {
    const e = press();
    const p = busy.busyProps({ onClick: (ev) => (ev === e ? 'pressed' : 'wrong press') });
    assert.deepEqual([p.disabled, p['aria-disabled']], [undefined, undefined]);
    assert.equal(p.onClick(e), 'pressed');
    assert.equal(e.prevented, false, 'a submit button still sends its form');
    assert.doesNotThrow(() => busy.busyProps().onClick(press()), 'with no press of its own');
  });

  test('one that can’t be used for another reason is disabled, busy or not, and only that', () => {
    for (const b of [false, true]) {
      const p = busy.busyProps({ busy: b, disabled: true, onClick: () => assert.fail('pressed') });
      assert.deepEqual([p.disabled, p['aria-disabled']], [true, undefined]);
    }
  });
});

// Just enough of a document for the status region: elements by id, made and added.
function fakeDocument() {
  const byId = new Map();
  const doc = {
    body: {
      children: [],
      append(el) {
        this.children.push(el);
        if (el.id) byId.set(el.id, el);
      },
    },
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tag) => ({ tag, id: '', className: '', textContent: '', attrs: {}, setAttribute(k, v) {
      this.attrs[k] = v;
    } }),
  };
  return doc;
}

describe('the page’s status region for busy buttons', { skip }, () => {
  test('is made once, hidden but heard, a status region as the app’s news is, and empty', () => {
    const doc = fakeDocument();
    const el = busy.busyRegion(doc);
    assert.deepEqual([el.tag, el.id, el.className, el.attrs.role, el.textContent], ['div', busy.BUSY_REGION_ID, 'visually-hidden', 'status', '']);
    assert.equal(busy.busyRegion(doc), el, 'the same one every time');
    assert.equal(doc.body.children.length, 1);
    assert.equal(busy.busyRegion({}), null, 'nowhere to put it: nothing');
  });

  test('says a button is busy in its own words, or in "Just a moment…", and stops when it isn’t', () => {
    const doc = fakeDocument();
    const stop = busy.sayBusy('Taking it back…', doc);
    assert.equal(busy.busyRegion(doc).textContent, 'Taking it back…');
    stop();
    assert.equal(busy.busyRegion(doc).textContent, '');
    busy.sayBusy(undefined, doc);
    assert.equal(busy.busyRegion(doc).textContent, 'Just a moment…');
    assert.equal(busy.BUSY_WORDS, 'Just a moment…');
  });

  test('is the pressed button’s to speak in: buttons waiting on the same request don’t talk over it', () => {
    const [returnIt, keepIt] = [{}, {}];
    assert.deepEqual([busy.pressedLast(returnIt), busy.pressedLast(keepIt)], [false, false]);
    busy.notePress(returnIt);
    assert.deepEqual([busy.pressedLast(returnIt), busy.pressedLast(keepIt)], [true, false]);
    busy.notePress(keepIt);
    assert.deepEqual([busy.pressedLast(returnIt), busy.pressedLast(keepIt)], [false, true]);
    assert.equal(busy.pressedLast(null), false);
  });

  test('leaves another button’s news alone', () => {
    const doc = fakeDocument();
    const first = busy.sayBusy('Saving…', doc);
    busy.sayBusy('Signing out…', doc);
    first();
    assert.equal(busy.busyRegion(doc).textContent, 'Signing out…');
  });
});

// Every .jsx file under web/src, without its comments.
function sources(dir = WEB, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = `${rel}${entry.name}`;
    if (entry.isDirectory()) out.push(...sources(new URL(`${entry.name}/`, dir), `${name}/`));
    else if (name.endsWith('.jsx')) out.push([name, withoutComments(fs.readFileSync(new URL(entry.name, dir), 'utf8'))]);
  }
  return out;
}

// What a page calls a request under way: useAction's busy, and the pages' own.
const BUSY = /\b(busy|starting|returning|uploading|loading|spent)\b/;

describe('every busy button in the app', { skip }, () => {
  test('is a BusyButton (or uses its rules), never disabled while its request runs', () => {
    const found = [];
    for (const [file, src] of sources()) {
      for (const [, expr] of src.matchAll(/(?<![\w-])disabled=\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
        // The Player's menus are disabled while it is stopped, which isn't a request.
        // The two checkboxes saved as they are ticked keep the focus the same way: a
        // change while busy is ignored, and React draws the box as it was.
        if (BUSY.test(expr)) found.push(`${file}: disabled={${expr}}`);
      }
    }
    assert.deepEqual(found, []);
  });

  test('the pages that run a request from a button use BusyButton, PlayTile’s busy or busyProps', () => {
    const uses = Object.fromEntries(sources().map(([file, src]) => [file, (src.match(/<BusyButton\b|\bbusy=\{|busyProps\(/g) ?? []).length]));
    // Each file, and at least how many busy buttons it has (a look at each page, at
    // the time of slice 10: every Save, every confirmation, the friend's Play, Return
    // it, Keep it and Hand it back, and the sign-ins).
    const AT_LEAST = {
      'PasskeySignIn.jsx': 2,
      'site.jsx': 1,
      'Player.jsx': 1,
      'pages/Film.jsx': 7,
      'pages/HandBack.jsx': 3,
      'pages/Account.jsx': 2,
      'pages/TicketOpen.jsx': 1,
      'pages/Enroll.jsx': 2,
      'admin/AdminApp.jsx': 2,
      'admin/Activity.jsx': 1,
      'admin/Branding.jsx': 5,
      'admin/FilmDetail.jsx': 4,
      'admin/FilmInfo.jsx': 4,
      'admin/Films.jsx': 1,
      'admin/Loans.jsx': 2,
      'admin/People.jsx': 1,
      'admin/PersonDetail.jsx': 10,
      'admin/Responses.jsx': 2,
      'admin/Settings.jsx': 7,
      'admin/Status.jsx': 1,
      'admin/TicketDetail.jsx': 7,
      'admin/Tickets.jsx': 2,
    };
    for (const [file, n] of Object.entries(AT_LEAST)) assert.ok((uses[file] ?? 0) >= n, `${file}: ${uses[file] ?? 0} busy buttons, expected at least ${n}`);
  });

  test('aria-disabled is drawn as disabled is, for every kind of button a BusyButton can be', () => {
    const css = ['look/ui.css', 'look/objects.css', 'look/friend.css'].map((f) => fs.readFileSync(new URL(f, WEB), 'utf8')).join('\n');
    for (const kind of ['.ui-btn', '.ui-btn--quiet', '.ui-item', '.ui-nav__item', '.fl-cardbtn', '.crt-play', '.osd__btn']) {
      const disabled = new RegExp(`${kind.replace('.', '\\.')}(\\[disabled\\]|:disabled)`).test(css);
      const busyToo = new RegExp(`${kind.replace('.', '\\.')}\\[aria-disabled='true'\\]`).test(css);
      assert.ok(disabled && busyToo, `${kind}: drawn disabled ${disabled}, busy ${busyToo}`);
    }
  });

  test('the two checkboxes saved as they are ticked, and the logo’s upload, are busy the same way, and drawn so', () => {
    const src = Object.fromEntries(sources());
    for (const file of ['admin/FilmDetail.jsx', 'admin/Branding.jsx']) {
      assert.match(src[file], /type="checkbox"[\s\S]{0,200}?aria-disabled=\{action\.busy \|\| undefined\}/, `${file}: its checkbox is aria-disabled while it saves`);
    }
    assert.match(src['admin/FilmDetail.jsx'], /onChange=\{\(e\) => !action\.busy && setMemberVisible/, 'a change while it saves is ignored');
    assert.match(src['admin/Branding.jsx'], /async function toggle\(e\) \{\s*if \(action\.busy\) return;/, 'a change while it saves is ignored');
    const ui = fs.readFileSync(new URL('look/ui.css', WEB), 'utf8');
    assert.ok(ui.includes(":is(.ui-check, .ui-choice) input:is([disabled], [aria-disabled='true'])"), 'a busy checkbox is drawn as a disabled one');
    assert.ok(ui.includes(".ui-btn:has(> input[aria-disabled='true'])"), 'the upload, a label that is a button, is drawn busy');
  });
});
