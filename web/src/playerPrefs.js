import { DEFAULT_SUBTITLE_BACKGROUND, DEFAULT_SUBTITLE_SIZE, SUBTITLE_BACKGROUNDS, SUBTITLE_SIZES } from './tracks.js';

// The player's remembered choices: the audio language, the subtitle language or Off,
// and how subtitles look. They stay in this browser (localStorage) and are never sent
// anywhere, so a choice made on the iPhone doesn't change the Mac. Only language codes
// are kept, never a track's label, the film or an address.
//
// Storage can fail in a private window, with site data blocked, or when it's full.
// That only means nothing is remembered: nothing here ever throws.

const KEY = 'openMatte.player';

// A language code as playlists and film.json give them: en, fr-CA, zh-Hant-TW.
const LANGUAGE = /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i;
const language = (v) => (typeof v === 'string' && LANGUAGE.test(v.trim()) ? v.trim() : undefined);

const CHECKS = {
  audioLanguage: language,
  subtitles: (v) => (v === 'off' ? 'off' : language(v)),
  subtitleSize: (v) => (SUBTITLE_SIZES.includes(v) ? v : undefined),
  subtitleBackground: (v) => (SUBTITLE_BACKGROUNDS.includes(v) ? v : undefined),
};

const DEFAULTS = { audioLanguage: null, subtitles: null, subtitleSize: DEFAULT_SUBTITLE_SIZE, subtitleBackground: DEFAULT_SUBTITLE_BACKGROUND };

// Only the known choices with values that make sense; anything else is dropped.
function clean(prefs) {
  const out = {};
  if (!prefs || typeof prefs !== 'object') return out;
  for (const [name, check] of Object.entries(CHECKS)) {
    const value = check(prefs[name]);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

// What this browser has stored, checked.
function stored() {
  try {
    return clean(JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null'));
  } catch {
    return {};
  }
}

// { audioLanguage, subtitles, subtitleSize, subtitleBackground }: audioLanguage and
// subtitles are null when nothing is remembered.
export function loadPrefs() {
  return { ...DEFAULTS, ...stored() };
}

// Remember the choices in patch (a viewer's own, never the player's), keeping the
// others. Returns them all, as loadPrefs would.
export function savePrefs(patch) {
  const next = { ...stored(), ...clean(patch) };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // not kept this time
  }
  return { ...DEFAULTS, ...next };
}
