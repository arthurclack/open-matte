// A software passkey for tests: what a browser and passkey provider would send,
// with every field the server checks open to forgery.
import crypto from 'node:crypto';

// Minimal deterministic CBOR encoder: unsigned/negative ints, byte/text strings, arrays, maps.
function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}
export function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error(`cbor: unsupported ${typeof v}`);
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const b64u = (b) => Buffer.from(b).toString('base64url');
const FLAGS = { up: 0x01, uv: 0x04, be: 0x08, bs: 0x10, at: 0x40 };

function authData({ rpId, flags, counter, attested }) {
  const head = Buffer.alloc(37);
  sha256(rpId).copy(head, 0);
  head[32] = flags;
  head.writeUInt32BE(counter, 33);
  return attested ? Buffer.concat([head, attested]) : head;
}

// One passkey. Options let tests forge every field the server must check.
export function softAuthenticator({ origin = 'http://localhost:5173', rpId = 'localhost', synced = true, alg = -7 } = {}) {
  const { publicKey, privateKey } =
    alg === -8 ? crypto.generateKeyPairSync('ed25519')
    : alg === -257 ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    : crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const id = crypto.randomBytes(16);
  let counter = 0;
  let userHandle = null;
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = alg === -8
    ? new Map([[1, 1], [3, -8], [-1, 6], [-2, Buffer.from(jwk.x, 'base64url')]])
    : alg === -257
    ? new Map([[1, 3], [3, -257], [-1, Buffer.from(jwk.n, 'base64url')], [-2, Buffer.from(jwk.e, 'base64url')]])
    : new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  const baseFlags = FLAGS.up | FLAGS.uv | (synced ? FLAGS.be | FLAGS.bs : 0);
  const sign = (data) => (alg === -8 ? crypto.sign(null, data, privateKey) : crypto.sign('sha256', data, privateKey));

  return {
    id: b64u(id),
    // navigator.credentials.create() -> RegistrationResponseJSON
    create(options, over = {}) {
      userHandle = options.user.id;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: over.type ?? 'webauthn.create', challenge: over.challenge ?? options.challenge, origin: over.origin ?? origin, crossOrigin: over.crossOrigin ?? false }));
      const idLen = Buffer.alloc(2); idLen.writeUInt16BE(id.length);
      const attested = Buffer.concat([Buffer.alloc(16) /* aaguid */, idLen, id, cbor(cose)]);
      const ad = authData({ rpId: over.rpId ?? rpId, flags: (over.flags ?? baseFlags) | FLAGS.at, counter, attested });
      const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]));
      return { id: b64u(id), rawId: b64u(id), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal', 'hybrid'] } };
    },
    // navigator.credentials.get() -> AuthenticationResponseJSON
    get(options, over = {}) {
      if (!synced) counter += 1;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: over.type ?? 'webauthn.get', challenge: over.challenge ?? options.challenge, origin: over.origin ?? origin, crossOrigin: over.crossOrigin ?? false }));
      const ad = authData({ rpId: over.rpId ?? rpId, flags: over.flags ?? baseFlags, counter: over.counter ?? counter });
      const signature = over.signature ?? sign(Buffer.concat([ad, sha256(clientDataJSON)]));
      return { id: b64u(id), rawId: b64u(id), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(ad), signature: b64u(signature), userHandle: over.userHandle ?? userHandle } };
    },
  };
}
