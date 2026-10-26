#!/usr/bin/env node
// Reference encoder: turns one source file into an Open Matte film folder.
//
//   node scripts/encode.mjs <input> <output-folder> [options]
//
// It writes the folder layout from docs/import-format.md: fMP4 (CMAF) HLS
// renditions under hls/, a master.m3u8 with real CODECS, BANDWIDTH and
// VIDEO-RANGE values, alternate audio renditions, .vtt subtitles from text
// subtitle streams under subtitles/, and a film.json. Run it on your own
// computer, then rsync the folder into the server's media directory.
//
// Options
//   --ladder 2160:hevc:hdr,1080:hevc,1080:h264,720:h264
//                   Renditions as height:codec[:hdr]. Default depends on the source.
//   --audio 1:en:English,2:en:Audio description:ad,1:en:Surround:surround
//                   Audio streams as index:language:name[:ad|:surround].
//                   Index counts audio streams only (0 = first). Default: first stream
//                   as stereo AAC, plus a 5.1 track if it has surround. The first entry
//                   is the default track.
//   --subs          Convert text subtitle streams to subtitles/<lang>.vtt.
//   --hw            Use VideoToolbox on macOS (much faster, bigger files, no HDR).
//   --preset slow   x264/x265 preset (default: medium).
//   --seconds 60    Only encode the first N seconds (for testing).
//   --dry-run       Print the ffmpeg commands without running them.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { guessTitleYear, looksLikeReleaseName } from '../server/titles.js';

const SEGMENT_SECONDS = 6;
const HLS_DIR = 'hls';
const GOP_SECONDS = 2;

// Peak rates cap a quality-targeted (CRF) encode, so simple scenes stay small.
const RUNGS = {
  'hevc:2160': { crf: 20, maxrate: 16000, box: [3840, 2160] },
  'hevc:1440': { crf: 21, maxrate: 10000, box: [2560, 1440] },
  'hevc:1080': { crf: 22, maxrate: 6500, box: [1920, 1080] },
  'hevc:720': { crf: 23, maxrate: 3500, box: [1280, 720] },
  'h264:1080': { crf: 21, maxrate: 8000, box: [1920, 1080] },
  'h264:720': { crf: 22, maxrate: 4500, box: [1280, 720] },
  'h264:480': { crf: 23, maxrate: 2000, box: [854, 480] },
};

// ------------------------------------------------------------------ args

function parseArgs(argv) {
  const opts = { positional: [], preset: 'medium', subs: false, hw: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ladder') opts.ladder = argv[++i];
    else if (a === '--audio') opts.audio = argv[++i];
    else if (a === '--subs') opts.subs = true;
    else if (a === '--hw') opts.hw = true;
    else if (a === '--preset') opts.preset = argv[++i];
    else if (a === '--seconds') opts.seconds = Number(argv[++i]);
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('--')) die(`Unknown option ${a}`);
    else opts.positional.push(a);
  }
  return opts;
}

function die(msg) {
  console.error(`encode: ${msg}`);
  process.exit(1);
}

// ------------------------------------------------------------------ probing

function ffprobe(args) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-of', 'json', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

function hasFilter(name) {
  const out = execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' });
  return new RegExp(`\\s${name}\\s`).test(out);
}

const ratio = (s) => {
  const [a, b] = String(s).split('/').map(Number);
  return b ? a / b : a;
};

// ffmpeg wants HDR10 mastering metadata in x265's G(x,y)B(x,y)R(x,y)WP(x,y)L(max,min) units.
function hdrMetadata(input) {
  const frames = ffprobe(['-select_streams', 'v:0', '-read_intervals', '%+#1', '-show_frames', '-show_entries', 'frame=side_data_list', input]).frames || [];
  const side = frames[0]?.side_data_list || [];
  const md = side.find((s) => /Mastering display/i.test(s.side_data_type));
  const cll = side.find((s) => /Content light level/i.test(s.side_data_type));
  const out = [];
  if (md) {
    const c = (k) => Math.round(ratio(md[k]) * 50000);
    const l = (k) => Math.round(ratio(md[k]) * 10000);
    out.push(`master-display=G(${c('green_x')},${c('green_y')})B(${c('blue_x')},${c('blue_y')})R(${c('red_x')},${c('red_y')})WP(${c('white_point_x')},${c('white_point_y')})L(${l('max_luminance')},${l('min_luminance')})`);
  }
  if (cll) out.push(`max-cll=${cll.max_content},${cll.max_average}`);
  return out;
}

// ------------------------------------------------------------------ plan

function defaultLadder(height, hdr) {
  if (height >= 2000) return hdr ? '2160:hevc:hdr,1080:hevc:hdr,1080:hevc,1080:h264,720:h264' : '2160:hevc,1080:hevc,1080:h264,720:h264';
  if (height >= 1000) return hdr ? '1080:hevc:hdr,1080:hevc,1080:h264,720:h264' : '1080:hevc,1080:h264,720:h264';
  if (height >= 700) return '720:hevc,720:h264,480:h264';
  return '480:h264';
}

function parseLadder(spec, sourceHdr) {
  return spec.split(',').map((item) => {
    const [h, codec, flag] = item.trim().split(':');
    const key = `${codec}:${h}`;
    if (!RUNGS[key]) die(`Unsupported rendition "${item}". Known: ${Object.keys(RUNGS).map((k) => k.split(':').reverse().join(':')).join(', ')}`);
    const hdr = flag === 'hdr';
    if (hdr && codec !== 'hevc') die(`HDR renditions must be HEVC ("${item}")`);
    if (hdr && !sourceHdr) die(`"${item}" asks for HDR but the source is SDR`);
    return { codec, height: Number(h), hdr, ...RUNGS[key], dir: `v_${codec}_${h}${hdr ? '_hdr' : ''}` };
  });
}

function parseAudio(spec, audioStreams) {
  if (!audioStreams.length) return [];
  const first = bcp47(audioStreams[0].tags?.language);
  // Default: stereo for everyone, plus a 5.1 option when the source has surround.
  const items = spec
    ? spec.split(',')
    : [`0:${first}:${languageName(first)}`, ...(audioStreams[0].channels >= 6 ? [`0:${first}:Surround:surround`] : [])];
  return items.map((item, i) => {
    const [idx, lang = 'und', name = languageName(lang), kind = ''] = item.split(':');
    const stream = audioStreams[Number(idx)];
    if (!stream) die(`Audio stream ${idx} does not exist (the source has ${audioStreams.length})`);
    const surround = kind === 'surround';
    if (surround && stream.channels < 6) die(`Audio stream ${idx} has ${stream.channels} channels, not surround`);
    return { index: Number(idx), lang, name, ad: kind === 'ad', surround, default: i === 0, dir: `a_${lang}_${i}` };
  });
}

// Containers usually tag ISO 639-2 codes (eng); HLS and WebVTT want BCP 47 (en).
const ISO639_2 = {
  eng: 'en', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', spa: 'es', ita: 'it', por: 'pt', nld: 'nl', dut: 'nl',
  swe: 'sv', nor: 'no', nob: 'nb', dan: 'da', fin: 'fi', isl: 'is', ice: 'is', pol: 'pl', ces: 'cs', cze: 'cs',
  rus: 'ru', ukr: 'uk', tur: 'tr', ell: 'el', gre: 'el', ara: 'ar', heb: 'he', hin: 'hi', jpn: 'ja', kor: 'ko',
  zho: 'zh', chi: 'zh', tha: 'th', vie: 'vi', ind: 'id', hun: 'hu', ron: 'ro', rum: 'ro', cat: 'ca', gle: 'ga',
};
const bcp47 = (code) => (code ? ISO639_2[code.toLowerCase()] || code.toLowerCase() : 'und');

function languageName(code) {
  if (!code || code === 'und') return 'Original';
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

// ------------------------------------------------------------------ commands

function hlsOutput(outDir, dir) {
  return [
    '-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_playlist_type', 'vod',
    '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', path.join(outDir, HLS_DIR, dir, 'seg_%05d.m4s'),
    path.join(outDir, HLS_DIR, dir, 'index.m3u8'),
  ];
}

function videoCommand({ input, outDir, r, source, opts, hdrParams, tonemapFilter }) {
  const [bw, bh] = r.box;
  const fps = ratio(source.r_frame_rate) || 24;
  const gop = Math.round(fps * GOP_SECONDS);
  const scale = `scale=w='min(iw,${bw})':h='min(ih,${bh})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  const filters = [scale];
  if (source.hdr && !r.hdr) filters.push(tonemapFilter);

  const args = ['-hide_banner', '-y', '-i', input];
  if (opts.seconds) args.push('-t', String(opts.seconds));
  args.push('-map', '0:v:0', '-an', '-sn', '-dn', '-vf', filters.join(','));
  args.push('-force_key_frames', `expr:gte(t,n_forced*${GOP_SECONDS})`);
  const rate = ['-maxrate', `${r.maxrate}k`, '-bufsize', `${r.maxrate * 2}k`];

  if (opts.hw) {
    const enc = r.codec === 'hevc' ? 'hevc_videotoolbox' : 'h264_videotoolbox';
    args.push('-c:v', enc, '-b:v', `${Math.round(r.maxrate * 0.6)}k`, ...rate, '-g', String(gop), '-pix_fmt', 'yuv420p');
    if (r.codec === 'hevc') args.push('-tag:v', 'hvc1');
  } else if (r.codec === 'h264') {
    args.push('-c:v', 'libx264', '-preset', opts.preset, '-profile:v', 'high', '-crf', String(r.crf), ...rate,
      '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-pix_fmt', 'yuv420p');
  } else {
    const x265 = [`keyint=${gop}`, `min-keyint=${gop}`, 'scenecut=0', 'open-gop=0', 'log-level=error'];
    if (r.hdr) {
      const transfer = source.color_transfer === 'arib-std-b67' ? 'arib-std-b67' : 'smpte2084';
      x265.push('hdr10-opt=1', 'repeat-headers=1', 'colorprim=bt2020', `transfer=${transfer}`, 'colormatrix=bt2020nc', ...hdrParams);
      args.push('-pix_fmt', 'yuv420p10le', '-profile:v', 'main10');
    } else {
      args.push('-pix_fmt', 'yuv420p', '-profile:v', 'main');
    }
    args.push('-c:v', 'libx265', '-preset', opts.preset, '-crf', String(r.crf), ...rate, '-tag:v', 'hvc1', '-x265-params', x265.join(':'));
  }
  args.push(...hlsOutput(outDir, r.dir));
  return args;
}

function audioCommand({ input, outDir, a, opts }) {
  const args = ['-hide_banner', '-y', '-i', input];
  if (opts.seconds) args.push('-t', String(opts.seconds));
  args.push('-map', `0:a:${a.index}`, '-vn', '-sn', '-dn', '-c:a', 'aac');
  if (a.surround) args.push('-ac', '6', '-b:a', '384k');
  else args.push('-ac', '2', '-b:a', '160k');
  args.push(...hlsOutput(outDir, a.dir));
  return args;
}

function run(args, dryRun) {
  console.log(`\n$ ffmpeg ${args.map((a) => (/[\s'(),]/.test(a) ? `"${a}"` : a)).join(' ')}`);
  if (dryRun) return;
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-stats', ...args], { stdio: 'inherit' });
  if (r.status !== 0) die(`ffmpeg failed (exit ${r.status})`);
}

// ------------------------------------------------------------------ master playlist

function codecString(stream) {
  if (stream.codec_name === 'h264') {
    const profile = { High: '64', Main: '4d', Baseline: '42', 'Constrained Baseline': '42' }[stream.profile] || '64';
    const constraint = stream.profile === 'Constrained Baseline' ? 'e0' : '00';
    return `avc1.${profile}${constraint}${Number(stream.level).toString(16).padStart(2, '0')}`;
  }
  if (stream.codec_name === 'hevc') {
    return /10/.test(stream.profile) ? `hvc1.2.4.L${stream.level}.B0` : `hvc1.1.6.L${stream.level}.B0`;
  }
  if (stream.codec_name === 'aac') return stream.profile === 'HE-AAC' ? 'mp4a.40.5' : 'mp4a.40.2';
  if (stream.codec_name === 'eac3') return 'ec-3';
  if (stream.codec_name === 'ac3') return 'ac-3';
  return stream.codec_name;
}

// BANDWIDTH must be the peak segment bitrate; AVERAGE-BANDWIDTH the mean.
function measure(outDir, dir) {
  const base = path.join(outDir, HLS_DIR, dir);
  const text = fs.readFileSync(path.join(base, 'index.m3u8'), 'utf8').split('\n');
  let peak = 0;
  let bytes = 0;
  let seconds = 0;
  for (let i = 0; i < text.length; i++) {
    if (!text[i].startsWith('#EXTINF:')) continue;
    const dur = Number.parseFloat(text[i].slice(8));
    const seg = text[i + 1].trim();
    const size = fs.statSync(path.join(base, seg)).size;
    bytes += size;
    seconds += dur;
    if (dur > 0.5) peak = Math.max(peak, (size * 8) / dur);
  }
  const init = fs.statSync(path.join(base, 'init.mp4')).size;
  return { peak: Math.ceil(peak || ((bytes + init) * 8) / seconds), average: Math.ceil(((bytes + init) * 8) / seconds) };
}

function probeOutput(outDir, dir) {
  return ffprobe(['-show_streams', path.join(outDir, HLS_DIR, dir, 'index.m3u8')]).streams[0];
}

function writeMaster({ outDir, videos, audios, fps }) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS', ''];
  let audioCodec = null;
  let audioPeak = 0;
  let audioAvg = 0;
  for (const a of audios) {
    const s = probeOutput(outDir, a.dir);
    const m = measure(outDir, a.dir);
    audioCodec ??= codecString(s);
    audioPeak = Math.max(audioPeak, m.peak);
    audioAvg = Math.max(audioAvg, m.average);
    const attrs = [
      'TYPE=AUDIO', 'GROUP-ID="audio"', `LANGUAGE="${a.lang}"`, `NAME="${a.name}"`,
      `DEFAULT=${a.default ? 'YES' : 'NO'}`, `AUTOSELECT=${a.default || a.ad ? 'YES' : 'NO'}`, `CHANNELS="${s.channels}"`,
    ];
    if (a.ad) attrs.push('CHARACTERISTICS="public.accessibility.describes-video"');
    attrs.push(`URI="${a.dir}/index.m3u8"`);
    lines.push(`#EXT-X-MEDIA:${attrs.join(',')}`);
  }
  if (audios.length) lines.push('');

  // Highest quality first; players sort anyway, but people read this file too.
  const rows = videos.map((r) => {
    const s = probeOutput(outDir, r.dir);
    const m = measure(outDir, r.dir);
    return { r, s, m };
  }).sort((x, y) => y.m.peak - x.m.peak);

  for (const { r, s, m } of rows) {
    const codecs = [codecString(s), audioCodec].filter(Boolean).join(',');
    const range = r.hdr ? (s.color_transfer === 'arib-std-b67' ? 'HLG' : 'PQ') : 'SDR';
    const attrs = [
      `BANDWIDTH=${m.peak + audioPeak}`, `AVERAGE-BANDWIDTH=${m.average + audioAvg}`, `CODECS="${codecs}"`,
      `RESOLUTION=${s.width}x${s.height}`, `FRAME-RATE=${fps.toFixed(3)}`, `VIDEO-RANGE=${range}`,
    ];
    if (audios.length) attrs.push('AUDIO="audio"');
    lines.push(`#EXT-X-STREAM-INF:${attrs.join(',')}`, `${r.dir}/index.m3u8`);
  }
  fs.writeFileSync(path.join(outDir, HLS_DIR, 'master.m3u8'), `${lines.join('\n')}\n`);
}

// Creates film.json, or updates only its media fields if you've already written one.
function writeFilmJson({ outDir, title, year, subtitles, replaceSubtitles }) {
  const jsonPath = path.join(outDir, 'film.json');
  const slug = path.basename(outDir);
  const existing = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : null;
  const film = existing || { schemaVersion: 1, slug, title, year, directors: null, synopsis: null, recommendation: null };
  film.hls = `${HLS_DIR}/master.m3u8`;
  if (replaceSubtitles || !existing) film.subtitles = subtitles;
  for (const [key, base] of [['poster', 'poster'], ['backdrop', 'backdrop']]) {
    const found = ['jpg', 'jpeg', 'png', 'webp', 'avif'].map((e) => `${base}.${e}`).find((f) => fs.existsSync(path.join(outDir, f)));
    if (found && !film[key]) film[key] = found;
  }
  fs.writeFileSync(jsonPath, `${JSON.stringify(film, null, 2)}\n`);
}

// ------------------------------------------------------------------ main

const opts = parseArgs(process.argv.slice(2));
if (opts.help || opts.positional.length !== 2) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 26).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(opts.help ? 0 : 1);
}
const [input, outDir] = opts.positional.map((p) => path.resolve(p));
if (!fs.existsSync(input)) die(`${input} does not exist`);

const probe = ffprobe(['-show_streams', '-show_format', input]);
const videoStream = probe.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
if (!videoStream) die('The source has no video stream');
const audioStreams = probe.streams.filter((s) => s.codec_type === 'audio');
const subStreams = probe.streams.filter((s) => s.codec_type === 'subtitle');

const source = { ...videoStream, hdr: ['smpte2084', 'arib-std-b67'].includes(videoStream.color_transfer) };
const videos = parseLadder(opts.ladder || defaultLadder(videoStream.height, source.hdr), source.hdr);
const audios = parseAudio(opts.audio, audioStreams);

let tonemapFilter = null;
let hdrParams = [];
if (source.hdr) {
  if (opts.hw && videos.some((v) => v.hdr)) die('--hw cannot produce HDR renditions; drop --hw or the :hdr rungs');
  if (videos.some((v) => !v.hdr)) {
    if (!hasFilter('zscale')) {
      die('This is an HDR source and SDR versions need tone mapping, which needs an ffmpeg built with zimg (the zscale filter). Homebrew\'s ffmpeg lacks it; use a static build from https://ffmpeg.org/download.html or the homebrew-ffmpeg tap.');
    }
    tonemapFilter = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
  }
  hdrParams = hdrMetadata(input);
}

console.log(`Source: ${videoStream.width}x${videoStream.height} ${videoStream.codec_name}${source.hdr ? ` HDR (${videoStream.color_transfer})` : ''}, ${audioStreams.length} audio, ${subStreams.length} subtitle stream(s)`);
console.log(`Video: ${videos.map((v) => `${v.height}p ${v.codec}${v.hdr ? ' HDR' : ''}`).join(', ')}`);
console.log(`Audio: ${audios.map((a) => `${a.name} (${a.lang}${a.surround ? ', 5.1' : ''}${a.ad ? ', AD' : ''})`).join(', ') || 'none'}`);

fs.mkdirSync(path.join(outDir, HLS_DIR), { recursive: true });
for (const r of videos) {
  fs.mkdirSync(path.join(outDir, HLS_DIR, r.dir), { recursive: true });
  run(videoCommand({ input, outDir, r, source, opts, hdrParams, tonemapFilter }), opts.dryRun);
}
for (const a of audios) {
  fs.mkdirSync(path.join(outDir, HLS_DIR, a.dir), { recursive: true });
  run(audioCommand({ input, outDir, a, opts }), opts.dryRun);
}

const subtitles = [];
if (opts.subs) {
  const TEXT_SUBS = new Set(['subrip', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);
  fs.mkdirSync(path.join(outDir, 'subtitles'), { recursive: true });
  const used = new Set();
  subStreams.forEach((s, i) => {
    if (!TEXT_SUBS.has(s.codec_name)) {
      console.warn(`Skipping subtitle stream ${i} (${s.codec_name}): image subtitles need OCR first.`);
      return;
    }
    const language = /^[a-z]{2,3}$/i.test(s.tags?.language || '') ? bcp47(s.tags.language) : 'und';
    const forced = Boolean(s.disposition?.forced);
    const sdh = Boolean(s.disposition?.hearing_impaired);
    let name = `${language}${forced ? '.forced' : ''}${sdh ? '.sdh' : ''}`;
    while (used.has(name)) name += '.alt';
    used.add(name);
    const file = `subtitles/${name}.vtt`;
    const args = ['-hide_banner', '-y', '-i', input, '-map', `0:s:${i}`, '-c:s', 'webvtt', path.join(outDir, file)];
    if (opts.seconds) args.splice(4, 0, '-t', String(opts.seconds));
    run(args, opts.dryRun);
    const label = `${languageName(language)}${forced ? ' (forced)' : ''}${sdh ? ' (SDH)' : ''}`;
    subtitles.push({ language, label, file, ...(forced ? { forced: true } : {}) });
  });
}

if (!opts.dryRun) {
  writeMaster({ outDir, videos, audios, fps: ratio(videoStream.r_frame_rate) || 24 });
  // "Hedwig.and.the.Angry.Inch.2001.1080p.BluRay…" becomes "Hedwig and the Angry Inch" (2001).
  // The server can then match it on TMDb and fill in the rest.
  const fromName = guessTitleYear(path.basename(input));
  const tagTitle = probe.format.tags?.title;
  const title = tagTitle && !looksLikeReleaseName(tagTitle) ? tagTitle : fromName.title;
  writeFilmJson({ outDir, title, year: fromName.year, subtitles, replaceSubtitles: opts.subs });
  console.log(`\nDone: ${path.join(outDir, HLS_DIR, 'master.m3u8')}`);
  console.log('Add a poster, fill in film.json, then rsync the folder to the server\'s media directory.');
}
