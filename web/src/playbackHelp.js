// Playback help: what the player and this browser say about playback, as lines a
// viewer can read, or copy and send to whoever runs the cinema. Plain functions
// with no DOM, React or hls.js, so the tests can check them without a browser.
//
// The summary leaves out every address (they contain screening IDs and ticket
// codes), cookies, ticket labels, names, the film's title and the cinema's name.
// Most of that never reaches it: the panel builds `info` from the player and the
// browser only. What does arrive as free text (track labels from the playlist,
// error details, the user agent) is scrubbed on the way out anyway.
//
// info, every field optional:
//   at             when the summary was made (ms since 1970)
//   engine         'native' (Safari's own player), 'hls' (hls.js) or null (none)
//   hlsVersion     hls.js's version, when it's the one playing
//   handedOver     why playback moved from Safari's player to hls.js: 'error' or 'quality'
//   rendition      what's playing: { height, codec, range, bitrate } from hls.js,
//                  or { width, height } from Safari's player
//   quality        the chosen quality: 'Auto' or the pick's label
//   audio          the audio track's label
//   subtitles      the subtitle track's label, or null for Off; while a forced track
//                  shows, "Off (French forced subtitles showing)", by language only
//   screen         { hdr, pixelRatio, width, height }: the video's size as shown
//   buffer         { ahead (seconds), readyState }
//   droppedFrames  { dropped, total }
//   decode         [{ codec, supported }] for each codec the film comes in
//                  (supported: true, false or null when there's no Media Source)
//   nativeHls      what video.canPlayType says about HLS: 'probably', 'maybe' or ''
//   userAgent      navigator.userAgent
//   errors         [{ at, source, detail, fatal, status }], newest last

export const codecName = (c = '') => (/^(hvc1|hev1)/.test(c) ? 'HEVC' : /^avc/.test(c) ? 'H.264' : /^av01/.test(c) ? 'AV1' : c.split('.')[0]);

const REMOVED = '[address removed]';
// Anything with a scheme, and any absolute path of two or more segments (/t/<code>,
// /media/<film>/…), also when it follows a bracket, a quote or an equals sign.
const URLS = /\b(?:https?|blob|data):[^\s]+/gi;
const PATHS = /(^|[\s("'=,;[])\/[^\s]*\/[^\s]*/gm;

export function scrub(text) {
  return String(text ?? '')
    .replace(URLS, REMOVED)
    .replace(PATHS, `$1${REMOVED}`);
}

const READY_STATES = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'];
const HANDOVERS = { error: "took over after Safari's own player stopped", quality: "took over from Safari's own player when a quality was picked" };

const pad = (n) => String(n).padStart(2, '0');
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

// HH:MM:SS on this device's clock.
function clock(at) {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '--:--:--' : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 2026-11-03 14:03:22 UTC+01:00, so it can be matched with the server's logs.
function stamp(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const offset = -d.getTimezoneOffset();
  const zone = `UTC${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock(at)} ${zone}`;
}

// A track's label, given as text or as { label }.
const label = (v) => (v && typeof v === 'object' ? v.label : v);

function player({ engine, hlsVersion, handedOver }) {
  if (engine === 'native') return "Safari's own";
  if (engine === 'hls') {
    const name = hlsVersion ? `hls.js ${hlsVersion}` : 'hls.js';
    return handedOver ? `${name} (${HANDOVERS[handedOver] || "took over from Safari's own player"})` : name;
  }
  return "None (this browser can't play the film)";
}

function rendition(r) {
  if (!r || !(r.height || r.width)) return 'Nothing yet';
  const parts = [r.width && r.height ? `${r.width} × ${r.height}` : `${r.height}p`];
  if (r.codec) parts.push(codecName(r.codec) === r.codec ? r.codec : `${codecName(r.codec)} (${r.codec})`);
  if (r.range) parts.push(r.range === 'SDR' ? 'SDR' : `HDR (${r.range})`);
  if (finite(r.bitrate)) parts.push(`${(r.bitrate / 1e6).toFixed(1)} Mbit/s`);
  return parts.join(' · ');
}

function screen(s) {
  if (!s) return 'Unknown';
  const parts = [s.hdr ? 'HDR' : 'SDR'];
  if (finite(s.pixelRatio)) parts.push(`pixel ratio ${Math.round(s.pixelRatio * 100) / 100}`);
  if (s.width && s.height) parts.push(`video shown at ${Math.round(s.width)} × ${Math.round(s.height)}`);
  return parts.join(' · ');
}

function buffer(b) {
  if (!b) return 'Unknown';
  const parts = [];
  if (finite(b.ahead)) parts.push(`${b.ahead.toFixed(1)} s ahead`);
  if (finite(b.readyState)) parts.push(`readyState ${b.readyState}${READY_STATES[b.readyState] ? ` (${READY_STATES[b.readyState]})` : ''}`);
  return parts.join(' · ') || 'Unknown';
}

function dropped(f) {
  return f && finite(f.dropped) && finite(f.total) ? `${f.dropped} of ${f.total}` : 'Not reported';
}

function decode({ decode: codecs = [], nativeHls }) {
  const yesNo = (v) => (v === true ? 'yes' : v === false ? 'no' : 'unknown');
  const parts = codecs.map(({ codec, supported }) => `${codecName(codec) === codec ? codec : `${codecName(codec)} (${codec})`}: ${yesNo(supported)}`);
  parts.push(`native HLS: ${nativeHls || 'no'}`);
  return parts.join(' · ');
}

function errorLine(e = {}) {
  const flags = [];
  if (e.fatal === true) flags.push('fatal');
  if (e.fatal === false) flags.push('not fatal');
  if (e.status != null) flags.push(`status ${e.status}`);
  return scrub(`${clock(e.at)} ${e.source || 'unknown'} ${e.detail || ''}`.trim() + (flags.length ? ` (${flags.join(', ')})` : ''));
}

// The panel's rows, [label, value], and the problems, one line each. Every value
// is scrubbed, whatever it is.
export function playbackItems(info = {}) {
  const items = [
    ['Player', player(info)],
    ['Playing', rendition(info.rendition)],
    ['Quality', info.quality || 'Auto'],
    ['Audio', label(info.audio) || 'Unknown'],
    ['Subtitles', label(info.subtitles) || 'Off'],
    ['This screen', screen(info.screen)],
    ['Buffer', buffer(info.buffer)],
    ['Dropped frames', dropped(info.droppedFrames)],
    ['This browser can decode', decode(info)],
    ['Browser', info.userAgent || 'Unknown'],
  ];
  return {
    items: items.map(([name, value]) => [name, scrub(value)]),
    errors: (info.errors || []).map(errorLine),
  };
}

// The text Copy summary puts on the clipboard: one `Label: value` line each, the
// problems last.
export function playbackSummary(info = {}) {
  const { items, errors } = playbackItems(info);
  return [
    'Playback summary',
    `Time: ${stamp(info.at ?? Date.now())}`,
    ...items.map(([name, value]) => `${name}: ${value}`),
    errors.length ? 'Recent problems:' : 'Recent problems: None',
    ...errors.map((line) => `  ${line}`),
  ].join('\n');
}
