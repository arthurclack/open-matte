import express from 'express';
import { config } from '../config.js';

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

const name = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw bad('A person needs a name');
  if (s.length > 80) throw bad('Names can be up to 80 characters');
  return s;
};
const note = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().slice(0, 1000));

// People, their passkeys and their links, for the admin. Mounted inside
// adminRoutes, after its sign-in check.
export function peopleRoutes({ db, people }) {
  const router = express.Router();
  const origin = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;

  const q = {
    all: db.prepare('SELECT * FROM people ORDER BY name COLLATE NOCASE'),
    counts: db.prepare(`
      SELECT (SELECT COUNT(*) FROM passkeys WHERE person_id = ?1) AS passkeys,
             (SELECT COUNT(*) FROM tickets WHERE person_id = ?1) AS tickets,
             (SELECT MAX(signed_in_at) FROM sessions WHERE person_id = ?1) AS lastSignedInAt,
             EXISTS (SELECT 1 FROM person_links WHERE person_id = ?1 AND used_at IS NOT NULL) AS setUp`),
    waiting: db.prepare(`
      SELECT purpose, created_at AS createdAt, expires_at AS expiresAt, opened_at AS openedAt FROM person_links
      WHERE person_id = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1`),
    passkeys: db.prepare(`
      SELECT k.id, k.device_type AS deviceType, k.backed_up AS synced, k.created_at AS addedAt, k.added_device AS addedDevice,
             k.last_used_at AS lastUsedAt, l.purpose AS viaLink
      FROM passkeys k LEFT JOIN person_links l ON l.id = k.link_id
      WHERE k.person_id = ? ORDER BY k.created_at`),
    browsers: db.prepare(`
      SELECT device, signed_in_at AS signedInAt, last_seen_at AS lastSeenAt, passkey_id AS passkeyId FROM sessions
      WHERE person_id = ? AND kind = 'viewer' AND revoked_at IS NULL AND expires_at > ?
      ORDER BY signed_in_at DESC`),
    links: db.prepare(`
      SELECT id, purpose, reset, created_at AS createdAt, expires_at AS expiresAt, opened_at AS openedAt,
             used_at AS usedAt, used_device AS usedDevice, cancelled_at AS cancelledAt
      FROM person_links WHERE person_id = ? ORDER BY created_at DESC LIMIT 20`),
  };

  // The note is for the admin only; nothing here ever goes to a viewer.
  function summary(p, now = Date.now()) {
    const c = q.counts.get(p.id);
    return {
      id: p.id,
      name: p.name,
      note: p.note,
      disabled: Boolean(p.disabled_at),
      disabledAt: p.disabled_at,
      createdAt: p.created_at,
      setUp: Boolean(c.setUp),
      passkeys: c.passkeys,
      tickets: c.tickets,
      lastSignedInAt: c.lastSignedInAt,
      linkWaiting: q.waiting.get(p.id, now) || null,
    };
  }

  function detail(p) {
    const now = Date.now();
    return {
      ...summary(p, now),
      passkeys: q.passkeys.all(p.id).map((k) => ({ ...k, synced: Boolean(k.synced) })),
      browsers: q.browsers.all(p.id, now),
      links: q.links.all(p.id).map((l) => ({ ...l, reset: Boolean(l.reset) })),
    };
  }

  router.get('/api/admin/people', (req, res) => {
    const now = Date.now();
    res.json(q.all.all().map((p) => summary(p, now)));
  });

  router.post('/api/admin/people', (req, res) => {
    const p = people.create({ name: name(req.body?.name), note: note(req.body?.note) });
    res.status(201).json(detail(p));
  });

  router.get('/api/admin/people/:id', (req, res) => res.json(detail(people.getPerson(req.params.id))));

  router.patch('/api/admin/people/:id', (req, res) => {
    const b = req.body || {};
    const p = people.update(req.params.id, { name: 'name' in b ? name(b.name) : undefined, note: 'note' in b ? note(b.note) : undefined });
    res.json(detail(p));
  });

  // The only response that ever contains the link.
  router.post('/api/admin/people/:id/links', (req, res) => {
    const b = req.body || {};
    const r = people.createLink(req.params.id, { hours: b.hours, reset: b.reset === true, confirmedContact: b.confirmedContact === true, ticketId: b.ticketId ?? null }, origin(req));
    res.status(201).json(r);
  });

  router.post('/api/admin/people/:id/links/cancel', (req, res) => res.json(detail(people.cancelLinks(req.params.id))));

  router.post('/api/admin/people/:id/sign-out', (req, res) => {
    res.json({ signedOut: people.signOutEverywhere(req.params.id, 'admin') });
  });

  router.post('/api/admin/people/:id/disable', (req, res) => res.json(detail(people.disable(req.params.id))));
  router.post('/api/admin/people/:id/enable', (req, res) => res.json(detail(people.enable(req.params.id))));

  router.post('/api/admin/passkeys/:id/remove', (req, res) => res.json(people.removePasskey(req.params.id)));

  return router;
}
