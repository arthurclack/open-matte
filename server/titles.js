// Film titles from file names, and title comparison for metadata matching.
// Shared by the server and scripts/encode.mjs.

// Tokens that start the technical tail of a release-style name.
const TAIL = /\b(?:2160p|1080[pi]|720p|576p|480p|4k|uhd|hdr10?\+?|dv|bluray|blu-ray|bdrip|brrip|remux|web-?dl|webrip|web|hdtv|dvdrip|dvd|x26[45]|h\.?26[45]|hevc|avc|aac|ac3|dts(?:-hd)?|truehd|atmos|proper|repack|extended|unrated|remastered|criterion|imax)\b/i;
const YEAR = /\b(?:19|20)\d{2}\b/g;

// "Hedwig.and.the.Angry.Inch.2001.1080p.BluRay.x264.DTS-FGT" → { title: "Hedwig and the Angry Inch", year: 2001 }
// "2001 A Space Odyssey (1968)" → { title: "2001 A Space Odyssey", year: 1968 }
export function guessTitleYear(name) {
  let s = String(name)
    .replace(/\.(mkv|mp4|m4v|mov|avi|ts|webm)$/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tail = s.search(TAIL);
  if (tail > 0) s = s.slice(0, tail);
  s = s.replace(/[\s(\-]+$/, '');

  // The year is the last year-like token that isn't the very start of the title.
  let year = null;
  let cut = -1;
  for (const m of s.matchAll(YEAR)) {
    if (m.index > 0) {
      year = Number(m[0]);
      cut = m.index;
    }
  }
  let title = cut > 0 ? s.slice(0, cut) : s;
  title = title.replace(/[\s(\-–]+$/, '').replace(/^\(|\)$/g, '').trim();
  return { title: title || String(name), year };
}

// True for names like "Some.Film.2001.1080p.BluRay.x264" that came from a file
// name rather than from a person.
export function looksLikeReleaseName(title) {
  if (!title) return false;
  return TAIL.test(title) || /\w\.\w+\.\w/.test(title) || /_/.test(title);
}

// For comparing titles: case, accents, punctuation and "&" don't matter.
export function normalizeTitle(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
