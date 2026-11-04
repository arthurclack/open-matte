// Passkeys (WebAuthn). The only place that calls @simplewebauthn/server, so its
// options are pinned here and nowhere else.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

// ES256, EdDSA, RS256. Without this, v14 offers ML-DSA first.
export const ALGS = [-7, -8, -257];
const TIMEOUT = 5 * 60 * 1000;
const DEV_ORIGIN = /^http:\/\/localhost(:\d{1,5})?$/;

// The standard says to refuse a longer credential id, and the library doesn't.
const MAX_CREDENTIAL_ID_BYTES = 1023;
// The transports a browser can report: the standard's, and Chrome's older "cable".
// The browser's list is only a hint for excludeCredentials, and the library passes
// it on unchecked, so anything else is dropped rather than kept and sent back with
// every later link for that person.
const TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);
const knownTransports = (list) => (Array.isArray(list) ? [...new Set(list.filter((t) => TRANSPORTS.has(t)))] : null);

// Why a response was refused. The message goes to the server log, never to the
// browser; `reason` is set when the caller should record it ('counter').
export class PasskeyError extends Error {
  constructor(message, reason = null) {
    super(message);
    this.reason = reason;
  }
}

// The relying party: the domain passkeys belong to, and the origins allowed to use
// them. In development that is localhost on any port; in production PUBLIC_URL's
// origin exactly, with WEBAUTHN_RP_ID chosen explicitly. `problem` says why passkeys
// can't be used, and the rest of the site carries on without them.
export function relyingParty({ publicUrl = '', rpId = '', production = false } = {}) {
  let url = null;
  if (publicUrl) {
    try {
      url = new URL(publicUrl);
    } catch {
      return unavailable(rpId, 'PUBLIC_URL is not a valid address');
    }
  }
  if (!production && (!url || url.hostname === 'localhost')) {
    return { id: 'localhost', origin: null, originFor: (o) => (typeof o === 'string' && DEV_ORIGIN.test(o) ? o : null), problem: null };
  }
  if (!url) return unavailable(rpId, 'PUBLIC_URL is not set');
  if (!rpId) {
    return unavailable(rpId, 'WEBAUTHN_RP_ID is not set. Choose it before anyone sets up a passkey: every passkey is tied to it for good.');
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(rpId) || /^[\d.]+$/.test(rpId)) {
    return unavailable(rpId, `WEBAUTHN_RP_ID "${rpId}" must be a lowercase domain name such as example.com, with no scheme, port or path`);
  }
  const host = url.hostname;
  if (host !== rpId && !host.endsWith(`.${rpId}`)) return unavailable(rpId, `${host} is not ${rpId} or one of its subdomains`);
  if (url.protocol !== 'https:') return unavailable(rpId, 'Passkeys need PUBLIC_URL to be https');
  const origin = url.origin;
  return { id: rpId, origin, originFor: (o) => (o === origin ? o : null), problem: null };
}

const unavailable = (rpId, problem) => ({ id: rpId || null, origin: null, originFor: () => null, problem });

// clientDataJSON as the browser sent it, or null if it doesn't parse.
export function clientData(credential) {
  try {
    const json = JSON.parse(Buffer.from(String(credential?.response?.clientDataJSON ?? ''), 'base64url').toString('utf8'));
    return json && typeof json === 'object' && !Array.isArray(json) ? json : null;
  } catch {
    return null;
  }
}

export function registrationOptions(rp, { rpName, person, existing = [] }) {
  return generateRegistrationOptions({
    rpName,
    rpID: rp.id,
    userID: Buffer.from(person.webauthn_user_id, 'base64url'),
    userName: person.name,
    userDisplayName: person.name,
    timeout: TIMEOUT,
    attestationType: 'none',
    supportedAlgorithmIDs: ALGS,
    excludeCredentials: existing.map((k) => ({ id: k.credential_id, transports: transports(k) })),
    // A fresh object every call: the library mutates it.
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
}

// No allowCredentials: people have no username, and credential ids never go to
// someone who hasn't proved who they are.
export const signInOptions = (rp) => generateAuthenticationOptions({ rpID: rp.id, timeout: TIMEOUT, userVerification: 'preferred' });

// Our own checks first: the library only refuses a cross-origin response when the
// browser sends topOrigin, which Safari doesn't, and takes exact origin strings.
function checkClient(rp, credential, type) {
  const cd = clientData(credential);
  if (!cd) throw new PasskeyError('clientDataJSON is unreadable');
  if (cd.type !== type) throw new PasskeyError(`type is ${cd.type}`);
  if (cd.crossOrigin === true) throw new PasskeyError('cross-origin response');
  const origin = rp.originFor(cd.origin);
  if (!origin) throw new PasskeyError(`origin ${cd.origin} is not allowed`);
  return origin;
}

// A thrown error and `verified: false` both mean no: the library returns the
// latter for some bad signatures.
async function verified(run) {
  let r;
  try {
    r = await run();
  } catch (err) {
    throw new PasskeyError(err.message);
  }
  if (!r?.verified) throw new PasskeyError('not verified');
  return r;
}

export async function verifyRegistration(rp, credential, challenge) {
  const origin = checkClient(rp, credential, 'webauthn.create');
  const { registrationInfo: info } = await verified(() =>
    verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rp.id,
      requireUserVerification: false,
      supportedAlgorithmIDs: ALGS,
    }),
  );
  if (Buffer.from(info.credential.id, 'base64url').length > MAX_CREDENTIAL_ID_BYTES) throw new PasskeyError('credential id is too long');
  return {
    credentialId: info.credential.id,
    publicKey: info.credential.publicKey,
    counter: info.credential.counter,
    // The library's copy is the browser's response.transports, as it was sent.
    transports: knownTransports(info.credential.transports),
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    aaguid: info.aaguid,
  };
}

// The counter is checked here, after the signature, rather than by the library, so
// a refusal is known to be about the counter (the only sign of a cloned device-bound
// key) and never comes from a forged response. Synced passkeys always report 0.
export async function verifySignIn(rp, credential, challenge, passkey) {
  const origin = checkClient(rp, credential, 'webauthn.get');
  const { authenticationInfo: info } = await verified(() =>
    verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rp.id,
      requireUserVerification: false,
      credential: { id: passkey.credential_id, publicKey: passkey.public_key, counter: 0, transports: transports(passkey) },
    }),
  );
  const stored = passkey.sign_count;
  if ((info.newCounter > 0 || stored > 0) && info.newCounter <= stored) {
    throw new PasskeyError(`counter ${info.newCounter} didn't move on from ${stored}`, 'counter');
  }
  return { newCounter: info.newCounter, backedUp: info.credentialBackedUp };
}

// Filtered again on the way out, for passkeys stored before the filter above.
function transports(passkey) {
  try {
    return knownTransports(JSON.parse(passkey.transports || '[]')) ?? undefined;
  } catch {
    return undefined;
  }
}
