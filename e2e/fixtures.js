// What every journey shares: the server's address, the admin API, a guard that
// fails a test on any uncaught error in any of its pages, or anything the pages'
// Content-Security-Policy blocked, and small helpers for the player and the keyboard.
import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';
import { softAuthenticator } from '../test/softauth.js';
import { FILMS } from './film.js';

export { expect };

const env = (key) => process.env[key];

// The films global setup published (film.js), and the cinema's name it set. Each
// browser project has a copy of each film of its own, so these are read while a
// journey runs: its project says which copy.
const published = (key) => {
  const f = () => JSON.parse(env('E2E_FILMS') || '{}')[base.info().project.name]?.[key] ?? {};
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
// How many film folders the media folder holds: every project's copies.
export const filmFolders = () => Object.values(JSON.parse(env('E2E_FILMS') || '{}')).reduce((n, own) => n + Object.keys(own).length, 0);
export const cinemaName = () => env('E2E_CINEMA_NAME');

// A label no other journey (or browser) will use.
export const unique = (what, testInfo) => `${what} ${testInfo.project.name} ${Math.random().toString(36).slice(2, 7)}`;

// Waits until no other journey holds `name`, in any browser, then holds it: the lock
// is a folder in the run's own folder, which global setup clears for each run. Returns
// what lets it go.
async function hold(name) {
  const lock = path.join(path.dirname(env('E2E_SERVER_LOG')), `${name}.lock`);
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  return () => fs.rmSync(lock, { recursive: true, force: true });
}

// Runs `fn` while no other journey holds `name`, in any browser: for journeys that
// change something every browser shares, such as the cinema's colours.
export async function exclusively(name, fn) {
  const release = await hold(name);
  try {
    return await fn();
  } finally {
    release();
  }
}

// ------------------------------------------------------------ one tape per film

// Version 2 lends one tape per film, and the journeys of a browser project share that
// project's copy of each film. So a journey that sends itself a link holds the
// project's tapes to itself (`tapes-<project>`) from then until it ends: no other
// journey can leave a tape out under it, or find one out. When it ends, every link
// that has lent, for each film it sent a link for, is cancelled, which takes the tape
// back if it is still out, so the next journey finds it in. A journey that makes its
// link in the back office's own pages, not through admin.issueTicket, calls holdTape
// itself before it presses Play. The time spent waiting for another journey's tapes
// doesn't count against this one's.
//
// One lock for both of a project's films, not one for each: with a lock per film, a
// journey holding the second film's tape and asking for the main one's, and another
// holding them the other way round, wait for each other until both time out, and
// every journey behind them with them (the admin's journey and the two-film journey of
// tracks.spec.js did, when they happened to overlap).
const journeys = new Map();
const TAPE_WAIT = 5 * 60_000;

export async function holdTape(forFilm = film) {
  const info = base.info();
  const mine = journeys.get(info.testId);
  if (!mine) throw new Error('holdTape is for use inside a journey');
  if (mine.films.has(forFilm.slug)) return;
  // Once for the journey, however many links it sends, and if it sends two at once.
  mine.held ??= (async () => {
    const allowed = info.timeout;
    const asked = Date.now();
    info.setTimeout(allowed + TAPE_WAIT);
    mine.release = await hold(`tapes-${info.project.name}`);
    info.setTimeout(allowed + (Date.now() - asked));
  })();
  await mine.held;
  mine.films.set(forFilm.slug, forFilm.id);
}

// As a journey ends: the tapes it held go back, and the next journey may take them.
async function returnTapes(mine) {
  try {
    for (const id of mine.films.values()) {
      const { data: links } = await call('GET', `/api/admin/tickets?film=${id}`);
      for (const link of links) if (link.firstPlayedAt && !link.revokedAt) await admin.revoke(link.id);
    }
  } finally {
    mine.release?.();
  }
}

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
  patch: async (url, body = {}) => (await call('PATCH', url, body)).data,
  // A link for anyone, lending for the shop's own days, unless `fields` say otherwise:
  // any of the admin's own fields, such as personId, loanDays, startBy or claimable.
  // The journey holds the film's tape from here on (holdTape, above).
  async issueTicket({ label, for: forFilm = film, ...fields } = {}) {
    await holdTape(forFilm);
    const [ticket] = await admin.post('/api/admin/tickets', { filmId: forFilm.id, label, ...fields });
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
  await page.getByLabel('Back office password').evaluate(async (input) => {
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
// passkeys: the viewer cookie to put in a browser context, and the passkey, to sign
// in with again.
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
  return { person, cookie, auth };
}

// Another of that person's devices: a second sign-in with the same passkey, which is
// a session of its own. The cookie to put in another browser context.
export async function anotherDevice(auth) {
  const { data: opts } = await call('POST', '/api/signin/options', {}, null);
  const { res } = await call('POST', '/api/signin/finish', { credential: auth.get(opts.options) }, null);
  const session = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('om_session='));
  if (!session) throw new Error('signing in set no session cookie');
  return { name: 'om_session', value: session.slice('om_session='.length), url: env('E2E_BASE_URL'), httpOnly: true, sameSite: 'Lax' };
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

// Anything a page's Content-Security-Policy blocks (server/csp.js), in any page, popup
// or frame: something the site needs and the policy refuses, which the tests must find
// before the owner's friends do. Each browser fires securitypolicyviolation in the page;
// it's passed on as it happens, since the page may have gone by the end of the test.
// Browsers also say so in the console, each in its own words, and a message the event
// missed counts too. No test, playwright.config.js or newContext() call may set
// bypassCSP, which would switch the policy off: the guard and newContext check.
//
// Only what happens while the test runs, until it fails, counts (see watching).
// Playwright's own screenshots, once a test has failed and as a browser closes (kept
// if the test fails), add a <style> to the page to hide the caret, and WebKit holds
// that against the policy.
function watchPolicy() {
  // How many <select>s the page has made, for WebKit's reports about its drop-down
  // menus: React makes the player's before it adds them to the page, and WebKit then
  // reports them as about the page as a whole.
  let selectsMade = 0;
  const create = Document.prototype.createElement;
  Document.prototype.createElement = function (name, ...rest) {
    if (String(name).toLowerCase() === 'select') selectsMade++;
    return create.call(this, name, ...rest);
  };
  document.addEventListener('securitypolicyviolation', (e) => {
    const where = e.sourceFile ? ` at ${e.sourceFile}:${e.lineNumber}` : '';
    const sample = e.sample ? `: ${e.sample}` : '';
    // The element it was about: #document when the browser names none, as WebKit does
    // for an element not yet in the page. Each such report about a style attribute uses
    // up one <select> the page made.
    const directive = e.effectiveDirective || e.violatedDirective;
    const target = e.target?.nodeName ?? null;
    let madeSelect = false;
    if (target === '#document' && directive === 'style-src-attr' && selectsMade > 0) {
      selectsMade--;
      madeSelect = true;
    }
    window.e2eCspViolation?.({
      directive,
      blocked: e.blockedURI || 'inline',
      target,
      madeSelect,
      line: `${location.pathname}: ${directive} blocked ${e.blockedURI || 'inline'}${where}${sample}`,
    });
  });
}
export const CSP_MESSAGE = /Content[- ]Security[- ]Policy/i;

// What a browser does of its own accord that the policy refuses, which changes nothing
// the cinema shows. Each is set aside as a note on the test, only in that browser,
// with as many of that browser's console messages about it; the other browsers would
// still find the same thing done by the site itself.
const BROWSERS_OWN = [
  {
    // WebKit holds the inside of its own drop-down menus against the policy: each
    // <select> it draws is reported as an inline style attribute refused, though the
    // page has none, and the menu looks and works just the same. Only a report about a
    // <select>, or about the page as a whole while a <select> the page made is still to
    // be added, is set aside: a style attribute on anything else still fails, in WebKit
    // as in the other browsers.
    browser: 'webkit',
    what: "WebKit's drop-down menu",
    is: ({ directive, blocked, target, madeSelect }) => directive === 'style-src-attr' && blocked === 'inline' && (target === 'SELECT' || madeSelect),
    message: (text) => text === "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.",
  },
  {
    // Firefox asks for /favicon.ico for an image or text file opened in a tab of its
    // own, which has no icon of its own to show.
    browser: 'firefox',
    what: "Firefox's search for a tab icon",
    is: ({ directive, blocked }) => directive === 'img-src' && /\/favicon\.ico$/.test(blocked),
    message: (text) => /\/favicon\.ico\b.*FaviconLoader/.test(text),
  },
];

async function prepare(context, pageErrors) {
  pageErrors.contexts.push(context);
  const browser = context.browser()?.browserType().name();
  const own = BROWSERS_OWN.filter((o) => o.browser === browser);
  await context.exposeFunction('e2eCspViolation', (violation) => {
    if (!watching(pageErrors)) return;
    const kind = own.find((o) => o.is(violation));
    if (kind) pageErrors.browsersOwn.push({ kind, line: violation.line });
    else pageErrors.csp.push(violation.line);
  });
  await context.addInitScript(watchPolicy);
  await context.addInitScript(initScript);
  const watch = (page) => {
    page.on('pageerror', (err) => (cutOffAsPageWent(err) ? pageErrors.cutOff : pageErrors).push(`${page.url()}: ${err.message}`));
    page.on('console', (msg) => {
      if (!watching(pageErrors) || !CSP_MESSAGE.test(msg.text())) return;
      pageErrors.cspConsole.push({ kind: own.find((o) => o.message(msg.text())), line: `${new URL(page.url()).pathname}: ${msg.text()}` });
    });
  };
  context.pages().forEach(watch);
  context.on('page', watch);
}

const watching = (pageErrors) => !pageErrors.stopped && pageErrors.testInfo.errors.length === 0;

// The end of the test, before its browsers close: whatever the policy reports after
// this is Playwright's doing. A short wait in each page, in every browser the test
// used, first lets through what they reported before. A round trip alone isn't
// enough: WebKit can log a refusal to the console before the page's
// securitypolicyviolation event has run, and the console line would then be left
// without the event that sets it aside.
async function stopWatching(pageErrors) {
  if (pageErrors.stopped) return;
  const pages = pageErrors.contexts.flatMap((context) => context.pages());
  await Promise.all(pages.map((page) => page.evaluate(() => new Promise((r) => setTimeout(r, 50))).catch(() => {})));
  pageErrors.stopped = true;
}

// What the policy blocked, less what the browsers did of their own accord.
function blockedByPolicy(pageErrors) {
  const left = new Map();
  for (const { kind } of pageErrors.browsersOwn) left.set(kind, (left.get(kind) ?? 0) + 1);
  const messages = pageErrors.cspConsole.filter(({ kind }) => {
    if (!kind || !left.get(kind)) return true;
    left.set(kind, left.get(kind) - 1);
    return false;
  });
  return [...pageErrors.csp, ...messages.map((m) => m.line)];
}

export const test = base.extend({
  baseURL: async ({}, use) => use(env('E2E_BASE_URL')),

  pageErrors: async ({}, use, testInfo) =>
    use(Object.assign([], { cutOff: [], csp: [], cspConsole: [], browsersOwn: [], contexts: [], testInfo, stopped: false })),

  context: async ({ context, pageErrors }, use, testInfo) => {
    await prepare(context, pageErrors);
    await use(context);
    await stopWatching(pageErrors);
    await forgetPasswordsIfFailed(context, testInfo);
  },

  // Another browser context (another person's browser), closed after the test.
  newContext: async ({ browser, pageErrors }, use, testInfo) => {
    const made = [];
    await use(async (options = {}) => {
      expect(options.bypassCSP, 'bypassCSP switches the policy off').toBeFalsy();
      const context = await browser.newContext({ baseURL: env('E2E_BASE_URL'), viewport: { width: 1280, height: 800 }, ...options });
      made.push(context);
      await prepare(context, pageErrors);
      return context;
    });
    await stopWatching(pageErrors);
    for (const context of made) {
      await forgetPasswordsIfFailed(context, testInfo);
      await context.close();
    }
  },

  // The films whose tape this journey holds (holdTape), and what lets them go. They go
  // back once the guard below has read the journey's pages, so a player stopped by
  // that is never held against the journey.
  tapes: async ({}, use, testInfo) => {
    const mine = { films: new Map(), held: null, release: null };
    journeys.set(testInfo.testId, mine);
    try {
      await use(mine);
    } finally {
      journeys.delete(testInfo.testId);
      await returnTapes(mine);
    }
  },

  // Skips everything when global setup couldn't make the films, or a project's
  // browser isn't installed (playwright.config.js), and fails any test whose pages
  // threw, or had anything blocked by their Content-Security-Policy.
  guard: [
    // (tapes: set up before this guard, so it is taken down after it.)
    async ({ pageErrors, bypassCSP, tapes }, use, testInfo) => {
      testInfo.skip(Boolean(env('E2E_SKIP')), env('E2E_SKIP'));
      testInfo.skip(Boolean(testInfo.project.metadata.missing), testInfo.project.metadata.missing);
      // As the test resolves it: from playwright.config.js, test.use or contextOptions.
      expect(bypassCSP, 'bypassCSP switches the policy off').toBeFalsy();
      await use();
      for (const line of pageErrors.cutOff) testInfo.annotations.push({ type: 'request cut off as the page went', description: line });
      const notes = new Set(pageErrors.browsersOwn.map(({ kind, line }) => `${kind.what}, held against the policy\n${line}`));
      for (const note of notes) {
        const [type, description] = note.split('\n');
        testInfo.annotations.push({ type, description });
      }
      expect([...pageErrors], 'uncaught errors in the page').toEqual([]);
      expect(blockedByPolicy(pageErrors), 'what the Content-Security-Policy blocked').toEqual([]);
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

// The film page's Play button, or Resume once the tape is yours (Resume at 42:17), or
// Play from the start once it has been watched to the end (the test films are eight
// seconds long). Named by its words alone: its icon is hidden from screen readers.
export const playButton = (page) => page.getByRole('button', { name: /^(Play|Play from the start|Resume( at [\d:]+)?)$/ });

// The language the film is heard in: the player fetches the chosen audio rendition
// (a folder such as a_fr_1), watched from `since` on (mark() gives the place). Safari's
// own player also says which of its audio tracks is on, and that has to agree.
export function audioHeard(page) {
  const fetched = [];
  page.on('response', (res) => {
    const m = /\/hls\/(a_[^/]+)\//.exec(new URL(res.url()).pathname);
    // Segments are checked with the server each time (server/routes/media.js), so a
    // rendition heard before can come back as a 304, which Firefox reports as such.
    if (m && (res.status() === 200 || res.status() === 304)) fetched.push(m[1]);
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
