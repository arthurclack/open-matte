import express from 'express';
import { VIEWER_COOKIE, clearCookie } from '../sessions.js';

// Signing in with a passkey, creating one from a setup or recovery link, signing
// out, and the person's account page. None of it is needed to watch with a ticket
// for anyone.
export function accountRoutes({ db, sessions, people, limit }) {
  const router = express.Router();
  const q = {
    passkeys: db.prepare(`
      SELECT k.id, k.backed_up, k.created_at, k.added_device, k.last_used_at, l.purpose
      FROM passkeys k LEFT JOIN person_links l ON l.id = k.link_id
      WHERE k.person_id = ? ORDER BY k.created_at`),
    browsers: db.prepare(`
      SELECT id_hash, device, signed_in_at, last_seen_at FROM sessions
      WHERE person_id = ? AND kind = 'viewer' AND revoked_at IS NULL AND expires_at > ?
      ORDER BY signed_in_at DESC`),
  };
  // A browser signed in as a person, or a 401.
  const signedIn = (req, res) => {
    const viewer = sessions.load(req, 'viewer');
    if (viewer?.person_id != null) return viewer;
    res.status(401).json({ error: 'sign-in-required' });
    return null;
  };
  const enrollLimit = limit({ windowMs: 15 * 60 * 1000, max: 20 });
  const signInOptionsLimit = limit({ windowMs: 10 * 60 * 1000, max: 60 });
  const signInLimit = limit({ windowMs: 10 * 60 * 1000, max: 30 });

  // The browser's current session, so signing in can carry its tickets over.
  const current = (req) => sessions.load(req, 'viewer')?.id_hash ?? null;

  router.post('/api/enroll/options', enrollLimit, async (req, res) => {
    res.json(await people.enrollOptions(req.body?.token));
  });

  router.post('/api/enroll/finish', enrollLimit, async (req, res) => {
    const r = await people.enrollFinish(req, req.body?.token, req.body?.credential, current(req));
    sessions.setViewerCookie(req, res, r.token, r.ttl);
    res.json({ person: r.person, slug: r.slug });
  });

  router.post('/api/signin/options', signInOptionsLimit, async (req, res) => {
    res.json(await people.signInStart());
  });

  router.post('/api/signin/finish', signInLimit, async (req, res) => {
    const r = await people.signInFinish(req, req.body?.credential, current(req));
    sessions.setViewerCookie(req, res, r.token, r.ttl);
    res.json({ person: r.person, newPasskeys: r.newPasskeys });
  });

  // Also forgets the link tickets this browser opened; the links still work.
  router.post('/api/signout', (req, res) => {
    people.signOut(sessions.load(req, 'viewer'));
    clearCookie(req, res, VIEWER_COOKIE);
    res.json({ ok: true });
  });

  // The signed-in person's passkeys and the browsers signed in as them. Only ever
  // their own, and no ids or session hashes: there's nothing to act on here
  // except signing out.
  router.get('/api/account', (req, res) => {
    const viewer = signedIn(req, res);
    if (!viewer) return;
    const now = Date.now();
    res.json({
      person: { name: viewer.person_name },
      passkeys: q.passkeys.all(viewer.person_id).map((k) => ({
        synced: Boolean(k.backed_up),
        addedAt: k.created_at,
        addedFrom: k.added_device,
        viaLink: k.purpose, // setup | recovery
        lastUsedAt: k.last_used_at,
        current: k.id === viewer.passkey_id,
      })),
      browsers: q.browsers.all(viewer.person_id, now).map((s) => ({
        device: s.device,
        signedInAt: s.signed_in_at,
        lastSeenAt: s.last_seen_at,
        current: s.id_hash === viewer.id_hash,
      })),
    });
  });

  // Signs the person out of every browser, this one included. Their passkeys
  // still work, and each browser forgets the link tickets it opened.
  router.post('/api/account/sign-out-everywhere', (req, res) => {
    const viewer = signedIn(req, res);
    if (!viewer) return;
    const signedOut = people.signOutEverywhere(viewer.person_id, 'person', viewer.id_hash);
    clearCookie(req, res, VIEWER_COOKIE);
    res.json({ signedOut });
  });

  return router;
}
