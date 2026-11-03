// Media Session's setting: milestone 3, slice 3. Written from docs/milestone-3.md and
// the slice 3 spec, not from the implementation. Lock screens, Control Center and
// Chrome's media controls show the film's title and poster unless the admin switches
// every viewer to the cinema's name only. The player reads which from the site's
// public settings, so it reaches viewers the way the branding does: /api/site,
// /api/me's site, and the copy written into every page.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { adminBrowser, browser, makeFilm, startServer, tempDir } from './helpers.js';

const { DEFAULT_SETTINGS } = await import('../server/settings.js');

const mediaDir = tempDir();
const webDist = tempDir();
// index.html as Vite builds it, near enough: the server writes the site's settings into its head.
const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>Open Matte</title>
    <script type="module" crossorigin src="/assets/index-C_YNhghY.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;
// A code that is well-formed but isn't a ticket.
const UNKNOWN = 'zzzzzzzzzzzzz';
// The home page, a film's page (where the player is) and a ticket's.
const PAGES = ['/', '/arrival', `/t/${UNKNOWN}`];

let srv;
let admin;
let filmId;

before(async () => {
  fs.writeFileSync(path.join(webDist, 'index.html'), TEMPLATE);
  makeFilm(mediaDir, 'arrival');
  srv = await startServer({ mediaDir, webDist });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  [{ id: filmId }] = (await admin.get('/api/admin/films')).data;
  const r = await admin.patch(`/api/admin/films/${filmId}`, { published: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});
after(() => srv.close());

const fresh = () => browser(srv.base);
const settingsRows = () => srv.db.prepare('SELECT key, value FROM settings ORDER BY key').all();

async function save(patch) {
  const r = await admin.patch('/api/admin/settings', patch);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}

// The site's public settings as a page carries them: one JSON <script id="site-data">.
async function siteDataOf(url) {
  const res = await fetch(srv.base + url);
  assert.equal(res.status, 200, url);
  const html = await res.text();
  const found = [...html.matchAll(/<script\b([^>]*)>(.*?)<\/script>/gs)].filter((m) => /\bid="site-data"/.test(m[1]));
  assert.equal(found.length, 1, `${url}: one #site-data`);
  assert.match(found[0][1], /\btype="application\/json"/, url);
  return JSON.parse(found[0][2]);
}

// The setting wherever a viewer's browser (or the admin's Settings page) reads it.
async function everywhere() {
  const out = {
    site: (await fresh().get('/api/site')).data.mediaSessionTitle,
    me: (await fresh().get('/api/me')).data.site.mediaSessionTitle,
    admin: (await admin.get('/api/admin/settings')).data.mediaSessionTitle,
  };
  for (const url of PAGES) out[url] = (await siteDataOf(url)).mediaSessionTitle;
  return out;
}
const all = (value) => ({ site: value, me: value, admin: value, ...Object.fromEntries(PAGES.map((url) => [url, value])) });
// The public settings with this one left out, to see that saving it changes nothing else.
const others = async () => {
  const { mediaSessionTitle, ...rest } = (await fresh().get('/api/site')).data;
  return rest;
};

describe("the film's title and poster on lock screens and media controls", () => {
  test('a new cinema shows them: the setting is on, for every viewer and in Settings', async () => {
    assert.equal(DEFAULT_SETTINGS.mediaSessionTitle, true);
    assert.deepEqual(await everywhere(), all(true));
  });

  test('every page carries it exactly as /api/site does, so the player has it from the first paint', async () => {
    const site = (await fresh().get('/api/site')).data;
    assert.equal(site.mediaSessionTitle, true);
    for (const url of PAGES) assert.deepEqual(await siteDataOf(url), site, url);
  });

  test('only true or false is saved: anything else is refused with a 400, and nothing in that save is written', async () => {
    const values = ['true', 'false', 'yes', 'no', 'on', 'off', '', 0, 1, null, [], {}, [true], { on: true }];
    // Once while it has never been saved, and once after it has been switched off,
    // so a value turned into true or into false would show either way.
    for (const state of [null, false]) {
      if (state !== null) await save({ mediaSessionTitle: state });
      const before = settingsRows();
      for (const value of values) {
        const r = await admin.patch('/api/admin/settings', { cinemaName: 'Never saved', mediaSessionTitle: value });
        assert.equal(r.status, 400, `${state}: ${JSON.stringify(value)}`);
      }
      assert.deepEqual(settingsRows(), before, `${state}: nothing written`);
      assert.deepEqual(await everywhere(), all(state ?? true), `${state}`);
      assert.equal((await fresh().get('/api/site')).data.cinemaName, 'Open Matte');
    }
    await save({ mediaSessionTitle: true });
  });

  test("switched off, every viewer gets the cinema's name only; switched on again, the film's title", async () => {
    const rest = await others();
    assert.equal((await save({ mediaSessionTitle: false })).mediaSessionTitle, false);
    assert.deepEqual(await everywhere(), all(false));
    // Saved on its own, it changes nothing else.
    assert.deepEqual(await others(), rest);
    // A viewer with a ticket gets the same: it's the site's, not the viewer's.
    const ticket = (await admin.post('/api/admin/tickets', { filmId })).data[0];
    const viewer = fresh();
    assert.equal((await viewer.post('/api/tickets/open', { code: ticket.code })).status, 200);
    assert.equal((await viewer.get('/api/me')).data.site.mediaSessionTitle, false);

    assert.equal((await save({ mediaSessionTitle: true })).mediaSessionTitle, true);
    assert.deepEqual(await everywhere(), all(true));
    assert.deepEqual(await others(), rest);
  });

  test('it saves with the rest of the main settings form', async () => {
    const saved = await save({ cinemaName: 'The Rex', poweredBy: false, mediaSessionTitle: false });
    try {
      assert.deepEqual([saved.cinemaName, saved.poweredBy, saved.mediaSessionTitle], ['The Rex', false, false]);
      const site = (await fresh().get('/api/site')).data;
      assert.deepEqual([site.cinemaName, site.poweredBy, site.mediaSessionTitle], ['The Rex', false, false]);
      assert.deepEqual(await everywhere(), all(false));
    } finally {
      await save({ cinemaName: 'Open Matte', poweredBy: true, mediaSessionTitle: true });
    }
  });
});
