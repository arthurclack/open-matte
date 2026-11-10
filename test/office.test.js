// The back office in the video shop's look (web/src/admin), the parts without a
// browser: what it reads off the booth for its status line and the attention strip
// on Films (admin/facts.js), and that the words it shows are the shop's (a tape, not
// a ticket; lend, not issue; the shelf, not publishing). See web/src/look/README.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';

// The web app's source isn't in the server's image, where docs/deploying.md runs the
// tests on the server's own Node: there these are skipped, not failed.
const ADMIN = new URL('../web/src/admin/', import.meta.url);
const present = fs.existsSync(new URL('facts.js', ADMIN));
const skip = present ? false : 'web/src is not here (the server image has no web source)';
const facts = present ? await import(new URL('facts.js', ADMIN)) : {};

const HOUR = 3600_000;
const NOW = new Date(2026, 10, 5, 19, 52).getTime();

// A booth's server part, as GET /api/admin/booth gives it (server/booth.js), all well.
const well = () => ({
  media: { readable: true, folders: 6, error: null, lastScan: { at: NOW - HOUR, films: 6, missing: 0 }, dir: '/srv/media' },
  disk: { data: { free: 40e9, total: 64e9, dir: '/data' }, media: { free: 1.1e12, total: 3.6e12, dir: '/srv/media' } },
  backups: { enabled: true, running: false, lastError: null, newest: { at: NOW - 17 * HOUR, name: 'open-matte-2026-11-05.db' }, count: 14, copy: { configured: false } },
  retention: { lastError: null, lastRun: null, settings: null },
  version: { app: '1.1.0' },
});

describe('the status line: whether the server is well (admin/facts.js serverTrouble)', { skip }, () => {
  test('a server whose every check is well has nothing to look at', () => {
    assert.equal(facts.serverTrouble(well(), NOW), 0);
    // Backups turned off, and no off-server copy set up: nothing was asked of them.
    const off = well();
    off.backups = { enabled: false, copy: { configured: false } };
    assert.equal(facts.serverTrouble(off, NOW), 0);
    assert.equal(facts.serverTrouble(null, NOW), 0);
  });

  test('each check that wants a look counts once, as Status shows it', () => {
    const cases = [
      ['the media folder unreadable', (s) => Object.assign(s.media, { readable: false, error: 'permission denied' })],
      ['the data disk nearly full', (s) => Object.assign(s.disk.data, { free: 5e9, total: 64e9 })],
      ['the media disk unknown', (s) => Object.assign(s.disk.media, { error: 'timed out' })],
      ['no backup yet', (s) => Object.assign(s.backups, { newest: null })],
      ['the backup a day and a bit old', (s) => Object.assign(s.backups.newest, { at: NOW - 27 * HOUR })],
      ['the last backup failed', (s) => Object.assign(s.backups, { lastError: { message: 'disk full' } })],
      ['the off-server copy two days old', (s) => Object.assign(s.backups, { copy: { configured: true, newest: { at: NOW - 49 * HOUR, name: 'x.db' } } })],
      ['the off-server copy missing', (s) => Object.assign(s.backups, { copy: { configured: true, newest: null } })],
      ['the clean-up failed', (s) => Object.assign(s.retention, { lastError: 'locked' })],
    ];
    for (const [what, spoil] of cases) {
      const s = well();
      spoil(s);
      assert.equal(facts.serverTrouble(s, NOW), 1, what);
    }
    const all = well();
    for (const [, spoil] of cases.slice(0, 3)) spoil(all);
    assert.equal(facts.serverTrouble(all, NOW), 3);
  });

  test('a recent backup and a copy seen today are well; a tenth of a disk free is low', () => {
    assert.equal(facts.backupLate({ at: NOW - 25 * HOUR }, NOW), false);
    assert.equal(facts.backupLate({ at: NOW - 27 * HOUR }, NOW), true);
    assert.equal(facts.copyOld({ at: NOW - 47 * HOUR }, NOW), false);
    assert.equal(facts.diskLow({ free: 9, total: 100 }), true);
    assert.equal(facts.diskLow({ free: 10, total: 100 }), false);
    assert.equal(facts.diskLow({ free: 10, total: 0 }), false);
  });
});

describe('the attention strip on Films (admin/facts.js attentionLine)', { skip }, () => {
  const quiet = () => ({ links: { waiting: [], expired: [] }, tickets: [], refusals: { total: 0, since: NOW - HOUR } });
  const at = () => '08:12';

  test('says nothing when all is quiet', () => {
    assert.deepEqual(facts.attentionLine(quiet(), at), []);
  });

  test("says each thing in a few words, in tapes, not tickets", () => {
    const a = quiet();
    a.links.waiting = [{ purpose: 'setup' }];
    a.links.expired = [{ purpose: 'recovery' }, { purpose: 'setup' }];
    a.tickets = [{ id: 1 }];
    a.refusals.total = 3;
    assert.deepEqual(facts.attentionLine(a, at), ['1 setup link waiting', '2 links expired unused', "1 tape's start-by date is close", '3 media requests refused since 08:12']);
    a.links.waiting = [{ purpose: 'setup' }, { purpose: 'recovery' }];
    a.tickets = [{ id: 1 }, { id: 2 }];
    a.refusals.total = 1;
    assert.deepEqual(facts.attentionLine(a, at), ['2 links waiting', '2 links expired unused', "2 tapes' start-by dates are close", '1 media request refused since 08:12']);
  });
});

// What the back office shows: the words in its JSX and its sentences in quotes, with
// comments, addresses (/api/admin/tickets) and code left out. 1.1.0's words map:
// ticket → tape, cinema → video shop, issue → lend, revoke → take the tape back,
// publish → put on the shelf, screening → play, Projection booth → Status, Activity
// → Ledger. Routes, API fields and event kinds keep their names (they aren't shown).
describe("the back office's words are the video shop's", { skip }, () => {
  const OLD = /\b(tickets?|cinemas?|screenings?|issued?|issuing|revoked?|revoking|unpublish(?:ed)?|publish(?:ed)?|projection booth|draft)\b/i;
  const shown = (src) => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    const out = [];
    // Text between JSX tags.
    for (const [, text] of code.matchAll(/(?<![=-])>([^<>{};=]*[A-Za-z][^<>{};=]*)</g)) out.push(text.trim());
    // Sentences in quotes: two words or more, and not an address or a class list.
    for (const [, , text] of code.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)) {
      const words = text.replace(/\$\{[^}]*\}/g, ' ');
      if (!/[A-Za-z]+ [A-Za-z]/.test(words) || /^\//.test(text) || /^[a-z0-9 _-]+--?[a-z]/.test(text) || /^(ui|of)-/.test(text)) continue;
      out.push(words.trim());
    }
    return out;
  };

  test('no screen of the back office says ticket, cinema, issue, revoke, publish, screening or projection booth', () => {
    const files = fs.readdirSync(ADMIN).filter((f) => f.endsWith('.jsx'));
    assert.ok(files.length >= 13, files.join(' '));
    const found = [];
    for (const file of files) {
      for (const text of shown(fs.readFileSync(new URL(file, ADMIN), 'utf8'))) if (OLD.test(text)) found.push(`${file}: ${text}`);
    }
    assert.deepEqual(found, []);
  });
});
