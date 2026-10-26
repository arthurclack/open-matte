import crypto from 'node:crypto';
import { config } from './config.js';

export const VIEWER_COOKIE = 'om_session';
export const ADMIN_COOKIE = 'om_admin';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
// Avoid a write on every segment request: only bump last_seen this often.
const TOUCH_INTERVAL = 5 * 60 * 1000;

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// Ticket codes go in links people paste into chats: short, unambiguous, ~65 bits.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function ticketCode(length = 13) {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}

// Enough for the admin to tell devices apart; the full user agent isn't kept.
export function deviceLabel(ua = '') {
  // On iPhone every browser is Safari underneath, but says which it is: EdgiOS, FxiOS, CriOS.
  const browser =
    /Edg\/|EdgiOS\/|EdgA\//.test(ua) ? 'Edge'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const os =
    /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'unknown device';
  return `${browser} on ${os}`;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // Ignore malformed cookies rather than failing the request.
    }
  }
  return out;
}

function isSecure(req) {
  if (config.cookieSecure === 'true') return true;
  if (config.cookieSecure === 'false') return false;
  return req.secure;
}

export function setCookie(req, res, name, value, maxAgeMs) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeMs !== undefined) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (isSecure(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function clearCookie(req, res, name) {
  setCookie(req, res, name, '', 0);
}

export function createSessionStore(db) {
  const q = {
    insert: db.prepare(`INSERT INTO sessions (id_hash, kind, device, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`),
    get: db.prepare(`SELECT * FROM sessions WHERE id_hash = ? AND kind = ?`),
    touch: db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?`),
    revoke: db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL`),
  };

  function create(req, res, kind) {
    const token = randomToken();
    const now = Date.now();
    const ttl = kind === 'admin' ? config.adminSessionHours * HOUR : config.viewerSessionDays * DAY;
    const idHash = sha256(token);
    q.insert.run(idHash, kind, deviceLabel(req.get('user-agent')), now, now, now + ttl);
    setCookie(req, res, kind === 'admin' ? ADMIN_COOKIE : VIEWER_COOKIE, token, ttl);
    return q.get.get(idHash, kind);
  }

  function load(req, kind) {
    const cookies = req.cookies || (req.cookies = parseCookies(req.headers.cookie));
    const token = cookies[kind === 'admin' ? ADMIN_COOKIE : VIEWER_COOKIE];
    if (!token) return null;
    const row = q.get.get(sha256(token), kind);
    const now = Date.now();
    if (!row || row.revoked_at || row.expires_at <= now) return null;
    if (now - row.last_seen_at > TOUCH_INTERVAL) q.touch.run(now, row.id_hash);
    return row;
  }

  function revoke(idHash) {
    q.revoke.run(Date.now(), idHash);
  }

  return { create, load, revoke };
}
