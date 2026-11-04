// Audio and subtitle tracks: milestone 3, slice 2. Written from
// docs/history/milestone-3.md (slice 2), not from the implementation. A film starts in
// the audio language and the subtitles a viewer chose last time, when it has them, and
// otherwise as film.json says; a forced track (signs, foreign dialogue) shows by itself
// while subtitles are Off and its language is the one being heard, and is never listed
// in the menu; the audio menu names each track's channel layout and audio description.
// web/src/tracks.js is plain functions: no DOM, no React, no hls.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';

// The web app's source isn't in the server's image, where docs/deploying.md runs the
// tests on the server's own Node: there these are skipped, not failed.
const MODULE = new URL('../web/src/tracks.js', import.meta.url);
const present = fs.existsSync(MODULE);
const skip = present ? false : 'web/src is not here (the server image has no web source)';
const {
  channelLabel,
  audioLabel,
  sameLanguage,
  initialAudio,
  menuSubtitles,
  initialSubtitle,
  forcedFor,
  showing,
  SUBTITLE_SIZES,
  SUBTITLE_BACKGROUNDS,
} = present ? await import(MODULE) : {};

// A film's subtitles and audio as the player gets them (film.media in server/films.js).
function sub(language, label, { forced = false, default: isDefault = false, file = `${language}${forced ? '.forced' : ''}.vtt` } = {}) {
  return { url: `/media/arrival/subtitles/${file}`, language, label, forced, default: isDefault };
}
function audio(name, language, channels, { default: isDefault = false, description = false } = {}) {
  return { name, language, channels, default: isDefault, description };
}
// An audio track as the player hands it over, from hls.js or Safari's audioTracks.
const track = (id, name, language, isDefault = false) => ({ id, name, language, default: isDefault });

// Five subtitles, no default: two English, a forced French (the French dialogue in an
// English film), the full French, and Brazilian Portuguese.
const ARRIVAL = [
  sub('en', 'English'),
  sub('en', 'English (SDH)', { file: 'en.sdh.vtt' }),
  sub('fr', 'French (forced)', { forced: true }),
  sub('fr', 'French'),
  sub('pt-BR', 'Portuguese (Brazil)'),
];
// English by default, and two forced tracks: French, and German with its full German too.
const TEST_PATTERN = [
  sub('en', 'English', { default: true }),
  sub('fr', 'French (forced)', { forced: true }),
  sub('de', 'German (forced)', { forced: true }),
  sub('de', 'German'),
];
// Only forced subtitles: nothing to list.
const ONLY_FORCED = [sub('fr', 'French (forced)', { forced: true }), sub('de', 'German (forced)', { forced: true })];

describe('channelLabel', { skip }, () => {
  test('names the usual layouts: Mono, Stereo, 5.1 and 7.1', () => {
    assert.equal(channelLabel(1), 'Mono');
    assert.equal(channelLabel(2), 'Stereo');
    assert.equal(channelLabel(6), '5.1');
    assert.equal(channelLabel(8), '7.1');
  });

  test('reads the count as HLS writes it, a string, with Dolby Atmos\'s "/JOC" and all', () => {
    assert.equal(channelLabel('1'), 'Mono');
    assert.equal(channelLabel('2'), 'Stereo');
    assert.equal(channelLabel('6'), '5.1');
    assert.equal(channelLabel('8'), '7.1');
    assert.equal(channelLabel('6/JOC'), '5.1');
    assert.equal(channelLabel('16/JOC'), '16 channels');
  });

  test('any other count is "<n> channels"', () => {
    assert.equal(channelLabel(3), '3 channels');
    assert.equal(channelLabel('4'), '4 channels');
    assert.equal(channelLabel(10), '10 channels');
  });

  test('a count that is missing or unreadable is no label at all', () => {
    for (const channels of [null, undefined, '', 'unknown', Number.NaN]) assert.equal(channelLabel(channels), null, String(channels));
  });
});

describe('audioLabel', { skip }, () => {
  const FILM = [audio('English', 'en', '2', { default: true }), audio('French', 'fr', '6')];

  test("is the track's name and the layout film.json recorded for it", () => {
    assert.equal(audioLabel(track(0, 'English', 'en', true), FILM), 'English · Stereo');
    assert.equal(audioLabel(track(1, 'French', 'fr'), FILM), 'French · 5.1');
    assert.equal(audioLabel(track(0, 'English', 'en'), [audio('English', 'en', '6/JOC')]), 'English · 5.1');
    assert.equal(audioLabel(track(0, 'English', 'en'), [audio('English', 'en', '8')]), 'English · 7.1');
  });

  test("finds film.json's entry by name before language: two English tracks keep their own layouts", () => {
    const film = [audio('English', 'en', '2', { default: true }), audio('Surround', 'en', '6')];
    assert.equal(audioLabel(track(0, 'English', 'en', true), film), 'English · Stereo');
    assert.equal(audioLabel(track(1, 'Surround', 'en'), film), 'Surround · 5.1');
  });

  test("falls back to the language when film.json has the track under another name", () => {
    assert.equal(audioLabel(track(1, 'Français', 'fr'), FILM), 'Français · 5.1');
  });

  test('says when a track is audio description, after its layout', () => {
    const film = [audio('English', 'en', '2', { default: true }), audio('English, described', 'en', '2', { description: true })];
    assert.equal(audioLabel(track(0, 'English', 'en', true), film), 'English · Stereo');
    assert.equal(audioLabel(track(1, 'English, described', 'en'), film), 'English, described · Stereo · Audio description');
    // No layout recorded: the description still shows.
    assert.equal(audioLabel(track(1, 'English, described', 'en'), [audio('English, described', 'en', null, { description: true })]), 'English, described · Audio description');
    // The name scripts/encode.mjs gives such a track: whatever it reads, it starts with the
    // name and gives the layout.
    const named = audioLabel(track(1, 'Audio description', 'en'), [audio('English', 'en', '2'), audio('Audio description', 'en', '2', { description: true })]);
    assert.match(named, /^Audio description · Stereo\b/);
  });

  test("a track film.json says nothing about, or whose layout wasn't recorded, is just its name", () => {
    assert.equal(audioLabel(track(0, 'English', 'en'), []), 'English');
    assert.equal(audioLabel(track(0, 'English', 'en'), [audio('English', 'en', null)]), 'English');
    assert.equal(audioLabel(track(0, 'Commentary', 'ja'), FILM), 'Commentary');
  });

  test("a track with no name is called by its language's name", () => {
    assert.match(audioLabel({ id: 0, language: 'fr', default: false }, []), /^French\b/);
    assert.equal(audioLabel({ id: 1, language: 'fr', default: false }, FILM), 'French · 5.1');
  });
});

describe('sameLanguage', { skip }, () => {
  test('the same code is the same language, whatever its case', () => {
    assert.ok(sameLanguage('en', 'en'));
    assert.ok(sameLanguage('FR', 'fr'));
    assert.ok(sameLanguage('pt-BR', 'pt-br'));
  });

  test('a language matches its regional forms, and they match each other', () => {
    assert.ok(sameLanguage('fr', 'fr-CA'));
    assert.ok(sameLanguage('fr-CA', 'fr'));
    assert.ok(sameLanguage('fr-CA', 'FR-fr'));
    assert.ok(sameLanguage('en-GB', 'en-US'));
  });

  test("different languages don't, even when one code starts with the other", () => {
    assert.ok(!sameLanguage('en', 'fr'));
    assert.ok(!sameLanguage('pt-BR', 'es'));
    assert.ok(!sameLanguage('ar', 'arz'));
    assert.ok(!sameLanguage('fr-CA', 'fro'));
  });

  test('a missing language matches nothing, not even another missing one', () => {
    assert.ok(!sameLanguage(null, 'en'));
    assert.ok(!sameLanguage('en', undefined));
    assert.ok(!sameLanguage(undefined, undefined));
    assert.ok(!sameLanguage(null, null));
  });
});

describe('initialAudio', { skip }, () => {
  const TRACKS = [track(0, 'English', 'en', true), track(1, 'French', 'fr'), track(2, 'German', 'de')];

  test('is the id of the track in the remembered language', () => {
    assert.equal(initialAudio(TRACKS, 'fr'), 1);
    assert.equal(initialAudio(TRACKS, 'de'), 2);
    // The default track is still a track: its id, 0, and not "no choice".
    assert.equal(initialAudio(TRACKS, 'en'), 0);
  });

  test("gives the track's id, not its place in the list", () => {
    assert.equal(initialAudio([track(4, 'English', 'en', true), track(7, 'French', 'fr')], 'fr'), 7);
  });

  test('ignores case, and prefers the exact code to a regional match', () => {
    const tracks = [track(0, 'English', 'en', true), track(1, 'Québécois', 'fr-CA'), track(2, 'French', 'fr')];
    assert.equal(initialAudio(tracks, 'fr'), 2);
    assert.equal(initialAudio(tracks, 'FR-ca'), 1);
    assert.equal(initialAudio(tracks, 'FR'), 2);
    // No exact match: the first in the same language.
    assert.equal(initialAudio(tracks, 'fr-FR'), 1);
    assert.equal(initialAudio([track(0, 'English', 'en', true), track(1, 'Québécois', 'fr-CA')], 'fr'), 1);
    assert.equal(initialAudio([track(0, 'English', 'en-US', true), track(1, 'French', 'fr')], 'en-GB'), 0);
  });

  test("a language the film doesn't have, or nothing remembered, leaves the player's own default: null", () => {
    assert.equal(initialAudio(TRACKS, 'ja'), null);
    assert.equal(initialAudio(TRACKS, undefined), null);
    assert.equal(initialAudio(TRACKS, null), null);
    assert.equal(initialAudio([], 'fr'), null);
    // Tracks without a language don't match "nothing remembered".
    assert.equal(initialAudio([{ id: 0, default: true }, { id: 1, default: false }], undefined), null);
  });
});

describe('menuSubtitles', { skip }, () => {
  const items = (list) => list.map(({ index, label, language }) => ({ index, label, language }));

  test("lists every subtitle but the forced ones, in film.json's order, each with its index there", () => {
    assert.deepEqual(items(menuSubtitles(ARRIVAL)), [
      { index: 0, label: 'English', language: 'en' },
      { index: 1, label: 'English (SDH)', language: 'en' },
      { index: 3, label: 'French', language: 'fr' },
      { index: 4, label: 'Portuguese (Brazil)', language: 'pt-BR' },
    ]);
    assert.deepEqual(items(menuSubtitles(TEST_PATTERN)), [
      { index: 0, label: 'English', language: 'en' },
      { index: 3, label: 'German', language: 'de' },
    ]);
  });

  test('no subtitles, or only forced ones, is an empty menu', () => {
    assert.deepEqual(menuSubtitles([]), []);
    assert.deepEqual(menuSubtitles(ONLY_FORCED), []);
    assert.deepEqual(menuSubtitles([sub('fr', 'French (forced)', { forced: true, default: true })]), []);
  });
});

describe('initialSubtitle', { skip }, () => {
  test('Off remembered: none, even when the film has a default', () => {
    assert.equal(initialSubtitle(TEST_PATTERN, 'off'), -1);
    assert.equal(initialSubtitle(ARRIVAL, 'off'), -1);
  });

  test('a remembered language the film has: its first listed track in it, never a forced one', () => {
    assert.equal(initialSubtitle(ARRIVAL, 'fr'), 3);
    assert.equal(initialSubtitle(ARRIVAL, 'en'), 0);
    assert.equal(initialSubtitle(ARRIVAL, 'pt-BR'), 4);
    // The remembered choice wins over the film's default (English), and German's full
    // track is chosen, not its forced one.
    assert.equal(initialSubtitle(TEST_PATTERN, 'de'), 3);
  });

  test('ignores case, and prefers the exact code to a regional match', () => {
    assert.equal(initialSubtitle(ARRIVAL, 'PT-br'), 4);
    assert.equal(initialSubtitle(ARRIVAL, 'pt'), 4);
    assert.equal(initialSubtitle(ARRIVAL, 'fr-CA'), 3);
    const english = [sub('en-US', 'English (US)'), sub('en-GB', 'English (UK)')];
    assert.equal(initialSubtitle(english, 'en-GB'), 1);
    assert.equal(initialSubtitle(english, 'en-us'), 0);
    assert.equal(initialSubtitle(english, 'en'), 0);
    assert.equal(initialSubtitle(english, 'en-AU'), 0);
  });

  test("nothing remembered: the film's default, else none", () => {
    assert.equal(initialSubtitle(TEST_PATTERN, undefined), 0);
    assert.equal(initialSubtitle(TEST_PATTERN, null), 0);
    assert.equal(initialSubtitle(ARRIVAL, undefined), -1);
    assert.equal(initialSubtitle(ARRIVAL, null), -1);
    const frenchDefault = [sub('en', 'English'), sub('fr', 'French', { default: true })];
    assert.equal(initialSubtitle(frenchDefault, undefined), 1);
  });

  test("a remembered language the film doesn't have: the film's default, else none", () => {
    assert.equal(initialSubtitle(TEST_PATTERN, 'ja'), 0);
    assert.equal(initialSubtitle(ARRIVAL, 'ja'), -1);
    // French is only there forced: that isn't a French subtitle to choose.
    assert.equal(initialSubtitle(TEST_PATTERN, 'fr'), 0);
    assert.equal(initialSubtitle([sub('fr', 'French (forced)', { forced: true }), sub('en', 'English')], 'fr'), -1);
  });

  test('a forced track is never where a film starts, not even when film.json marks it default', () => {
    const forcedDefault = [sub('fr', 'French (forced)', { forced: true, default: true }), sub('en', 'English')];
    assert.equal(initialSubtitle(forcedDefault, undefined), -1);
    assert.equal(initialSubtitle(forcedDefault, 'fr'), -1);
    assert.equal(initialSubtitle(ONLY_FORCED, undefined), -1);
    assert.equal(initialSubtitle(ONLY_FORCED, 'de'), -1);
  });

  test('no subtitles at all: none', () => {
    for (const remembered of ['fr', 'off', undefined, null]) assert.equal(initialSubtitle([], remembered), -1, String(remembered));
  });
});

describe('forcedFor', { skip }, () => {
  test('with subtitles Off, it is the forced track in the language being heard', () => {
    assert.equal(forcedFor(TEST_PATTERN, -1, 'fr'), 1);
    assert.equal(forcedFor(ARRIVAL, -1, 'fr'), 2);
    assert.equal(forcedFor(ONLY_FORCED, -1, 'fr'), 0);
    assert.equal(forcedFor(ONLY_FORCED, -1, 'de'), 1);
  });

  test('of several forced tracks, it follows the audio, and never picks a full track', () => {
    // German audio: the German forced track, not the full German subtitles.
    assert.equal(forcedFor(TEST_PATTERN, -1, 'de'), 2);
    assert.equal(forcedFor(TEST_PATTERN, -1, 'fr'), 1);
    // English audio has no forced track.
    assert.equal(forcedFor(TEST_PATTERN, -1, 'en'), -1);
    assert.equal(forcedFor(ARRIVAL, -1, 'en'), -1);
    assert.equal(forcedFor(TEST_PATTERN, -1, 'ja'), -1);
  });

  test('matches the audio language whatever its case or region', () => {
    assert.equal(forcedFor(TEST_PATTERN, -1, 'FR'), 1);
    assert.equal(forcedFor(TEST_PATTERN, -1, 'fr-CA'), 1);
    assert.equal(forcedFor([sub('en', 'English'), sub('fr-CA', 'French (forced)', { forced: true })], -1, 'fr'), 1);
  });

  test('with subtitles chosen, no forced track shows', () => {
    assert.equal(forcedFor(TEST_PATTERN, 0, 'fr'), -1);
    assert.equal(forcedFor(TEST_PATTERN, 3, 'de'), -1);
    assert.equal(forcedFor(ARRIVAL, 3, 'fr'), -1);
  });

  test("with the audio's language unknown, or no forced tracks, none", () => {
    assert.equal(forcedFor(TEST_PATTERN, -1, null), -1);
    assert.equal(forcedFor(TEST_PATTERN, -1, undefined), -1);
    assert.equal(forcedFor([], -1, 'fr'), -1);
    assert.equal(forcedFor([sub('en', 'English'), sub('fr', 'French')], -1, 'fr'), -1);
  });

  test('two forced tracks in the language heard: one of them, only one', () => {
    const twice = [sub('fr', 'French (forced)', { forced: true }), sub('fr', 'French signs', { forced: true, file: 'fr.signs.forced.vtt' })];
    assert.ok([0, 1].includes(forcedFor(twice, -1, 'fr')));
  });
});

describe('showing', { skip }, () => {
  test('is the chosen subtitle when there is one, with no forced track beside it', () => {
    assert.equal(showing(ARRIVAL, 3, 'fr'), 3);
    assert.equal(showing(ARRIVAL, 0, 'fr'), 0);
    assert.equal(showing(TEST_PATTERN, 3, 'de'), 3);
    assert.equal(showing(TEST_PATTERN, 0, 'en'), 0);
  });

  test("with subtitles Off, it is the forced track for the audio, else none", () => {
    assert.equal(showing(TEST_PATTERN, -1, 'fr'), 1);
    assert.equal(showing(TEST_PATTERN, -1, 'de'), 2);
    assert.equal(showing(TEST_PATTERN, -1, 'en'), -1);
    assert.equal(showing(ARRIVAL, -1, 'fr'), 2);
    assert.equal(showing(ARRIVAL, -1, null), -1);
    assert.equal(showing([], -1, 'fr'), -1);
  });

  test('is always one index, a track of the film or -1, whatever is chosen and heard', () => {
    for (const subtitles of [ARRIVAL, TEST_PATTERN, ONLY_FORCED, []]) {
      for (let chosen = -1; chosen < subtitles.length; chosen++) {
        if (subtitles[chosen]?.forced) continue; // The menu never offers one.
        for (const heard of ['en', 'fr', 'fr-CA', 'de', 'ja', null]) {
          const index = showing(subtitles, chosen, heard);
          assert.ok(Number.isInteger(index) && index >= -1 && index < subtitles.length, `${chosen} ${heard}: ${index}`);
          if (chosen >= 0) assert.equal(index, chosen);
          else if (index >= 0) assert.equal(subtitles[index].forced, true, `${heard}: ${index}`);
        }
      }
    }
  });
});

describe('subtitle size and background', { skip }, () => {
  test('sizes are small, medium and large; backgrounds a shadow or a box', () => {
    assert.deepEqual(SUBTITLE_SIZES, ['small', 'medium', 'large']);
    assert.deepEqual(SUBTITLE_BACKGROUNDS, ['shadow', 'box']);
  });
});
