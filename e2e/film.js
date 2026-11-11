// The browser journeys' films: about eight seconds of test pattern each, 640×360,
// H.264 and AAC, made into Open Matte film folders by scripts/encode.mjs itself.
//
// - The main one has English and French audio, English and French subtitles, and a
//   forced French track (a sign), which shows by itself with French audio and
//   subtitles Off.
// - The second has English and Canadian French audio and subtitles, English marked
//   default: the journey that checks a second film starts in the languages chosen
//   for the first (fr finds fr-CA) and that a remembered Off beats a film's default.
//
// They're cached in e2e/.cache, keyed by the encoder's source and this file's, so
// a run only encodes again when either changes.
//
// Each browser project plays copies of its own (copyFilms), so a journey in one
// browser never finds a film already playing, or out on loan, in another's.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENCODER = path.join(ROOT, 'scripts', 'encode.mjs');
export const CACHE = path.join(ROOT, 'e2e', '.cache');
const SECONDS = 8;

// lang is what the source file is tagged with (the encoder turns eng into en);
// text is the track's one cue, for the whole film.
export const FILMS = {
  main: {
    slug: 'e2e-reel',
    title: 'Lanternfish Test Reel',
    pattern: 'testsrc2',
    tones: [440, 660],
    audio: '0:en:English,1:fr:French',
    subtitles: [
      { lang: 'eng', text: 'The lanternfish swims at night.' },
      { lang: 'fra', text: 'Le poisson-lanterne nage la nuit.' },
      { lang: 'fra', text: 'PHARE DU GRAND LARGE', forced: true },
    ],
    synopsis: 'Eight seconds of test pattern, in two languages, with a sign in French.',
  },
  second: {
    slug: 'e2e-second-reel',
    title: 'Hatchetfish Test Reel',
    pattern: 'testsrc',
    tones: [550, 770],
    audio: '0:en:English,1:fr-CA:French (Canada)',
    subtitles: [
      { lang: 'eng', text: 'The hatchetfish keeps to the dark.' },
      { lang: 'fra', text: 'Le poisson-hachette reste dans le noir.' },
    ],
    synopsis: 'Eight more seconds, in English and Canadian French.',
    // The encoder names subtitles by their two- or three-letter tag: the region, and
    // which track is the film's default, go into film.json as you'd write them by hand.
    edit(json) {
      json.subtitles[0].default = true;
      Object.assign(json.subtitles[1], { language: 'fr-CA', label: 'French (Canada)' });
    },
  },
};

export function hasFfmpeg() {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    if (spawnSync(tool, ['-version'], { stdio: 'ignore' }).status !== 0) return false;
  }
  return true;
}

const sha = (...parts) => {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex').slice(0, 16);
};

const ffmpeg = (args, log) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  fs.appendFileSync(log, `$ ffmpeg ${args.join(' ')}\n${r.stdout}${r.stderr}\n`);
  if (r.status !== 0) throw new Error(`ffmpeg failed (exit ${r.status}); see ${log}`);
};

// One cue for the whole film, so a track has its cue whenever it's showing.
const srt = (text) => `1\n00:00:00,000 --> 00:00:${String(SECONDS).padStart(2, '0')},000\n${text}\n`;

// The media folder to point MEDIA_DIR at (it holds only these films' folders), and
// the CODECS the main film's master playlist declares, for the journeys' capability checks.
export function ensureFilms() {
  const key = sha(fs.readFileSync(ENCODER), fs.readFileSync(fileURLToPath(import.meta.url)));
  const mediaDir = path.join(CACHE, `media-${key}`);
  if (!fs.existsSync(mediaDir)) build(mediaDir);
  const master = fs.readFileSync(path.join(mediaDir, FILMS.main.slug, 'hls', 'master.m3u8'), 'utf8');
  const codecs = /CODECS="([^"]+)"/.exec(master)?.[1].split(',') ?? [];
  return { mediaDir, codecs };
}

// A project's copy of a film: a folder and a title of its own. The title has nothing
// a regular expression would read as more than itself, since journeys match on it.
export const copyFor = (film, project) => ({ slug: `${film.slug}-${project}`, title: `${film.title}, ${project}` });

// The media folder for one run: for each browser project, a copy of each cached film
// under the copy's own slug and title. Real copies, not links: the server serves
// nothing that leads out of a film's folder. Returns { project: { main: { slug, title }, … } }.
export function copyFilms(cachedMediaDir, mediaDir, projects) {
  const copies = {};
  for (const project of projects) {
    copies[project] = {};
    for (const [key, film] of Object.entries(FILMS)) {
      const copy = copyFor(film, project);
      const dir = path.join(mediaDir, copy.slug);
      fs.cpSync(path.join(cachedMediaDir, film.slug), dir, { recursive: true });
      const jsonPath = path.join(dir, 'film.json');
      const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (json.slug != null) json.slug = copy.slug;
      json.title = copy.title;
      fs.writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);
      copies[project][key] = copy;
    }
  }
  return copies;
}

function build(mediaDir) {
  fs.mkdirSync(CACHE, { recursive: true });
  // Built in a scratch folder, then moved into place, so an interrupted build is
  // never mistaken for a finished one.
  const work = fs.mkdtempSync(path.join(CACHE, 'build-'));
  const log = path.join(work, 'build.log');
  try {
    const media = path.join(work, 'media');
    for (const film of Object.values(FILMS)) encodeFilm(film, path.join(work, film.slug), path.join(media, film.slug), log);
    fs.renameSync(media, mediaDir);
    // Older fixtures, from an earlier encoder or recipe.
    for (const name of fs.readdirSync(CACHE)) {
      const old = path.join(CACHE, name);
      if (/^(film|media)-/.test(name) && old !== mediaDir) fs.rmSync(old, { recursive: true, force: true });
    }
    fs.rmSync(work, { recursive: true, force: true });
  } catch (err) {
    err.message += ` (work folder kept: ${work})`;
    throw err;
  }
}

function encodeFilm(film, scratch, out, log) {
  fs.mkdirSync(scratch, { recursive: true });
  const d = String(SECONDS);
  const subs = film.subtitles.map((s, i) => {
    const file = path.join(scratch, `${i}.srt`);
    fs.writeFileSync(file, srt(s.text));
    return file;
  });
  const source = path.join(scratch, 'source.mkv');
  ffmpeg(
    [
      '-f', 'lavfi', '-i', `${film.pattern}=size=640x360:rate=24:duration=${d}`,
      ...film.tones.flatMap((hz) => ['-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=48000:duration=${d}`]),
      ...subs.flatMap((file) => ['-i', file]),
      '-map', '0:v',
      ...film.tones.flatMap((_, i) => ['-map', `${i + 1}:a`]),
      ...subs.flatMap((_, i) => ['-map', `${i + 1 + film.tones.length}:s`]),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-c:s', 'srt',
      '-metadata', `title=${film.title}`,
      ...film.subtitles.flatMap((s, i) => [
        `-metadata:s:s:${i}`, `language=${s.lang}`,
        // The encoder reads the forced flag, and names and marks the track by it.
        `-disposition:s:${i}`, s.forced ? 'forced' : '0',
      ]),
      source,
    ],
    log,
  );

  fs.mkdirSync(out, { recursive: true });
  // A poster before encoding, so the encoder lists it in film.json.
  ffmpeg(['-ss', '2', '-i', source, '-frames:v', '1', '-vf', 'scale=240:360:force_original_aspect_ratio=increase,crop=240:360', path.join(out, 'poster.jpg')], log);

  const encode = spawnSync(
    process.execPath,
    [ENCODER, source, out, '--ladder', '480:h264', '--audio', film.audio, '--subs', '--preset', 'veryfast'],
    { encoding: 'utf8', cwd: ROOT },
  );
  fs.appendFileSync(log, `$ node scripts/encode.mjs (${film.slug})\n${encode.stdout}${encode.stderr}\n`);
  if (encode.status !== 0) throw new Error(`scripts/encode.mjs failed for ${film.slug} (exit ${encode.status}); see ${log}`);

  const jsonPath = path.join(out, 'film.json');
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  Object.assign(json, {
    title: film.title,
    year: 2026,
    synopsis: film.synopsis,
    recommendation: 'Made by the browser journeys. Watch it with the sound on.',
  });
  film.edit?.(json);
  fs.writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);
}
