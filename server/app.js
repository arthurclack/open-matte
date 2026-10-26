import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createAccess } from './access.js';
import { createBackups } from './backup.js';
import { config } from './config.js';
import { createMetadata } from './metadata.js';
import { adminRoutes } from './routes/admin.js';
import { mediaRoutes } from './routes/media.js';
import { viewerRoutes } from './routes/viewer.js';
import { createSessionStore } from './sessions.js';
import { createSettings } from './settings.js';

export function createApp({ db, mediaDir = config.mediaDir, webDist = config.webDist, dataDir = config.dataDir, metadataOptions = {}, backupOptions = {} }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  const settings = createSettings(db);
  const metadata = createMetadata({ db, settings, dataDir, ...metadataOptions });
  const backups = createBackups({ db, dataDir, ...backupOptions });
  const deps = { db, mediaDir, settings, metadata, backups, sessions: createSessionStore(db), access: createAccess(db, settings) };
  app.locals.metadata = metadata;
  app.locals.backups = backups;

  app.use((req, res, next) => {
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'DENY');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  // Mutating API calls must be JSON. Together with SameSite=Lax cookies this
  // stops other sites from submitting forms against the API.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
      return res.status(415).json({ error: 'json-required' });
    }
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  app.use(mediaRoutes(deps));
  app.use(viewerRoutes(deps));
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
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'server-error' : err.message });
  });

  return app;
}
