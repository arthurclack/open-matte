// Audio and subtitles: the labels in the bar's menus, and which tracks the player
// starts on. Plain functions with no DOM, React or hls.js, so the tests can check them
// without a browser.
//
// A film's subtitles are film.media.subtitles: [{ url, language, label, forced, default }],
// always referred to by their index in that list. Forced tracks (signs, and dialogue
// in another language) are never listed in a menu: one shows by itself while
// subtitles are Off and its language matches the audio being heard. Only one track
// ever shows.

export const SUBTITLE_SIZES = ['small', 'medium', 'large'];
export const SUBTITLE_BACKGROUNDS = ['shadow', 'box'];
export const DEFAULT_SUBTITLE_SIZE = 'medium';
export const DEFAULT_SUBTITLE_BACKGROUND = 'shadow';

const LAYOUTS = { 1: 'Mono', 2: 'Stereo', 6: '5.1', 8: '7.1' };

// What the encoder recorded as an audio rendition's CHANNELS: 2, "6", or HLS's "16/JOC"
// for Dolby Atmos, where the number before the slash is still the channel count.
export function channelLabel(channels) {
  const n = Number.parseInt(String(channels ?? '').trim(), 10);
  if (!Number.isInteger(n) || n < 1) return null;
  return LAYOUTS[n] || `${n} channels`;
}

// Language codes compared as BCP 47 tags: case doesn't matter, an underscore is a
// hyphen, and the three-letter codes some tools write ("eng", "fre") mean the same
// as the two-letter ones.
function canonical(code) {
  const text = String(code ?? '').trim().replace(/_/g, '-');
  if (!text) return '';
  try {
    return Intl.getCanonicalLocales(text)[0].toLowerCase();
  } catch {
    return text.toLowerCase();
  }
}
const primary = (code) => canonical(code).split('-')[0];

// The same language: exactly, or by the primary subtag (fr and fr-CA).
export function sameLanguage(a, b) {
  const [x, y] = [canonical(a), canonical(b)];
  if (!x || !y) return false;
  return x === y || primary(x) === primary(y);
}

// The first of items in the language: an exact match before a regional one, and
// among equal matches the one marked default.
function inLanguage(items, language, languageOf, isDefault = () => false) {
  const wanted = canonical(language);
  if (!wanted) return null;
  for (const matches of [(item) => canonical(languageOf(item)) === wanted, (item) => sameLanguage(languageOf(item), wanted)]) {
    const found = items.filter(matches);
    if (found.length) return found.find(isDefault) || found[0];
  }
  return null;
}

const languageNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'language' }) : null;

// "French" for fr, or the code itself when there's no name for it.
export function languageName(code) {
  if (!code) return null;
  try {
    return languageNames?.of(code) || code;
  } catch {
    return code;
  }
}

// The audio menu's label: the track's name (or its language), then the channel layout
// and audio description from the film's own audio list: "English · 5.1".
// track: { id, name, language } as the player reports it; filmAudio: film.media.audio,
// [{ name, language, channels, default, description }]. A name that already says it
// ("English 5.1", "English (audio description)") isn't told twice.
export function audioLabel(track, filmAudio = []) {
  const entry = (track.name && filmAudio.find((a) => a.name === track.name)) || inLanguage(filmAudio, track.language, (a) => a.language);
  const name = track.name || languageName(track.language) || (Number.isInteger(track.id) ? `Track ${track.id + 1}` : 'Audio');
  const says = (text) => name.toLowerCase().includes(text.toLowerCase());
  const parts = [name];
  const layout = channelLabel(entry?.channels);
  if (layout && !says(layout)) parts.push(layout);
  if (entry?.description && !says('description')) parts.push('Audio description');
  return parts.join(' · ');
}

// The audio track to start on: the one in the language this browser remembers, or
// null to keep the player's own default. tracks: [{ id, language, default }].
export function initialAudio(tracks = [], remembered) {
  return inLanguage(tracks, remembered, (t) => t.language, (t) => t.default)?.id ?? null;
}

// The subtitles the menu offers: every track but the forced ones, by their index in
// the film's list.
export function menuSubtitles(subtitles = []) {
  return subtitles.flatMap((s, index) => (s.forced ? [] : [{ index, label: s.label, language: s.language }]));
}

// The subtitles to start with, -1 for Off: what this browser remembers ('off' or a
// language) when the film has it, otherwise the film's own default.
export function initialSubtitle(subtitles = [], remembered) {
  if (remembered === 'off') return -1;
  const listed = menuSubtitles(subtitles);
  const match = remembered ? inLanguage(listed, remembered, (s) => s.language, (s) => subtitles[s.index].default) : null;
  if (match) return match.index;
  return listed.find((s) => subtitles[s.index].default)?.index ?? -1;
}

const chosenTrack = (chosen) => Number.isInteger(chosen) && chosen >= 0;

// With subtitles Off, the forced track for the audio being heard, if the film has one.
export function forcedFor(subtitles = [], chosen, audioLanguage) {
  if (chosenTrack(chosen)) return -1;
  const forced = subtitles.map((s, index) => ({ ...s, index })).filter((s) => s.forced);
  return inLanguage(forced, audioLanguage, (s) => s.language)?.index ?? -1;
}

// The one track to show: the chosen subtitles, or with them Off, the forced track for
// the audio. -1 shows none.
export function showing(subtitles = [], chosen, audioLanguage) {
  return chosenTrack(chosen) ? chosen : forcedFor(subtitles, -1, audioLanguage);
}
