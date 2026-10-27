// People and their passkeys: adding people, setup and recovery links, creating a
// passkey from a link, and signing in. Nothing here grants access to a film; a
// signed-in session is all it produces, and access.js decides the rest.
import crypto from 'node:crypto';
import { tx } from './db.js';
import { deviceLabel, randomToken, sha256 } from './sessions.js';
import { PasskeyError, clientData, registrationOptions, signInOptions, verifyRegistration, verifySignIn } from './webauthn.js';

const HOUR = 60 * 60 * 1000;
// How long a link works, in hours. Recovery links are the most attractive to
// steal, so they're the shortest.
export const LINK_HOURS = { setup: [1, 24, 72, 168], recovery: [1, 24] };
const DEFAULT_HOURS = { setup: 72, recovery: 1 };

// Errors carry the code the browser sees; app.js turns them into JSON.
const fail = (code, status) => Object.assign(new Error(code), { status });

export function createPeople({ db, sessions, access, settings, rp, ceremonies }) {
  const q = {
    person: db.prepare('SELECT * FROM people WHERE id = ?'),
    insertPerson: db.prepare('INSERT INTO people (name, note, webauthn_user_id, created_at) VALUES (?, ?, ?, ?)'),
    setUp: db.prepare('SELECT 1 FROM person_links WHERE person_id = ? AND used_at IS NOT NULL LIMIT 1'),
    linkByHash: db.prepare('SELECT * FROM person_links WHERE token_hash = ?'),
    // Only links still waiting: an expired one keeps showing as expired.
    cancelLinks: db.prepare('UPDATE person_links SET cancelled_at = ?1 WHERE person_id = ?2 AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?1'),
    names: db.prepare('SELECT id, name FROM people'),
    insertLink: db.prepare(`
      INSERT INTO person_links (person_id, token_hash, purpose, reset, ticket_id, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
    opened: db.prepare('UPDATE person_links SET opened_at = ? WHERE id = ? AND opened_at IS NULL'),
    useLink: db.prepare(`
      UPDATE person_links SET used_at = ?, used_device = ?
      WHERE id = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?`),
    passkeysOf: db.prepare('SELECT * FROM passkeys WHERE person_id = ? ORDER BY created_at'),
    ticketFor: db.prepare('SELECT * FROM tickets WHERE id = ? AND person_id = ? AND revoked_at IS NULL'),
    // Still this person's and not revoked: a restored ticket shows its film again at once.
    filmOf: db.prepare(`
      SELECT f.slug, f.title, f.published FROM tickets t JOIN films f ON f.id = t.film_id
      WHERE t.id = ? AND t.person_id = ? AND t.revoked_at IS NULL`),
    passkey: db.prepare('SELECT * FROM passkeys WHERE id = ?'),
    passkeyByCredential: db.prepare('SELECT * FROM passkeys WHERE credential_id = ?'),
    insertPasskey: db.prepare(`
      INSERT INTO passkeys (person_id, credential_id, public_key, sign_count, device_type, backed_up, transports, aaguid, added_device, link_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    deletePasskeys: db.prepare('DELETE FROM passkeys WHERE person_id = ?'),
    deletePasskey: db.prepare('DELETE FROM passkeys WHERE id = ?'),
    // Compare-and-set, so two sign-ins with one device-bound key can't both pass the counter check.
    used: db.prepare('UPDATE passkeys SET sign_count = ?, backed_up = ?, last_used_at = ? WHERE id = ? AND sign_count = ?'),
    addedSince: db.prepare(`
      SELECT created_at AS addedAt, added_device AS device FROM passkeys
      WHERE person_id = ? AND id <> ? AND created_at > ? ORDER BY created_at`),
  };

  const event = (type, personId, detail, extra = {}, now = Date.now()) => access.logEvent(type, { personId, detail, ...extra }, now);

  function getPerson(id) {
    const p = q.person.get(Number(id));
    if (!p) throw fail('person-not-found', 404);
    return p;
  }

  const available = () => {
    if (rp.problem) throw fail('passkeys-unavailable', 503);
  };

  // ---------------------------------------------------------------- people (admin)
  // Names are unique ignoring case and Unicode form ('Élodie' and 'élodie' are one
  // name; 'Elodie' is another). SQLite's NOCASE only folds ASCII, so the index is a
  // backstop and this is the check. Runs inside the caller's write transaction.
  function nameTaken(name, selfId = null) {
    return q.names.all().some((x) => x.id !== selfId && x.name.normalize('NFC').localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
  }

  const unique = (fn) => {
    try {
      return tx(db, fn, { immediate: true });
    } catch (err) {
      if (/UNIQUE constraint failed: people\.name/.test(err.message)) throw fail('name-taken', 409);
      throw err;
    }
  };

  function create({ name, note }) {
    name = name.normalize('NFC');
    return unique(() => {
      if (nameTaken(name)) throw fail('name-taken', 409);
      const r = q.insertPerson.run(name, note, crypto.randomBytes(32).toString('base64url'), Date.now());
      return getPerson(r.lastInsertRowid);
    });
  }

  function update(id, { name, note }) {
    return unique(() => {
      const p = getPerson(id);
      const sets = [];
      const args = [];
      if (name !== undefined) {
        name = name.normalize('NFC');
        if (nameTaken(name, p.id)) throw fail('name-taken', 409);
        sets.push('name = ?'), args.push(name);
      }
      if (note !== undefined) sets.push('note = ?'), args.push(note);
      if (sets.length) db.prepare(`UPDATE people SET ${sets.join(', ')} WHERE id = ?`).run(...args, p.id);
      return getPerson(p.id);
    });
  }

  // Signed out everywhere, links cancelled, and unable to sign in until enabled.
  // Passkeys stay: for a lost or stolen device, use a reset instead.
  function disable(id) {
    return tx(db, () => {
      const p = getPerson(id);
      if (p.disabled_at) return p;
      const now = Date.now();
      db.prepare('UPDATE people SET disabled_at = ? WHERE id = ?').run(now, p.id);
      const signedOut = sessions.revokePersonSessions(p.id, now);
      q.cancelLinks.run(now, p.id);
      event('person-disabled', p.id, { signedOut }, {}, now);
      return getPerson(p.id);
    }, { immediate: true });
  }

  function enable(id) {
    const p = getPerson(id);
    if (!p.disabled_at) return p;
    db.prepare('UPDATE people SET disabled_at = NULL WHERE id = ?').run(p.id);
    event('person-enabled', p.id);
    return getPerson(p.id);
  }

  function signOutEverywhere(id, by) {
    const p = getPerson(id);
    const signedOut = sessions.revokePersonSessions(p.id);
    event('signed-out-everywhere', p.id, { by, signedOut });
    return signedOut;
  }

  // Sign out the browsers it signed in first: deleting it first would set their
  // passkey_id to NULL and leave nothing to revoke.
  function removePasskey(passkeyId) {
    return tx(db, () => {
      const k = q.passkey.get(Number(passkeyId));
      if (!k) throw fail('passkey-not-found', 404);
      const now = Date.now();
      const signedOut = sessions.revokePasskeySessions(k.id, now);
      q.deletePasskey.run(k.id);
      event('passkey-removed', k.person_id, { device: k.added_device, signedOut }, {}, now);
      return { signedOut };
    }, { immediate: true });
  }

  // ---------------------------------------------------------------- links (admin)
  // The link is returned here and nowhere else: only its hash is kept.
  function createLink(id, { hours, reset = false, confirmedContact = false, ticketId = null }, origin) {
    available();
    const token = randomToken(32);
    const result = tx(db, () => {
      const p = getPerson(id);
      if (p.disabled_at) throw fail('person-disabled', 409);
      // Once someone has ever set up a passkey, every later link is a recovery
      // link, even after their last passkey was removed.
      const purpose = q.setUp.get(p.id) ? 'recovery' : 'setup';
      const h = hours ?? DEFAULT_HOURS[purpose];
      if (!LINK_HOURS[purpose].includes(h)) throw fail('bad-hours', 400);
      if (purpose === 'recovery' && confirmedContact !== true) throw fail('confirm-contact', 400);
      // A link can carry a ticket for this person, so a new friend gets one link that ends on the film.
      if (ticketId != null && !q.ticketFor.get(Number(ticketId), p.id)) throw fail('bad-ticket', 400);
      const now = Date.now();
      const resetting = purpose === 'recovery' && reset === true;
      q.cancelLinks.run(now, p.id);
      let browsersSignedOut = 0;
      let passkeysRemoved = 0;
      if (resetting) {
        // Now, not when the link is used: a stolen phone is cut off at once.
        browsersSignedOut = sessions.revokePersonSessions(p.id, now);
        passkeysRemoved = Number(q.deletePasskeys.run(p.id).changes);
      }
      const expiresAt = now + h * HOUR;
      q.insertLink.run(p.id, sha256(token), purpose, resetting ? 1 : 0, ticketId != null ? Number(ticketId) : null, now, expiresAt);
      event('link-created', p.id, { purpose, reset: resetting, hours: h, passkeysRemoved, browsersSignedOut }, {}, now);
      return { purpose, expiresAt };
    }, { immediate: true });
    return { link: `${origin}/enroll#${token}`, ...result };
  }

  function cancelLinks(id) {
    const p = getPerson(id);
    // Logs only when a link was actually waiting.
    const n = Number(q.cancelLinks.run(Date.now(), p.id).changes);
    if (n) event('link-cancelled', p.id);
    return getPerson(p.id);
  }

  // ---------------------------------------------------------------- creating a passkey from a link
  function liveLink(token) {
    const link = typeof token === 'string' && token ? q.linkByHash.get(sha256(token)) : null;
    if (!link) throw fail('link-unknown', 404);
    if (link.used_at) throw fail('link-used', 410);
    if (link.cancelled_at) throw fail('link-cancelled', 410);
    if (link.expires_at <= Date.now()) throw fail('link-expired', 410);
    return link;
  }

  // The film a link carries, while it is published; the ticket itself is checked as usual.
  function linkFilm(link) {
    const f = link.ticket_id != null ? q.filmOf.get(link.ticket_id, link.person_id) : null;
    return f?.published ? { slug: f.slug, title: f.title } : null;
  }

  // Opening the page uses nothing up: link previews and scanners can't spend a link.
  async function enrollOptions(token) {
    available();
    const link = liveLink(token);
    const person = getPerson(link.person_id);
    q.opened.run(Date.now(), link.id);
    const options = await registrationOptions(rp, { rpName: settings.get().cinemaName, person, existing: q.passkeysOf.all(person.id) });
    ceremonies.beginEnroll(link.id, options.challenge);
    return { person: { name: person.name }, purpose: link.purpose, reset: Boolean(link.reset), expiresAt: link.expires_at, film: linkFilm(link), options };
  }

  // Only a passkey actually created uses a link up. Two browsers finishing one
  // link: BEGIN IMMEDIATE serialises them, the first wins and the second gets link-used.
  async function enrollFinish(req, token, credential, currentHash) {
    available();
    let link = liveLink(token);
    const challenge = clientData(credential)?.challenge;
    const entry = ceremonies.take('enroll', challenge);
    if (!entry || entry.linkId !== link.id) throw fail('ceremony-expired', 400);
    let reg;
    try {
      reg = await verifyRegistration(rp, credential, challenge);
    } catch (err) {
      if (!(err instanceof PasskeyError)) throw err;
      console.warn(`Passkey not created from a link: ${err.message}`);
      throw fail('passkey-invalid', 400);
    }
    const now = Date.now();
    const device = deviceLabel(req.get('user-agent'));
    return tx(db, () => {
      if (Number(q.useLink.run(now, device, link.id, now).changes) !== 1) {
        link = q.linkByHash.get(link.token_hash);
        throw fail(link.used_at ? 'link-used' : link.cancelled_at ? 'link-cancelled' : 'link-expired', 410);
      }
      const person = getPerson(link.person_id);
      let passkeyId;
      try {
        passkeyId = Number(
          q.insertPasskey.run(
            person.id, reg.credentialId, reg.publicKey, reg.counter, reg.deviceType, reg.backedUp ? 1 : 0,
            reg.transports ? JSON.stringify(reg.transports) : null, reg.aaguid ?? null, device, link.id, now,
          ).lastInsertRowid,
        );
      } catch (err) {
        // Rolls back, so the link isn't used up.
        if (/UNIQUE constraint failed: passkeys\.credential_id/.test(err.message)) throw fail('passkey-exists', 409);
        throw err;
      }
      const signedIn = sessions.signIn(req, { personId: person.id, passkeyId, currentHash }, now);
      event('passkey-added', person.id, { via: link.purpose, device }, { sessionHash: signedIn.session.id_hash }, now);
      return { ...signedIn, person: { name: person.name }, slug: linkFilm(link)?.slug ?? null };
    }, { immediate: true });
  }

  // ---------------------------------------------------------------- signing in
  async function signInStart() {
    available();
    const options = await signInOptions(rp);
    if (!ceremonies.beginSignIn(options.challenge)) throw fail('busy', 429);
    return { options };
  }

  async function signInFinish(req, credential, currentHash) {
    available();
    const challenge = clientData(credential)?.challenge;
    if (!ceremonies.take('signin', challenge)) throw fail('ceremony-expired', 400);
    const id = typeof credential?.id === 'string' ? credential.id : '';
    // Unknown credentials aren't logged: there is nobody to log them against.
    const before = id && q.passkeyByCredential.get(id);
    if (!before) throw fail('passkey-unknown', 401);
    let result;
    try {
      result = await verifySignIn(rp, credential, challenge, before);
    } catch (err) {
      if (!(err instanceof PasskeyError)) throw err;
      console.warn(`Passkey sign-in refused: ${err.message}`);
      if (err.reason === 'counter') event('sign-in-refused', before.person_id, { reason: 'counter', device: before.added_device });
      throw fail('sign-in-failed', 401);
    }
    const owner = q.person.get(before.person_id);
    if (!owner || credential.response?.userHandle !== owner.webauthn_user_id) throw fail('sign-in-failed', 401);

    const now = Date.now();
    // Refusals return rather than throw, so their events survive the transaction.
    const r = tx(db, () => {
      // Removed, or the person reset, while we were checking the signature.
      const k = q.passkey.get(before.id);
      if (!k) return { error: fail('passkey-unknown', 401) };
      const person = getPerson(k.person_id);
      // Reported only after a valid signature, so nobody can learn it without the passkey.
      if (person.disabled_at) {
        event('sign-in-refused', person.id, { reason: 'disabled', device: k.added_device }, {}, now);
        return { error: fail('account-disabled', 403) };
      }
      // Against the counter the signature was checked with: if another sign-in has
      // moved it on meanwhile, this one loses, and the stored counter never goes back.
      if (Number(q.used.run(result.newCounter, result.backedUp ? 1 : 0, now, k.id, before.sign_count).changes) !== 1) {
        return { error: fail('try-again', 409) };
      }
      // Passkeys added since this one was last used. Only someone holding this
      // passkey can move that point, so one added from an intercepted link (and
      // perhaps used elsewhere since) is still reported to its owner.
      const newPasskeys = q.addedSince.all(person.id, k.id, k.last_used_at ?? k.created_at);
      const signedIn = sessions.signIn(req, { personId: person.id, passkeyId: k.id, currentHash }, now);
      event('signed-in', person.id, { device: deviceLabel(req.get('user-agent')) }, { sessionHash: signedIn.session.id_hash }, now);
      return { ...signedIn, person: { name: person.name }, newPasskeys };
    }, { immediate: true });
    if (r.error) throw r.error;
    return r;
  }

  function signOut(viewer) {
    if (!viewer) return;
    sessions.revoke(viewer.id_hash);
    if (viewer.person_id != null) event('signed-out', viewer.person_id, null, { sessionHash: viewer.id_hash });
  }

  return {
    getPerson, create, update, disable, enable, signOutEverywhere, removePasskey,
    createLink, cancelLinks, enrollOptions, enrollFinish, signInStart, signInFinish, signOut,
  };
}
