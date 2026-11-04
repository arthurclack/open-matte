// Titles from file names, and how titles are compared when matching on TMDb.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { guessTitleYear, looksLikeReleaseName, normalizeTitle } = await import('../server/titles.js');

test('release file names become a title and a year', () => {
  const cases = [
    ['Hedwig.and.the.Angry.Inch.2001.1080p.BluRay.x264.DTS-FGT', 'Hedwig and the Angry Inch', 2001],
    ['Paris.Texas.1984.1080p.BluRay.x264-GRP.mkv', 'Paris Texas', 1984],
    ['2001 A Space Odyssey (1968)', '2001 A Space Odyssey', 1968],
    ['1917.2019.2160p.UHD.BluRay.x265.mkv', '1917', 2019],
    ['Blade.Runner.2049.2017.1080p.mkv', 'Blade Runner 2049', 2017],
    // Words a release name adds after the year are cut there...
    ['The.Lord.of.the.Rings.2001.EXTENDED.1080p.BluRay.x264.mkv', 'The Lord of the Rings', 2001],
    ['Some.Film.2001.PROPER.REPACK.mkv', 'Some Film', 2001],
    // ...but the same words in the title itself are kept.
    ['Charlottes.Web.1973.1080p.BluRay.mkv', 'Charlottes Web', 1973],
    ["Charlotte's.Web.2006.1080p.WEB-DL.mkv", "Charlotte's Web", 2006],
    ['Charlottes.Web.1080p.BluRay.mkv', 'Charlottes Web', null],
    ['The Web', 'The Web', null],
    ['Arrival.mkv', 'Arrival', null],
  ];
  for (const [name, title, year] of cases) assert.deepEqual(guessTitleYear(name), { title, year }, name);
});

test('only names shaped like a release count as file names', () => {
  for (const name of ['Hedwig.and.the.Angry.Inch.2001.1080p.BluRay.x264', 'Some_Film', 'Some Film 1080p', 'Some Film 2001 Extended']) {
    assert.equal(looksLikeReleaseName(name), true, name);
  }
  for (const title of ["Charlotte's Web", 'The Web', 'Web of the Spider', 'Proper Manners', 'IMAX: Hubble 3D', 'The Avengers: Extended', 'Wonder Woman 1984', 'Arrival', '']) {
    assert.equal(looksLikeReleaseName(title), false, title);
  }
});

test('title comparison ignores case, accents, punctuation and "&"', () => {
  assert.equal(normalizeTitle('Amélie'), normalizeTitle('Amelie'));
  assert.equal(normalizeTitle('Amélie'), 'amelie');
  assert.equal(normalizeTitle('Paris, Texas'), normalizeTitle('paris texas'));
  assert.equal(normalizeTitle('Love & Death'), normalizeTitle('Love and Death'));
  assert.notEqual(normalizeTitle('Twins'), normalizeTitle('Twin'));
});
