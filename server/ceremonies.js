// WebAuthn challenges waiting for their answer, in memory: each lasts five minutes
// and is taken once, whatever the outcome. A restart loses them, and the page simply
// asks for another tap. Two pools, so a flood of anonymous sign-in attempts can't
// push out a setup that is under way.
export function createCeremonies({ ttlMs = 5 * 60 * 1000, signInMax = 500, perLink = 3, now = Date.now } = {}) {
  const signIn = new Map(); // challenge -> { expiresAt }
  const enroll = new Map(); // challenge -> { linkId, expiresAt }

  const sweep = (pool) => {
    const t = now();
    for (const [k, v] of pool) if (v.expiresAt <= t) pool.delete(k);
  };

  return {
    // False when the pool is full: the caller answers 429 rather than evicting anyone.
    beginSignIn(challenge) {
      sweep(signIn);
      if (signIn.size >= signInMax) return false;
      signIn.set(challenge, { expiresAt: now() + ttlMs });
      return true;
    },
    // Only a valid link token gets here, so a fourth try just replaces that link's oldest.
    beginEnroll(linkId, challenge) {
      sweep(enroll);
      const mine = [...enroll].filter(([, v]) => v.linkId === linkId);
      if (mine.length >= perLink) enroll.delete(mine[0][0]);
      enroll.set(challenge, { linkId, expiresAt: now() + ttlMs });
    },
    take(purpose, challenge) {
      const pool = purpose === 'signin' ? signIn : enroll;
      if (typeof challenge !== 'string') return null;
      const entry = pool.get(challenge);
      pool.delete(challenge);
      return entry && entry.expiresAt > now() ? entry : null;
    },
  };
}
