// Names the import contract checks: film folder names, which become each
// film's address (your-domain/<folder>), and language codes. Shared by the
// scan and scripts/encode.mjs, so both hold them to the same rule.

// Film folders become URLs, so these names are taken.
export const RESERVED_SLUGS = new Set(['admin', 'api', 'media', 't', 'assets', 'signin', 'enroll', 'account', 'tickets', 'about', 'help']);
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
// BCP 47, as HLS and WebVTT want it: "en", "fr-CA", "pt-BR".
export const LANG_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

// The standard poster or backdrop in a folder's listing, spelled as the folder
// spells it: "poster.jpg" if it's there, or else "Poster.JPG", say. A Mac's
// disk finds either when asked for the other; most servers' disks don't.
export function artworkFile(names, base) {
  const wanted = ['jpg', 'jpeg', 'png', 'webp', 'avif'].map((e) => `${base}.${e}`);
  return wanted.find((f) => names.includes(f)) ?? names.find((n) => wanted.includes(n.toLowerCase())) ?? null;
}

// Why a folder name can't be a film's, or null if it can.
export function slugProblem(name) {
  if (!SLUG_RE.test(name)) {
    return 'Folder names must be lowercase letters, digits and hyphens, at most 64 of them, starting and ending with a letter or digit (they become the URL)';
  }
  if (RESERVED_SLUGS.has(name)) return 'This name is reserved for the site itself';
  return null;
}
