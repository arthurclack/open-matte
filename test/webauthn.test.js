// The passkey wrapper (server/webauthn.js) and the challenge store, tested
// against docs/milestone-2.md: "Passkeys", "Relying party" and "Challenges".
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';

const { ALGS, PasskeyError, relyingParty, registrationOptions, signInOptions, verifyRegistration, verifySignIn } = await import('../server/webauthn.js');
const { createCeremonies } = await import('../server/ceremonies.js');

const DEV = relyingParty({ publicUrl: '', rpId: '', production: false });
const PROD_URL = 'https://www.openmatte.dev';
const PROD = relyingParty({ publicUrl: PROD_URL, rpId: 'openmatte.dev', production: true });
const prodAuth = (opts = {}) => softAuthenticator({ origin: PROD_URL, rpId: 'openmatte.dev', ...opts });

const b64u = (b) => Buffer.from(b).toString('base64url');
const newPerson = () => ({ name: 'Sam', webauthn_user_id: crypto.randomBytes(32).toString('base64url') });
const UP = 0x01;
const UV = 0x04;

// Registers `auth` and returns the passkey row as it would be stored.
async function register(rp, auth, over) {
  const options = await registrationOptions(rp, { rpName: 'Open Matte', person: newPerson() });
  const reg = await verifyRegistration(rp, auth.create(options, over), options.challenge);
  return { reg, passkey: { credential_id: reg.credentialId, public_key: reg.publicKey, sign_count: reg.counter, transports: JSON.stringify(reg.transports) } };
}

// One sign-in; the stored counter moves on as people.js would move it.
async function signIn(rp, auth, passkey, over) {
  const options = await signInOptions(rp);
  const r = await verifySignIn(rp, auth.get(options, over), options.challenge, passkey);
  passkey.sign_count = r.newCounter;
  return r;
}

async function refusedRegistration(rp, auth, over) {
  const options = await registrationOptions(rp, { rpName: 'Open Matte', person: newPerson() });
  await assert.rejects(verifyRegistration(rp, auth.create(options, over), options.challenge), PasskeyError, JSON.stringify(over));
}

async function refusedSignIn(rp, auth, passkey, over) {
  const before = passkey.sign_count;
  const options = await signInOptions(rp);
  await assert.rejects(verifySignIn(rp, auth.get(options, over), options.challenge, passkey), PasskeyError, JSON.stringify(over));
  assert.equal(passkey.sign_count, before);
}

// ------------------------------------------------------------------ relying party
describe('relyingParty()', () => {
  const problems = {
    'production without PUBLIC_URL': { production: true, rpId: 'openmatte.dev' },
    'production without WEBAUTHN_RP_ID': { production: true, publicUrl: PROD_URL },
    'production with PUBLIC_URL on localhost (never silently localhost)': { production: true, publicUrl: 'http://localhost:3000' },
    'a PUBLIC_URL that is not localhost, outside production, without an ID': { publicUrl: PROD_URL },
    'an IPv4 address as the ID': { production: true, publicUrl: 'https://65.21.54.126', rpId: '65.21.54.126' },
    'an IPv6 address as the ID': { production: true, publicUrl: 'https://[2001:db8::1]', rpId: '2001:db8::1' },
    'an IP address as the ID with a domain PUBLIC_URL': { production: true, publicUrl: PROD_URL, rpId: '65.21.54.126' },
    'an ID with a port': { production: true, publicUrl: PROD_URL, rpId: 'openmatte.dev:443' },
    'an ID with a scheme': { production: true, publicUrl: PROD_URL, rpId: 'https://openmatte.dev' },
    'an ID with a path': { production: true, publicUrl: PROD_URL, rpId: 'openmatte.dev/' },
    'an ID in upper case': { production: true, publicUrl: PROD_URL, rpId: 'OpenMatte.dev' },
    'an ID with no dot': { production: true, publicUrl: 'https://intranet', rpId: 'intranet' },
    'an http origin': { production: true, publicUrl: 'http://www.openmatte.dev', rpId: 'openmatte.dev' },
    'a host that only ends with the ID': { production: true, publicUrl: 'https://evilopenmatte.dev', rpId: 'openmatte.dev' },
    'a host unrelated to the ID': { production: true, publicUrl: 'https://www.example.com', rpId: 'openmatte.dev' },
    'an ID that is a subdomain of the host': { production: true, publicUrl: 'https://openmatte.dev', rpId: 'www.openmatte.dev' },
  };
  for (const [name, input] of Object.entries(problems)) {
    test(`sets a problem for ${name}`, () => {
      const rp = relyingParty(input);
      assert.equal(typeof rp.problem, 'string', JSON.stringify(input));
      assert.ok(rp.problem.length > 0);
      // Nothing is accepted while there is a problem.
      for (const o of [PROD_URL, 'https://openmatte.dev', 'http://localhost:5173', input.publicUrl && new URL(input.publicUrl).origin]) {
        assert.equal(rp.originFor(o), null, `${name}: ${o}`);
      }
    });
  }

  test('names the missing settings in its problem', () => {
    assert.match(relyingParty({ production: true }).problem, /PUBLIC_URL/);
    assert.match(relyingParty({ production: true, publicUrl: PROD_URL }).problem, /WEBAUTHN_RP_ID/);
  });

  test('accepts https://www.openmatte.dev with the ID openmatte.dev, and that origin only', () => {
    assert.equal(PROD.problem, null);
    assert.equal(PROD.id, 'openmatte.dev');
    assert.equal(PROD.originFor(PROD_URL), PROD_URL);
    for (const o of ['https://openmatte.dev', 'https://x.openmatte.dev', 'http://www.openmatte.dev', 'https://www.openmatte.dev.evil.dev', 'https://www.openmatte.dev/', 'http://localhost:5173', '', null, undefined]) {
      assert.equal(PROD.originFor(o), null, String(o));
    }
    // A trailing slash in PUBLIC_URL makes no difference, and the bare domain works too.
    assert.equal(relyingParty({ production: true, publicUrl: `${PROD_URL}/`, rpId: 'openmatte.dev' }).originFor(PROD_URL), PROD_URL);
    const bare = relyingParty({ production: true, publicUrl: 'https://openmatte.dev', rpId: 'openmatte.dev' });
    assert.equal(bare.problem, null);
    assert.equal(bare.originFor('https://openmatte.dev'), 'https://openmatte.dev');
  });

  test('in development the ID is localhost and any localhost port is an origin', () => {
    for (const rp of [DEV, relyingParty({ publicUrl: 'http://localhost:3000' }), relyingParty({})]) {
      assert.equal(rp.problem, null);
      assert.equal(rp.id, 'localhost');
      for (const o of ['http://localhost:5173', 'http://localhost:41234', 'http://localhost:3000', 'http://localhost']) assert.equal(rp.originFor(o), o);
      for (const o of ['http://127.0.0.1:5173', 'http://localhost.evil.dev', 'http://localhost:5173.evil.dev', 'https://localhost:5173', 'http://localhost:5173/', 'http://localhost:123456', 'http://evil.dev/http://localhost', 'http://[::1]:5173', null, undefined, 5173]) {
        assert.equal(rp.originFor(o), null, String(o));
      }
    }
  });
});

// ------------------------------------------------------------------ options
describe('ceremony options', () => {
  test('registration: discoverable, user verification preferred, attestation none, ES256/EdDSA/RS256, the name and never the note', async () => {
    const person = { ...newPerson(), note: 'rude about Nolan' };
    const existing = [{ credential_id: 'Y3JlZDE', transports: '["internal","hybrid"]' }, { credential_id: 'Y3JlZDI', transports: null }];
    const o = await registrationOptions(DEV, { rpName: 'Open Matte', person, existing });
    assert.equal(o.rp.id, 'localhost');
    assert.equal(o.rp.name, 'Open Matte');
    assert.equal(o.user.id, person.webauthn_user_id, 'user.id is the stored WebAuthn user id');
    assert.equal(o.user.name, 'Sam');
    assert.equal(o.user.displayName, 'Sam');
    assert.equal(o.attestation, 'none');
    assert.equal(o.timeout, 300_000);
    assert.deepEqual(o.pubKeyCredParams.map((p) => p.alg), [-7, -8, -257]);
    assert.deepEqual(ALGS, [-7, -8, -257]);
    assert.equal(o.authenticatorSelection.residentKey, 'required');
    assert.equal(o.authenticatorSelection.userVerification, 'preferred');
    assert.deepEqual(o.excludeCredentials.map((c) => c.id), ['Y3JlZDE', 'Y3JlZDI']);
    assert.deepEqual(o.excludeCredentials[0].transports, ['internal', 'hybrid']);
    assert.doesNotMatch(JSON.stringify(o), /Nolan/);
    // The library mutates authenticatorSelection: a second call must still require a discoverable key.
    const again = await registrationOptions(DEV, { rpName: 'Open Matte', person, existing: [] });
    assert.equal(again.authenticatorSelection.residentKey, 'required');
    assert.deepEqual(again.excludeCredentials, []);
    assert.notEqual(again.challenge, o.challenge);
  });

  test('sign-in: no allowCredentials, user verification preferred, a fresh challenge each time', async () => {
    const a = await signInOptions(DEV);
    const b = await signInOptions(DEV);
    assert.equal(a.rpId, 'localhost');
    assert.ok(!a.allowCredentials || a.allowCredentials.length === 0, 'no credential ids for someone who has not proved who they are');
    assert.equal(a.userVerification, 'preferred');
    assert.equal(a.timeout, 300_000);
    assert.notEqual(a.challenge, b.challenge);
    assert.ok(Buffer.from(a.challenge, 'base64url').length >= 16);
    assert.equal((await signInOptions(PROD)).rpId, 'openmatte.dev');
  });
});

// ------------------------------------------------------------------ verification
describe('registering and signing in', () => {
  for (const alg of [-7, -8, -257]) {
    for (const synced of [true, false]) {
      test(`alg ${alg}, ${synced ? 'synced' : 'device-bound'}: registers and signs in twice`, async () => {
        const auth = softAuthenticator({ alg, synced });
        const { reg, passkey } = await register(DEV, auth);
        assert.equal(reg.credentialId, auth.id);
        assert.equal(reg.counter, 0);
        assert.equal(reg.deviceType, synced ? 'multiDevice' : 'singleDevice');
        assert.equal(reg.backedUp, synced);
        assert.deepEqual(reg.transports, ['internal', 'hybrid']);
        assert.ok(reg.publicKey instanceof Uint8Array && reg.publicKey.length > 0);
        const first = await signIn(DEV, auth, passkey);
        const second = await signIn(DEV, auth, passkey);
        assert.deepEqual([first.newCounter, second.newCounter], synced ? [0, 0] : [1, 2]);
        assert.equal(second.backedUp, synced);
      });
    }
  }

  test('the production relying party works from https://www.openmatte.dev', async () => {
    const auth = prodAuth();
    const { passkey } = await register(PROD, auth);
    await signIn(PROD, auth, passkey);
    await signIn(PROD, auth, passkey);
  });

  test('a synced passkey that always reports 0 passes again and again', async () => {
    const auth = softAuthenticator({ synced: true });
    const { passkey } = await register(DEV, auth);
    for (let i = 0; i < 4; i++) assert.equal((await signIn(DEV, auth, passkey, { counter: 0 })).newCounter, 0);
  });

  test('user verification is preferred, not enforced: user presence alone passes', async () => {
    const auth = softAuthenticator({ synced: false });
    const { passkey } = await register(DEV, auth, { flags: UP });
    await signIn(DEV, auth, passkey, { flags: UP });
  });

  test('development origins on any localhost port work end to end; 127.0.0.1 and look-alikes do not', async () => {
    for (const origin of ['http://localhost:5173', 'http://localhost:41234']) {
      const auth = softAuthenticator({ origin });
      const { passkey } = await register(DEV, auth);
      await signIn(DEV, auth, passkey);
    }
    for (const origin of ['http://127.0.0.1:5173', 'http://localhost.evil.dev']) {
      await refusedRegistration(DEV, softAuthenticator({ origin }));
      const auth = softAuthenticator();
      const { passkey } = await register(DEV, auth);
      await refusedSignIn(DEV, auth, passkey, { origin });
    }
  });
});

describe('forged registrations are refused', () => {
  const forgeries = {
    'a wrong challenge': { challenge: b64u(crypto.randomBytes(32)) },
    'a wrong origin': { origin: 'http://evil.example' },
    'the sign-in type': { type: 'webauthn.get' },
    'a wrong RP ID': { rpId: 'evil.example' },
    'no user-present flag': { flags: UV },
    'crossOrigin: true': { crossOrigin: true },
  };
  for (const [name, over] of Object.entries(forgeries)) {
    test(name, async () => refusedRegistration(DEV, softAuthenticator(), over));
  }

  test('against the production relying party: right rpIdHash, wrong origins', async () => {
    for (const origin of ['https://openmatte.dev', 'https://x.openmatte.dev', 'http://www.openmatte.dev']) {
      await refusedRegistration(PROD, prodAuth({ origin }));
    }
    // The host as the RP ID is not the RP ID.
    await refusedRegistration(PROD, prodAuth({ rpId: 'www.openmatte.dev' }));
  });

  test('responses that do not parse are refused as PasskeyErrors, not crashes', async () => {
    const options = await registrationOptions(DEV, { rpName: 'Open Matte', person: newPerson() });
    const good = softAuthenticator().create(options);
    const garbage = [
      null,
      undefined,
      'nonsense',
      {},
      { response: {} },
      { ...good, response: { ...good.response, clientDataJSON: '%%%' } },
      { ...good, response: { ...good.response, clientDataJSON: b64u('[1,2]') } },
      { ...good, response: { ...good.response, attestationObject: b64u('not cbor') } },
    ];
    for (const credential of garbage) {
      await assert.rejects(verifyRegistration(DEV, credential, options.challenge), PasskeyError, JSON.stringify(credential));
    }
  });
});

describe('forged sign-ins are refused', () => {
  const forgeries = {
    'a wrong challenge': { challenge: b64u(crypto.randomBytes(32)) },
    'a wrong origin': { origin: 'http://evil.example' },
    'the registration type': { type: 'webauthn.create' },
    'a wrong RP ID': { rpId: 'evil.example' },
    'no user-present flag': { flags: UV },
    'crossOrigin: true': { crossOrigin: true },
    'a random signature': { signature: crypto.randomBytes(64) },
  };
  for (const [name, over] of Object.entries(forgeries)) {
    test(name, async () => {
      const auth = softAuthenticator({ synced: false });
      const { passkey } = await register(DEV, auth);
      await refusedSignIn(DEV, auth, passkey, over);
      // The passkey itself still works.
      await signIn(DEV, auth, passkey);
    });
  }

  for (const alg of [-7, -8, -257]) {
    test(`a signature over different data (alg ${alg})`, async () => {
      const auth = softAuthenticator({ alg });
      const { passkey } = await register(DEV, auth);
      const options = await signInOptions(DEV);
      const credential = auth.get(options);
      // Tamper with the signed authenticator data after signing.
      const ad = Buffer.from(credential.response.authenticatorData, 'base64url');
      ad[32] ^= UV;
      credential.response.authenticatorData = b64u(ad);
      await assert.rejects(verifySignIn(DEV, credential, options.challenge, passkey), PasskeyError);
    });
  }

  test("another passkey's signature for this credential id", async () => {
    const auth = softAuthenticator();
    const { passkey } = await register(DEV, auth);
    const other = softAuthenticator();
    await register(DEV, other);
    const options = await signInOptions(DEV);
    const credential = { ...other.get(options), id: auth.id, rawId: auth.id };
    await assert.rejects(verifySignIn(DEV, credential, options.challenge, passkey), PasskeyError);
  });

  test('a counter that goes backwards (or stands still) on a device-bound key', async () => {
    const auth = softAuthenticator({ synced: false });
    const { passkey } = await register(DEV, auth);
    await signIn(DEV, auth, passkey);
    await signIn(DEV, auth, passkey);
    assert.equal(passkey.sign_count, 2);
    await refusedSignIn(DEV, auth, passkey, { counter: 1 });
    await refusedSignIn(DEV, auth, passkey, { counter: 2 });
    await refusedSignIn(DEV, auth, passkey, { counter: 0 });
    // The real authenticator carries on counting and is accepted.
    assert.ok((await signIn(DEV, auth, passkey)).newCounter > 2);
  });

  test('against the production relying party: right rpIdHash, wrong origins', async () => {
    const auth = prodAuth();
    const { passkey } = await register(PROD, auth);
    for (const origin of ['https://openmatte.dev', 'https://x.openmatte.dev', 'http://www.openmatte.dev']) {
      await refusedSignIn(PROD, auth, passkey, { origin });
    }
    await refusedSignIn(PROD, auth, passkey, { rpId: 'www.openmatte.dev' });
    await signIn(PROD, auth, passkey);
  });

  test('a response that does not parse is a PasskeyError', async () => {
    const auth = softAuthenticator();
    const { passkey } = await register(DEV, auth);
    const options = await signInOptions(DEV);
    const good = auth.get(options);
    for (const credential of [null, 'x', {}, { ...good, response: { ...good.response, clientDataJSON: 'e30' } }, { ...good, response: { ...good.response, authenticatorData: '' } }]) {
      await assert.rejects(verifySignIn(DEV, credential, options.challenge, passkey), PasskeyError, JSON.stringify(credential));
    }
  });
});

// ------------------------------------------------------------------ challenges
describe('challenges (ceremonies.js)', () => {
  const clock = (t = 1_000_000) => {
    const c = { t, now: () => c.t };
    return c;
  };

  test('a challenge is taken once, whatever the outcome', () => {
    const c = createCeremonies();
    assert.equal(c.beginSignIn('a'), true);
    assert.ok(c.take('signin', 'a'));
    assert.equal(c.take('signin', 'a'), null, 'a replayed challenge');
    c.beginEnroll(7, 'b');
    assert.equal(c.take('enroll', 'b').linkId, 7);
    assert.equal(c.take('enroll', 'b'), null);
    assert.equal(c.take('signin', undefined), null);
    assert.equal(c.take('enroll', { toString: () => 'b' }), null);
  });

  test('sign-in and setup challenges live in separate pools', () => {
    const c = createCeremonies();
    c.beginSignIn('s');
    c.beginEnroll(1, 'e');
    assert.equal(c.take('enroll', 's'), null);
    assert.equal(c.take('signin', 'e'), null);
  });

  test('challenges last five minutes', () => {
    const k = clock();
    const c = createCeremonies({ now: k.now });
    c.beginSignIn('early');
    c.beginSignIn('late');
    c.beginEnroll(1, 'enrol');
    k.t += 5 * 60 * 1000 - 1;
    assert.ok(c.take('signin', 'early'));
    k.t += 1;
    assert.equal(c.take('signin', 'late'), null);
    assert.equal(c.take('enroll', 'enrol'), null);
  });

  test('a full sign-in pool refuses new attempts and evicts nobody early', () => {
    const k = clock();
    const c = createCeremonies({ now: k.now });
    for (let i = 0; i < 500; i++) assert.equal(c.beginSignIn(`c${i}`), true);
    assert.equal(c.beginSignIn('one too many'), false);
    assert.ok(c.take('signin', 'c0'), 'the oldest is still there');
    assert.equal(c.beginSignIn('room again'), true);
    assert.equal(c.beginSignIn('full again'), false);
    // Setups are unaffected by a full sign-in pool.
    c.beginEnroll(1, 'setup');
    assert.ok(c.take('enroll', 'setup'));
    // Once they expire there is room.
    k.t += 5 * 60 * 1000;
    assert.equal(c.beginSignIn('later'), true);
  });

  test('at most three live setup challenges per link; a fourth replaces that link’s oldest', () => {
    const c = createCeremonies();
    for (const ch of ['a1', 'a2', 'a3']) c.beginEnroll(1, ch);
    c.beginEnroll(2, 'b1');
    c.beginEnroll(1, 'a4');
    assert.equal(c.take('enroll', 'a1'), null);
    for (const ch of ['a2', 'a3', 'a4']) assert.equal(c.take('enroll', ch)?.linkId, 1, ch);
    assert.equal(c.take('enroll', 'b1')?.linkId, 2, "another link's challenge is untouched");
  });
});
