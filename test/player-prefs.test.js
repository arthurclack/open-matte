// Remembered player choices: milestone 3, slice 2. Written from
// docs/history/milestone-3.md (slice 2), not from the implementation. The audio
// language, the subtitle language (or Off), and the subtitles' size and background stay
// in the viewer's browser, under one localStorage key, and are never sent anywhere.
// What is kept is language codes, never a track's label, a film's title or slug, an
// address or an id. Storage that fails (a private window, blocked site data, a full
// quota) means nothing is remembered, never an error.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { beforeEach, describe, test } from 'node:test';

const KEY = 'openMatte.player';
const FIELDS = ['audioLanguage', 'subtitles', 'subtitleSize', 'subtitleBackground'];
// A language code: `fr`, `pt-BR`, `zh-Hant`. Not `English`, `French (forced)` or an address.
const CODE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

// A browser's localStorage, near enough, on globalThis before the module loads (Node's
// own wants --localstorage-file). `mode` makes it fail the ways browsers' does:
// 'throwing', getItem and setItem throw (some private windows); 'full', setItem throws
// (the quota); 'blocked', even reading localStorage throws (site data blocked).
const store = new Map();
let mode = 'ok';
const failure = (name) => Object.assign(new Error(`localStorage: ${name}`), { name });
const storage = {
  get length() {
    return store.size;
  },
  key: (i) => [...store.keys()][i] ?? null,
  getItem(key) {
    if (mode === 'throwing' || mode === 'blocked') throw failure('SecurityError');
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    if (mode === 'full') throw failure('QuotaExceededError');
    if (mode !== 'ok') throw failure('SecurityError');
    store.set(key, String(value));
  },
  removeItem(key) {
    if (mode !== 'ok') throw failure('SecurityError');
    store.delete(key);
  },
  clear() {
    if (mode !== 'ok') throw failure('SecurityError');
    store.clear();
  },
};
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  get() {
    if (mode === 'blocked') throw failure('SecurityError');
    return storage;
  },
});

// The web app's source isn't in the server's image, where docs/deploying.md runs the
// tests on the server's own Node: there these are skipped, not failed.
const MODULE = new URL('../web/src/playerPrefs.js', import.meta.url);
const present = fs.existsSync(MODULE);
const skip = present ? false : 'web/src is not here (the server image has no web source)';
const { loadPrefs, savePrefs } = present ? await import(MODULE) : {};

beforeEach(() => {
  mode = 'ok';
  store.clear();
});

const put = (value) => store.set(KEY, typeof value === 'string' ? value : JSON.stringify(value));
const stored = () => JSON.parse(store.get(KEY));
const lower = (value) => (typeof value === 'string' ? value.toLowerCase() : value);

// Nothing remembered: no languages, medium subtitles on a shadow.
function assertDefaults(prefs, what) {
  assert.equal(typeof prefs, 'object', what);
  assert.ok(prefs, what);
  assert.equal(prefs.audioLanguage ?? null, null, what);
  assert.equal(prefs.subtitles ?? null, null, what);
  assert.equal(prefs.subtitleSize, 'medium', what);
  assert.equal(prefs.subtitleBackground, 'shadow', what);
}

describe('loadPrefs', { skip }, () => {
  test('with nothing stored, nothing is remembered: medium subtitles on a shadow', () => {
    assertDefaults(loadPrefs(), 'empty');
  });

  test("stored text that isn't JSON, or isn't an object, is nothing remembered", () => {
    for (const text of ['{"audioLanguage": "fr"', 'not json', '', 'undefined', 'null', '"fr"', '42', 'true', '[]', '["fr", "off"]']) {
      put(text);
      let prefs;
      assert.doesNotThrow(() => (prefs = loadPrefs()), text);
      assertDefaults(prefs, text);
    }
  });

  test('what was saved before comes back, regions and Off included', () => {
    put({ audioLanguage: 'pt-BR', subtitles: 'en-GB', subtitleSize: 'large', subtitleBackground: 'box' });
    const prefs = loadPrefs();
    assert.equal(lower(prefs.audioLanguage), 'pt-br');
    assert.equal(lower(prefs.subtitles), 'en-gb');
    assert.equal(prefs.subtitleSize, 'large');
    assert.equal(prefs.subtitleBackground, 'box');
    put({ audioLanguage: 'fr', subtitles: 'off', subtitleSize: 'small', subtitleBackground: 'shadow' });
    assert.deepEqual(
      Object.fromEntries(FIELDS.map((f) => [f, lower(loadPrefs()[f])])),
      { audioLanguage: 'fr', subtitles: 'off', subtitleSize: 'small', subtitleBackground: 'shadow' },
    );
  });

  test('unknown values are ignored one by one, and the others kept', () => {
    put({ audioLanguage: 'fr', subtitles: 'French (forced)', subtitleSize: 'huge', subtitleBackground: 'box' });
    let prefs = loadPrefs();
    assert.equal(prefs.audioLanguage, 'fr');
    assert.equal(prefs.subtitles ?? null, null);
    assert.equal(prefs.subtitleSize, 'medium');
    assert.equal(prefs.subtitleBackground, 'box');

    put({ audioLanguage: 'https://www.openmatte.dev/media/arrival/hls/a_fr.m3u8', subtitles: 'off', subtitleSize: 'large', subtitleBackground: 'neon' });
    prefs = loadPrefs();
    assert.equal(prefs.audioLanguage ?? null, null);
    assert.equal(prefs.subtitles, 'off');
    assert.equal(prefs.subtitleSize, 'large');
    assert.equal(prefs.subtitleBackground, 'shadow');
  });

  test("values of the wrong kind, labels, addresses and ids aren't languages", () => {
    for (const bad of [
      { audioLanguage: 3, subtitles: 0, subtitleSize: ['large'], subtitleBackground: { box: true } },
      { audioLanguage: true, subtitles: -1, subtitleSize: 2, subtitleBackground: null },
      { audioLanguage: 'English · 5.1', subtitles: '/media/arrival/subtitles/fr.vtt', subtitleSize: 'LARGE PRINT', subtitleBackground: '' },
      { audioLanguage: 'English', subtitles: 'English (SDH)' },
      { audioLanguage: 'arrival', subtitles: 'blob:https://www.openmatte.dev/6c1f0d6e' },
      { audioLanguage: '', subtitles: '' },
    ]) {
      put(bad);
      assertDefaults(loadPrefs(), JSON.stringify(bad));
    }
  });
});

describe('savePrefs', { skip }, () => {
  test('a round trip: each choice saved comes back, and saving one keeps the others', () => {
    savePrefs({ audioLanguage: 'fr' });
    savePrefs({ subtitles: 'en' });
    savePrefs({ subtitleSize: 'large' });
    savePrefs({ subtitleBackground: 'box' });
    let prefs = loadPrefs();
    assert.equal(prefs.audioLanguage, 'fr');
    assert.equal(prefs.subtitles, 'en');
    assert.equal(prefs.subtitleSize, 'large');
    assert.equal(prefs.subtitleBackground, 'box');

    // Subtitles turned Off, then the audio changed: the rest stays.
    savePrefs({ subtitles: 'off' });
    savePrefs({ audioLanguage: 'de' });
    prefs = loadPrefs();
    assert.equal(prefs.audioLanguage, 'de');
    assert.equal(prefs.subtitles, 'off');
    assert.equal(prefs.subtitleSize, 'large');
    assert.equal(prefs.subtitleBackground, 'box');

    // Several at once, regions and all.
    savePrefs({ audioLanguage: 'pt-BR', subtitles: 'fr-CA', subtitleSize: 'small', subtitleBackground: 'shadow' });
    prefs = loadPrefs();
    assert.equal(lower(prefs.audioLanguage), 'pt-br');
    assert.equal(lower(prefs.subtitles), 'fr-ca');
    assert.equal(prefs.subtitleSize, 'small');
    assert.equal(prefs.subtitleBackground, 'shadow');
  });

  test('everything goes under one key, openMatte.player, as JSON', () => {
    savePrefs({ audioLanguage: 'fr' });
    savePrefs({ subtitles: 'off', subtitleSize: 'large' });
    assert.deepEqual([...store.keys()], [KEY]);
    const saved = stored();
    assert.equal(lower(saved.audioLanguage), 'fr');
    assert.equal(saved.subtitles, 'off');
    assert.equal(saved.subtitleSize, 'large');
  });

  test('only language codes are stored: no labels, titles, slugs, addresses or ids', () => {
    savePrefs({ audioLanguage: 'fr', subtitles: 'en' });
    // A careless caller hands over the whole track.
    savePrefs({
      audioLanguage: 'fr',
      label: 'French · 5.1',
      name: 'French',
      title: 'Arrival',
      slug: 'arrival',
      url: '/media/arrival/subtitles/en.vtt',
      id: 3,
      index: 2,
    });
    // Or the wrong field of it.
    savePrefs({ audioLanguage: 'French · 5.1' });
    savePrefs({ audioLanguage: 'English' });
    savePrefs({ audioLanguage: 2 });
    savePrefs({ subtitles: 'English (SDH)' });
    savePrefs({ subtitles: '/media/arrival/subtitles/en.vtt' });
    savePrefs({ subtitles: 'https://www.openmatte.dev/media/arrival/subtitles/en.vtt' });
    savePrefs({ subtitles: 3 });
    savePrefs({ subtitleSize: 'huge', subtitleBackground: 'neon' });

    assert.deepEqual([...store.keys()], [KEY]);
    const saved = stored();
    for (const key of Object.keys(saved)) assert.ok(FIELDS.includes(key), `${key} stored: ${store.get(KEY)}`);
    if (saved.audioLanguage != null) assert.match(saved.audioLanguage, CODE);
    if (saved.subtitles != null) assert.ok(saved.subtitles === 'off' || CODE.test(saved.subtitles), store.get(KEY));
    if (saved.subtitleSize != null) assert.ok(['small', 'medium', 'large'].includes(saved.subtitleSize), store.get(KEY));
    if (saved.subtitleBackground != null) assert.ok(['shadow', 'box'].includes(saved.subtitleBackground), store.get(KEY));
    for (const word of ['French', 'English', 'Arrival', 'arrival', '/media', 'openmatte', '5.1', 'huge', 'neon']) {
      assert.ok(!store.get(KEY).includes(word), `${word} stored: ${store.get(KEY)}`);
    }
  });

  test('storage whose getItem and setItem throw: nothing remembered, and no exception', () => {
    put({ audioLanguage: 'fr', subtitles: 'off', subtitleSize: 'large', subtitleBackground: 'box' });
    mode = 'throwing';
    let prefs;
    assert.doesNotThrow(() => (prefs = loadPrefs()));
    assertDefaults(prefs, 'throwing');
    assert.doesNotThrow(() => savePrefs({ audioLanguage: 'de' }));
    assert.doesNotThrow(() => savePrefs({ subtitles: 'en', subtitleSize: 'small', subtitleBackground: 'shadow' }));
    assert.doesNotThrow(() => loadPrefs());
  });

  test('blocked site data, where reading localStorage itself throws: the same', () => {
    put({ audioLanguage: 'fr', subtitles: 'off', subtitleSize: 'large', subtitleBackground: 'box' });
    mode = 'blocked';
    let prefs;
    assert.doesNotThrow(() => (prefs = loadPrefs()));
    assertDefaults(prefs, 'blocked');
    assert.doesNotThrow(() => savePrefs({ audioLanguage: 'de' }));
    assert.doesNotThrow(() => loadPrefs());
  });

  test('a full quota: saving fails quietly, and what was stored stays as it was', () => {
    savePrefs({ audioLanguage: 'fr', subtitles: 'off' });
    const before = store.get(KEY);
    mode = 'full';
    assert.doesNotThrow(() => savePrefs({ audioLanguage: 'de', subtitles: 'en' }));
    assert.equal(store.get(KEY), before);
    assert.doesNotThrow(() => loadPrefs());
  });

  test('saving over stored text that is broken starts afresh', () => {
    put('{"audioLanguage": "fr", "subtitles"');
    assert.doesNotThrow(() => savePrefs({ audioLanguage: 'de' }));
    const prefs = loadPrefs();
    assert.equal(prefs.audioLanguage, 'de');
    assert.equal(prefs.subtitles ?? null, null);
    assert.equal(prefs.subtitleSize, 'medium');
    assert.equal(prefs.subtitleBackground, 'shadow');
  });
});
