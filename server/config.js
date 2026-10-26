import path from 'node:path';

const env = process.env;

function int(name, fallback) {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`${name} must be a number`);
  return n;
}

export const config = {
  port: int('PORT', 3000),
  dataDir: path.resolve(env.DATA_DIR || './data'),
  mediaDir: path.resolve(env.MEDIA_DIR || './media'),
  adminPassword: env.ADMIN_PASSWORD || '',
  // Public origin, e.g. https://cinema.example.com. Used to build ticket links.
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  // "auto" marks cookies Secure when the request arrived over HTTPS (via Caddy).
  cookieSecure: env.COOKIE_SECURE || 'auto',
  viewerSessionDays: int('VIEWER_SESSION_DAYS', 90),
  adminSessionHours: int('ADMIN_SESSION_HOURS', 12),
  trustProxy: env.TRUST_PROXY ?? 'loopback, uniquelocal',
  webDist: path.resolve(env.WEB_DIST || './dist'),
  // Daily database backups (see server/backup.js). BACKUP_DIR=off turns them off.
  backupDir: env.BACKUP_DIR === 'off' ? null : path.resolve(env.BACKUP_DIR || path.join(env.DATA_DIR || './data', 'backups')),
  backupHour: int('BACKUP_HOUR', 4),
  backupKeepDays: int('BACKUP_KEEP_DAYS', 14),
  backupKeepMonths: int('BACKUP_KEEP_MONTHS', 12),
  // Film information and artwork. The key can also be set in the admin.
  tmdbApiKey: env.TMDB_API_KEY || '',
  tmdbApiBase: (env.TMDB_API_BASE || 'https://api.themoviedb.org/3').replace(/\/$/, ''),
  tmdbImageBase: (env.TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p').replace(/\/$/, ''),
};

export function assertConfig() {
  if (!config.adminPassword || config.adminPassword.length < 12) {
    throw new Error('ADMIN_PASSWORD must be set and at least 12 characters long');
  }
}
