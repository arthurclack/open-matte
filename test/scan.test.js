// The import contract: film.json validation, per-film errors, and rescans
// that keep admin edits.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ADMIN_PASSWORD, makeFilm, tempDir, writeFilmJson } from './helpers.js';

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

test('symlinks are fine inside the folder and an error when they lead out of it', () => {
  const { mediaDir, dir } = fresh();
  // A poster linked to another file in the folder is fine.
  fs.renameSync(path.join(dir, 'poster.jpg'), path.join(dir, 'poster-original.jpg'));
  fs.symlinkSync(path.join(dir, 'poster-original.jpg'), path.join(dir, 'poster.jpg'));
  assert.deepEqual(inspectFilm(dir, 'arrival').errors, []);

  // An audio rendition and a subtitle file kept elsewhere and linked in are not:
  // the server would refuse to serve them.
  const shared = path.join(mediaDir, '_shared');
  fs.mkdirSync(shared);
  fs.renameSync(path.join(dir, 'hls', 'a_fr'), path.join(shared, 'a_fr'));
  fs.symlinkSync(path.join(shared, 'a_fr'), path.join(dir, 'hls', 'a_fr'));
  fs.renameSync(path.join(dir, 'subtitles', 'en.vtt'), path.join(shared, 'en.vtt'));
  fs.symlinkSync(path.join(shared, 'en.vtt'), path.join(dir, 'subtitles', 'en.vtt'));
  const r = inspectFilm(dir, 'arrival');
  assert.equal(r.status, 'error');
  assert.ok(r.errors.some((e) => /Audio "French": hls\/a_fr\/index.m3u8 is a symlink to somewhere outside/.test(e)), r.errors.join('\n'));
  assert.ok(r.errors.some((e) => /subtitles\[0\].file: "subtitles\/en.vtt" is a symlink to somewhere outside/.test(e)), r.errors.join('\n'));
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

test('a conflict found by the scan at startup is named in the server log, without its values', async () => {
  const { mediaDir, dir } = fresh();
  const dataDir = tempDir();
  const db = openDb(path.join(dataDir, 'open-matte.db'));
  await scanMedia(db, mediaDir);
  db.prepare("UPDATE films SET recommendation = 'My own words.' WHERE slug = 'arrival'").run();
  db.close();
  // Changed while the server was down, say just before a deploy.
  writeFilmJson(dir, { recommendation: 'Changed in the file.' });

  const env = { ...process.env, PORT: '0', DATA_DIR: dataDir, MEDIA_DIR: mediaDir, BACKUP_DIR: 'off', TMDB_API_KEY: '', ADMIN_PASSWORD };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_ENV;
  const server = spawn(process.execPath, [fileURLToPath(new URL('../server/index.js', import.meta.url))], { env });
  let out = '';
  server.stdout.on('data', (d) => (out += d));
  server.stderr.on('data', (d) => (out += d));
  const exited = new Promise((resolve) => server.once('close', resolve));
  // Stop it once both lines are out (stdout and stderr arrive separately), or
  // after 10 seconds whatever happened.
  const giveUp = setTimeout(() => server.kill('SIGKILL'), 10000);
  const watch = setInterval(() => {
    if (/Media scan: \d+ film folder/.test(out) && /Media scan: arrival:/.test(out)) server.kill('SIGTERM');
  }, 50);
  await exited;
  clearTimeout(giveUp);
  clearInterval(watch);

  assert.match(out, /Media scan: 1 film folder/);
  assert.match(out, /Media scan: arrival: film\.json changed recommendation, which you've edited in the admin, so your version was kept/);
  assert.ok(!out.includes('My own words.') && !out.includes('Changed in the file.'), 'the values stay out of the log');
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

test('a folder with neither film.json nor a master playlist is skipped, not added as a film', async () => {
  const { mediaDir, dir } = fresh();
  // Somewhere to stage uploads.
  fs.mkdirSync(path.join(mediaDir, 'incoming'));
  fs.writeFileSync(path.join(mediaDir, 'incoming', 'Some.Film.2019.mkv'), 'half a film');
  const db = openDb(':memory:');
  const report = await scanMedia(db, mediaDir);
  assert.deepEqual(report.films.map((f) => f.slug), ['arrival']);
  assert.deepEqual(report.skipped.map((s) => s.name), ['incoming']);
  assert.match(report.skipped[0].reason, /no film\.json or hls\/master\.m3u8/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM films WHERE slug = 'incoming'").get().n, 0, 'no film row, so nothing to look up on TMDb');

  // A film whose folder has been emptied (an upload starting over, say) is still reported as broken.
  fs.rmSync(path.join(dir, 'film.json'));
  fs.rmSync(path.join(dir, 'hls'), { recursive: true });
  const again = await scanMedia(db, mediaDir);
  const arrival = again.films.find((f) => f.slug === 'arrival');
  assert.equal(arrival.status, 'error');
  assert.match(arrival.errors[0], /film\.json is missing/);
});

test('a film folder that is a symlink is skipped with a reason', async () => {
  const { mediaDir, dir } = fresh();
  const elsewhere = tempDir();
  makeFilm(elsewhere, 'heat');
  fs.symlinkSync(path.join(elsewhere, 'heat'), path.join(mediaDir, 'heat'));
  const db = openDb(':memory:');
  const report = await scanMedia(db, mediaDir);
  assert.deepEqual(report.films.map((f) => f.slug), ['arrival']);
  assert.match(report.skipped.find((s) => s.name === 'heat')?.reason ?? '', /is a symlink\. A film folder must be a real folder/);

  // A film whose folder is replaced by a symlink is marked missing, and says why.
  fs.renameSync(dir, path.join(elsewhere, 'arrival'));
  fs.symlinkSync(path.join(elsewhere, 'arrival'), dir);
  await scanMedia(db, mediaDir);
  const row = db.prepare("SELECT media_status, scan_report FROM films WHERE slug = 'arrival'").get();
  assert.equal(row.media_status, 'missing');
  assert.match(JSON.parse(row.scan_report).errors[0], /can't be used: This is a symlink/);
});

test('a skipped name is told the whole rule: length and first and last characters too', async () => {
  const mediaDir = tempDir();
  for (const slug of ['a'.repeat(64), 'a'.repeat(65), '-arrival', 'arrival-']) makeFilm(mediaDir, slug);
  const report = await scanMedia(openDb(':memory:'), mediaDir);
  assert.deepEqual(report.films.map((f) => f.slug), ['a'.repeat(64)]);
  assert.equal(report.skipped.length, 3);
  for (const s of report.skipped) assert.match(s.reason, /at most 64 of them, starting and ending with a letter or digit/, s.name);
});

test('every unknown film.json field is a warning, even one named like a built-in', () => {
  const { dir } = fresh();
  writeFilmJson(dir, { constructor: 1, toString: 'x', tittle: 'Arrival' });
  const r = inspectFilm(dir, 'arrival');
  for (const key of ['constructor', 'toString', 'tittle']) {
    assert.ok(r.warnings.includes(`film.json: unknown field "${key}" was ignored`), `${key}: ${r.warnings.join('\n')}`);
  }
});

test('a subtitle file that starts with a byte-order mark is still WebVTT', () => {
  const { dir } = fresh();
  const bom = String.fromCharCode(0xfeff);
  fs.writeFileSync(path.join(dir, 'subtitles', 'en.vtt'), `${bom}WEBVTT\n\n00:01.000 --> 00:02.000\nHello\n`);
  const r = inspectFilm(dir, 'arrival');
  assert.deepEqual(r.errors, []);
  assert.equal(r.status, 'ok');
});

// A Mac's disk ignores letter case and the Unicode form of accents; most Linux
// disks don't. The scan says so on both, so a folder checked on a Mac doesn't
// fail later on the server.
test('a file named in film.json with other letter case or accents is caught on any disk', () => {
  const { dir } = fresh();
  fs.renameSync(path.join(dir, 'poster.jpg'), path.join(dir, 'Poster.JPG'));
  // Accents written the other Unicode way from film.json, as Finder may name a file.
  const nfc = 'subtitles/français.vtt'.normalize('NFC');
  fs.renameSync(path.join(dir, 'subtitles', 'en.vtt'), path.join(dir, nfc.normalize('NFD')));
  writeFilmJson(dir, { subtitles: [{ language: 'fr', file: nfc }] });

  const r = inspectFilm(dir, 'arrival');
  const caseBlind = fs.existsSync(path.join(dir, 'poster.jpg'));
  if (caseBlind) {
    assert.equal(r.status, 'warning', r.errors.join('\n'));
    assert.ok(r.warnings.some((w) => w.startsWith('poster: "poster.jpg" is "Poster.JPG" on disk')), r.warnings.join('\n'));
    assert.ok(r.warnings.some((w) => w.startsWith(`subtitles[0].file: "${nfc}" is "${nfc.normalize('NFD')}" on disk`)), r.warnings.join('\n'));
    assert.ok(!r.warnings.some((w) => /isn't listed/.test(w)), 'the file is listed, however its name is written');
    assert.equal(r.media.poster, 'Poster.JPG', 'the real name is kept');
  } else {
    assert.equal(r.status, 'error');
    assert.ok(r.errors.some((e) => e.startsWith('poster: "poster.jpg" does not exist; the folder has "Poster.JPG"')), r.errors.join('\n'));
    assert.ok(r.errors.some((e) => e.startsWith(`subtitles[0].file: "${nfc}" does not exist; the folder has`)), r.errors.join('\n'));
  }
});

test('without film.json, the standard poster is found however its name is cased', () => {
  const { dir } = fresh();
  fs.rmSync(path.join(dir, 'film.json'));
  fs.renameSync(path.join(dir, 'poster.jpg'), path.join(dir, 'Poster.JPG'));
  const r = inspectFilm(dir, 'arrival');
  assert.deepEqual(r.errors, []);
  assert.equal(r.media.poster, 'Poster.JPG');
});
