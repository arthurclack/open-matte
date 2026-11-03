// What every journey shares: the server's address, the admin API, a guard that
// fails a test on any uncaught error in any of its pages, and small helpers for
// the player and the keyboard.
import { test as base, expect } from '@playwright/test';
import { softAuthenticator } from '../test/softauth.js';

export { expect };

const env = (key) => process.env[key];

// The film global setup published, and the cinema's name it set.
export const film = {
  get id() {
    return Number(env('E2E_FILM_ID'));
  },
  get slug() {
    return env('E2E_FILM_SLUG');
  },
  get title() {
    return env('E2E_FILM_TITLE');
  },
};
export const cinemaName = () => env('E2E_CINEMA_NAME');

// A label no other journey (or browser) will use.
export const unique = (what, testInfo) => `${what} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 7)}`;

// ------------------------------------------------------------ the admin API

async function call(method, url, body, cookie = env('E2E_ADMIN_COOKIE')) {
  const res = await fetch(env('E2E_BASE_URL') + url, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${JSON.stringify(data)}`);
  return { data, res };
}

// As the admin, with the session global setup signed in.
export const admin = {
  post: async (url, body = {}) => (await call('POST', url, body)).data,
  // A ticket for anyone with the link, with no screening limit.
  async issueTicket({ label, claimable = false } = {}) {
    const [ticket] = await admin.post('/api/admin/tickets', { filmId: film.id, label, screeningLimit: null, claimable });
    return ticket;
  },
  revoke: (ticketId) => admin.post(`/api/admin/tickets/${ticketId}/revoke`),
  newPerson: (name) => admin.post('/api/admin/people', { name }),
  // A setup link, <origin>/enroll#<token>.
  setupLink: async (personId) => (await admin.post(`/api/admin/people/${personId}/links`)).link,
};

// The run's admin password, put in a field as typing would put it, but without the
// value passing through a Playwright call: reports and traces keep those calls'
// parameters. Trace snapshots keep form fields' values too, so the journeys that
// use this turn them off (NO_SNAPSHOTS).
export async function enterAdminPassword(page, field) {
  await page.exposeFunction('e2eAdminPassword', () => env('E2E_ADMIN_PASSWORD'));
  await field.evaluate(async (input) => {
    const value = await window.e2eAdminPassword();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
export const NO_SNAPSHOTS = { trace: { mode: 'retain-on-failure', snapshots: false } };

// A person set up and signed in through the API with a software passkey
// (test/softauth.js), for journeys that need someone signed in but aren't about
// passkeys: the viewer cookie to put in a browser context.
export async function signedInPerson(name) {
  const person = await admin.newPerson(name);
  const token = new URL(await admin.setupLink(person.id)).hash.slice(1);
  const auth = softAuthenticator({ origin: env('E2E_BASE_URL') });
  const { data: opts } = await call('POST', '/api/enroll/options', { token }, null);
  const { res } = await call('POST', '/api/enroll/finish', { token, credential: auth.create(opts.options) }, null);
  const session = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('om_session='));
  if (!session) throw new Error('enrolling set no session cookie');
  const cookie = { name: 'om_session', value: session.slice('om_session='.length), url: env('E2E_BASE_URL'), httpOnly: true, sameSite: 'Lax' };
  return { person, cookie };
}

// ------------------------------------------------------------ every page

// Runs in every page before its own scripts.
function initScript() {
  // The messages the player shows when it stops, as they appear: the film page
  // may replace the player with its own page straight after.
  window.__playerMessages = [];
  const note = () => {
    for (const p of document.querySelectorAll('.player-message p')) {
      const text = p.textContent;
      if (text && !window.__playerMessages.includes(text)) window.__playerMessages.push(text);
    }
  };
  new MutationObserver(note).observe(document, { childList: true, subtree: true, characterData: true });

  // What Copy summary puts on the clipboard, readable in every engine without
  // clipboard permissions. Where this can't be replaced, the panel falls back to
  // a text box holding the same text.
  window.__copied = null;
  try {
    if (navigator.clipboard) {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: (text) => {
          window.__copied = String(text);
          return Promise.resolve();
        },
      });
    }
  } catch {
    // the text box it is
  }
}

async function prepare(context, pageErrors) {
  await context.addInitScript(initScript);
  const watch = (page) => page.on('pageerror', (err) => pageErrors.push(`${page.url()}: ${err.message}`));
  context.pages().forEach(watch);
  context.on('page', watch);
}

export const test = base.extend({
  baseURL: async ({}, use) => use(env('E2E_BASE_URL')),

  pageErrors: async ({}, use) => use([]),

  context: async ({ context, pageErrors }, use) => {
    await prepare(context, pageErrors);
    await use(context);
  },

  // Another browser context (another person's browser), closed after the test.
  newContext: async ({ browser, pageErrors }, use) => {
    const made = [];
    await use(async (options = {}) => {
      const context = await browser.newContext({ baseURL: env('E2E_BASE_URL'), viewport: { width: 1280, height: 800 }, ...options });
      made.push(context);
      await prepare(context, pageErrors);
      return context;
    });
    for (const context of made) await context.close();
  },

  // Skips everything when global setup couldn't make the film, and fails any
  // test whose pages threw.
  guard: [
    async ({ pageErrors }, use, testInfo) => {
      testInfo.skip(Boolean(env('E2E_SKIP')), env('E2E_SKIP'));
      await use();
      expect(pageErrors, 'uncaught errors in the page').toEqual([]);
    },
    { auto: true },
  ],
});

// ------------------------------------------------------------ the player

// Whether this browser says it can play the film: through Media Source
// Extensions (hls.js) or its own HLS player (Safari).
export async function playbackSupport(page) {
  const codecs = env('E2E_CODECS').split(',');
  const video = codecs.find((c) => /^(avc|hvc|hev|av01)/.test(c));
  const audio = codecs.find((c) => /^mp4a/.test(c));
  const r = await page.evaluate(
    ([v, a]) => {
      const MS = window.ManagedMediaSource || window.MediaSource;
      const mse = Boolean(MS?.isTypeSupported?.(`video/mp4; codecs="${v}"`) && MS.isTypeSupported(`audio/mp4; codecs="${a}"`));
      const nativeHls = document.createElement('video').canPlayType('application/vnd.apple.mpegurl');
      return { mse, nativeHls };
    },
    [video, audio],
  );
  return {
    ...r,
    canPlay: r.mse || Boolean(r.nativeHls),
    why: `this browser can't play ${video} with ${audio}: Media Source says no and it has no HLS player of its own`,
  };
}

export const media = {
  time: (page) => page.locator('video').evaluate((v) => v.currentTime),
  paused: (page) => page.locator('video').evaluate((v) => v.paused),
  // Waits until the video has played past `seconds`.
  async playedPast(page, seconds) {
    await expect.poll(() => media.time(page), { timeout: 30_000, message: `the video plays past ${seconds} s` }).toBeGreaterThan(seconds);
  },
  // hls.js feeds the video a blob: address; Safari's own player has the playlist's.
  engine: (page) => page.locator('video').evaluate((v) => (v.currentSrc.startsWith('blob:') ? 'hls' : v.currentSrc ? 'native' : null)),
  // Whether this browser has Media Session, and what it shows.
  session: (page) =>
    page.evaluate(() => {
      if (!('mediaSession' in navigator) || typeof window.MediaMetadata !== 'function') return { supported: false };
      const m = navigator.mediaSession.metadata;
      return { supported: true, metadata: m ? { title: m.title, artist: m.artist } : null };
    }),
};

// Progress reports this page sent and how the server answered.
export function heartbeats(page) {
  const seen = [];
  page.on('response', (res) => {
    if (!/\/api\/screenings\/\d+\/heartbeat$/.test(new URL(res.url()).pathname)) return;
    let body = null;
    try {
      body = res.request().postDataJSON();
    } catch {
      // no body
    }
    seen.push({ status: res.status(), playing: body?.playing });
  });
  return seen;
}

// ------------------------------------------------------------ the keyboard

// Safari, out of the box, moves Tab between text fields and menus only: Option-Tab
// reaches buttons and links too (as "Press Tab to highlight each item" would).
// Playwright's WebKit behaves the same.
export const tabKey = (page) => (page.context().browser()?.browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab');

// Presses Tab until `locator` has focus, and returns how many presses it took.
export async function tabTo(page, locator, { key = tabKey(page), max = 40 } = {}) {
  await expect(locator).toBeVisible();
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press(key);
    if (await locator.evaluate((el) => el === document.activeElement)) return i;
  }
  const focused = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120));
  throw new Error(`${max} presses of ${key} never reached ${locator}; focus is on ${focused}`);
}

export const focusedTag = (page) => page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? null);
