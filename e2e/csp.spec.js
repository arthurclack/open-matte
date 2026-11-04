// The pages' Content-Security-Policy (server/csp.js), in real browsers. Every journey
// already fails on anything the policy blocks (fixtures.js); these cover what the
// others don't reach: the cinema's colours saved in Settings and shown to a viewer,
// TMDB's thumbnails in Find details, each way from a viewer's page into the admin
// loading it as a page of its own, the empty subtitle tracks hls.js makes, how
// hls.js runs under the policy, files opened in a tab of their own, and a blocked
// request reaching the server's log. Every browser, but for how hls.js runs
// (chromium only).
import fs from 'node:fs';
import { THUMBNAIL_QUERY } from './tmdb.js';
import { NO_SNAPSHOTS, admin, exclusively, expect, film, media, playButton, playbackSupport, signInAsAdmin, signedInPerson, test, unique } from './fixtures.js';

test.use(NO_SNAPSHOTS);

const DEFAULT_COLORS = { accentColor: '#e8b04a', backgroundColor: '#0d0c0f' };
// Through the admin API, so Settings' form starts from them and can save.
const defaultColors = () => admin.patch('/api/admin/settings', DEFAULT_COLORS);

const asAdmin = async (context, baseURL) => {
  const value = process.env.E2E_ADMIN_COOKIE.split('; ').find((c) => c.startsWith('om_admin=')).slice('om_admin='.length);
  await context.addCookies([{ name: 'om_admin', value, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
};

// The colours a page is drawn in: the theme's own two, and the page's background as drawn.
const drawn = (page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return { accent: root.getPropertyValue('--accent').trim(), bg: root.getPropertyValue('--bg').trim(), body: getComputedStyle(document.body).backgroundColor };
  });

const hexToRgb = (hex) => `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

// The img-src a page was sent with.
const policyOf = (res) => res.headers()['content-security-policy'].split('; ').find((d) => d.startsWith('img-src '));
// The admin's, which adds the stand-in for TMDB's image server (tmdb.js).
const ADMIN_IMAGES = /^img-src 'self' http:\/\/127\.0\.0\.1:\d+$/;
// The next page this tab loads at `pathname`: a page of its own, not a move within
// the one it has, which would keep that page's policy.
const loadOf = (page, pathname) => page.waitForResponse((r) => new URL(r.url()).pathname === pathname && r.request().resourceType() === 'document', { timeout: 10_000 });

// The passkey made by signedInPerson (test/softauth.js), answering in this context's
// pages as the person's device would. In every browser: passkeys.spec.js has the
// virtual authenticators only Chromium offers.
async function answerPasskeys(context, auth) {
  await context.exposeFunction('e2ePasskey', (challenge) => auth.get({ challenge }));
  await context.addInitScript(() => {
    // Only a secure page has passkeys: not about:blank, which a new page starts on.
    if (!navigator.credentials) return;
    const bytes = (s) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0)).buffer;
    const text = (b) => btoa(String.fromCharCode(...new Uint8Array(ArrayBuffer.isView(b) ? b.buffer : b))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    navigator.credentials.get = async ({ publicKey }) => {
      const c = await window.e2ePasskey(text(publicKey.challenge));
      const { clientDataJSON, authenticatorData, signature, userHandle } = c.response;
      return {
        id: c.id,
        rawId: bytes(c.rawId),
        type: c.type,
        authenticatorAttachment: c.authenticatorAttachment,
        getClientExtensionResults: () => ({}),
        response: { clientDataJSON: bytes(clientDataJSON), authenticatorData: bytes(authenticatorData), signature: bytes(signature), userHandle: userHandle ? bytes(userHandle) : undefined },
      };
    };
  });
}

// Find details for the test film, from its page in the admin: TMDB's thumbnail, drawn.
async function findThumbnail(page, baseURL) {
  await page.getByRole('button', { name: /^(Find details|Change match)…$/ }).click();
  const search = page.locator('form').filter({ has: page.getByRole('button', { name: 'Search TMDB' }) });
  await search.getByRole('textbox', { name: 'Title' }).fill(THUMBNAIL_QUERY);
  await search.getByRole('button', { name: 'Search TMDB' }).click();
  await expect(page.getByText('A Stand-in Thumbnail')).toBeVisible();
  const thumb = page.locator('img[src*="/e2e-poster.png"]');
  await expect(thumb).toHaveCount(1);
  // From another origin than the page's (the stand-in's 127.0.0.1 against localhost),
  // as TMDB's is, and drawn.
  const src = new URL(await thumb.getAttribute('src'));
  expect(src.origin).not.toBe(new URL(baseURL).origin);
  await expect.poll(() => thumb.evaluate((img) => img.complete && img.naturalWidth)).toBe(2);
  await search.getByRole('button', { name: 'Cancel' }).click();
}

test("the cinema's colours, saved in Settings, show in the admin at once and on a viewer's page", async ({ page, newContext }, testInfo) => {
  // Two pairs, so the second save changes the style the server wrote.
  const first = { accent: '#4ab0e8', bg: '#0b1016' };
  const second = { accent: '#7fd18b', bg: '#100b14' };
  const ticket = await admin.issueTicket({ label: unique('Colours', testInfo) });

  // Every browser shares the cinema's colours: one of these at a time.
  await exclusively('colours', async () => {
    await defaultColors();
    try {
      await test.step('signed in to Settings, with no colours of the cinema written into the page', async () => {
        await page.goto('/admin/settings');
        await signInAsAdmin(page, () => page.getByRole('button', { name: 'Sign in' }).click());
        await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
        // An empty one, for the colours once they're saved. They go into this style,
        // which the policy allows by its hash.
        expect(await page.locator('style#theme').evaluate((el) => el.textContent)).toBe(':root{}');
      });

      const save = async ({ accent, bg }) => {
        await page.getByRole('textbox', { name: 'Accent, as #rrggbb' }).fill(accent);
        await page.getByRole('textbox', { name: 'Background, as #rrggbb' }).fill(bg);
        // The preview, before saving.
        await expect.poll(() => drawn(page)).toMatchObject({ accent, bg });
        await page.getByRole('button', { name: 'Save colours' }).click();
        await expect(page.getByText('Colours saved.', { exact: true })).toBeVisible();
        // Once the preview has gone, the page keeps them.
        await expect.poll(() => page.evaluate(() => document.documentElement.style.length)).toBe(0);
        await expect.poll(() => drawn(page)).toEqual({ accent, bg, body: hexToRgb(bg) });
      };

      await test.step('the first colours, saved, stay on the page and on the next admin page', async () => {
        await save(first);
        await page.getByRole('link', { name: 'Films', exact: true }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Films' })).toBeVisible();
        expect(await drawn(page)).toEqual({ ...first, body: hexToRgb(first.bg) });
      });

      await test.step("a viewer's page is drawn in them, from the style the server wrote", async () => {
        const viewer = await (await newContext()).newPage();
        const answer = viewer.waitForResponse((r) => new URL(r.url()).pathname === `/t/${ticket.code}`);
        await viewer.goto(`/t/${ticket.code}`);
        expect((await answer).headers()['content-security-policy']).toMatch(/style-src 'self' 'sha256-[A-Za-z0-9+/]+=*'/);
        await expect(viewer.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
        await expect(viewer.locator('style#theme')).toHaveCount(1);
        expect(await drawn(viewer)).toEqual({ ...first, body: hexToRgb(first.bg) });
        // And the button that takes the accent.
        expect(await playButton(viewer).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(hexToRgb(first.accent));
      });

      await test.step('reloaded, the admin has the server’s style; saving again changes it in place', async () => {
        await page.goto('/admin/settings');
        await expect(page.locator('style#theme')).toHaveCount(1);
        expect(await drawn(page)).toEqual({ ...first, body: hexToRgb(first.bg) });
        await save(second);
        await page.reload();
        expect(await drawn(page)).toEqual({ ...second, body: hexToRgb(second.bg) });
      });

      await test.step("back to Open Matte's colours", async () => {
        await page.getByRole('button', { name: "Back to Open Matte's colours" }).click();
        await page.getByRole('button', { name: 'Save colours' }).click();
        await expect(page.getByText('Colours saved.', { exact: true })).toBeVisible();
        await expect.poll(() => drawn(page)).toEqual({ accent: DEFAULT_COLORS.accentColor, bg: DEFAULT_COLORS.backgroundColor, body: hexToRgb(DEFAULT_COLORS.backgroundColor) });
      });
    } finally {
      await defaultColors();
    }
  });
});

test("only the admin's pages allow TMDB's image server, and signing in on the way to the admin loads it as a page of its own", async ({ page, context, baseURL, newContext }, testInfo) => {
  // The viewers' pages, as the server sends them.
  const ticket = await admin.issueTicket({ label: unique('Images', testInfo) });
  for (const url of ['/', `/${film.slug}`, `/t/${ticket.code}`, '/signin']) expect(policyOf(await page.request.get(url)), url).toBe("img-src 'self'");

  const next = `/admin/films/${film.id}`;
  const { cookie, auth } = await signedInPerson(unique('Images', testInfo));

  await test.step('signed in already: Continue loads the admin, with its own policy', async () => {
    // Someone signed in, who is also the admin, sent to sign in on the way to a film's
    // page in the admin.
    await context.addCookies([cookie]);
    await asAdmin(context, baseURL);
    await page.goto(`/signin?next=${encodeURIComponent(next)}`);
    const loaded = loadOf(page, next);
    await page.getByRole('link', { name: 'Continue' }).click();
    expect(policyOf(await loaded)).toMatch(ADMIN_IMAGES);
    await expect(page).toHaveURL((url) => url.pathname === next);
  });

  await test.step('signing in with a passkey on the way loads it too', async () => {
    // The same person and admin, in a browser they aren't signed in to yet.
    const other = await newContext();
    await asAdmin(other, baseURL);
    await answerPasskeys(other, auth);
    const signingIn = await other.newPage();
    await signingIn.goto(`/signin?next=${encodeURIComponent(next)}`);
    const loaded = loadOf(signingIn, next);
    await signingIn.getByRole('button', { name: 'Sign in with a passkey' }).click();
    expect(policyOf(await loaded)).toMatch(ADMIN_IMAGES);
    await expect(signingIn).toHaveURL((url) => url.pathname === next);
    await expect(signingIn.getByRole('button', { name: /^(Find details|Change match)…$/ })).toBeVisible();
  });
});

test("the header's Admin button loads the admin as a page of its own, so Find details shows TMDB's thumbnails", async ({ page, context, baseURL }) => {
  // The usual way in: the admin, looking at the viewers' site.
  await asAdmin(context, baseURL);
  await page.goto('/');
  const loaded = loadOf(page, '/admin');
  await page.locator('header').getByRole('link', { name: 'Admin' }).click();
  expect(policyOf(await loaded)).toMatch(ADMIN_IMAGES);
  // On through the admin, within that page: the guard fails the test on a blocked
  // thumbnail.
  await page.locator(`a[href="/admin/films/${film.id}"]`).first().click();
  await findThumbnail(page, baseURL);
});

test("Find details shows TMDB's thumbnails, from TMDB's image server", async ({ page, context, baseURL }) => {
  await asAdmin(context, baseURL);
  await page.goto(`/admin/films/${film.id}`);
  await findThumbnail(page, baseURL);
});

test('the empty subtitle tracks hls.js makes for itself load under the policy', async ({ page }, testInfo) => {
  // hls.js gives each text track it makes (captions carried in the video, subtitles
  // listed in the playlist, timed metadata) the address data:,WEBVTT. The test films
  // have none, so this makes one as hls.js does, on the film page under its policy.
  const ticket = await admin.issueTicket({ label: unique('Tracks', testInfo) });
  await page.goto(`/t/${ticket.code}`);
  await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
  const state = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const video = document.createElement('video');
        const track = document.createElement('track');
        track.kind = 'captions';
        track.label = 'hls.js';
        track.src = 'data:,WEBVTT';
        track.track.mode = 'hidden';
        video.appendChild(track);
        document.body.appendChild(video);
        track.addEventListener('load', () => resolve('loaded'));
        track.addEventListener('error', () => resolve('error'));
        setTimeout(() => resolve(`readyState ${track.readyState}`), 5000);
      }),
  );
  expect(state).toBe('loaded');
});

test('hls.js plays the film under the policy, through Media Source, without a worker', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'checks how hls.js runs, which is the same code in every browser that uses it');
  // Every worker the page starts, and the address it starts it from.
  await page.addInitScript(() => {
    window.__workers = [];
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(url, options) {
        window.__workers.push(String(url).split(':')[0]);
        super(url, options);
      }
    };
  });
  const ticket = await admin.issueTicket({ label: unique('Worker', testInfo) });
  await page.goto(`/t/${ticket.code}`);
  const support = await playbackSupport(page);
  test.skip(!support.canPlay, support.why);
  await playButton(page).click();
  await media.playedPast(page, 2);
  expect(await media.engine(page)).toBe('hls');
  // The ES module build of hls.js, which Vite bundles, has no worker of its own to
  // start (it only can when given workerPath): it reads the segments in the page. The
  // policy allows no worker, so one started from a blob: address would be refused,
  // and found by the guard, if a newer hls.js began to.
  expect(await page.evaluate(() => window.__workers)).toEqual([]);
});

test("a poster and the licences opened in a tab of their own: the browser's own page for them, with nothing blocked", async ({ page }, testInfo) => {
  // They get the policy for everything that isn't a page, which leaves the browser's
  // own page for an image or a text file the styles it gives itself.
  const ticket = await admin.issueTicket({ label: unique('Files', testInfo) });
  await page.goto(`/t/${ticket.code}`);
  await expect(page.getByRole('heading', { level: 1, name: film.title })).toBeVisible();
  const poster = await page.locator('img.poster').first().getAttribute('src');
  await page.goto(poster);
  await expect.poll(() => page.evaluate(() => document.images[0]?.complete && document.images[0].naturalWidth)).toBeGreaterThan(0);

  await page.goto('/');
  await page.getByRole('link', { name: 'Licences' }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/third-party-licenses.txt');
  await expect(page.locator('body')).toContainText('The web app this site sends to your browser is Open Matte.');
});

test('what a page blocks reaches the server log, as one short line', async ({ page, pageErrors }, testInfo) => {
  // A host of this browser's own: the log says each blocked origin once a minute.
  const host = `blocked-${testInfo.project.name}.invalid`;
  const log = process.env.E2E_SERVER_LOG;
  await page.goto('/');
  await page.evaluate((src) => {
    const img = new Image();
    img.src = src;
    document.body.appendChild(img);
  }, `http://${host}/pixel.png?t=secret`);
  // With the browser that sent it, in the account page's words.
  const line = new RegExp(`^CSP blocked img-src http://${host.replaceAll('.', '\\.')} on / \\((Chrome|Firefox|Safari) on [A-Za-z]+\\)$`);
  await expect.poll(() => fs.readFileSync(log, 'utf8').split('\n').filter((l) => l.includes(host)), { message: 'the report is in the server log' }).toEqual([expect.stringMatching(line)]);
  // The guard saw it too: this one was meant.
  await expect.poll(() => pageErrors.csp.filter((l) => l.includes(host)).length).toBe(1);
  pageErrors.csp.splice(0, Infinity, ...pageErrors.csp.filter((l) => !l.includes(host)));
  pageErrors.cspConsole.splice(0, Infinity, ...pageErrors.cspConsole.filter((m) => !m.line.includes(host)));
});
