// The import contract: film.json validation, per-film errors, and rescans
// that keep admin edits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { makeFilm, tempDir, writeFilmJson } from './helpers.js';

const { openDb } = await import('../server/db.js');
const { inspectFilm, scanMedia } = await import('../server/scan.js');
const { artworkUrl } = await import('../server/films.js');

function fresh(slug = 'arrival', overrides) {
  const mediaDir = tempDir();
  const dir = makeFilm(mediaDir, slug, overrides);
  return { mediaDir, dir };
}

test('a complete folder passes', () => {
  const { dir } = fresh();
  const r = inspectFilm(dir, 'arrival');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.status, 'ok');
  assert.equal(r.media.variants.length, 2);
  assert.equal(r.media.audio.length, 2);
  assert.equal(r.media.subtitles[0].label, 'English');
});

test('film.json problems are reported as errors on that film', () => {
  const cases = [
    [{ schemaVersion: 2 }, /schemaVersion must be 1/],
    [{ title: '' }, /title is required/],
    [{ slug: 'arrivals' }, /doesn't match the folder name/],
    [{ year: '2016' }, /year must be a whole number/],
    [{ hls: '../other/master.m3u8' }, /must be a path inside the film folder/],
    [{ hls: '/etc/master.m3u8' }, /must be a path inside the film folder/],
    [{ hls: 'hls/missing.m3u8' }, /does not exist/],
    [{ hls: 'hls/v_h264_720/index.m3u8' }, /is a media playlist/],
    [{ poster: 'poster.gif' }, /must end in/],
    [{ subtitles: [{ language: 'english', file: 'subtitles/en.vtt' }] }, /language must be a language code/],
    [{ subtitles: [{ language: 'en', file: 'hls/master.m3u8' }] }, /must end in .vtt/],
  ];
  for (const [patch, pattern] of cases) {
    const { dir } = fresh();
    writeFilmJson(dir, patch);
    const r = inspectFilm(dir, 'arrival');
    assert.equal(r.status, 'error', JSON.stringify(patch));
    assert.ok(r.errors.some((e) => pattern.test(e)), `${JSON.stringify(patch)} → ${JSON.stringify(r.errors)}`);
  }
});

test('a missing or broken film.json is an error, not a crash', () => {
  const { dir } = fresh();
  fs.writeFileSync(path.join(dir, 'film.json'), '{ "schemaVersion": 1, ');
  assert.match(inspectFilm(dir, 'arrival').errors[0], /not valid JSON/);
});

test('without film.json, a standard folder still imports with defaults and a warning', () => {
  const { dir } = fresh();
  fs.rmSync(path.join(dir, 'film.json'));
  const r = inspectFilm(dir, 'arrival');
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /No film.json/.test(w)));
  assert.equal(r.meta.title, 'Arrival');
  assert.equal(r.media.poster, 'poster.jpg');
  assert.equal(r.media.subtitles[0].file, 'subtitles/en.vtt');
  fs.rmSync(path.join(dir, 'hls', 'master.m3u8'));
  assert.match(inspectFilm(dir, 'arrival').errors[0], /film.json is missing/);
});

test('an incomplete upload is caught segment by segment', () => {
  const { dir } = fresh();
  fs.rmSync(path.join(dir, 'hls', 'v_h264_720', 'seg_9.m4s'));
  fs.rmSync(path.join(dir, 'hls', 'a_fr', 'init.mp4'));
  const r = inspectFilm(dir, 'arrival');
  assert.equal(r.status, 'error');
  assert.ok(r.errors.some((e) => /1 of 18 segment files are missing \(first: seg_9.m4s\)/.test(e)), r.errors.join('\n'));
  assert.ok(r.errors.some((e) => /Audio "French".*first: init.mp4/.test(e)), r.errors.join('\n'));
});

test('an unfinished playlist is an error', () => {
  const { dir } = fresh();
  const p = path.join(dir, 'hls', 'v_hevc_1080', 'index.m3u8');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('#EXT-X-ENDLIST', ''));
  assert.ok(inspectFilm(dir, 'arrival').errors.some((e) => /no #EXT-X-ENDLIST/.test(e)));
});

test('missing H.264 SDR fallback and unlisted subtitles are warnings', () => {
  const { dir } = fresh();
  const master = path.join(dir, 'hls', 'master.m3u8');
  const lines = fs.readFileSync(master, 'utf8').split('\n');
  fs.writeFileSync(master, lines.filter((l) => !/avc1|v_h264_720/.test(l)).join('\n'));
  fs.writeFileSync(path.join(dir, 'subtitles', 'de.vtt'), 'WEBVTT\n');
  const r = inspectFilm(dir, 'arrival');
  assert.equal(r.status, 'warning');
  assert.ok(r.warnings.some((w) => /No H.264 SDR rendition/.test(w)));
  assert.ok(r.warnings.some((w) => /subtitles\/de.vtt isn't listed/.test(w)));
});

test('rescans follow film.json for untouched fields and keep admin edits', async () => {
  const { mediaDir, dir } = fresh();
  const db = openDb(':memory:');
  await scanMedia(db, mediaDir);

  // The admin rewrites the recommendation.
  db.prepare("UPDATE films SET recommendation = 'My own words.' WHERE slug = 'arrival'").run();
  // film.json changes the synopsis (untouched in the admin) and the recommendation (edited).
  writeFilmJson(dir, { synopsis: 'New synopsis.', recommendation: 'Changed in the file.' });

  const report = await scanMedia(db, mediaDir);
  const entry = report.films[0];
  assert.deepEqual(entry.updated, ['synopsis']);
  assert.deepEqual(entry.conflicts, [{ field: 'recommendation', kept: 'My own words.', fileValue: 'Changed in the file.' }]);

  const film = db.prepare("SELECT * FROM films WHERE slug = 'arrival'").get();
  assert.equal(film.synopsis, 'New synopsis.');
  assert.equal(film.recommendation, 'My own words.');

  // The conflict is reported once, not on every scan.
  assert.deepEqual((await scanMedia(db, mediaDir)).films[0].conflicts, []);
});

test('a film whose folder disappears is marked missing but kept', async () => {
  const { mediaDir, dir } = fresh();
  makeFilm(mediaDir, 'second-film');
  const db = openDb(':memory:');
  await scanMedia(db, mediaDir);
  fs.rmSync(dir, { recursive: true });
  const report = await scanMedia(db, mediaDir);
  assert.deepEqual(report.removed.map((r) => r.slug), ['arrival']);
  assert.equal(db.prepare("SELECT media_status FROM films WHERE slug = 'arrival'").get().media_status, 'missing');
  assert.equal(db.prepare("SELECT media_status FROM films WHERE slug = 'second-film'").get().media_status, 'ok');
});

test('an empty or unreadable media folder changes nothing (storage not mounted)', async () => {
  const { mediaDir } = fresh();
  const db = openDb(':memory:');
  await scanMedia(db, mediaDir);
  const status = () => db.prepare("SELECT media_status FROM films WHERE slug = 'arrival'").get().media_status;

  // The mount point is there but empty, as when network storage isn't mounted.
  const emptyDir = tempDir();
  const empty = await scanMedia(db, emptyDir);
  assert.match(empty.unavailable, /empty.*may not be mounted.*Nothing was marked missing/);
  assert.deepEqual(empty.removed, []);
  assert.equal(status(), 'ok');

  const gone = await scanMedia(db, path.join(emptyDir, 'nope'));
  assert.equal(gone.unavailable, 'The media folder does not exist');
  assert.equal(status(), 'ok');
});

test('folder names that cannot be URLs are skipped with a reason', async () => {
  const mediaDir = tempDir();
  makeFilm(mediaDir, 'Bad Name');
  makeFilm(mediaDir, 'admin');
  const report = await scanMedia(openDb(':memory:'), mediaDir);
  assert.equal(report.films.length, 0);
  assert.deepEqual(report.skipped.map((s) => s.name).sort(), ['Bad Name', 'admin']);
});

test('poster URLs only change when the image does', async () => {
  const { mediaDir, dir } = fresh();
  const db = openDb(':memory:');
  const posterUrl = () => artworkUrl(db.prepare("SELECT * FROM films WHERE slug = 'arrival'").get(), 'poster');
  await scanMedia(db, mediaDir);
  const first = posterUrl();
  await scanMedia(db, mediaDir);
  assert.equal(posterUrl(), first, 'a rescan keeps the URL, so browsers keep their cached copy');
  fs.writeFileSync(path.join(dir, 'poster.jpg'), 'a different picture, a different size');
  await scanMedia(db, mediaDir);
  assert.notEqual(posterUrl(), first);
});

test('an unchanged film reuses its measured size; adding segments re-measures it', () => {
  const { dir } = fresh();
  const first = inspectFilm(dir, 'arrival');
  assert.ok(first.media.sizeBytes > 0);
  const reused = inspectFilm(dir, 'arrival', { signature: first.media.signature, sizeBytes: 12345 });
  assert.equal(reused.media.sizeBytes, 12345, 'same playlists and folders: the size is taken from the last scan');
  fs.writeFileSync(path.join(dir, 'hls', 'v_h264_720', 'extra.m4s'), 'more');
  const changed = inspectFilm(dir, 'arrival', { signature: first.media.signature, sizeBytes: 12345 });
  assert.notEqual(changed.media.signature, first.media.signature);
  assert.equal(changed.media.sizeBytes, first.media.sizeBytes + 4);
});

test('two scans at once share one pass over the folder', async () => {
  const { mediaDir } = fresh();
  const db = openDb(':memory:');
  const [a, b] = await Promise.all([scanMedia(db, mediaDir), scanMedia(db, mediaDir)]);
  assert.equal(a, b);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM films').get().n, 1);
});

test('a folder that can\'t be read is reported and left as it was, without stopping the scan', async () => {
  const { mediaDir, dir } = fresh();
  makeFilm(mediaDir, 'second-film');
  const db = openDb(':memory:');
  await scanMedia(db, mediaDir);

  const vtt = path.join(dir, 'subtitles', 'en.vtt');
  fs.chmodSync(vtt, 0o000);
  try {
    const report = await scanMedia(db, mediaDir);
    const arrival = report.films.find((f) => f.slug === 'arrival');
    assert.equal(arrival.status, 'error');
    assert.match(arrival.errors[0], /Couldn't read the folder \(EACCES\)\. Nothing was changed/);
    assert.equal(report.films.find((f) => f.slug === 'second-film').status, 'ok', 'the other film was still scanned');
    const row = db.prepare("SELECT media_status FROM films WHERE slug = 'arrival'").get();
    assert.equal(row.media_status, 'ok', 'the film keeps what the last good scan found');
    assert.deepEqual(report.removed, []);
  } finally {
    fs.chmodSync(vtt, 0o644);
  }
});
