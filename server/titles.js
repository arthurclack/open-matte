// Film titles from file names, and title comparison for metadata matching.
// Shared by the server and scripts/encode.mjs.

// Technical tokens that never belong to a real title: resolutions, sources and codecs.
const TECH = /\b(?:2160p|1080[pi]|720p|576p|480p|bluray|blu-ray|bdrip|brrip|remux|web-?dl|webrip|hdtv|dvdrip|x26[45]|h\.?26[45]|hevc|avc|aac|ac3|dts(?:-hd)?|truehd|hdr10\+?)\b/i;
// Words a release name puts after the year, but that real titles use too
// ("Charlotte's Web", "The Avengers: Extended"), so they only count after a year.
const EDITION = /\b(?:4k|uhd|hdr|dv|web|dvd|atmos|proper|repack|extended|unrated|remastered|criterion|imax)\b/i;
const YEAR = /\b(?:19|20)\d{2}\b/g;

// Where the technical tail of a release name starts, or -1 if it has none.
function tailStart(s) {
  const starts = [s.search(TECH)];
  // A year at the very start is part of the title ("2001 A Space Odyssey").
  const year = [...s.matchAll(YEAR)].find((m) => m.index > 0);
  if (year) {
    const edition = s.slice(year.index).search(EDITION);
    if (edition >= 0) starts.push(year.index + edition);
  }
  const found = starts.filter((i) => i >= 0);
  return found.length ? Math.min(...found) : -1;
}

// "Hedwig.and.the.Angry.Inch.2001.1080p.BluRay.x264.DTS-GRP" → { title: "Hedwig and the Angry Inch", year: 2001 }
// "2001 A Space Odyssey (1968)" → { title: "2001 A Space Odyssey", year: 1968 }
export function guessTitleYear(name) {
  let s = String(name)
    .replace(/\.(mkv|mp4|m4v|mov|avi|ts|webm)$/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tail = tailStart(s);
  if (tail > 0) s = s.slice(0, tail);
  s = s.replace(/[\s(-]+$/, '');

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
// name rather than from a person. A plain title with a word such as "Web" or
// "Extended" in it is not one.
export function looksLikeReleaseName(title) {
  if (!title) return false;
  return tailStart(title) >= 0 || /\w\.\w+\.\w/.test(title) || /_/.test(title);
}

// For comparing titles: case, accents, punctuation and "&" don't matter.
export function normalizeTitle(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
