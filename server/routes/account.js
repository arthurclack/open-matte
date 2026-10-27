import express from 'express';
import { VIEWER_COOKIE, clearCookie } from '../sessions.js';

// Signing in with a passkey, creating one from a setup or recovery link, and
// signing out. None of it is needed to watch with a ticket for anyone.
export function accountRoutes({ sessions, people, limit }) {
  const router = express.Router();
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

  return router;
}
