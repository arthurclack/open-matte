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
    insertSignedIn: db.prepare(`
      INSERT INTO sessions (id_hash, kind, device, created_at, last_seen_at, expires_at, person_id, passkey_id, signed_in_at)
      VALUES (?, 'viewer', ?, ?, ?, ?, ?, ?, ?)`),
    get: db.prepare(`
      SELECT s.*, p.name AS person_name, p.disabled_at AS person_disabled_at, p.id AS person_found
      FROM sessions s LEFT JOIN people p ON p.id = s.person_id
      WHERE s.id_hash = ? AND s.kind = ?`),
    touch: db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?`),
    revoke: db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL`),
    moveTickets: db.prepare('UPDATE session_tickets SET session_hash = ? WHERE session_hash = ?'),
    moveScreenings: db.prepare('UPDATE screenings SET session_hash = ? WHERE session_hash = ?'),
    // Live sessions only: expired ones are refused anyway, and counting them would
    // tell the admin more browsers were signed out than were ever shown.
    revokePerson: db.prepare(`UPDATE sessions SET revoked_at = ?1 WHERE person_id = ?2 AND revoked_at IS NULL AND expires_at > ?1`),
    revokePasskey: db.prepare(`UPDATE sessions SET revoked_at = ?1 WHERE passkey_id = ?2 AND revoked_at IS NULL AND expires_at > ?1`),
  };

  // Live: not revoked or expired, and if signed in, its person still exists and isn't disabled.
  const live = (row, now) =>
    Boolean(row) && !row.revoked_at && row.expires_at > now && (row.person_id == null || (row.person_found != null && !row.person_disabled_at));

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
    // Disabling a person also revokes their sessions; checking here as well means
    // "from the next request" holds even if that write were ever missed.
    if (!live(row, now)) return null;
    if (now - row.last_seen_at > TOUCH_INTERVAL) q.touch.run(now, row.id_hash);
    return row;
  }

  function revoke(idHash) {
    q.revoke.run(Date.now(), idHash);
  }

  // Signing in always makes a new session and cookie, so a planted cookie never
  // becomes a signed-in one. Runs inside the caller's IMMEDIATE transaction (tx()
  // can't nest), and re-reads the browser's current session there because the
  // passkey check awaited before the transaction began. Link tickets and a held
  // screening come along only from an anonymous session or the same person's. The
  // caller sets the cookie after COMMIT, so a rolled-back sign-in never sends one.
  function signIn(req, { personId, passkeyId, currentHash = null }, now = Date.now()) {
    const token = randomToken();
    const idHash = sha256(token);
    const ttl = config.viewerSessionDays * DAY;
    q.insertSignedIn.run(idHash, deviceLabel(req.get('user-agent')), now, now, now + ttl, personId, passkeyId, now);
    const current = currentHash ? q.get.get(currentHash, 'viewer') : null;
    if (current && current.id_hash !== idHash) {
      if (live(current, now) && (current.person_id == null || current.person_id === personId)) {
        q.moveTickets.run(idHash, current.id_hash);
        q.moveScreenings.run(idHash, current.id_hash);
      }
      q.revoke.run(now, current.id_hash);
    }
    return { token, ttl, session: q.get.get(idHash, 'viewer') };
  }

  const setViewerCookie = (req, res, token, ttl) => setCookie(req, res, VIEWER_COOKIE, token, ttl);

  // Each returns how many browsers it signed out.
  const revokePersonSessions = (personId, now = Date.now()) => Number(q.revokePerson.run(now, personId).changes);
  const revokePasskeySessions = (passkeyId, now = Date.now()) => Number(q.revokePasskey.run(now, passkeyId).changes);

  return { create, load, revoke, signIn, setViewerCookie, revokePersonSessions, revokePasskeySessions };
}
