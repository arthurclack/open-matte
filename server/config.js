import path from 'node:path';

const env = process.env;

// A whole number, or `fallback` when unset or empty. Out of range stops the
// start: a backup setting of 0, say, would otherwise delete backups as they're made.
function int(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`${name} must be a number`);
  if (n < min || n > max) throw new Error(max === Infinity ? `${name} must be ${min} or more` : `${name} must be from ${min} to ${max}`);
  return n;
}

// Which proxies the app believes about a visitor's address and protocol, as
// Express's "trust proxy": how many proxies stand in front of the app (a number),
// or their addresses and subnets. The default trusts private addresses, which is
// where Caddy reaches the app from in Docker. An environment variable is always a
// string, so a number is turned into one here: Express would read "1" as the
// address 0.0.0.1.
function trustProxy(v) {
  if (v === undefined || v.trim() === '') return 'loopback, uniquelocal';
  if (/^\s*\d+\s*$/.test(v)) return Number(v);
  const names = v.split(',').map((s) => s.trim());
  if (!names.every((s) => /^(loopback|linklocal|uniquelocal|[\da-f.:]+(\/[\d.]+)?)$/i.test(s))) {
    throw new Error('TRUST_PROXY must be how many proxies stand in front of the app, such as 1, or their addresses and subnets, separated by commas');
  }
  return v;
}

const production = env.NODE_ENV === 'production';
// Public origin, e.g. https://cinema.example.com. Used to build ticket links.
const publicUrl = (env.PUBLIC_URL || '').replace(/\/$/, '');

export const config = {
  port: int('PORT', 3000),
  dataDir: path.resolve(env.DATA_DIR || './data'),
  mediaDir: path.resolve(env.MEDIA_DIR || './media'),
  adminPassword: env.ADMIN_PASSWORD || '',
  publicUrl,
  // The domain passkeys belong to, e.g. example.com for https://www.example.com.
  // Every passkey is tied to it for good: choose it before anyone sets one up.
  webauthnRpId: (env.WEBAUTHN_RP_ID || '').trim(),
  production,
  // "auto" marks cookies Secure when the request arrived over HTTPS (via Caddy).
  // A production site on https always marks them, so cookies stay Secure even if
  // the proxy isn't trusted (TRUST_PROXY) and the request looks like plain HTTP.
  cookieSecure: env.COOKIE_SECURE || (production && publicUrl.startsWith('https:') ? 'true' : 'auto'),
  viewerSessionDays: int('VIEWER_SESSION_DAYS', 90),
  adminSessionHours: int('ADMIN_SESSION_HOURS', 12),
  trustProxy: trustProxy(env.TRUST_PROXY),
  webDist: path.resolve(env.WEB_DIST || './dist'),
  // Daily database backups (see server/backup.js). BACKUP_DIR=off turns them off.
  backupDir: env.BACKUP_DIR === 'off' ? null : path.resolve(env.BACKUP_DIR || path.join(env.DATA_DIR || './data', 'backups')),
  backupHour: int('BACKUP_HOUR', 4, { min: 0, max: 23 }),
  backupKeepDays: int('BACKUP_KEEP_DAYS', 14, { min: 1 }),
  backupKeepMonths: int('BACKUP_KEEP_MONTHS', 12, { min: 0 }),
  // Optional: the folder the off-server copy of the backups lands in, as this
  // server sees it (mounted read-only), so the admin can show the newest copy.
  // Only read, never written. Unset: the admin says no copy is configured.
  backupCopyDir: env.BACKUP_COPY_DIR ? path.resolve(env.BACKUP_COPY_DIR) : null,
  // Film information and artwork. The key can also be set in the admin.
  tmdbApiKey: env.TMDB_API_KEY || '',
  tmdbApiBase: (env.TMDB_API_BASE || 'https://api.themoviedb.org/3').replace(/\/$/, ''),
  tmdbImageBase: (env.TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p').replace(/\/$/, ''),
};

// The origin for links the server writes out (tickets, setup links, link
// previews): PUBLIC_URL, or else the address this request came to.
export const publicOrigin = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;

export function assertConfig() {
  if (!config.adminPassword || config.adminPassword.length < 12) {
    throw new Error('ADMIN_PASSWORD must be set and at least 12 characters long');
  }
}
