// What every journey shares: the server's address, the admin API, a guard that
// fails a test on any uncaught error in any of its pages, and small helpers for
// the player and the keyboard.
import { test as base, expect } from '@playwright/test';
import { softAuthenticator } from '../test/softauth.js';
import { FILMS } from './film.js';

export { expect };

const env = (key) => process.env[key];

// The films global setup published (film.js), and the cinema's name it set.
const published = (key) => {
  const f = () => JSON.parse(env('E2E_FILMS') || '{}')[key] ?? {};
  return {
    get id() {
      return f().id;
    },
    get slug() {
      return f().slug;
    },
    get title() {
      return f().title;
    },
    // Each subtitle track's one cue, in film.json's order.
    cues: FILMS[key].subtitles.map((s) => s.text),
  };
};
export const film = published('main');
export const secondFilm = published('second');
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
  async issueTicket({ label, claimable = false, for: forFilm = film } = {}) {
    const [ticket] = await admin.post('/api/admin/tickets', { filmId: forFilm.id, label, screeningLimit: null, claimable });
    return ticket;
  },
  revoke: (ticketId) => admin.post(`/api/admin/tickets/${ticketId}/revoke`),
  newPerson: (name) => admin.post('/api/admin/people', { name }),
  // A setup link, <origin>/enroll#<token>.
  setupLink: async (personId) => (await admin.post(`/api/admin/people/${personId}/links`)).link,
};

// ------------------------------------------------------------ the admin's password

// Signing in to the admin through its form with the run's password, which must never
// reach the terminal, test-results, a trace or the report. While the password is in the
// form's field, Playwright can copy it out of the page:
// - into a call's log (printed when the call fails, kept in the trace either way) when a
//   locator resolves to the field, since React mirrors the value into a value attribute;
// - into the ARIA snapshot a failing expect() takes of its element or of the whole page,
//   and the one taken of the page as a failed test's browser closes: both hold text
//   fields' values, password fields' too, and error-context.md, the trace and the report
//   keep them;
// - into trace snapshots, which keep form fields' values (NO_SNAPSHOTS turns them off).
// So the password goes into the field without passing through a Playwright call (whose
// parameters reports and traces keep); after that nothing points a locator or expect()
// at the field or waits with expect(); and if the form hasn't gone within the waits,
// the field, and the form state behind it, are cleared before the error is thrown. As a
// failed test's browsers close, every password field in them is cleared too (the
// context fixtures below), for whatever stopped the test mid-sign-in.
//
// `submit` sends the form (a click, or Enter); the field has focus throughout.
export async function signInAsAdmin(page, submit) {
  await page.exposeFunction('e2eAdminPassword', () => env('E2E_ADMIN_PASSWORD'));
  await page.getByLabel('Admin password').evaluate(async (input) => {
    const value = await window.e2eAdminPassword();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  try {
    const answered = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/login', { timeout: 10_000 });
    answered.catch(() => {});
    await submit();
    const res = await answered.catch(() => {
      throw new Error('the admin sign-in form sent nothing within 10 s');
    });
    if (!res.ok()) throw new Error(`the admin sign-in was refused: ${res.status()}`);
    await page.waitForFunction(() => !document.querySelector('input[type=password]'), null, { polling: 100, timeout: 10_000 }).catch(() => {
      throw new Error('the admin sign-in form was still there 10 s after the sign-in was accepted');
    });
  } catch (err) {
    await forgetPasswords(page);
    throw err;
  }
}
export const NO_SNAPSHOTS = { trace: { mode: 'retain-on-failure', snapshots: false } };

// Empties every password field in the page, and the form state behind it, which React
// would otherwise put back the next time it draws the form.
async function forgetPasswords(page) {
  const forget = page
    .evaluate(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      for (const input of document.querySelectorAll('input[type=password]')) {
        setValue.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.removeAttribute('value');
      }
    })
    .catch(() => {});
  // A page that doesn't answer has nothing Playwright can snapshot either.
  await Promise.race([forget, new Promise((resolve) => setTimeout(resolve, 2000))]);
}

// Before a failed test's browser closes: Playwright then writes the first page's ARIA
// snapshot, field values and all, to error-context.md.
async function forgetPasswordsIfFailed(context, testInfo) {
  if (testInfo.errors.length === 0) return;
  for (const page of context.pages()) await forgetPasswords(page);
}

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

// Playwright's WebKit reports every error WebKit logs from JavaScript as an uncaught
// error, and WebKit logs one when it cuts off a request as the page goes, though the
// page handles the failure: "Fetch API cannot load …/heartbeat due to access control
// checks." The player's last progress report, sent as the page goes, can be one. Those
// are noted on the test rather than failing it.
const cutOffAsPageWent = (err) => /^Fetch API cannot load .*\/api\/screenings\/\d+\/heartbeat due to access control checks\.$/.test(`${err.name}:${err.message}`);

async function prepare(context, pageErrors) {
  await context.addInitScript(initScript);
  const watch = (page) =>
    page.on('pageerror', (err) => (cutOffAsPageWent(err) ? pageErrors.cutOff : pageErrors).push(`${page.url()}: ${err.message}`));
  context.pages().forEach(watch);
  context.on('page', watch);
}

export const test = base.extend({
  baseURL: async ({}, use) => use(env('E2E_BASE_URL')),

  pageErrors: async ({}, use) => use(Object.assign([], { cutOff: [] })),

  context: async ({ context, pageErrors }, use, testInfo) => {
    await prepare(context, pageErrors);
    await use(context);
    await forgetPasswordsIfFailed(context, testInfo);
  },

  // Another browser context (another person's browser), closed after the test.
  newContext: async ({ browser, pageErrors }, use, testInfo) => {
    const made = [];
    await use(async (options = {}) => {
      const context = await browser.newContext({ baseURL: env('E2E_BASE_URL'), viewport: { width: 1280, height: 800 }, ...options });
      made.push(context);
      await prepare(context, pageErrors);
      return context;
    });
    for (const context of made) {
      await forgetPasswordsIfFailed(context, testInfo);
      await context.close();
    }
  },

  // Skips everything when global setup couldn't make the films, or a project's
  // browser isn't installed (playwright.config.js), and fails any test whose pages threw.
  guard: [
    async ({ pageErrors }, use, testInfo) => {
      testInfo.skip(Boolean(env('E2E_SKIP')), env('E2E_SKIP'));
      testInfo.skip(Boolean(testInfo.project.metadata.missing), testInfo.project.metadata.missing);
      await use();
      for (const line of pageErrors.cutOff) testInfo.annotations.push({ type: 'request cut off as the page went', description: line });
      expect([...pageErrors], 'uncaught errors in the page').toEqual([]);
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
  // The film's own subtitle files, as the page's <track> elements hold them (Safari
  // can add tracks of its own from the stream): ['English disabled', 'French showing', …].
  subtitleModes: (page) => page.locator('video track').evaluateAll((els) => els.map((el) => `${el.label} ${el.track.mode}`)),
  // The cue of the track that's showing, once it has loaded; null with none showing.
  shownCue: (page) =>
    page.locator('video track').evaluateAll((els) => {
      const shown = els.map((el) => el.track).find((t) => t.mode === 'showing');
      return shown ? (shown.cues?.[0]?.text ?? '') : null;
    }),
  // What this browser remembers for the player (web/src/playerPrefs.js), or null.
  remembered: (page) => page.evaluate(() => JSON.parse(localStorage.getItem('openMatte.player') ?? 'null')),
};

// The film page's Play button, or Resume once a screening is open.
export const playButton = (page) => page.getByRole('button', { name: /^▶ (Play|Resume)/ });

// The language the film is heard in: the player fetches the chosen audio rendition
// (a folder such as a_fr_1), watched from `since` on (mark() gives the place). Safari's
// own player also says which of its audio tracks is on, and that has to agree.
export function audioHeard(page) {
  const fetched = [];
  page.on('response', (res) => {
    const m = /\/hls\/(a_[^/]+)\//.exec(new URL(res.url()).pathname);
    if (m && res.status() === 200) fetched.push(m[1]);
  });
  return {
    mark: () => fetched.length,
    async is({ language, rendition, since = 0 }) {
      await expect.poll(() => fetched.slice(since).includes(rendition), { message: `the ${rendition} audio is fetched` }).toBe(true);
      if ((await media.engine(page)) !== 'native') return;
      await expect
        .poll(() => page.locator('video').evaluate((v) => Array.from(v.audioTracks ?? []).filter((t) => t.enabled).map((t) => t.language)), {
          message: `Safari's player has the ${language} audio on, and only that`,
        })
        .toEqual([language]);
    },
  };
}

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
