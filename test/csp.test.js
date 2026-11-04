// Content-Security-Policy: what each page may load and run, the locked policy on
// everything else, and the report endpoint browsers tell of blocked things through.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

// TMDB's image server, as an install might set it: read when config.js is first loaded.
process.env.TMDB_IMAGE_BASE = 'https://images.example.test/t/p/';
const { adminBrowser, browser, makeFilm, startServer, tempDir } = await import('./helpers.js');
const { LOCKED_POLICY, createCspReports, originOf, pagePath, pagePolicy, readReports, styleHash } = await import('../server/csp.js');

// index.html as Vite builds it.
const TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>Open Matte</title>
    <script type="module" crossorigin src="/assets/index-C_YNhghY.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-DodpWqzH.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

const mediaDir = tempDir();
const webDist = tempDir();
let srv;
let admin;
let ticket;

before(async () => {
  fs.writeFileSync(path.join(webDist, 'index.html'), TEMPLATE);
  fs.writeFileSync(path.join(webDist, 'third-party-licenses.txt'), 'Licences\n');
  fs.mkdirSync(path.join(webDist, 'assets'));
  fs.writeFileSync(path.join(webDist, 'assets', 'index-C_YNhghY.js'), 'console.log(1)');
  makeFilm(mediaDir, 'arrival');
  srv = await startServer({ mediaDir, webDist });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  const filmId = (await admin.get('/api/admin/films')).data[0].id;
  await admin.patch(`/api/admin/films/${filmId}`, { published: true });
  ticket = (await admin.post('/api/admin/tickets', { filmId, screeningLimit: null })).data[0];
});
after(() => srv.close());

// A policy as { directive: [values] }, in order.
const parse = (policy) => Object.fromEntries(policy.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));

const page = async (url) => {
  const res = await fetch(srv.base + url);
  return { res, html: await res.text(), policy: parse(res.headers.get('content-security-policy') ?? '') };
};

const VIEWER_PAGES = () => ['/', '/index.html', '/arrival', `/t/${ticket.code}`, '/signin', '/enroll', '/account', '/administrator'];
const ADMIN_PAGES = ['/admin', '/admin/', '/admin/films/1', '/ADMIN/settings'];
const PAGES = () => [...VIEWER_PAGES(), ...ADMIN_PAGES];
// The <style id="theme"> a page has with no colours set, and its hash.
const EMPTY_THEME = "'sha256-" + crypto.createHash('sha256').update(':root{}').digest('base64') + "'";

describe('the policy on pages', () => {
  test("every page may run only its own scripts and load only from this server, TMDB's images in the admin aside", async () => {
    for (const url of PAGES()) {
      const { res, policy } = await page(url);
      assert.equal(res.status, 200, url);
      assert.match(res.headers.get('content-type'), /^text\/html/, url);
      assert.deepEqual(
        policy,
        {
          'default-src': ["'none'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", EMPTY_THEME],
          // TMDB's thumbnails, in the admin's Find details only.
          'img-src': ADMIN_PAGES.includes(url) ? ["'self'", 'https://images.example.test'] : ["'self'"],
          'media-src': ["'self'", 'blob:', 'data:'],
          'connect-src': ["'self'"],
          'base-uri': ["'none'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
          'report-uri': ['/api/csp-report'],
        },
        url,
      );
      // And the older header, for browsers that don't know frame-ancestors.
      assert.equal(res.headers.get('x-frame-options'), 'DENY', url);
    }
  });

  test('nothing in a page needs more than the policy allows: no inline script, no style attribute', async () => {
    for (const url of PAGES()) {
      const { html } = await page(url);
      for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) {
        assert.ok(/\bsrc=/.test(tag) || /\btype="application\/json"/.test(tag), `${url}: ${tag} would be run inline`);
      }
      assert.doesNotMatch(html, /\sstyle=/, url);
      // No colours set: an empty one, for the admin to put colours in once saved.
      assert.deepEqual([...html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]), ['<style id="theme">:root{}</style>'], url);
    }
  });

  test("the cinema's colours: the policy allows the page's own <style>, by the hash of its text exactly", async (t) => {
    t.after(() => admin.patch('/api/admin/settings', { accentColor: '#e8b04a', backgroundColor: '#0d0c0f' }));
    const r = await admin.patch('/api/admin/settings', { accentColor: '#4ab0e8', backgroundColor: '#0b1016' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    for (const url of PAGES()) {
      const { html, policy } = await page(url);
      const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)];
      assert.equal(styles.length, 1, url);
      assert.match(styles[0][0], /^<style id="theme">/, url);
      const text = styles[0][1];
      assert.match(text, /--accent:#4ab0e8/, url);
      const hash = `'sha256-${crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('base64')}'`;
      assert.deepEqual(policy['style-src'], ["'self'", hash], url);
      assert.doesNotMatch(policy['style-src'].join(' '), /unsafe/, url);
    }
    // The page is the same each time, policy and all, so it keeps its ETag.
    const first = await fetch(`${srv.base}/arrival`);
    // (A Cache-Control of its own, or fetch adds no-cache to a conditional request.)
    const again = await fetch(`${srv.base}/arrival`, { headers: { 'if-none-match': first.headers.get('etag'), 'cache-control': 'max-age=0' } });
    assert.equal(again.status, 304);

    // Back to Open Matte's own colours: an empty <style>, and its hash.
    await admin.patch('/api/admin/settings', { accentColor: '#e8b04a', backgroundColor: '#0d0c0f' });
    const { html, policy } = await page('/arrival');
    assert.match(html, /<style id="theme">:root\{\}<\/style>/);
    assert.deepEqual(policy['style-src'], ["'self'", EMPTY_THEME]);
  });

  test('styleHash is the hash a browser works out for the element', () => {
    // A browser hashes the element's text as UTF-8, with nothing trimmed.
    assert.equal(styleHash(':root{--accent:#4ab0e8}'), `'sha256-${crypto.createHash('sha256').update(':root{--accent:#4ab0e8}').digest('base64')}'`);
    assert.notEqual(styleHash(':root{}'), styleHash(' :root{}'));
  });

  test("TMDB's image server is wherever metadata fetches thumbnails from, and no wider", async () => {
    // From TMDB_IMAGE_BASE, above: just its origin, with no path or wildcard.
    assert.deepEqual((await page('/admin')).policy['img-src'], ["'self'", 'https://images.example.test']);
    const other = await startServer({ mediaDir, webDist, metadataOptions: { envKey: '', imageBase: 'http://127.0.0.1:8099/t/p' } });
    try {
      const res = await fetch(`${other.base}/admin`);
      assert.deepEqual(parse(res.headers.get('content-security-policy'))['img-src'], ["'self'", 'http://127.0.0.1:8099']);
    } finally {
      await other.close();
    }
    // Something that isn't an http(s) address adds nothing.
    assert.equal(originOf('https://image.tmdb.org/t/p'), 'https://image.tmdb.org');
    assert.equal(originOf('http://127.0.0.1:8099/t/p'), 'http://127.0.0.1:8099');
    for (const url of ['ftp://a.example/t/p', 'file:///x/t/p', 'javascript:1', 'data:,x', 'not a url', '', undefined]) assert.equal(originOf(url), null, String(url));
    const ftp = await startServer({ mediaDir, webDist, metadataOptions: { envKey: '', imageBase: 'ftp://a.example/t/p' } });
    try {
      const res = await fetch(`${ftp.base}/admin`);
      assert.deepEqual(parse(res.headers.get('content-security-policy'))['img-src'], ["'self'"]);
    } finally {
      await ftp.close();
    }
  });

  test('the guide to the log names every rule the policy sets, and says which to report', () => {
    const doc = fs.readFileSync(new URL('../docs/deploying.md', import.meta.url), 'utf8');
    const section = doc.slice(doc.indexOf('### What browsers blocked'), doc.indexOf('\n## ', doc.indexOf('### What browsers blocked')));
    const set = pagePolicy()
      .split('; ')
      .map((d) => d.split(' ')[0])
      .filter((name) => !['default-src', 'report-uri'].includes(name));
    for (const name of [...set, 'script-src-attr', 'style-src-attr']) assert.ok(section.includes(`\`${name}\``), name);
    // A report under these means markup got into a page, or a frame: never an extension.
    const report = section.slice(section.indexOf('`form-action`'));
    assert.match(report.slice(0, report.indexOf('\n\n')), /Please report/);
    // And the check after an update looks for these lines.
    const after = doc.slice(doc.indexOf('### After an update'), doc.indexOf('\n### ', doc.indexOf('### After an update') + 1));
    assert.match(after, /grep -E '[^']*\bCSP\b[^']*'/);
  });

  test('the policy never allows inline script, eval, any https: address or wildcards', async () => {
    const { policy } = await page('/');
    const all = Object.values(policy).flat();
    for (const loose of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'wasm-unsafe-eval'", '*', 'https:', 'http:']) assert.ok(!all.includes(loose), loose);
    assert.ok(!('upgrade-insecure-requests' in policy), 'local development runs over http');
  });
});

describe('the locked policy on everything else', () => {
  test('API answers, media, artwork, static files, refusals and 404s allow nothing but inline styles', async () => {
    const viewer = browser(srv.base);
    await viewer.post('/api/tickets/open', { code: ticket.code });
    assert.equal((await viewer.post('/api/films/arrival/screenings')).status, 200);
    const answers = [
      ['/api/site', 200],
      ['/api/me', 200],
      ['/api/nope', 404],
      ['/api/admin/session', 401],
      ['/media/nope/master.m3u8', 403],
      ['/assets/index-C_YNhghY.js', 200],
      ['/assets/index-OLDHASH.js', 404],
      ['/favicon.svg', 200],
      ['/third-party-licenses.txt', 200],
      ['/branding/nope.png', 404],
      ['/poster/1.AAAAAAAAAAAAAAAAAAAAAA', 404],
      ['/artwork/arrival/nope.jpg', null],
    ];
    for (const [url, status] of answers) {
      const res = await fetch(srv.base + url);
      if (status) assert.equal(res.status, status, url);
      assert.equal(res.headers.get('content-security-policy'), LOCKED_POLICY, url);
    }
    // A film's own files, as a player fetches them.
    for (const url of ['/media/arrival/hls/master.m3u8', '/media/arrival/hls/a_en/seg_1.m4s', '/media/arrival/subtitles/en.vtt']) {
      const r = await viewer.get(url);
      assert.equal(r.status, 200, url);
      assert.equal(r.headers.get('content-security-policy'), LOCKED_POLICY, url);
    }
    // Errors too.
    const refused = await fetch(`${srv.base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"no"}' });
    assert.equal(refused.status, 401);
    assert.equal(refused.headers.get('content-security-policy'), LOCKED_POLICY);
    assert.deepEqual(parse(LOCKED_POLICY), {
      'default-src': ["'none'"],
      // The browser's own page for an image or text file opened in a tab.
      'style-src': ["'unsafe-inline'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
    });
  });
});

// ====================================================================== reports

// What browsers send, as they send it, and who says they sent it.
const ORIGIN = 'http://localhost:3000';
const UA = {
  chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
};
const REPORTS = {
  // report-uri, from Chromium: the inline style it refused, with the start of its text.
  chromium: {
    type: 'application/csp-report',
    body: {
      'csp-report': {
        'document-uri': `${ORIGIN}/arrival`,
        referrer: '',
        'violated-directive': 'style-src-elem',
        'effective-directive': 'style-src-elem',
        'original-policy': pagePolicy(),
        disposition: 'enforce',
        'blocked-uri': 'inline',
        'line-number': 12,
        'source-file': `${ORIGIN}/arrival`,
        'status-code': 200,
        'script-sample': ':root{--accent:#4ab0e8}',
      },
    },
    ua: UA.chrome,
    line: 'CSP blocked style-src-elem inline on /arrival (Chrome on Mac)',
  },
  // report-uri, from Firefox: an image from elsewhere, on a ticket link's page.
  firefox: {
    type: 'application/csp-report',
    body: {
      'csp-report': {
        'blocked-uri': 'https://tracker.example.com/pixel.gif?who=abc',
        'column-number': 1,
        disposition: 'enforce',
        'document-uri': `${ORIGIN}/t/abcdefgh12345?utm=x#y`,
        'effective-directive': 'img-src',
        'line-number': 1,
        'original-policy': pagePolicy(),
        referrer: '',
        'script-sample': '',
        'source-file': `${ORIGIN}/t/abcdefgh12345`,
        'status-code': 200,
        'violated-directive': 'img-src',
      },
    },
    ua: UA.firefox,
    line: 'CSP blocked img-src https://tracker.example.com on /t/… (Firefox on Windows)',
  },
  // report-uri, from WebKit: violated-directive is the whole directive.
  webkit: {
    type: 'application/csp-report',
    body: {
      'csp-report': {
        'document-uri': `${ORIGIN}/admin/films/3?tab=info`,
        referrer: '',
        'violated-directive': "media-src 'self' blob: data:",
        'effective-directive': 'media-src',
        'original-policy': pagePolicy(),
        'blocked-uri': 'https://cdn.example.net/film.mp4',
        'status-code': 0,
      },
    },
    ua: UA.safari,
    line: 'CSP blocked media-src https://cdn.example.net on /admin/films/3 (Safari on iPhone)',
  },
  // The Reporting API (report-to), from Chromium: a list.
  reporting: {
    type: 'application/reports+json',
    body: [
      {
        age: 10,
        type: 'csp-violation',
        url: `${ORIGIN}/account`,
        user_agent: 'Mozilla/5.0',
        body: {
          blockedURL: 'eval',
          columnNumber: 3,
          disposition: 'enforce',
          documentURL: `${ORIGIN}/account?again=1`,
          effectiveDirective: 'script-src',
          lineNumber: 1,
          originalPolicy: pagePolicy(),
          referrer: '',
          sample: 'alert(document.cookie)',
          sourceFile: `${ORIGIN}/assets/index.js`,
          statusCode: 200,
        },
      },
      { age: 1, type: 'deprecation', url: `${ORIGIN}/`, body: { id: 'x', message: 'not a CSP report' } },
    ],
    ua: UA.chrome,
    line: 'CSP blocked script-src eval on /account (Chrome on Mac)',
  },
  // Some browsers send report-uri reports as plain JSON.
  json: {
    type: 'application/json',
    body: { 'csp-report': { 'document-uri': `${ORIGIN}/`, 'violated-directive': 'worker-src', 'blocked-uri': 'blob' } },
    ua: 'curl/8.7.1',
    line: 'CSP blocked worker-src blob on / (Browser on unknown device)',
  },
};

// Sends a report as a browser would, from `from` (an address the server trusts
// the proxy about) and from any site.
const send = (body, { type = 'application/csp-report', from = '198.51.100.1', site = 'cross-site', url = '/api/csp-report', ua = UA.chrome } = {}) =>
  fetch(srv.base + url, {
    method: 'POST',
    headers: { 'content-type': type, 'x-forwarded-for': from, 'sec-fetch-site': site, 'user-agent': ua },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

// Everything the database holds, row counts by table: a report must change none.
const rowCounts = () =>
  Object.fromEntries(
    srv.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map(({ name }) => [name, srv.db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n]),
  );

describe('the report endpoint', () => {
  test("accepts each browser's reports, answers 204 and logs one short line each", async (t) => {
    const logged = t.mock.method(console, 'warn', () => {});
    const rows = rowCounts();
    for (const [name, { type, body, ua, line }] of Object.entries(REPORTS)) {
      const at = logged.mock.callCount();
      const res = await send(body, { type, ua });
      assert.equal(res.status, 204, name);
      assert.equal(await res.text(), '', name);
      const lines = logged.mock.calls.slice(at).map((c) => c.arguments.join(' '));
      assert.deepEqual(lines, [line], name);
    }
    assert.deepEqual(rowCounts(), rows, 'nothing is stored');
  });

  test('a ticket code, a query, a fragment or a sample of code never reaches the log', async (t) => {
    const logged = t.mock.method(console, 'warn', () => {});
    const code = 'secretcode9876';
    await send({ 'csp-report': { 'document-uri': `${ORIGIN}/t/${code}?code=${code}#${code}`, 'effective-directive': 'connect-src', 'blocked-uri': `https://evil.example/t/${code}?q=${code}`, 'script-sample': code } });
    await send({ 'csp-report': { 'document-uri': `${ORIGIN}/T/${code}`, 'effective-directive': 'font-src', 'blocked-uri': `${ORIGIN}/t/${code}` } });
    await send({ 'csp-report': { 'document-uri': `${ORIGIN}/arrival?ticket=${code}`, 'effective-directive': 'frame-src', 'blocked-uri': `data:text/html,${code}` } });
    await send({ 'csp-report': { 'document-uri': `${ORIGIN}/enroll#${code}`, 'effective-directive': 'object-src', 'blocked-uri': `blob:${ORIGIN}/${code}` } });
    // Made up to break the log: new lines, a directive that isn't one, a long path.
    await send({ 'csp-report': { 'document-uri': `${ORIGIN}/a%0Ab\n${'x'.repeat(500)}`, 'effective-directive': `img-src\nCSP forged ${code}`, 'blocked-uri': `javascript:${code}` } });
    const lines = logged.mock.calls.map((c) => c.arguments.join(' '));
    assert.deepEqual(lines.slice(0, 4), [
      'CSP blocked connect-src https://evil.example on /t/… (Chrome on Mac)',
      'CSP blocked font-src http://localhost:3000 on /t/… (Chrome on Mac)',
      'CSP blocked frame-src data on /arrival (Chrome on Mac)',
      'CSP blocked object-src blob on /enroll (Chrome on Mac)',
    ]);
    assert.equal(lines.length, 5);
    assert.match(lines[4], /^CSP blocked img-src javascript on \/a%0Abx+ \(Chrome on Mac\)$/);
    assert.ok(lines[4].length < 170);
    for (const line of lines) {
      assert.ok(!line.includes(code), line);
      assert.doesNotMatch(line, /[\r\n]/);
    }
  });

  test('repeated reports are one line a minute, then how many more there were', () => {
    const lines = [];
    let now = 0;
    const reports = createCspReports({ log: (l) => lines.push(l), now: () => now });
    const report = (blocked, page = '/arrival') => ({ effectiveDirective: 'img-src', blockedURL: blocked, documentURL: `${ORIGIN}${page}` });
    for (let i = 0; i < 5; i++) reports.add(report('https://a.example/x.png'), 'Chrome on Mac');
    reports.add(report('https://a.example/y.png'), 'Chrome on Mac');
    reports.add(report('https://b.example/z.png'), 'Chrome on Mac');
    assert.deepEqual(lines, ['CSP blocked img-src https://a.example on /arrival (Chrome on Mac)', 'CSP blocked img-src https://b.example on /arrival (Chrome on Mac)']);
    now = 59_999;
    reports.sweep();
    assert.equal(lines.length, 2, 'not before the minute is up');
    now = 60_000;
    reports.sweep();
    assert.deepEqual(lines.slice(2), ['CSP blocked img-src https://a.example on /arrival (Chrome on Mac): 5 more like it in the minute before']);
    // The next minute starts with a line of its own; a report arriving before the
    // sweep has said how many came before it says so first.
    reports.add(report('https://b.example/z.png'), 'Chrome on Mac');
    assert.deepEqual(lines.slice(3), ['CSP blocked img-src https://b.example on /arrival (Chrome on Mac)']);
    reports.add(report('https://b.example/z.png'), 'Chrome on Mac');
    now = 125_000;
    reports.add(report('https://b.example/z.png'), 'Chrome on Mac');
    assert.deepEqual(lines.slice(4), ['CSP blocked img-src https://b.example on /arrival (Chrome on Mac): 1 more like it in the minute before', 'CSP blocked img-src https://b.example on /arrival (Chrome on Mac)']);
  });

  test("a different page or browser is a line of its own, so Safari's drop-downs hide nothing else", () => {
    const lines = [];
    let now = 0;
    const reports = createCspReports({ log: (l) => lines.push(l), now: () => now });
    const attr = (page) => ({ effectiveDirective: 'style-src-attr', blockedURL: 'inline', documentURL: `${ORIGIN}${page}` });
    reports.add(attr('/admin/settings'), 'Safari on iPhone');
    now = 5_000;
    reports.add(attr('/arrival'), 'Safari on iPhone');
    reports.add(attr('/admin/settings'), 'Firefox on Mac');
    now = 20_000;
    reports.add(attr('/admin/settings'), 'Safari on iPhone');
    now = 61_000;
    reports.sweep();
    assert.deepEqual(lines, [
      'CSP blocked style-src-attr inline on /admin/settings (Safari on iPhone)',
      'CSP blocked style-src-attr inline on /arrival (Safari on iPhone)',
      'CSP blocked style-src-attr inline on /admin/settings (Firefox on Mac)',
      'CSP blocked style-src-attr inline on /admin/settings (Safari on iPhone): 1 more like it in the minute before',
    ]);
    // Only the browser's words reach the log.
    reports.add(attr('/'), 'Chrome\nCSP forged <x> on 1234567890');
    reports.add(attr('/x'), '');
    reports.add(attr('/y'), { toString: 1 });
    assert.deepEqual(lines.slice(4), [
      'CSP blocked style-src-attr inline on / (ChromeCSP forged x on)',
      'CSP blocked style-src-attr inline on /x (unknown browser)',
      'CSP blocked style-src-attr inline on /y (unknown browser)',
    ]);
  });

  test('the log takes at most 30 new lines a minute from everyone, then says how many it left out', () => {
    const lines = [];
    let now = 0;
    const reports = createCspReports({ log: (l) => lines.push(l), now: () => now });
    // Someone making every report different, from many addresses.
    const report = (i) => ({ effectiveDirective: 'script-src-elem', blockedURL: `https://x${i}.example/`, documentURL: `${ORIGIN}/admin` });
    for (let i = 0; i < 2000; i++) reports.add(report(i), 'Chrome on Mac');
    assert.equal(lines.length, 30);
    // A real one in the same minute is counted with the rest.
    reports.add({ effectiveDirective: 'media-src', blockedURL: 'blob:x', documentURL: `${ORIGIN}/arrival` }, 'Safari on iPhone');
    assert.equal(lines.length, 30);
    now = 60_000;
    reports.sweep();
    assert.deepEqual(lines.slice(30), ['CSP: 1971 more reports not logged in the minute before']);
    // A new minute, a new allowance.
    reports.add({ effectiveDirective: 'media-src', blockedURL: 'blob:x', documentURL: `${ORIGIN}/arrival` }, 'Safari on iPhone');
    assert.deepEqual(lines.slice(31), ['CSP blocked media-src blob on /arrival (Safari on iPhone)']);
    // Said by the next report, too, if it comes before the sweep.
    for (let i = 0; i < 40; i++) reports.add(report(`b${i}`), 'Chrome on Mac');
    now = 120_000;
    reports.add(report('c'), 'Chrome on Mac');
    assert.deepEqual(lines.slice(-2), ['CSP: 11 more reports not logged in the minute before', 'CSP blocked script-src-elem https://xc.example on /admin (Chrome on Mac)']);
  });

  test('a report forgotten to make room still says how many more like it there were', () => {
    const lines = [];
    let now = 0;
    const reports = createCspReports({ log: (l) => lines.push(l), now: () => now, keep: 2 });
    const report = (host) => ({ effectiveDirective: 'img-src', blockedURL: `https://${host}/`, documentURL: `${ORIGIN}/` });
    for (let i = 0; i < 3; i++) reports.add(report('a.example'), 'Chrome on Mac');
    reports.add(report('b.example'), 'Chrome on Mac');
    reports.add(report('c.example'), 'Chrome on Mac');
    assert.deepEqual(lines, [
      'CSP blocked img-src https://a.example on / (Chrome on Mac)',
      'CSP blocked img-src https://b.example on / (Chrome on Mac)',
      'CSP blocked img-src https://a.example on / (Chrome on Mac): 2 more like it in the minute before',
      'CSP blocked img-src https://c.example on / (Chrome on Mac)',
    ]);
  });

  test('reads only what browsers send, and only the first few of a list', () => {
    assert.deepEqual(readReports(null), []);
    assert.deepEqual(readReports({ 'csp-report': 'no' }), []);
    assert.deepEqual(readReports([{ type: 'csp-violation' }, 'x', null]), []);
    assert.equal(readReports(Array.from({ length: 50 }, () => REPORTS.reporting.body[0])).length, 3);
    assert.equal(pagePath('not a url'), 'unknown');
    assert.equal(pagePath(`${ORIGIN}/t`), '/t/…');
  });

  test('a list of 20 reports in one body writes no more than 3 lines', async (t) => {
    const logged = t.mock.method(console, 'warn', () => {});
    const many = Array.from({ length: 20 }, (_, i) => ({ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: `https://many${i}.example/`, documentURL: `${ORIGIN}/` } }));
    assert.equal((await send(many, { type: 'application/reports+json', from: '198.51.100.20' })).status, 204);
    assert.deepEqual(
      logged.mock.calls.map((c) => c.arguments.join(' ')),
      [0, 1, 2].map((i) => `CSP blocked img-src https://many${i}.example on / (Chrome on Mac)`),
    );
  });

  test('a field that is anything but text is no crash: the server answers, and carries on', async (t) => {
    const logged = t.mock.method(console, 'warn', () => {});
    const odd = [{ toString: 1 }, { toString: null, valueOf: null }, [1, 2], 42, true, null, { 'csp-report': {} }];
    const fields = ['effective-directive', 'violated-directive', 'blocked-uri', 'document-uri'];
    const camel = ['effectiveDirective', 'violatedDirective', 'blockedURL', 'documentURL'];
    let n = 0;
    for (const value of odd) {
      for (const field of fields) {
        const res = await send({ 'csp-report': { 'effective-directive': 'img-src', [field]: value } }, { from: `198.51.100.${30 + (n++ % 50)}` });
        assert.equal(res.status, 204, `${field}: ${res.status}`);
      }
      for (const field of camel) {
        const res = await send([{ type: 'csp-violation', url: value, body: { effectiveDirective: 'img-src', [field]: value } }], { type: 'application/reports+json', from: `198.51.100.${30 + (n++ % 50)}` });
        assert.equal(res.status, 204, `${field}: ${res.status}`);
      }
      // The whole report, or its body, as the odd value: read past, not a failure.
      assert.equal((await send({ 'csp-report': value })).status, 204);
      assert.equal((await send([{ type: 'csp-violation', body: value }], { type: 'application/reports+json' })).status, 204);
    }
    // Each odd field was read as missing, and the report still logged.
    assert.ok(logged.mock.callCount() > 0);
    assert.equal((await fetch(`${srv.base}/api/site`)).status, 200);
    // And what can't be read at all is a 400.
    assert.equal((await send('{"csp-report":', { from: '198.51.100.99' })).status, 400);
    assert.equal((await fetch(`${srv.base}/api/site`)).status, 200);
  });

  test('refuses a body over 8 KB, or one that is not a report, and logs nothing', async (t) => {
    const logged = t.mock.method(console, 'warn', () => {});
    const big = { 'csp-report': { 'document-uri': `${ORIGIN}/`, 'effective-directive': 'img-src', 'blocked-uri': 'https://big.example', pad: 'x'.repeat(9000) } };
    assert.equal((await send(big)).status, 413);
    assert.equal((await send('not json')).status, 400);
    assert.equal((await send('{"csp-report":{}}', { type: 'text/plain' })).status, 415);
    assert.equal((await send('{"csp-report":{}}', { type: 'application/x-www-form-urlencoded' })).status, 415);
    assert.equal((await fetch(`${srv.base}/api/csp-report`, { method: 'POST' })).status, 415);
    // Well-formed, but no report in it: accepted, and nothing to say.
    assert.equal((await send({ hello: 'there' })).status, 204);
    assert.equal(logged.mock.callCount(), 0);
  });

  test('is limited per visitor address', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const body = REPORTS.json.body;
    let status;
    let sent = 0;
    while (sent < 200) {
      status = (await send(body, { type: 'application/json', from: '203.0.113.7' })).status;
      sent++;
      if (status !== 204) break;
    }
    assert.equal(status, 429);
    assert.equal(sent, 101, '100 in ten minutes');
    // Someone else still can.
    assert.equal((await send(body, { type: 'application/json', from: '203.0.113.8' })).status, 204);
  });

  test('loosens nothing else under /api', async () => {
    // Other API paths still want JSON, and refuse other sites.
    const report = JSON.stringify(REPORTS.chromium.body);
    for (const url of ['/api/admin/login', '/api/signout', '/api/tickets/open', '/api/csp-report/more', '/api/csp-reports']) {
      const asReport = await send(report, { url, site: 'same-origin' });
      assert.equal(asReport.status, 415, url);
      const crossSite = await send({ password: 'x' }, { url, type: 'application/json', site: 'cross-site' });
      assert.equal(crossSite.status, 403, url);
      const sameSite = await send({ password: 'x' }, { url, type: 'application/json', site: 'same-site' });
      assert.equal(sameSite.status, 403, url);
    }
    // The report path's other methods meet the rules as before.
    const put = await send(report, { site: 'same-origin', type: 'application/csp-report' }).then(() =>
      fetch(`${srv.base}/api/csp-report`, { method: 'PUT', headers: { 'content-type': 'application/csp-report' }, body: report }),
    );
    assert.equal(put.status, 415);
    const get = await fetch(`${srv.base}/api/csp-report`);
    assert.equal(get.status, 404);
    assert.equal(get.headers.get('cache-control'), 'no-store');
  });
});

// The other line anyone can add to the log without signing in.
describe('the media refusal log line', () => {
  test("logs only the start of a refused request's Range header", async (t) => {
    const logged = t.mock.method(console, 'warn', () => {});
    const res = await fetch(`${srv.base}/media/arrival/hls/master.m3u8`, { headers: { range: `bytes=0-1,${'9'.repeat(4000)}` } });
    assert.equal(res.status, 403);
    const lines = logged.mock.calls.map((c) => c.arguments.join(' ')).filter((l) => l.startsWith('media 403'));
    assert.equal(lines.length, 1);
    assert.match(lines[0], / - range bytes=0-1,9{30}$/);
  });
});
