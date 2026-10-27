import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createAccess } from './access.js';
import { createBackups } from './backup.js';
import { createCeremonies } from './ceremonies.js';
import { config } from './config.js';
import { createMetadata } from './metadata.js';
import { createPeople } from './people.js';
import { rateLimit } from './ratelimit.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { mediaRoutes } from './routes/media.js';
import { viewerRoutes } from './routes/viewer.js';
import { createSessionStore } from './sessions.js';
import { createSettings } from './settings.js';
import { relyingParty } from './webauthn.js';

export function createApp({
  db,
  mediaDir = config.mediaDir,
  webDist = config.webDist,
  dataDir = config.dataDir,
  metadataOptions = {},
  backupOptions = {},
  // Passkeys' relying party; tests pass their own.
  webauthn = { publicUrl: config.publicUrl, rpId: config.webauthnRpId, production: config.production },
  // { scale } multiplies every rate limit, for test suites that sign in many times.
  limits = {},
}) {
  const app = express();
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
  const deps = { db, mediaDir, settings, metadata, backups, sessions, access, rp, people, limit };
  app.locals.metadata = metadata;
  app.locals.backups = backups;
  app.locals.rp = rp;

  app.use((req, res, next) => {
    // Nothing here needs a Referer, and from /t/<code> it would carry the ticket code.
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Frame-Options', 'DENY');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  // Mutating API calls must be JSON, and browsers mustn't be sending them from
  // another site (Sec-Fetch-Site). Together with SameSite=Lax cookies this stops
  // other sites from acting with a viewer's or the admin's session. Same-site is
  // refused too: passkeys belong to the parent domain, so a page on any of its
  // subdomains counts as same-site.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const site = req.get('sec-fetch-site');
      if (site === 'cross-site' || site === 'same-site') return res.status(403).json({ error: 'cross-site' });
      if (!req.is('application/json')) return res.status(415).json({ error: 'json-required' });
    }
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  app.use(mediaRoutes(deps));
  app.use(viewerRoutes(deps));
  app.use(accountRoutes(deps));
  app.use(adminRoutes(deps));
  app.use('/api', (req, res) => res.status(404).json({ error: 'not-found' }));

  // The React app. Every other path (/, /arrival, /admin/...) gets index.html.
  const index = path.join(webDist, 'index.html');
  if (fs.existsSync(index)) {
    app.use('/assets', express.static(path.join(webDist, 'assets'), { immutable: true, maxAge: '1y', index: false }));
    app.use(express.static(webDist, { index: false }));
    app.get('/{*splat}', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(index));
  }

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    // A deliberate 503 (passkeys unavailable) says why; anything else over 500 doesn't.
    const deliberate = status === 503 && err.status === 503;
    if (status >= 500 && !deliberate) console.error(err);
    res.status(status).json({ error: status >= 500 && !deliberate ? 'server-error' : err.message });
  });

  return app;
}
