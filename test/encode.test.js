// The reference encoder's planning: which renditions and audio tracks it makes,
// and the checks it runs before an encode that can take hours. None of this
// needs ffmpeg.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.js';

// scripts/ isn't in the server's image, where docs/deploying.md runs the tests on
// the server's own Node: there these are skipped, not failed.
const MODULE = new URL('../scripts/encode.mjs', import.meta.url);
const ENCODER = fileURLToPath(MODULE);
const present = fs.existsSync(MODULE);
const skip = present ? false : 'scripts/ is not here (the server image has none)';
// Importing it must not run it: main only runs when the file is executed.
const encoder = present ? await import(MODULE) : {};
const { defaultLadder, parseAudio, parseLadder, writeFilmJson } = encoder;
const { artworkFile } = await import('../server/names.js');

const run = (...args) => spawnSync(process.execPath, [ENCODER, ...args], { encoding: 'utf8' });

describe('the reference encoder', { skip }, () => {
  test('sources are classed by the 16:9 frame they fill, so cropped widescreen keeps its resolution', () => {
    const cases = [
      // [width, height, hdr, ladder]
      [3840, 2160, true, '2160:hevc:hdr,1080:hevc:hdr,1080:hevc,1080:h264,720:h264'],
      [3840, 2160, false, '2160:hevc,1080:hevc,1080:h264,720:h264'],
      [3840, 1600, true, '2160:hevc:hdr,1080:hevc:hdr,1080:hevc,1080:h264,720:h264'], // 2.39:1 UHD, bars cropped
      [3840, 1600, false, '2160:hevc,1080:hevc,1080:h264,720:h264'],
      [1920, 1080, true, '1080:hevc:hdr,1080:hevc,1080:h264,720:h264'],
      [1920, 1080, false, '1080:hevc,1080:h264,720:h264'],
      [1920, 800, false, '1080:hevc,1080:h264,720:h264'], // 2.39:1 Blu-ray, bars cropped
      [1920, 1036, false, '1080:hevc,1080:h264,720:h264'],
      [1440, 1080, false, '1080:hevc,1080:h264,720:h264'], // 4:3 keeps its height
      [1280, 720, false, '720:hevc,720:h264,480:h264'],
      [1280, 536, false, '720:hevc,720:h264,480:h264'],
      [720, 576, false, '480:h264'],
    ];
    for (const [width, height, hdr, ladder] of cases) {
      assert.equal(defaultLadder({ width, height }, hdr), ladder, `${width}x${height}${hdr ? ' HDR' : ''}`);
    }
  });

  test('every default ladder is valid and has an H.264 SDR rendition', () => {
    for (const [width, height] of [[3840, 2160], [1920, 1080], [1280, 720], [640, 360]]) {
      for (const hdr of [true, false]) {
        const rungs = parseLadder(defaultLadder({ width, height }, hdr), hdr);
        assert.ok(rungs.some((r) => r.codec === 'h264' && !r.hdr), `${width}x${height}${hdr ? ' HDR' : ''}`);
      }
    }
  });

  test('a bad --ladder is refused with a reason', () => {
    assert.throws(() => parseLadder('1080:av1', false), /Unsupported rendition "1080:av1"/);
    assert.throws(() => parseLadder('1080:hevc:hdr', false), /asks for HDR but the source is SDR/);
  });

  test('a source file’s audio language is only used when it is a language code', () => {
    const stream = (language, channels = 2) => ({ channels, tags: language === undefined ? {} : { language } });
    const plan = (language) => parseAudio(undefined, [stream(language)])[0];
    assert.deepEqual(
      { lang: plan('eng').lang, name: plan('eng').name, dir: plan('eng').dir },
      { lang: 'en', name: 'English', dir: 'a_en_0' },
    );
    for (const crafted of ['x/../../../../escaped', 'en"x:Pwned:ad', 'en\nx', undefined]) {
      const a = plan(crafted);
      assert.equal(a.lang, 'und', JSON.stringify(crafted));
      assert.equal(a.dir, 'a_und_0', 'nothing from the tag reaches the folder name');
      assert.equal(a.ad, false, 'a tag cannot turn the track into audio description');
    }
    const surround = parseAudio(undefined, [stream('fre', 6)]);
    assert.deepEqual(surround.map((a) => [a.lang, a.name, a.surround, a.dir]), [['fr', 'French', false, 'a_fr_0'], ['fr', 'Surround', true, 'a_fr_1']]);
  });

  test('languages and names given with --audio are checked too', () => {
    const streams = [{ channels: 2 }, { channels: 2 }];
    const ok = parseAudio('0:en:English,1:fr-CA:French (Canada)', streams);
    assert.deepEqual(ok.map((a) => a.dir), ['a_en_0', 'a_fr-CA_1']);
    assert.throws(() => parseAudio('0:../x:English', streams), /isn't a language code/);
    assert.throws(() => parseAudio('0:en:Say "hi"', streams), /can't contain double quotes/);
    assert.throws(() => parseAudio('2:en:English', streams), /does not exist/);
  });

  test('--help prints the usage and nothing else', () => {
    const r = run('--help');
    assert.equal(r.status, 0);
    const lines = r.stdout.trimEnd().split('\n');
    assert.equal(lines[0], 'Reference encoder: turns one source file into an Open Matte film folder.');
    assert.match(lines.at(-1), /^ {2}--dry-run/);
    assert.doesNotMatch(r.stdout, /import /);
  });

  test('an output folder whose name can’t be a film’s is refused before anything is encoded', () => {
    const dir = tempDir();
    // Any existing file will do as the source: the name is checked before ffprobe runs.
    const input = path.join(dir, 'source.mkv');
    fs.writeFileSync(input, 'not a film');
    for (const name of ['Arrival', 'admin', '-arrival']) {
      const r = run(input, path.join(dir, name), '--dry-run');
      assert.equal(r.status, 1, name);
      assert.match(r.stderr, new RegExp(`"${name}" can't be a film folder's name`), name);
      assert.ok(!fs.existsSync(path.join(dir, name)), `${name}: nothing was written`);
    }
  });

  test('a broken film.json already in the folder stops the script before it encodes', () => {
    const dir = tempDir();
    const input = path.join(dir, 'source.mkv');
    fs.writeFileSync(input, 'not a film');
    const out = path.join(dir, 'arrival');
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, 'film.json'), '{ "schemaVersion": 1, ');
    const r = run(input, out, '--dry-run');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /film\.json is not valid JSON/);
    assert.ok(!fs.existsSync(path.join(out, 'hls')));
  });

  test('film.json names the poster as the folder does, letter case included', () => {
    assert.equal(artworkFile(['Poster.JPG', 'backdrop.png'], 'poster'), 'Poster.JPG');
    assert.equal(artworkFile(['Poster.JPG', 'backdrop.png'], 'backdrop'), 'backdrop.png');
    assert.equal(artworkFile(['poster.webp', 'POSTER.jpg'], 'poster'), 'poster.webp', 'an exact name comes first');
    assert.equal(artworkFile(['notes.txt'], 'poster'), null);

    const out = path.join(tempDir(), 'arrival');
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, 'Poster.JPG'), 'a poster');
    writeFilmJson({ outDir: out, title: 'Arrival', year: 2016, subtitles: [], replaceSubtitles: false });
    const json = JSON.parse(fs.readFileSync(path.join(out, 'film.json'), 'utf8'));
    assert.equal(json.poster, 'Poster.JPG');
    assert.equal(json.slug, 'arrival');
  });
});
