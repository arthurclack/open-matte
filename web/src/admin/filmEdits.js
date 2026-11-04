// Which of a film's details count as your edits, for its admin page. Plain
// JavaScript, so the tests can check the rule (test/admin-api.test.js).

// A value TMDB filled in, and you haven't changed since.
export const fromTmdb = (film, key) => film.metaSources?.[key] === 'tmdb';

// Edited here: different from what film.json gave at the last scan, and not from
// TMDB. A field TMDB filled in differs from film.json too (it had nothing there),
// but it isn't an edit, and Reset to film.json leaves it alone: the server skips
// those fields the same way. A value taken from TMDB by hand in place of
// film.json's isn't marked as TMDB's, so it counts as an edit.
export const editedHere = (film, key) =>
  Boolean(film.importedMeta) && String(film[key] ?? '') !== String(film.importedMeta[key] ?? '') && !fromTmdb(film, key);
