import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createAccess } from './access.js';
import { createBackups } from './backup.js';
import { createBooth } from './booth.js';
import { IMAGE_TYPES, createBranding } from './branding.js';
import { createCeremonies } from './ceremonies.js';
import { config } from './config.js';
import { LOCKED_POLICY, REPORT_PATH, createCspReports, originOf, pagePolicy, readReports } from './csp.js';
import { createMetadata } from './metadata.js';
import { createPage, createTicketPreviews } from './page.js';
import { createPeople } from './people.js';
import { rateCounter, rateLimit } from './ratelimit.js';
import { createRetention } from './retention.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { createRefusals, createShare, mediaRoutes, shareLimits } from './routes/media.js';
import { publicRoutes } from './routes/public.js';
import { viewerRoutes } from './routes/viewer.js';
import { createSessionStore, deviceLabel } from './sessions.js';
import { createSettings } from './settings.js';
import { relyingParty } from './webauthn.js';

// The two uploads that send an image rather than JSON (see the guard below).
const UPLOADS = new Set(['/api/admin/branding/logo', '/api/admin/branding/icon']);
const isUpload = (req) => req.method === 'POST' && UPLOADS.has(req.baseUrl + req.path);

export function createApp({
  db,
  mediaDir = config.mediaDir,
  webDist = config.webDist,
  dataDir = config.dataDir,
  metadataOptions = {},
  backupOptions = {},
  // The films' folders' places and deadlines (media.js, shareLimits); tests pass their own.
  mediaOptions = {},
  // Passkeys' relying party; tests pass their own.
  webauthn = { publicUrl: config.publicUrl, rpId: config.webauthnRpId, production: config.production },
  // { scale } multiplies every rate limit, for test suites that sign in many times.
  limits = {},
}) {
  const app = express();
  const startedAt = Date.now();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  const settings = createSettings(db);
  const metadata = createMetadata({ db, settings, dataDir, ...metadataOptions });
  const backups = createBackups({ db, dataDir, ...backupOptions });
  const sessions = createSessionStore(db);
  const access = createAccess(db, settings);
  const rp = relyingParty(webauthn);
  const limit = (opts) => rateLimit({ ...opts, scale: limits.scale ?? 1 });
  const people = createPeople({ db, sessions, access, settings, rp, ceremonies: createCeremonies() });
  const branding = createBranding({ settings, dataDir });
  // What the viewer site shows in its header and footer: /api/site, /api/me's
  // `site`, and the copy written into every page. TMDb asks for credit wherever
  // its data and images appear.
  const site = (s = settings.get()) => ({ ...branding.publicView(s), tmdbCredit: metadata.status().configured });
  // Ticket links' previews. The page and the poster count against one limit per
  // client. The key signs the posters' addresses; it is made once and never sent.
  const previewCount = rateCounter({ windowMs: 10 * 60 * 1000, max: 60, scale: limits.scale ?? 1 });
  const previewKey = settings.ensureSecret('previewKey', () => crypto.randomBytes(32).toString('base64url'));
  const previews = createTicketPreviews({ db, access, counter: previewCount, key: previewKey });
  // Deleting old events and ended sessions, daily (index.js starts it).
  const retention = createRetention({ db, settings });
  // Refused media requests, in memory only, for the projection booth.
  const refusals = createRefusals();
  const booth = createBooth({ db, mediaDir, dataDir, backups, retention, refusals, startedAt });
  // Reading from the films' folders, which may be network storage that stops answering.
  const share = createShare({ ...shareLimits(), ...mediaOptions });
  const deps = { db, mediaDir, dataDir, settings, metadata, backups, sessions, access, rp, people, limit, branding, site, previews, retention, refusals, booth, share };
  app.locals.metadata = metadata;
  app.locals.backups = backups;
  app.locals.retention = retention;
  app.locals.refusals = refusals;
  app.locals.rp = rp;

  app.use((req, res, next) => {
    // Nothing here needs a Referer, and from /t/<code> it would carry the ticket code.
    res.set('Referrer-Policy', 'no-referrer');
    // frame-ancestors says the same in the policy; this is for browsers too old for that.
    res.set('X-Frame-Options', 'DENY');
    res.set('X-Content-Type-Options', 'nosniff');
    // Nothing at all, for anything that isn't a page: sendPage gives pages their own (csp.js).
    res.set('Content-Security-Policy', LOCKED_POLICY);
    next();
  });

  // Where browsers report what a page's policy blocked (csp.js), into the server log
  // and nowhere else. Ahead of the /api rules below, which it couldn't meet: browsers
  // send these as application/csp-report or application/reports+json, not JSON, and
  // may mark them as sent from anywhere. That's safe because this does nothing but
  // write a short line to the log, and this one path, for POST, is all it covers:
  // anything else under /api, this path's other methods included, meets the rules as
  // before. Anyone can send these, so they're small, limited per visitor's address,
  // limited again in how many lines they write to the log (csp.js), and never read
  // back to anyone.
  const cspReports = createCspReports();
  const REPORT_TYPES = ['application/csp-report', 'application/reports+json', 'application/json'];
  app.post(
    REPORT_PATH,
    limit({ windowMs: 10 * 60 * 1000, max: 100 }),
    (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      if (!req.is(REPORT_TYPES)) return res.status(415).end();
      next();
    },
    express.raw({ type: () => true, limit: '8kb' }),
    (req, res) => {
      // Anything wrong with what was sent is a 400, never a crash.
      try {
        const body = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '');
        const browser = deviceLabel(req.get('user-agent') || '');
        for (const report of readReports(body)) cspReports.add(report, browser);
      } catch {
        return res.status(400).end();
      }
      res.status(204).end();
    },
    // A body over the limit, or one the parser couldn't read.
    (err, req, res, next) => res.status(err.type === 'entity.too.large' ? 413 : 400).end(),
  );

  // Mutating API calls must be JSON, and browsers mustn't be sending them from
  // another site (Sec-Fetch-Site). Together with SameSite=Lax cookies this stops
  // other sites from acting with a viewer's or the admin's session. Same-site is
  // refused too: passkeys belong to the parent domain, so a page on any of its
  // subdomains counts as same-site. The one exception to JSON: the logo and icon
  // uploads send the image itself, as PNG, JPEG or WebP. A page on another site
  // can't send those types without a CORS preflight, which this server never
  // answers, and the admin cookie is SameSite=Lax besides.
  app.use('/api', (req, res, next) => {
    // What the API says is for this browser, as it is now: never kept in a cache.
    // On a shared computer the next person could otherwise read the admin's ticket
    // links, or someone's account, from the browser's cache after signing out.
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const site = req.get('sec-fetch-site');
      if (site === 'cross-site' || site === 'same-site') return res.status(403).json({ error: 'cross-site' });
      const image = isUpload(req) && req.is(IMAGE_TYPES);
      if (!image && !req.is('application/json')) return res.status(415).json({ error: 'json-required' });
    }
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  app.use(mediaRoutes(deps));
  app.use(publicRoutes(deps));
  app.use(viewerRoutes(deps));
  app.use(accountRoutes(deps));
  app.use(adminRoutes(deps));
  app.use('/api', (req, res) => res.status(404).json({ error: 'not-found' }));

  // The React app. Every other path (/, /arrival, /admin/...) gets index.html,
  // with the cinema's name, colours and link-preview tags written in (page.js).
  const indexFile = path.join(webDist, 'index.html');
  if (fs.existsSync(indexFile)) {
    const page = createPage({ indexFile, settings, previews, site });
    const tmdbImages = [originOf(metadata.imageBase)].filter(Boolean);
    const sendPage = (req, res) => {
      // A ticket link's page may name its film: no shared caches.
      res.set('Cache-Control', req.path.startsWith('/t/') ? 'private, no-cache' : 'no-cache');
      const { html, styleHashes } = page.render(req);
      // Only the admin's pages show TMDB's thumbnails (Find details), straight from
      // TMDB's image server; the viewers' pages load images from here alone. A page
      // keeps the policy it was loaded with, so the app loads the admin as a page of
      // its own, never from a viewer's page (SignIn.jsx).
      const imageOrigins = /^\/admin(\/|$)/i.test(req.path) ? tmdbImages : [];
      res.set('Content-Security-Policy', pagePolicy({ styleHashes, imageOrigins }));
      res.type('html').send(html);
    };
    // Ahead of the static files, which would send it as it is.
    app.get('/index.html', sendPage);
    app.use('/assets', express.static(path.join(webDist, 'assets'), { immutable: true, maxAge: '1y', index: false }));
    app.use(express.static(webDist, { index: false }));
    // A file a page asks for that this build doesn't have, such as a part of the
    // app from before a deploy: the page would refuse index.html in its place, and
    // a 404 lets it say so.
    app.use('/assets', (req, res) => res.status(404).end());
    app.get('/{*splat}', sendPage);
  }

  // An API error is { error }: a kebab-case code the page turns into words, or, for
  // what only the admin reads, a sentence it shows as it is.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    // express.raw refusing an upload over its limit, before the route runs.
    if (err.type === 'entity.too.large' && isUpload(req)) return res.status(413).json({ error: 'That image is larger than 1 MB.' });
    // A body that isn't JSON gets a code, not the parser's own words.
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad-json' });
    const status = err.status || err.statusCode || 500;
    // A deliberate 503 (passkeys unavailable) says why; anything else over 500 doesn't.
    const deliberate = status === 503 && err.status === 503;
    if (status >= 500 && !deliberate) console.error(err);
    res.status(status).json({ error: status >= 500 && !deliberate ? 'server-error' : err.message });
  });

  return app;
}
