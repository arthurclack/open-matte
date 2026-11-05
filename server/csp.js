import crypto from 'node:crypto';

// Content-Security-Policy: what a page may load and run. A page may run only the
// app's own scripts, from this server, and use only its own stylesheets, plus the
// one <style> the server writes into it (the cinema's colours, allowed by its
// hash). So if someone ever found a way to put markup into a page (a film's title,
// a person's name, details from TMDB), the browser would still refuse to run it,
// to load anything from elsewhere, or to send a form anywhere else.
//
// Every other answer (the API's JSON, films, artwork, the logo, the app's files,
// 404s) gets a policy that allows next to nothing. They are never pages, so as
// images, playlists or scripts they're unaffected; it matters only if one is opened
// as a page of its own, such as an SVG or a text file, where it stops anything in
// it from running or loading anything.

export const REPORT_PATH = '/api/csp-report';

// Inline styles are allowed, and nothing else: a browser shows an image or a text
// file opened in a tab of its own (a poster, the licences) on a page it makes for it,
// styled with style attributes of its own, to centre and zoom the image or wrap long
// lines. Without them, Chrome and Safari draw the image off-centre, without zoom, and
// Safari doesn't wrap the text. A style can't run a script, and with everything else
// refused, it can't load anything either.
export const LOCKED_POLICY = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

// The hash of a <style> element's exact text, as a policy names it.
export const styleHash = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;

// The origin of an address, or null for one that isn't http(s).
export function originOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

// The policy for a page. `styleHashes` are the hashes of the <style> elements the
// server wrote into it (styleHash); `imageOrigins`, where else its images may come
// from: TMDB's image server, for the thumbnails the admin's Find details shows
// straight from there (app.js gives it to the admin's pages only).
export function pagePolicy({ styleHashes = [], imageOrigins = [] } = {}) {
  const directives = [
    "default-src 'none'",
    // The app's own scripts. The <script type="application/json"> the server writes
    // is data, never run, so it needs nothing here.
    "script-src 'self'",
    "style-src 'self'" + styleHashes.map((h) => ` ${h}`).join(''),
    "img-src 'self'" + imageOrigins.map((o) => ` ${o}`).join(''),
    // hls.js plays the film through Media Source, which the video takes as a blob:
    // address. And every text track hls.js makes for itself (captions carried in
    // the video, subtitles listed in the playlist, timed metadata) gets the address
    // data:,WEBVTT, an empty subtitle file, so the browser's own menus behave. Only
    // the video and its tracks may use these: images, scripts and styles may not.
    "media-src 'self' blob: data:",
    "connect-src 'self'",
    // The fonts the membership card is printed in, which the app serves itself
    // (web/public/fonts). Never from anywhere else, and never as data: addresses.
    "font-src 'self'",
    // No worker-src, so workers follow script-src: from this server only, never from a
    // blob: address. hls.js as Vite bundles it (its ES module build) starts none: it
    // reads the film in the page itself. If a newer one starts a worker from a blob:
    // address, the journeys' guard will say so.
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Where browsers say what they blocked, for the server log (createCspReports, below).
    `report-uri ${REPORT_PATH}`,
  ];
  return directives.join('; ');
}

// ------------------------------------------------------------ reports

// What a browser's report says, cut down to what's safe to log: the directive, what
// was blocked as an origin or a kind ('inline', 'eval', 'blob', 'data'), and the
// page's path. Never a query, a fragment, a ticket code or a sample of the code.
const DIRECTIVE = /^[a-z][a-z-]{0,39}$/;
const KINDS = new Set(['inline', 'eval', 'wasm-eval', 'self', 'blob', 'data', 'trusted-types-policy', 'trusted-types-sink']);
const SAFE_PATH = /[^A-Za-z0-9/._~%-]/g;

// Only strings are read from a report: anything else in its place (a number, a list,
// an object that won't turn into text) counts as missing.
const text = (v) => (typeof v === 'string' ? v : '');

function directiveOf(r) {
  // Safari's violated-directive is the whole directive, values and all: its name is the first word.
  const name = (text(r.effectiveDirective) || text(r.violatedDirective)).trim().split(/\s+/)[0].toLowerCase();
  return DIRECTIVE.test(name) ? name : 'unknown';
}

function blockedOf(r) {
  const blocked = text(r.blockedURL).trim();
  // An inline script or style, in a browser that leaves the address empty.
  if (!blocked) return 'inline';
  if (KINDS.has(blocked.toLowerCase())) return blocked.toLowerCase();
  try {
    const u = new URL(blocked);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'ws:' || u.protocol === 'wss:') return u.origin.slice(0, 100);
    // blob:, data:, chrome-extension: and the like: only the scheme.
    return u.protocol.slice(0, -1).replace(/[^a-z0-9+.-]/gi, '').slice(0, 30) || 'unknown';
  } catch {
    return 'unknown';
  }
}

// The browser and device a report came from, as the account page names them (sessions.js
// deviceLabel), from the report's own User-Agent: "Safari on iPhone". Only those words.
function browserOf(label) {
  const words = text(label).replace(/[^A-Za-z ]/g, '').trim().slice(0, 40);
  return words || 'unknown browser';
}

export function pagePath(documentUrl) {
  let pathname;
  try {
    pathname = new URL(text(documentUrl)).pathname;
  } catch {
    return 'unknown';
  }
  // A ticket link's code opens the ticket: never in the log.
  if (/^\/t(\/|$)/i.test(pathname)) return '/t/…';
  return pathname.replace(SAFE_PATH, '_').slice(0, 100);
}

// The reports in a body as browsers send it, in one shape: [{ effectiveDirective,
// violatedDirective, blockedURL, documentURL }]. report-uri sends one
// { "csp-report": {...} } with hyphenated names (application/csp-report); the
// Reporting API sends a list of { type: "csp-violation", body: {...} } with
// camelCase ones (application/reports+json), of which only the first few are read:
// the pages don't ask for that kind (report-to), and a long list would only be
// someone making the log longer. Anything else is no report.
export const REPORTS_PER_BODY = 3;
export function readReports(body) {
  const out = [];
  if (Array.isArray(body)) {
    for (const r of body.slice(0, REPORTS_PER_BODY)) {
      if (r?.type !== 'csp-violation' || typeof r.body !== 'object' || !r.body) continue;
      const b = r.body;
      out.push({ effectiveDirective: b.effectiveDirective, violatedDirective: b.violatedDirective, blockedURL: b.blockedURL, documentURL: b.documentURL ?? r.url });
    }
  } else if (body && typeof body['csp-report'] === 'object' && body['csp-report']) {
    const r = body['csp-report'];
    out.push({ effectiveDirective: r['effective-directive'], violatedDirective: r['violated-directive'], blockedURL: r['blocked-uri'], documentURL: r['document-uri'] });
  }
  return out;
}

// Reports, as lines in the server log: "CSP blocked img-src https://example.com on
// /arrival (Chrome on Android)". The same directive, blocked origin, page and browser
// is logged once a minute at most (one page can send dozens); once the minute is
// over, a line says how many more like it there were. Anyone can send reports, and
// can make each one different, so the log also takes at most `perMinute` new lines a
// minute from everyone together; past that, reports are only counted, and once the
// minute is over one line says how many weren't logged. So the lines the owner relies
// on (errors, refused passkeys, real reports) can't be pushed out of the log.
export function createCspReports({ windowMs = 60 * 1000, perMinute = 30, keep = 500, log = (line) => console.warn(line), now = () => Date.now() } = {}) {
  // directive + blocked + page + browser → { until, more, last } for the current minute's lines.
  const seen = new Map();
  // The new lines this minute, and the reports past them that weren't logged.
  let budget = { until: 0, used: 0, dropped: 0 };

  const line = ({ directive, blocked, page, browser }) => `CSP blocked ${directive} ${blocked} on ${page} (${browser})`;
  // The minute's others.
  const more = (had) => `${line(had.last)}: ${had.more} more like it in the minute before`;

  // Starts a new minute for the budget once the last one is over, saying what it left out.
  function nextMinute(t) {
    if (budget.until > t) return;
    if (budget.dropped) log(`CSP: ${budget.dropped} more reports not logged in the minute before`);
    budget = { until: t + windowMs, used: 0, dropped: 0 };
  }

  function forget(key, had) {
    if (had.more) log(more(had));
    seen.delete(key);
  }

  // `browser` is deviceLabel's words for the browser that sent it.
  function add(report, browser) {
    const entry = { directive: directiveOf(report), blocked: blockedOf(report), page: pagePath(report.documentURL), browser: browserOf(browser) };
    const key = `${entry.directive} ${entry.blocked} ${entry.page} ${entry.browser}`;
    const t = now();
    nextMinute(t);
    const had = seen.get(key);
    if (had && had.until > t) {
      had.more++;
      return;
    }
    if (had) forget(key, had);
    if (budget.used >= perMinute) {
      budget.dropped++;
      return;
    }
    // Never more than `keep`: forget the one that started longest ago, saying first
    // how many more it had.
    if (seen.size >= keep) {
      const [oldest, was] = seen.entries().next().value;
      forget(oldest, was);
    }
    budget.used++;
    log(line(entry));
    seen.set(key, { until: t + windowMs, more: 0, last: entry });
  }

  // For each minute that has ended with reports unsaid, says how many.
  function sweep() {
    const t = now();
    for (const [key, had] of seen) if (had.until <= t) forget(key, had);
    nextMinute(t);
  }

  const timer = setInterval(sweep, windowMs);
  timer.unref();
  return { add, sweep };
}
