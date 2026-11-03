// The browser journeys' film: about eight seconds of test pattern, 640×360,
// H.264 and AAC, with English and French audio and English and French
// subtitles, made into an Open Matte film folder by scripts/encode.mjs itself.
// It's cached in e2e/.cache, keyed by the encoder's source and this file's, so
// a run only encodes again when either changes.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENCODER = path.join(ROOT, 'scripts', 'encode.mjs');
export const CACHE = path.join(ROOT, 'e2e', '.cache');

export const FILM = {
  slug: 'e2e-reel',
  title: 'Lanternfish Test Reel',
  year: 2026,
  seconds: 8,
};

const SUBTITLES = {
  en: { lang: 'eng', text: 'The lanternfish swims at night.' },
  fr: { lang: 'fra', text: 'Le poisson-lanterne nage la nuit.' },
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

// One cue for the whole film, so a track's active cue is there whenever it's showing.
const srt = (text) => `1\n00:00:00,000 --> 00:00:${String(FILM.seconds).padStart(2, '0')},000\n${text}\n`;

// The media folder to point MEDIA_DIR at (it holds only the film's folder), and
// the CODECS the master playlist declares, for the journeys' capability checks.
export function ensureFilm() {
  const key = sha(fs.readFileSync(ENCODER), fs.readFileSync(fileURLToPath(import.meta.url)));
  const mediaDir = path.join(CACHE, `film-${key}`);
  const filmDir = path.join(mediaDir, FILM.slug);
  if (!fs.existsSync(path.join(filmDir, 'film.json'))) build(mediaDir, filmDir);
  const master = fs.readFileSync(path.join(filmDir, 'hls', 'master.m3u8'), 'utf8');
  const codecs = /CODECS="([^"]+)"/.exec(master)?.[1].split(',') ?? [];
  return { mediaDir, filmDir, codecs };
}

function build(mediaDir, filmDir) {
  fs.mkdirSync(CACHE, { recursive: true });
  // Built in a scratch folder, then moved into place, so an interrupted build is
  // never mistaken for a finished one.
  const work = fs.mkdtempSync(path.join(CACHE, 'build-'));
  const log = path.join(work, 'build.log');
  try {
    for (const [code, s] of Object.entries(SUBTITLES)) fs.writeFileSync(path.join(work, `${code}.srt`), srt(s.text));
    const source = path.join(work, 'source.mkv');
    const d = String(FILM.seconds);
    ffmpeg(
      [
        '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=24:duration=${d}`,
        '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${d}`,
        '-f', 'lavfi', '-i', `sine=frequency=660:sample_rate=48000:duration=${d}`,
        '-i', path.join(work, 'en.srt'),
        '-i', path.join(work, 'fr.srt'),
        '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s', '-map', '4:s',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-c:s', 'srt',
        '-metadata', `title=${FILM.title}`,
        '-metadata:s:a:0', `language=${SUBTITLES.en.lang}`,
        '-metadata:s:a:1', `language=${SUBTITLES.fr.lang}`,
        '-metadata:s:s:0', `language=${SUBTITLES.en.lang}`,
        '-metadata:s:s:1', `language=${SUBTITLES.fr.lang}`,
        source,
      ],
      log,
    );

    const out = path.join(work, 'media', FILM.slug);
    fs.mkdirSync(out, { recursive: true });
    // A poster before encoding, so the encoder lists it in film.json.
    ffmpeg(['-ss', '2', '-i', source, '-frames:v', '1', '-vf', 'scale=240:360:force_original_aspect_ratio=increase,crop=240:360', path.join(out, 'poster.jpg')], log);

    const encode = spawnSync(
      process.execPath,
      [ENCODER, source, out, '--ladder', '480:h264', '--audio', '0:en:English,1:fr:French', '--subs', '--preset', 'veryfast'],
      { encoding: 'utf8', cwd: ROOT },
    );
    fs.appendFileSync(log, `$ node scripts/encode.mjs …\n${encode.stdout}${encode.stderr}\n`);
    if (encode.status !== 0) throw new Error(`scripts/encode.mjs failed (exit ${encode.status}); see ${log}`);

    const jsonPath = path.join(out, 'film.json');
    const film = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    Object.assign(film, {
      title: FILM.title,
      year: FILM.year,
      synopsis: 'Eight seconds of test pattern, in two languages.',
      recommendation: 'Made by the browser journeys. Watch it with the sound on.',
    });
    fs.writeFileSync(jsonPath, `${JSON.stringify(film, null, 2)}\n`);

    fs.rmSync(mediaDir, { recursive: true, force: true });
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.renameSync(out, filmDir);
    // Older fixtures, from an earlier encoder or recipe.
    for (const name of fs.readdirSync(CACHE)) {
      const old = path.join(CACHE, name);
      if (name.startsWith('film-') && old !== mediaDir) fs.rmSync(old, { recursive: true, force: true });
    }
    fs.rmSync(work, { recursive: true, force: true });
  } catch (err) {
    err.message += ` (work folder kept: ${work})`;
    throw err;
  }
}
