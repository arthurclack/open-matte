// People, setup and recovery links, passkey sign-in and sign-out, and the admin's
// People pages: milestone 2, slice 1. Written from docs/history/milestone-2.md
// ("Slice 1", "Setup and recovery links", "Signing in", "Sessions", "Access rules"),
// not from the implementation. Slice 1 grants no film access: a signed-in person plays
// only what their browser could already play.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';

const { adminBrowser, enroll, makeFilm, newPerson, setupLink, signIn, startServer, tempDir } = await import('./helpers.js');
const { inspectMediaDir } = await import('../server/scan.js');
const { RESERVED_SLUGS } = await import('../server/names.js');
const { clientKey } = await import('../server/ratelimit.js');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
};
const MASTER = '/media/arrival/hls/master.m3u8';
const SEGMENT = '/media/arrival/hls/v_h264_720/seg_0.m4s';
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A browser like helpers.browser(), with headers of our own (User-Agent,
// X-Forwarded-For) and the Set-Cookie headers of each response.
function client(base, headers = {}) {
  const jar = new Map();
  async function request(method, url, body, extra = {}) {
    const h = { ...headers, ...extra };
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const setCookies = res.headers.getSetCookie();
    for (const c of setCookies) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const value = pair.slice(i + 1);
      if (/Max-Age=0/.test(c) || value === '') jar.delete(pair.slice(0, i));
      else jar.set(pair.slice(0, i), value);
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers, setCookies };
  }
  return {
    jar,
    get: (url, extra) => request('GET', url, undefined, extra),
    post: (url, body = {}, extra) => request('POST', url, body, extra),
    patch: (url, body = {}, extra) => request('PATCH', url, body, extra),
  };
}

let srv;
let admin;
let filmId;
const mediaDir = tempDir();

before(async () => {
  makeFilm(mediaDir, 'arrival');
  srv = await startServer({ mediaDir, limits: { scale: 100 } });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  filmId = (await admin.get('/api/admin/films')).data.find((f) => f.slug === 'arrival').id;
  await admin.patch(`/api/admin/films/${filmId}`, { published: true });
});
after(() => srv.close());

let counter = 0;
const uniq = (name) => `${name} ${++counter}`;
const fresh = (headers) => client(srv.base, headers);
// A browser carrying a given om_session cookie value.
const withCookie = (token) => {
  const c = fresh();
  c.jar.set('om_session', token);
  return c;
};
const me = async (b) => {
  const r = await b.get('/api/me');
  assert.equal(r.status, 200);
  return r.data;
};
const personIn = async (b) => (await me(b)).person;
async function detail(id) {
  const r = await admin.get(`/api/admin/people/${id}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const activity = async (query) => (await admin.get(`/api/admin/activity?${query}`)).data.events;
const webauthnId = (personId) => srv.db.prepare('SELECT webauthn_user_id FROM people WHERE id = ?').get(personId).webauthn_user_id;
const sessionRow = (token) => srv.db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(sha256(token));
const passkeyCount = (personId) => srv.db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE person_id = ?').get(personId).n;

// A person who has created one passkey from a setup link in browser b.
async function enrolled({ b = fresh(), name = uniq('Sam'), note, auth = softAuthenticator() } = {}) {
  const p = await newPerson(admin, name, note);
  const link = await setupLink(admin, p.id);
  const r = await enroll(b, link.token, { auth });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { p, b, auth, link };
}
// "Help Sam sign in again" with the tick.
const recoveryLink = (personId, body = {}) => setupLink(admin, personId, { confirmedContact: true, ...body });

async function newTicket(fields = {}) {
  const r = await admin.post('/api/admin/tickets', { filmId, ...fields });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data[0];
}
async function opened(b, ticket) {
  const r = await b.post('/api/tickets/open', { code: ticket.code });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return b;
}
async function play(b) {
  const r = await b.post('/api/films/arrival/screenings');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
const status = async (b, url) => (await b.get(url)).status;

// ====================================================================== people
describe('people', () => {
  test('names are unique ignoring case, and a person needs a short name', async () => {
    const name = uniq('Morgan');
    const p = await newPerson(admin, name);
    for (const again of [name.toLowerCase(), name.toUpperCase(), `  ${name}  `]) {
      const r = await admin.post('/api/admin/people', { name: again });
      assert.equal(r.status, 409, again);
      assert.equal(r.data.error, 'name-taken');
    }
    for (const bad of ['', '   ', null, 'x'.repeat(200)]) {
      assert.equal((await admin.post('/api/admin/people', { name: bad })).status, 400, String(bad));
    }
    // Renaming someone to a name taken by another person, in any case, is refused too.
    const other = await newPerson(admin, uniq('Riley'));
    const clash = await admin.patch(`/api/admin/people/${other.id}`, { name: name.toUpperCase() });
    assert.equal(clash.status, 409);
    assert.equal(clash.data.error, 'name-taken');
    // A person may change the case of their own name.
    const recased = await admin.patch(`/api/admin/people/${p.id}`, { name: name.toUpperCase() });
    assert.equal(recased.status, 200, JSON.stringify(recased.data));
    assert.equal(recased.data.name, name.toUpperCase());
  });

  test('a new person has no passkeys, no link and is not set up', async () => {
    const name = uniq('Ari');
    const p = await newPerson(admin, name, 'met at the film club');
    assert.equal(p.name, name);
    assert.equal(p.note, 'met at the film club');
    assert.equal(p.disabled, false);
    assert.equal(p.setUp, false);
    assert.deepEqual(p.passkeys, []);
    assert.deepEqual(p.browsers, []);
    assert.deepEqual(p.links, []);
    assert.equal(p.linkWaiting, null);
    const listed = (await admin.get('/api/admin/people')).data.find((x) => x.id === p.id);
    assert.equal(listed.passkeys, 0);
    assert.equal(listed.tickets, 0);
    assert.equal(listed.lastSignedInAt, null);
    assert.equal(listed.linkWaiting, null);
    // Editing the note keeps the name.
    const edited = await admin.patch(`/api/admin/people/${p.id}`, { note: 'rude about Nolan' });
    assert.equal(edited.data.note, 'rude about Nolan');
    assert.equal(edited.data.name, name);
  });

  test("a person's name can change; their WebAuthn user id never does", async () => {
    const { p, b, auth } = await enrolled();
    const id = webauthnId(p.id);
    const renamed = uniq('Samantha');
    assert.equal((await admin.patch(`/api/admin/people/${p.id}`, { name: renamed })).status, 200);
    assert.deepEqual(await personIn(b), { name: renamed }, 'a signed-in browser sees the new name');
    assert.deepEqual((await signIn(fresh(), auth)).data.person, { name: renamed });
    const l = await recoveryLink(p.id);
    const o = await fresh().post('/api/enroll/options', { token: l.token });
    assert.equal(o.data.options.user.id, id);
    assert.equal(o.data.options.user.name, renamed);
    assert.equal(webauthnId(p.id), id);
  });

  test('someone who does not exist is a 404', async () => {
    for (const id of ['999999', 'abc', '1.5']) {
      assert.equal((await admin.get(`/api/admin/people/${id}`)).status, 404, id);
      assert.equal((await admin.post(`/api/admin/people/${id}/links`, {})).status, 404, id);
    }
    assert.equal((await admin.post('/api/admin/passkeys/999999/remove')).status, 404);
  });

  test('every People endpoint needs the admin', async () => {
    const p = await newPerson(admin, uniq('Guarded'));
    const anon = fresh();
    assert.equal((await anon.get('/api/admin/people')).status, 401);
    assert.equal((await anon.get(`/api/admin/people/${p.id}`)).status, 401);
    assert.equal((await anon.post('/api/admin/people', { name: 'Intruder' })).status, 401);
    assert.equal((await anon.post(`/api/admin/people/${p.id}/links`, {})).status, 401);
    assert.equal((await anon.post(`/api/admin/people/${p.id}/disable`)).status, 401);
    assert.equal((await anon.post('/api/admin/passkeys/1/remove')).status, 401);
  });
});

// ====================================================================== setup links
describe('setup links', () => {
  test('the link is shown once, when it is made, and only its hash is stored', async () => {
    const p = await newPerson(admin, uniq('Sam'), 'rude about Nolan');
    const before = Date.now();
    const l = await setupLink(admin, p.id);
    assert.equal(l.purpose, 'setup');
    assert.match(l.link, new RegExp(`^${srv.base.replace(/\./g, '\\.')}/enroll#[A-Za-z0-9_-]+$`));
    assert.equal(Buffer.from(l.token, 'base64url').length, 32, 'a 256-bit token');
    assert.ok(Math.abs(l.expiresAt - (before + 72 * HOUR)) < 5000, 'setup links last 3 days by default');
    const token = l.token;

    // Nowhere in the admin afterwards.
    const later = [
      await admin.get('/api/admin/people'),
      await admin.get(`/api/admin/people/${p.id}`),
      await admin.get(`/api/admin/activity?person=${p.id}`),
      await admin.get('/api/admin/activity'),
      await admin.get('/api/admin/settings'),
    ];
    for (const r of later) assert.ok(!JSON.stringify(r.data).includes(token));
    const d = await detail(p.id);
    assert.equal(d.links.length, 1);
    for (const k of Object.keys(d.links[0])) assert.doesNotMatch(k, /token|hash/i);
    assert.equal(d.linkWaiting.purpose, 'setup');
    assert.equal(d.linkWaiting.openedAt, null);

    // Nowhere in the database: not the token, its bytes in hex, or standard base64.
    const bytes = Buffer.from(token, 'base64url');
    const forms = [token, bytes.toString('hex'), bytes.toString('base64').replace(/=+$/, '')];
    const tables = srv.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    assert.ok(tables.includes('person_links'));
    for (const t of tables) {
      const dump = JSON.stringify(srv.db.prepare(`SELECT * FROM "${t}"`).all(), (k, v) =>
        v instanceof Uint8Array ? [Buffer.from(v).toString('latin1'), Buffer.from(v).toString('hex'), Buffer.from(v).toString('base64url')] : v,
      );
      for (const f of forms) assert.ok(!dump.includes(f), `${t} contains the token`);
    }
    // What is stored is its SHA-256.
    const stored = srv.db.prepare('SELECT token_hash FROM person_links WHERE person_id = ?').get(p.id).token_hash;
    assert.ok([sha256(token), crypto.createHash('sha256').update(bytes).digest('hex')].includes(stored));
  });

  test('opening a link uses nothing up; creating a passkey does, and signs the browser in', async () => {
    const name = uniq('Sam');
    const p = await newPerson(admin, name, 'rude about Nolan');
    const l = await setupLink(admin, p.id);
    const b = fresh({ 'user-agent': UA.iphone });

    const first = await b.post('/api/enroll/options', { token: l.token });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.deepEqual(first.data.person, { name });
    assert.equal(first.data.purpose, 'setup');
    assert.equal(first.data.reset, false);
    assert.equal(first.data.expiresAt, l.expiresAt);
    assert.equal(first.data.film, null);
    const o = first.data.options;
    assert.equal(o.rp.id, 'localhost');
    assert.equal(o.user.id, webauthnId(p.id));
    assert.equal(o.user.name, name);
    assert.equal(o.user.displayName, name);
    assert.deepEqual(o.excludeCredentials, []);
    assert.equal(o.authenticatorSelection.residentKey, 'required');
    assert.equal(o.authenticatorSelection.userVerification, 'preferred');
    assert.equal(o.attestation, 'none');
    assert.doesNotMatch(JSON.stringify(first.data), /Nolan/, 'the note never reaches the person or their keychain');
    assert.equal(first.setCookies.length, 0, 'opening the link creates no session');

    // Opened, not used: it can be opened again.
    const opened1 = await detail(p.id);
    assert.ok(opened1.linkWaiting.openedAt > 0);
    assert.ok(opened1.links[0].openedAt > 0);
    assert.equal(opened1.links[0].usedAt, null);
    const second = await b.post('/api/enroll/options', { token: l.token });
    assert.equal(second.status, 200);
    assert.equal((await detail(p.id)).links[0].openedAt, opened1.links[0].openedAt, 'opened_at is the first opening');

    const auth = softAuthenticator();
    const done = await b.post('/api/enroll/finish', { token: l.token, credential: auth.create(second.data.options) });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    // And their membership card, which only they and the admin are sent (membership.test.js).
    assert.deepEqual(done.data, { person: { name }, slug: null, membership: (await detail(p.id)).membership });
    assert.ok(b.jar.get('om_session'));
    assert.deepEqual(await personIn(b), { name });

    const d = await detail(p.id);
    assert.equal(d.setUp, true);
    assert.equal(d.linkWaiting, null);
    assert.equal(d.passkeys.length, 1);
    assert.equal(d.passkeys[0].synced, true);
    assert.equal(d.passkeys[0].viaLink, 'setup');
    assert.equal(d.passkeys[0].addedDevice, 'Safari on iPhone');
    assert.equal(d.passkeys[0].lastUsedAt, null);
    assert.ok(d.links[0].usedAt > 0);
    assert.equal(d.links[0].usedDevice, 'Safari on iPhone', 'a used link shows where it was used');
    assert.equal(d.browsers.length, 1);
    assert.equal(d.browsers[0].passkeyId, d.passkeys[0].id);
    assert.equal(d.browsers[0].device, 'Safari on iPhone');
    assert.ok(d.lastSignedInAt > 0);

    // Used up.
    const again = await fresh().post('/api/enroll/options', { token: l.token });
    assert.equal(again.status, 410);
    assert.equal(again.data.error, 'link-used');
  });

  test('a link that is unknown, used, expired, cancelled or replaced says so, at both steps', async () => {
    const tryLink = async (token) => {
      const b = fresh();
      return { options: await b.post('/api/enroll/options', { token }), finish: await b.post('/api/enroll/finish', { token, credential: softAuthenticator().create({ user: { id: 'x' }, challenge: 'y' }) }) };
    };
    const expect = async (token, code, statusCode = 410) => {
      const r = await tryLink(token);
      for (const step of ['options', 'finish']) {
        assert.equal(r[step].status, statusCode, `${code} ${step}: ${JSON.stringify(r[step].data)}`);
        assert.equal(r[step].data.error, code, step);
      }
    };
    await expect(crypto.randomBytes(32).toString('base64url'), 'link-unknown', 404);
    await expect('', 'link-unknown', 404);
    await expect(undefined, 'link-unknown', 404);

    const { p, link } = await enrolled();
    await expect(link.token, 'link-used');

    const expiring = await recoveryLink(p.id);
    srv.db.prepare('UPDATE person_links SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1, sha256(expiring.token));
    await expect(expiring.token, 'link-expired');

    const cancelled = await recoveryLink(p.id);
    const c = await admin.post(`/api/admin/people/${p.id}/links/cancel`);
    assert.equal(c.status, 200);
    assert.equal(c.data.linkWaiting, null);
    await expect(cancelled.token, 'link-cancelled');
    assert.ok((await activity(`person=${p.id}`)).some((e) => e.type === 'link-cancelled'), 'link-cancelled is logged');
    // Cancelling when nothing is waiting changes nothing and logs nothing.
    const events = (await activity(`person=${p.id}`)).length;
    assert.equal((await admin.post(`/api/admin/people/${p.id}/links/cancel`)).status, 200);
    assert.equal((await activity(`person=${p.id}`)).length, events);

    const replaced = await recoveryLink(p.id);
    const newer = await recoveryLink(p.id);
    await expect(replaced.token, 'link-cancelled');
    assert.equal((await fresh().post('/api/enroll/options', { token: newer.token })).status, 200, 'the newer link works');
    const d = await detail(p.id);
    assert.equal(d.links.filter((l) => l.usedAt == null && l.cancelledAt == null && l.expiresAt > Date.now()).length, 1, 'one live link per person');
  });

  test('a link that expires or is cancelled between opening and finishing is refused, and nothing is created', async () => {
    for (const [code, spoil] of [
      ['link-expired', (p, l) => srv.db.prepare('UPDATE person_links SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1, sha256(l.token))],
      ['link-cancelled', (p) => admin.post(`/api/admin/people/${p.id}/links/cancel`)],
    ]) {
      const p = await newPerson(admin, uniq('Late'));
      const l = await setupLink(admin, p.id);
      const b = fresh();
      const o = await b.post('/api/enroll/options', { token: l.token });
      assert.equal(o.status, 200);
      await spoil(p, l);
      const r = await b.post('/api/enroll/finish', { token: l.token, credential: softAuthenticator().create(o.data.options) });
      assert.equal(r.status, 410, code);
      assert.equal(r.data.error, code);
      assert.equal(r.setCookies.length, 0);
      assert.equal(passkeyCount(p.id), 0);
    }
  });

  test('two browsers finishing one link at once: one passkey, and the other is told it was used', async () => {
    const p = await newPerson(admin, uniq('Twice'));
    const l = await setupLink(admin, p.id);
    const [a, b] = [fresh(), fresh()];
    const [oa, ob] = [await a.post('/api/enroll/options', { token: l.token }), await b.post('/api/enroll/options', { token: l.token })];
    const results = await Promise.all([
      a.post('/api/enroll/finish', { token: l.token, credential: softAuthenticator().create(oa.data.options) }),
      b.post('/api/enroll/finish', { token: l.token, credential: softAuthenticator().create(ob.data.options) }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 410], JSON.stringify(results.map((r) => r.data)));
    const loser = results.find((r) => r.status === 410);
    assert.equal(loser.data.error, 'link-used');
    assert.equal(loser.setCookies.length, 0);
    assert.equal(passkeyCount(p.id), 1);
    assert.equal((await detail(p.id)).browsers.length, 1);
  });

  test('a passkey that is already registered is refused, and the link stays unused', async () => {
    const { auth } = await enrolled();
    const p = await newPerson(admin, uniq('Second'));
    const l = await setupLink(admin, p.id);
    const b = fresh();
    const r = await enroll(b, l.token, { auth });
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.equal(r.data.error, 'passkey-exists');
    assert.equal(r.setCookies.length, 0);
    assert.equal(b.jar.get('om_session'), undefined);
    const d = await detail(p.id);
    assert.equal(d.passkeys.length, 0);
    assert.equal(d.links[0].usedAt, null);
    assert.ok(d.linkWaiting);
    assert.equal((await enroll(b, l.token)).status, 200, 'the link still works with another passkey');
  });

  test('a bad passkey response is refused without using the link', async () => {
    const p = await newPerson(admin, uniq('Forged'));
    const l = await setupLink(admin, p.id);
    for (const over of [{ origin: 'http://evil.example' }, { origin: 'http://127.0.0.1:5173' }, { crossOrigin: true }, { rpId: 'evil.example' }, { flags: 0x04 }]) {
      const r = await enroll(fresh(), l.token, { over });
      assert.equal(r.status, 400, JSON.stringify(over));
      assert.equal(r.data.error, 'passkey-invalid', JSON.stringify(over));
      assert.equal(r.setCookies.length, 0);
    }
    // Nonsense instead of a credential is a 400, not a server error.
    for (const credential of [undefined, null, 'nonsense', {}, { response: { clientDataJSON: 'e30' } }]) {
      const r = await fresh().post('/api/enroll/finish', { token: l.token, credential });
      assert.equal(r.status, 400, JSON.stringify(credential));
    }
    assert.equal(passkeyCount(p.id), 0);
    assert.equal((await detail(p.id)).links[0].usedAt, null);
    assert.equal((await enroll(fresh(), l.token)).status, 200);
  });

  test('a credential id over 1023 bytes is refused without using the link; unknown transports are never kept or sent back', async () => {
    const p = await newPerson(admin, uniq('Scripted'));
    const l = await setupLink(admin, p.id);
    const long = await enroll(fresh(), l.token, { auth: softAuthenticator({ idLength: 1024 }) });
    assert.equal(long.status, 400, JSON.stringify(long.data));
    assert.equal(long.data.error, 'passkey-invalid');
    assert.equal(long.setCookies.length, 0);
    assert.equal(passkeyCount(p.id), 0);
    assert.equal((await detail(p.id)).links[0].usedAt, null);

    // The link still works, and only the transports the standard names are kept.
    const transports = ['internal', { not: 'a transport' }, 'x'.repeat(40_000), 'hybrid', 'internal'];
    const r = await enroll(fresh(), l.token, { over: { transports } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const stored = srv.db.prepare('SELECT transports FROM passkeys WHERE person_id = ?').get(p.id).transports;
    assert.deepEqual(JSON.parse(stored), ['internal', 'hybrid']);
    // A later link for this person sends the passkey back with those only.
    const op = await fresh().post('/api/enroll/options', { token: (await recoveryLink(p.id)).token });
    assert.equal(op.status, 200, JSON.stringify(op.data));
    assert.deepEqual(op.data.options.excludeCredentials, [{ id: r.auth.id, type: 'public-key', transports: ['internal', 'hybrid'] }]);
    assert.equal((await signIn(fresh(), r.auth)).status, 200);
  });

  test('a ceremony belongs to its link and its purpose, is taken once, and a fourth replaces the oldest', async () => {
    const p = await newPerson(admin, uniq('Bound'));
    const q = await newPerson(admin, uniq('Other'));
    const lp = await setupLink(admin, p.id);
    const lq = await setupLink(admin, q.id);
    const b = fresh();

    // Options for P's link, finished against Q's link.
    const op = await b.post('/api/enroll/options', { token: lp.token });
    const auth = softAuthenticator();
    const crossed = await b.post('/api/enroll/finish', { token: lq.token, credential: auth.create(op.data.options) });
    assert.equal(crossed.status, 400);
    assert.equal(crossed.data.error, 'ceremony-expired');
    // Taken whatever the outcome: it no longer works for P's link either.
    const late = await b.post('/api/enroll/finish', { token: lp.token, credential: auth.create(op.data.options) });
    assert.equal(late.status, 400);
    assert.equal(late.data.error, 'ceremony-expired');

    // A sign-in challenge can't finish a setup, and a setup challenge can't sign in.
    const signinOpts = await b.post('/api/signin/options');
    const viaSignin = await b.post('/api/enroll/finish', { token: lp.token, credential: softAuthenticator().create(op.data.options, { challenge: signinOpts.data.options.challenge }) });
    assert.equal(viaSignin.data.error, 'ceremony-expired');
    const { auth: someone } = await enrolled();
    const op2 = await b.post('/api/enroll/options', { token: lp.token });
    const viaEnroll = await b.post('/api/signin/finish', { credential: someone.get({ challenge: op2.data.options.challenge }) });
    assert.equal(viaEnroll.status, 400);
    assert.equal(viaEnroll.data.error, 'ceremony-expired');

    // Four sets of options for one link: the first no longer works, the last does.
    const sets = [];
    for (let i = 0; i < 4; i++) sets.push((await b.post('/api/enroll/options', { token: lq.token })).data.options);
    const oldest = await b.post('/api/enroll/finish', { token: lq.token, credential: softAuthenticator().create(sets[0]) });
    assert.equal(oldest.data.error, 'ceremony-expired');
    const newest = await b.post('/api/enroll/finish', { token: lq.token, credential: softAuthenticator().create(sets[3]) });
    assert.equal(newest.status, 200, JSON.stringify(newest.data));
    assert.equal(passkeyCount(p.id), 0);
  });

  test('a link can carry only a ticket for this person: a ticket for anyone is refused', async () => {
    const p = await newPerson(admin, uniq('Ticketless'));
    const ticket = await newTicket();
    const r = await admin.post(`/api/admin/people/${p.id}/links`, { ticketId: ticket.id });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'bad-ticket');
    assert.equal((await detail(p.id)).links.length, 0);
  });
});

// ====================================================================== lifetimes and recovery
describe('link lifetimes and recovery links', () => {
  test('setup links last 1, 24, 72 or 168 hours, 72 by default', async () => {
    const p = await newPerson(admin, uniq('Hours'));
    for (const hours of [1, 24, 72, 168]) {
      const t = Date.now();
      const l = await setupLink(admin, p.id, { hours });
      assert.equal(l.purpose, 'setup');
      assert.ok(Math.abs(l.expiresAt - (t + hours * HOUR)) < 5000, String(hours));
    }
    for (const hours of [0, 2, 48, 169, 336, -1, 'week']) {
      const r = await admin.post(`/api/admin/people/${p.id}/links`, { hours });
      assert.equal(r.status, 400, String(hours));
      assert.equal(r.data.error, 'bad-hours', String(hours));
    }
  });

  test('a recovery link needs the confirmed-contact tick and lasts 1 or 24 hours, 1 by default', async () => {
    const { p } = await enrolled();
    for (const body of [{}, { confirmedContact: false }, { confirmedContact: 'true' }, { reset: true }]) {
      const r = await admin.post(`/api/admin/people/${p.id}/links`, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.data.error, 'confirm-contact', JSON.stringify(body));
    }
    let t = Date.now();
    const l = await recoveryLink(p.id);
    assert.equal(l.purpose, 'recovery');
    assert.ok(Math.abs(l.expiresAt - (t + HOUR)) < 5000, 'recovery links last an hour by default');
    t = Date.now();
    assert.ok(Math.abs((await recoveryLink(p.id, { hours: 24 })).expiresAt - (t + DAY)) < 5000);
    assert.equal((await recoveryLink(p.id, { hours: 1 })).purpose, 'recovery');
    for (const hours of [72, 168, 2, 25]) {
      const r = await admin.post(`/api/admin/people/${p.id}/links`, { confirmedContact: true, hours });
      assert.equal(r.status, 400, String(hours));
      assert.equal(r.data.error, 'bad-hours', String(hours));
    }
  });

  test('a refused recovery link changes nothing: no passkey removed, nobody signed out, the waiting link kept', async () => {
    const { p, b } = await enrolled();
    const waiting = await recoveryLink(p.id);
    for (const body of [{ reset: true }, { reset: true, confirmedContact: true, hours: 72 }, { reset: true, confirmedContact: true, ticketId: 1 }]) {
      const r = await admin.post(`/api/admin/people/${p.id}/links`, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(passkeyCount(p.id), 1, JSON.stringify(body));
      assert.ok(await personIn(b), JSON.stringify(body));
      assert.equal((await fresh().post('/api/enroll/options', { token: waiting.token })).status, 200, JSON.stringify(body));
    }
  });

  test('after the only passkey is removed, the next link is still a recovery link', async () => {
    const { p } = await enrolled();
    const [k] = (await detail(p.id)).passkeys;
    assert.equal((await admin.post(`/api/admin/passkeys/${k.id}/remove`)).status, 200);
    const d = await detail(p.id);
    assert.equal(d.passkeys.length, 0);
    assert.equal(d.setUp, true);
    const unticked = await admin.post(`/api/admin/people/${p.id}/links`, {});
    assert.equal(unticked.status, 400);
    assert.equal(unticked.data.error, 'confirm-contact');
    const l = await recoveryLink(p.id);
    assert.equal(l.purpose, 'recovery');
    const opts = await fresh().post('/api/enroll/options', { token: l.token });
    assert.equal(opts.data.purpose, 'recovery');
  });

  test('Add a sign-in method keeps passkeys and browsers; Reset after loss removes them when the link is made', async () => {
    const { p, b: phone, auth: k1 } = await enrolled();
    const laptop = fresh();
    assert.equal((await signIn(laptop, k1)).status, 200);

    // Add a sign-in method.
    const add = await recoveryLink(p.id);
    assert.equal(add.purpose, 'recovery');
    assert.equal(passkeyCount(p.id), 1);
    assert.ok(await personIn(phone));
    assert.ok(await personIn(laptop));
    const addOpts = await fresh().post('/api/enroll/options', { token: add.token });
    assert.equal(addOpts.data.purpose, 'recovery');
    assert.equal(addOpts.data.reset, false);
    assert.deepEqual(addOpts.data.options.excludeCredentials.map((c) => c.id), [k1.id], "the holder's browser is told which passkeys exist");
    let created = (await activity(`person=${p.id}`)).find((e) => e.type === 'link-created');
    assert.deepEqual(created.detail, { purpose: 'recovery', reset: false, hours: 1, passkeysRemoved: 0, browsersSignedOut: 0 });

    // Reset after loss: before the link is used, the old passkey is gone and every browser signed out.
    const reset = await recoveryLink(p.id, { reset: true });
    assert.equal(reset.purpose, 'recovery');
    assert.equal(passkeyCount(p.id), 0);
    assert.equal(await personIn(phone), null);
    assert.equal(await personIn(laptop), null);
    const rows = srv.db.prepare('SELECT revoked_at, passkey_id FROM sessions WHERE person_id = ?').all(p.id);
    assert.ok(rows.length >= 2);
    for (const r of rows) {
      assert.ok(r.revoked_at, 'every session of the person is revoked');
      assert.equal(r.passkey_id, null);
    }
    created = (await activity(`person=${p.id}`)).find((e) => e.type === 'link-created');
    assert.deepEqual(created.detail, { purpose: 'recovery', reset: true, hours: 1, passkeysRemoved: 1, browsersSignedOut: 2 });
    // The Add link it replaced no longer works.
    assert.equal((await fresh().post('/api/enroll/options', { token: add.token })).data.error, 'link-cancelled');

    // The old passkey can't sign in.
    const stolen = await signIn(fresh(), k1);
    assert.equal(stolen.status, 401);
    assert.equal(stolen.data.error, 'passkey-unknown');

    // The recovery link works, and says it followed a reset.
    const b = fresh();
    const opts = await b.post('/api/enroll/options', { token: reset.token });
    assert.equal(opts.data.purpose, 'recovery');
    assert.equal(opts.data.reset, true);
    assert.deepEqual(opts.data.options.excludeCredentials, []);
    const k2 = softAuthenticator();
    const fin = await b.post('/api/enroll/finish', { token: reset.token, credential: k2.create(opts.data.options) });
    assert.equal(fin.status, 200, JSON.stringify(fin.data));
    const d = await detail(p.id);
    assert.equal(d.passkeys.length, 1);
    assert.equal(d.passkeys[0].viaLink, 'recovery');
    assert.equal(d.links[0].reset, true);
    assert.equal((await signIn(fresh(), k2)).status, 200);
  });

  test('two links made at once leave one live link', async () => {
    const p = await newPerson(admin, uniq('Hurried'));
    const made = await Promise.all([1, 2, 3].map(() => admin.post(`/api/admin/people/${p.id}/links`, {})));
    assert.deepEqual(made.map((r) => r.status), [201, 201, 201]);
    const live = [];
    for (const r of made) {
      const o = await fresh().post('/api/enroll/options', { token: new URL(r.data.link).hash.slice(1) });
      if (o.status === 200) live.push(r);
      else assert.equal(o.data.error, 'link-cancelled');
    }
    assert.equal(live.length, 1);
  });

  test('a link for a disabled person is refused', async () => {
    const p = await newPerson(admin, uniq('Off'));
    await admin.post(`/api/admin/people/${p.id}/disable`);
    const r = await admin.post(`/api/admin/people/${p.id}/links`, {});
    assert.equal(r.status, 409);
    assert.equal(r.data.error, 'person-disabled');
  });
});

// ====================================================================== signing in
describe('signing in', () => {
  test('signing in issues a new cookie for 90 days, and the old one stops being signed in', async () => {
    const { p, b, auth } = await enrolled();
    const c1 = b.jar.get('om_session');
    const r = await signIn(b, auth);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data, { person: { name: p.name }, newPasskeys: [] });
    const c2 = b.jar.get('om_session');
    assert.ok(c2 && c2 !== c1, 'a new cookie');
    const cookie = r.setCookies.find((c) => c.startsWith('om_session='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, new RegExp(`Max-Age=${90 * 24 * 60 * 60}\\b`));
    assert.ok(Math.abs(sessionRow(c2).expires_at - (Date.now() + 90 * DAY)) < 60_000);
    assert.equal(await personIn(withCookie(c1)), null, 'the old cookie is no longer signed in');
    assert.ok(sessionRow(c1).revoked_at);
    assert.deepEqual(await personIn(withCookie(c2)), { name: p.name });
    assert.equal(sessionRow(c2).person_id, p.id);
    assert.ok(sessionRow(c2).signed_in_at > 0);
  });

  test('a planted anonymous cookie never becomes a signed-in one', async () => {
    const { auth } = await enrolled();
    const b = await opened(fresh(), await newTicket());
    const planted = b.jar.get('om_session');
    assert.equal((await signIn(b, auth)).status, 200);
    assert.notEqual(b.jar.get('om_session'), planted);
    const old = await me(withCookie(planted));
    assert.equal(old.person, null);
    assert.deepEqual(old.tickets, [], 'the planted session is revoked');
  });

  test('signing in carries link tickets and an open screening over from an anonymous browser', async () => {
    const { p, auth } = await enrolled();
    const b = fresh();
    const ticket = await newTicket();
    await opened(b, ticket);
    const { screeningId } = await play(b);
    assert.equal(await status(b, MASTER), 200);

    const r = await signIn(b, auth);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const after1 = await me(b);
    assert.deepEqual(after1.person, { name: p.name });
    assert.deepEqual(after1.tickets.map((t) => t.film.slug), ['arrival']);
    assert.ok(after1.tickets[0].ticket.openScreening, 'the open screening came along');
    assert.equal(await status(b, MASTER), 200, 'media stays at 200');
    assert.equal(await status(b, SEGMENT), 200);
    assert.equal((await b.post(`/api/screenings/${screeningId}/heartbeat`, { position: 12 })).status, 200);
    const resumed = await play(b);
    assert.equal(resumed.screeningId, screeningId);
    assert.equal(resumed.resumed, true);
  });

  test('finishing a setup link carries over in the same way', async () => {
    const p = await newPerson(admin, uniq('Enrolling'));
    const l = await setupLink(admin, p.id);
    const b = fresh();
    await opened(b, await newTicket());
    const { screeningId } = await play(b);
    assert.equal((await enroll(b, l.token)).status, 200);
    assert.deepEqual((await me(b)).tickets.map((t) => t.film.slug), ['arrival']);
    assert.equal(await status(b, SEGMENT), 200);
    assert.equal((await play(b)).screeningId, screeningId);
  });

  test("signing in as someone else carries nothing over from the other person's browser, and frees its screening", async () => {
    const { p, b: shared } = await enrolled();
    const { p: q, auth: qAuth } = await enrolled();
    const ticket = await newTicket();
    await opened(shared, ticket);
    const { screeningId } = await play(shared);
    assert.deepEqual(await personIn(shared), { name: p.name });

    assert.equal((await signIn(shared, qAuth)).status, 200);
    const now = await me(shared);
    assert.deepEqual(now.person, { name: q.name });
    assert.deepEqual(now.tickets, [], "P's link tickets stay with P's (revoked) session");
    assert.equal(await status(shared, MASTER), 403);
    assert.equal((await shared.post('/api/films/arrival/screenings')).status, 404);

    // The screening is free at once for another browser with the link.
    const other = await opened(fresh(), ticket);
    const taken = await play(other);
    assert.equal(taken.screeningId, screeningId);
  });

  test('signing in again as the same person carries everything over', async () => {
    const { b, auth } = await enrolled();
    await opened(b, await newTicket());
    const { screeningId } = await play(b);
    assert.equal((await signIn(b, auth)).status, 200);
    assert.deepEqual((await me(b)).tickets.map((t) => t.film.slug), ['arrival']);
    assert.equal(await status(b, MASTER), 200);
    assert.equal((await play(b)).screeningId, screeningId);
  });

  test('a session that was already revoked carries nothing over', async () => {
    const { auth } = await enrolled();
    const b = await opened(fresh(), await newTicket());
    srv.db.prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ?').run(Date.now(), sha256(b.jar.get('om_session')));
    assert.equal((await signIn(b, auth)).status, 200);
    assert.deepEqual((await me(b)).tickets, []);
  });

  test('signing in grants no film by itself', async () => {
    const { b } = await enrolled();
    assert.deepEqual((await me(b)).tickets, []);
    assert.equal(await status(b, '/api/films/arrival'), 404);
    assert.equal((await b.post('/api/films/arrival/screenings')).status, 404);
    assert.equal(await status(b, MASTER), 403);
    assert.equal(await status(b, '/media/arrival/poster.jpg'), 403);
  });

  test("a valid assertion carrying another person's user handle is refused", async () => {
    const { p, auth } = await enrolled();
    const { p: q } = await enrolled();
    const b = fresh();
    const r = await signIn(b, auth, { userHandle: webauthnId(q.id) });
    assert.equal(r.status, 401);
    assert.equal(r.data.error, 'sign-in-failed');
    assert.equal(r.setCookies.length, 0);
    assert.equal(await personIn(b), null);
    // Nor with no user handle at all (softauth's `null` means "the real one", so remove it by hand).
    const c = fresh();
    const o = await c.post('/api/signin/options');
    const credential = auth.get(o.data.options);
    delete credential.response.userHandle;
    const none = await c.post('/api/signin/finish', { credential });
    assert.equal(none.status, 401);
    assert.equal(none.data.error, 'sign-in-failed');
    // The passkey is unharmed.
    const ok = await signIn(fresh(), auth);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.person.name, p.name);
  });

  test('a replayed sign-in response is refused', async () => {
    const { auth } = await enrolled();
    const b = fresh();
    const r = await signIn(b, auth);
    assert.equal(r.status, 200);
    const replay = await fresh().post('/api/signin/finish', { credential: r.credential });
    assert.equal(replay.status, 400);
    assert.equal(replay.data.error, 'ceremony-expired');
    assert.equal(replay.setCookies.length, 0);
    // A response to a challenge the server never issued, likewise.
    const made = await fresh().post('/api/signin/finish', { credential: auth.get({ challenge: crypto.randomBytes(32).toString('base64url') }) });
    assert.equal(made.data.error, 'ceremony-expired');
  });

  test('an unknown passkey is refused and not logged', async () => {
    const count = () => srv.db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
    const before = count();
    const r = await signIn(fresh(), softAuthenticator());
    assert.equal(r.status, 401);
    assert.equal(r.data.error, 'passkey-unknown');
    assert.equal(count(), before);
  });

  test('forged sign-ins are refused with 401 and change nothing', async () => {
    const { p, auth } = await enrolled({ auth: softAuthenticator({ synced: false }) });
    for (const over of [{ origin: 'http://evil.example' }, { rpId: 'evil.example' }, { crossOrigin: true }, { signature: crypto.randomBytes(64) }, { type: 'webauthn.create' }, { flags: 0x04 }]) {
      const b = fresh();
      const r = await signIn(b, auth, over);
      assert.equal(r.status, 401, JSON.stringify(over));
      assert.equal(r.data.error, 'sign-in-failed', JSON.stringify(over));
      assert.equal(await personIn(b), null);
    }
    assert.equal(srv.db.prepare('SELECT last_used_at FROM passkeys WHERE person_id = ?').get(p.id).last_used_at, null);
    assert.equal((await signIn(fresh(), auth)).status, 200);
  });

  test('a device-bound passkey whose counter goes backwards is refused, and that is logged', async () => {
    const { p, auth } = await enrolled({ auth: softAuthenticator({ synced: false }) });
    const d = await detail(p.id);
    assert.equal(d.passkeys[0].synced, false);
    assert.equal(d.passkeys[0].deviceType, 'singleDevice');
    assert.equal((await signIn(fresh(), auth)).status, 200);
    assert.equal((await signIn(fresh(), auth)).status, 200);
    const cloned = await signIn(fresh(), auth, { counter: 1 });
    assert.equal(cloned.status, 401);
    assert.equal(cloned.data.error, 'sign-in-failed');
    const refused = (await activity(`person=${p.id}`)).find((e) => e.type === 'sign-in-refused');
    assert.ok(refused, 'sign-in-refused is logged');
    assert.equal(refused.detail.reason, 'counter');
    assert.equal(refused.detail.device, 'Browser on unknown device');
    assert.equal(refused.personId, p.id);
    assert.equal((await signIn(fresh(), auth)).status, 200, 'the genuine authenticator carries on');
  });

  test('one device-bound passkey used twice at once signs in once', async () => {
    const { p, auth } = await enrolled({ auth: softAuthenticator({ synced: false }) });
    const [a, b] = [fresh(), fresh()];
    const [oa, ob] = [await a.post('/api/signin/options'), await b.post('/api/signin/options')];
    const results = await Promise.all([
      a.post('/api/signin/finish', { credential: auth.get(oa.data.options, { counter: 1 }) }),
      b.post('/api/signin/finish', { credential: auth.get(ob.data.options, { counter: 1 }) }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    assert.equal(statuses[0], 200, JSON.stringify(results.map((r) => r.data)));
    assert.ok([401, 409].includes(statuses[1]), JSON.stringify(results.map((r) => r.data)));
    assert.equal(srv.db.prepare('SELECT sign_count FROM passkeys WHERE person_id = ?').get(p.id).sign_count, 1);
  });

  test('a synced passkey that always reports 0 signs in again and again', async () => {
    const { auth } = await enrolled({ auth: softAuthenticator({ synced: true }) });
    for (let i = 0; i < 3; i++) assert.equal((await signIn(fresh(), auth, { counter: 0 })).status, 200);
  });

  test('newPasskeys: a passkey added from a link someone else finished is reported at the owner’s next sign-in', async () => {
    const owner = fresh({ 'user-agent': UA.iphone });
    const { p, auth: k1 } = await enrolled({ b: owner });
    let r = await signIn(owner, k1);
    assert.deepEqual(r.data.newPasskeys, [], 'nothing new yet');
    await sleep(5);

    // An Add-a-sign-in-method link goes astray and someone else finishes it, then signs in with it.
    const link = await recoveryLink(p.id);
    const thief = fresh({ 'user-agent': UA.windows });
    const k2 = softAuthenticator();
    const stolen = await enroll(thief, link.token, { auth: k2 });
    assert.equal(stolen.status, 200);
    assert.equal(stolen.data.person.name, p.name);
    await sleep(5);
    const thiefSignIn = await signIn(fresh({ 'user-agent': UA.windows }), k2);
    assert.equal(thiefSignIn.status, 200);
    assert.deepEqual(thiefSignIn.data.newPasskeys, [], "the owner's older passkey is not new to the thief");

    const added = (await detail(p.id)).passkeys.find((k) => k.viaLink === 'recovery');
    r = await signIn(owner, k1);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.newPasskeys, [{ addedAt: added.addedAt, device: 'Chrome on Windows' }]);
    // Shown once per passkey that signs in.
    assert.deepEqual((await signIn(owner, k1)).data.newPasskeys, []);
  });

  test('newPasskeys for a passkey that has never signed in counts from when it was created', async () => {
    const { p, auth: k1 } = await enrolled();
    await sleep(5);
    const add = await recoveryLink(p.id);
    assert.equal((await enroll(fresh({ 'user-agent': UA.mac }), add.token)).status, 200);
    // k1 has only ever been used to set up (which signs in, but is not a sign-in with k1).
    const r = await signIn(fresh(), k1);
    assert.deepEqual(r.data.newPasskeys.map((k) => k.device), ['Safari on Mac']);
  });

  test('signing out revokes the session and forgets the link tickets this browser opened', async () => {
    const { p, auth } = await enrolled();
    const b = fresh();
    const ticket = await newTicket();
    await opened(b, ticket);
    await play(b);
    assert.equal((await signIn(b, auth)).status, 200);
    const token = b.jar.get('om_session');
    const out = await b.post('/api/signout');
    assert.equal(out.status, 200);
    assert.deepEqual(out.data, { ok: true });
    assert.ok(out.setCookies.some((c) => /^om_session=;/.test(c) && /Max-Age=0/.test(c)), 'the cookie is cleared');
    assert.ok(sessionRow(token).revoked_at);
    const now = await me(withCookie(token));
    assert.equal(now.person, null);
    assert.deepEqual(now.tickets, []);
    assert.equal(await status(withCookie(token), MASTER), 403);
    const ev = (await activity(`person=${p.id}`)).find((e) => e.type === 'signed-out');
    assert.ok(ev, 'signed-out is logged');
    // The link still works.
    await opened(b, ticket);
    assert.deepEqual((await me(b)).tickets.map((t) => t.film.slug), ['arrival']);
  });

  test('an anonymous browser can sign out too, and signing out with no session is harmless', async () => {
    const b = await opened(fresh(), await newTicket());
    const token = b.jar.get('om_session');
    assert.equal((await b.post('/api/signout')).status, 200);
    assert.deepEqual((await me(withCookie(token))).tickets, []);
    const nobody = await fresh().post('/api/signout');
    assert.equal(nobody.status, 200);
    assert.deepEqual(nobody.data, { ok: true });
  });
});

// ====================================================================== admin actions
describe("the admin's actions", () => {
  test('removing a passkey signs out only the browsers it signed in', async () => {
    const { p, b: phone, auth: k1 } = await enrolled();
    const laptop = fresh();
    assert.equal((await signIn(laptop, k1)).status, 200);
    const add = await recoveryLink(p.id);
    const tablet = fresh();
    const k2 = softAuthenticator();
    assert.equal((await enroll(tablet, add.token, { auth: k2 })).status, 200);
    assert.equal((await detail(p.id)).browsers.length, 3);

    const id1 = (await detail(p.id)).passkeys.find((k) => k.viaLink === 'setup').id;
    const r = await admin.post(`/api/admin/passkeys/${id1}/remove`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { signedOut: 2 });
    assert.equal(await personIn(phone), null);
    assert.equal(await personIn(laptop), null);
    assert.deepEqual(await personIn(tablet), { name: p.name });
    const d = await detail(p.id);
    assert.deepEqual(d.passkeys.map((k) => k.viaLink), ['recovery']);
    assert.equal(d.browsers.length, 1);
    const ev = (await activity(`person=${p.id}`)).find((e) => e.type === 'passkey-removed');
    assert.deepEqual(ev.detail, { device: 'Browser on unknown device', signedOut: 2 }, 'the event keeps the device label');
    assert.equal((await signIn(fresh(), k1)).data.error, 'passkey-unknown');
    assert.equal((await signIn(fresh(), k2)).status, 200);
  });

  test("Sign out everywhere signs out every one of the person's browsers, and nobody else's", async () => {
    const { p, b: a, auth } = await enrolled();
    const b = fresh();
    await signIn(b, auth);
    const { b: other } = await enrolled();
    const r = await admin.post(`/api/admin/people/${p.id}/sign-out`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { signedOut: 2 });
    assert.equal(await personIn(a), null);
    assert.equal(await personIn(b), null);
    assert.ok(await personIn(other));
    assert.deepEqual((await detail(p.id)).browsers, []);
    const ev = (await activity(`person=${p.id}`)).find((e) => e.type === 'signed-out-everywhere');
    assert.deepEqual(ev.detail, { by: 'admin', signedOut: 2 });
    // Their passkeys still work.
    assert.equal((await signIn(fresh(), auth)).status, 200);
  });

  test('disabling signs out, cancels the link, keeps passkeys, and refuses sign-in only after a valid signature', async () => {
    const { p, b, auth } = await enrolled({ auth: softAuthenticator({ synced: false }) });
    const waiting = await recoveryLink(p.id);
    const r = await admin.post(`/api/admin/people/${p.id}/disable`);
    assert.equal(r.status, 200);
    assert.equal(r.data.disabled, true);
    assert.equal(r.data.linkWaiting, null);
    assert.equal(r.data.passkeys.length, 1, 'disabling does not remove passkeys');
    assert.deepEqual(r.data.browsers, []);
    assert.equal(await personIn(b), null);
    assert.equal((await fresh().post('/api/enroll/options', { token: waiting.token })).data.error, 'link-cancelled');

    // Without a valid signature it looks like any failed sign-in.
    for (const over of [{ signature: crypto.randomBytes(64) }, { userHandle: crypto.randomBytes(32).toString('base64url') }, { origin: 'http://evil.example' }]) {
      const bad = await signIn(fresh(), auth, over);
      assert.equal(bad.status, 401, JSON.stringify(over));
      assert.equal(bad.data.error, 'sign-in-failed');
    }
    const c = fresh();
    const refused = await signIn(c, auth);
    assert.equal(refused.status, 403);
    assert.equal(refused.data.error, 'account-disabled');
    assert.equal(refused.setCookies.length, 0);
    assert.equal(await personIn(c), null);
    const disabledEvent = (await activity(`person=${p.id}`)).find((e) => e.type === 'person-disabled');
    assert.deepEqual(disabledEvent.detail, { signedOut: 1 });
    const ev = (await activity(`person=${p.id}`)).find((e) => e.type === 'sign-in-refused');
    assert.equal(ev.detail.reason, 'disabled');
    assert.equal(ev.detail.device, 'Browser on unknown device');
    assert.equal((await activity(`person=${p.id}`)).filter((e) => e.type === 'sign-in-refused').length, 1, 'only the valid signature is logged');

    // Enabling lets them sign in again, but doesn't bring the cancelled link back.
    const e = await admin.post(`/api/admin/people/${p.id}/enable`);
    assert.equal(e.data.disabled, false);
    assert.equal((await fresh().post('/api/enroll/options', { token: waiting.token })).data.error, 'link-cancelled');
    assert.equal((await signIn(fresh(), auth)).status, 200);
    assert.ok((await activity(`person=${p.id}`)).some((x) => x.type === 'person-enabled'));
  });

  test('a disabled person is anonymous on the next request even if their sessions were missed', async () => {
    const { p, b } = await enrolled();
    await opened(b, await newTicket());
    await play(b);
    // Disabled without revoking anything: sessions.load is the backstop.
    srv.db.prepare('UPDATE people SET disabled_at = ? WHERE id = ?').run(Date.now(), p.id);
    try {
      const m = await me(b);
      assert.equal(m.person, null);
      assert.deepEqual(m.tickets, []);
      assert.equal(await status(b, MASTER), 403);
    } finally {
      srv.db.prepare('UPDATE people SET disabled_at = NULL WHERE id = ?').run(p.id);
    }
  });

  test('the People list summarises each person', async () => {
    const { p, auth } = await enrolled({ name: uniq('Listed'), note: 'only for me' });
    await signIn(fresh(), auth);
    const l = await recoveryLink(p.id);
    await fresh().post('/api/enroll/options', { token: l.token });
    const list = (await admin.get('/api/admin/people')).data;
    const names = list.map((x) => x.name);
    const nocase = (x) => x.replace(/[A-Z]/g, (c) => c.toLowerCase());
    assert.deepEqual(names, [...names].sort((a, b) => (nocase(a) < nocase(b) ? -1 : nocase(a) > nocase(b) ? 1 : 0)), 'sorted by name, ignoring case');
    const row = list.find((x) => x.id === p.id);
    assert.equal(row.name, p.name);
    assert.equal(row.disabled, false);
    assert.equal(row.passkeys, 1);
    assert.equal(row.tickets, 0);
    assert.ok(row.lastSignedInAt > 0);
    assert.equal(row.linkWaiting.purpose, 'recovery');
    assert.ok(row.linkWaiting.openedAt > 0);
    assert.equal(row.linkWaiting.expiresAt, l.expiresAt);
  });

  test('Settings report the relying party', async () => {
    const s = (await admin.get('/api/admin/settings')).data;
    assert.equal(s.passkeys.rpId, 'localhost');
    assert.equal(s.passkeys.problem, null);
  });

  test('Activity names the person for account events, and for viewing only once the browser is signed in', async () => {
    const b = fresh({ 'user-agent': UA.iphone });
    const ticket = await newTicket();
    await opened(b, ticket);
    await play(b);
    const { p, auth } = await enrolled();
    assert.equal((await signIn(b, auth)).status, 200);
    await play(b);

    const mine = await activity(`person=${p.id}`);
    for (const e of mine) {
      assert.equal(e.personId, p.id, e.type);
      assert.equal(e.personName, p.name, e.type);
    }
    const types = mine.map((e) => e.type);
    for (const t of ['link-created', 'passkey-added', 'signed-in', 'play']) assert.ok(types.includes(t), t);
    assert.deepEqual(mine.find((e) => e.type === 'passkey-added').detail.via, 'setup');
    assert.deepEqual(mine.find((e) => e.type === 'signed-in').detail, { device: 'Safari on iPhone' });
    assert.deepEqual(mine.find((e) => e.type === 'link-created').detail, { purpose: 'setup', reset: false, hours: 72, passkeysRemoved: 0, browsersSignedOut: 0 });

    // The play before signing in stays anonymous: guest history is never rewritten.
    const plays = (await activity(`ticket=${ticket.id}`)).filter((e) => e.type === 'play');
    assert.equal(plays.length, 2);
    assert.equal(plays[0].personId, p.id, 'the later play');
    assert.equal(plays[1].personId, null, 'the earlier play');
    // Viewing events find their person through the session; only account events store one.
    for (const r of srv.db.prepare('SELECT type, person_id FROM events WHERE ticket_id = ?').all(ticket.id)) assert.equal(r.person_id, null, r.type);
    for (const t of ['link-created', 'passkey-added', 'signed-in']) {
      assert.equal(srv.db.prepare('SELECT person_id FROM events WHERE type = ? AND person_id = ?').all(t, p.id).length >= 1, true, t);
    }
  });

  test('no IP address, full user agent or challenge is stored', async () => {
    const ip = '203.0.113.99';
    const b = fresh({ 'user-agent': UA.windows, 'x-forwarded-for': ip });
    const p = await newPerson(admin, uniq('Private'));
    const l = await setupLink(admin, p.id);
    const r = await enroll(b, l.token);
    assert.equal(r.status, 200);
    const s = await signIn(b, r.auth);
    assert.equal(s.status, 200);
    await opened(b, await newTicket());
    await play(b);
    await b.post('/api/signout');
    const leftover = await b.post('/api/signin/options');
    const secrets = [ip, UA.windows, 'AppleWebKit/537.36', 'Chrome/141.0', r.options.challenge, s.options.challenge, leftover.data.options.challenge];
    const tables = srv.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    for (const t of tables) {
      const dump = JSON.stringify(srv.db.prepare(`SELECT * FROM "${t}"`).all(), (k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : v));
      for (const secret of secrets) assert.ok(!dump.includes(secret), `${t} stores ${secret}`);
    }
  });
});

// ====================================================================== takeover (amendment 1)
describe('taking over a screening from a browser that can no longer play it', () => {
  async function held() {
    const ticket = await newTicket();
    const holder = await opened(fresh(), ticket);
    const { screeningId } = await play(holder);
    const other = await opened(fresh(), ticket);
    const blocked = await other.post('/api/films/arrival/screenings');
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.error, 'playing-elsewhere');
    return { ticket, holder, other, screeningId };
  }
  const takesOver = async (b, screeningId) => {
    const r = await b.post('/api/films/arrival/screenings');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.screeningId, screeningId);
    assert.equal(r.data.resumed, true);
    assert.equal(await status(b, MASTER), 200);
  };

  test('once the holding browser signs out, another takes over at once', async () => {
    const { holder, other, screeningId } = await held();
    await holder.post('/api/signout');
    await takesOver(other, screeningId);
  });

  test("once the holder's session has expired", async () => {
    const { holder, other, screeningId } = await held();
    srv.db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(Date.now() - 1, sha256(holder.jar.get('om_session')));
    await takesOver(other, screeningId);
  });

  test("once the holder's person is disabled or signed out everywhere", async () => {
    for (const action of ['disable', 'sign-out']) {
      const { p, b: holder } = await enrolled();
      const ticket = await newTicket();
      await opened(holder, ticket);
      const { screeningId } = await play(holder);
      const other = await opened(fresh(), ticket);
      assert.equal((await other.post('/api/films/arrival/screenings')).status, 409, action);
      await admin.post(`/api/admin/people/${p.id}/${action}`);
      await takesOver(other, screeningId);
      assert.equal(await status(holder, MASTER), 403, action);
    }
  });

  test('once the holder has forgotten the ticket (Sign out browsers)', async () => {
    const { ticket, other, screeningId } = await held();
    await admin.post(`/api/admin/tickets/${ticket.id}/sign-out-browsers`);
    await opened(other, ticket);
    await takesOver(other, screeningId);
  });
});

// ====================================================================== boundaries
describe('boundaries', () => {
  test('cross-site and same-site POSTs to the passkey endpoints are refused', async () => {
    const { b, auth } = await enrolled();
    const p = await newPerson(admin, uniq('Csrf'));
    const l = await setupLink(admin, p.id);
    const cookie = `om_session=${b.jar.get('om_session')}`;
    const opts = (await fresh().post('/api/enroll/options', { token: l.token })).data.options;
    const signinOpts = (await fresh().post('/api/signin/options')).data.options;
    const bodies = {
      '/api/enroll/options': { token: l.token },
      '/api/enroll/finish': { token: l.token, credential: softAuthenticator().create(opts) },
      '/api/signin/options': {},
      '/api/signin/finish': { credential: auth.get(signinOpts) },
      '/api/signout': {},
    };
    for (const site of ['cross-site', 'same-site']) {
      for (const [url, body] of Object.entries(bodies)) {
        const r = await fetch(srv.base + url, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': site, cookie }, body: JSON.stringify(body) });
        assert.equal(r.status, 403, `${site} ${url}`);
      }
    }
    // Nothing happened: still signed in, link unused.
    assert.ok(await personIn(b));
    assert.equal((await detail(p.id)).links[0].usedAt, null);
    // Same-origin is fine.
    const ok = await fetch(`${srv.base}/api/signout`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', cookie }, body: '{}' });
    assert.equal(ok.status, 200);
    // And a form post is refused whatever the site.
    const form = await fetch(`${srv.base}/api/signout`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: '' });
    assert.equal(form.status, 415);
  });

  test("a person's session cookie in om_admin is not an admin session", async () => {
    const { b } = await enrolled();
    const token = b.jar.get('om_session');
    for (const [method, url] of [['GET', '/api/admin/people'], ['POST', '/api/admin/people'], ['GET', '/api/admin/settings']]) {
      const r = await fetch(srv.base + url, { method, headers: { cookie: `om_admin=${token}`, 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify({ name: 'Mallory' }) : undefined });
      assert.equal(r.status, 401, url);
    }
  });

  // Another host under the same parent domain can set om_session or om_admin for
  // the whole domain (Domain=), and its path decides whether the browser sends it
  // before or after the cinema's own. Neither way round may it choose the session.
  test('a second, different session or admin cookie is used neither way round, /media included', async () => {
    const { p, b } = await enrolled();
    const { b: m } = await enrolled({ name: uniq('Mallory') });
    await opened(b, await newTicket());
    await play(b);
    const sam = `om_session=${b.jar.get('om_session')}`;
    const mallory = `om_session=${m.jar.get('om_session')}`;
    const send = (url, cookie) => fetch(srv.base + url, { headers: { cookie } });
    const personWith = async (cookie) => (await (await send('/api/me', cookie)).json()).person;
    assert.deepEqual(await personWith(sam), { name: p.name });
    assert.equal((await send(SEGMENT, sam)).status, 200);
    for (const cookie of [`${sam}; ${mallory}`, `${mallory}; ${sam}`, `${sam}; om_session=`, `om_session=; ${sam}`]) {
      assert.equal(await personWith(cookie), null, cookie);
      assert.equal((await send(SEGMENT, cookie)).status, 403, cookie);
    }
    // In two Cookie header lines, which the server joins into one. Written by hand:
    // Node's own client would join them before sending.
    const { hostname, port } = new URL(srv.base);
    const twoHeaders = await new Promise((resolve, reject) => {
      let raw = '';
      net.connect({ host: hostname, port: Number(port) }, function () {
        this.end(`GET /api/me HTTP/1.1\r\nHost: ${hostname}\r\nCookie: ${mallory}\r\nCookie: ${sam}\r\nConnection: close\r\n\r\n`);
      })
        .on('data', (d) => (raw += d))
        .on('end', () => resolve(raw))
        .on('error', reject);
    });
    assert.match(twoHeaders, /^HTTP\/1\.1 200/);
    assert.equal(JSON.parse(twoHeaders.slice(twoHeaders.indexOf('\r\n\r\n') + 4)).person, null);
    // The same cookie twice (a proxy repeating the header) is still one cookie.
    assert.deepEqual(await personWith(`${sam}; ${sam}`), { name: p.name });

    const adminCookie = `om_admin=${admin.jar.get('om_admin')}`;
    assert.equal((await send('/api/admin/people', adminCookie)).status, 200);
    for (const cookie of [`${adminCookie}; om_admin=planted`, `om_admin=planted; ${adminCookie}`]) {
      assert.equal((await send('/api/admin/people', cookie)).status, 401, cookie);
    }
  });

  test('/api/me and the sign-in answers expose no user handles, credential ids, notes or other people', async () => {
    const { p: q } = await enrolled({ name: uniq('Quentin'), note: 'never shown' });
    const { p, b, auth } = await enrolled({ name: uniq('Pat'), note: 'rude about Nolan' });
    const s = await signIn(b, auth);
    const m = await b.get('/api/me');
    assert.deepEqual(m.data.person, { name: p.name });
    const secrets = [webauthnId(p.id), webauthnId(q.id), auth.id, 'rude about Nolan', 'never shown', q.name];
    for (const [what, r] of [['/api/me', m], ['/api/signin/finish', s]]) {
      const json = JSON.stringify(r.data);
      for (const secret of secrets) assert.ok(!json.includes(secret), `${what} exposes ${secret}`);
    }
    // Sign-in options go to anyone, so they carry no credential ids either.
    const o = await fresh().post('/api/signin/options');
    assert.ok(!o.data.options.allowCredentials || o.data.options.allowCredentials.length === 0);
    for (const secret of secrets) assert.ok(!JSON.stringify(o.data).includes(secret));
  });

  test('signin, enroll and account are reserved, not film slugs', async () => {
    for (const slug of ['signin', 'enroll', 'account']) {
      assert.ok(RESERVED_SLUGS.has(slug), slug);
      assert.equal(await status(fresh(), `/api/films/${slug}`), 404);
    }
    const dir = tempDir();
    makeFilm(dir, 'account');
    const found = inspectMediaDir(dir);
    assert.deepEqual(found.results, []);
    assert.equal(found.skipped[0].name, 'account');
  });

  test('foreign keys still hold after everything above', () => {
    assert.deepEqual(srv.db.prepare('PRAGMA foreign_key_check').all(), []);
  });

  // Last in this server: it signs every viewer out.
  test('after Sign out every viewer, a browser that opens the link again takes over at once', async () => {
    const ticket = await newTicket();
    const holder = await opened(fresh(), ticket);
    const { screeningId } = await play(holder);
    const { b: member } = await enrolled();
    await admin.post('/api/admin/sessions/expire-all');
    assert.equal(await personIn(member), null, 'people are signed out too');
    const other = await opened(fresh(), ticket);
    const r = await other.post('/api/films/arrival/screenings');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.screeningId, screeningId);
  });
});

// ====================================================================== the production relying party
describe('with the production relying party (openmatte.dev)', () => {
  const PROD_URL = 'https://www.openmatte.dev';
  let s;
  let adm;
  before(async () => {
    s = await startServer({ mediaDir: tempDir(), webauthn: { publicUrl: PROD_URL, rpId: 'openmatte.dev', production: true } });
    adm = await adminBrowser(s.base);
  });
  after(() => s.close());

  test('Settings name the RP ID and origin', async () => {
    assert.deepEqual((await adm.get('/api/admin/settings')).data.passkeys, { rpId: 'openmatte.dev', origin: PROD_URL, problem: null });
  });

  test('a passkey made on www.openmatte.dev sets up and signs in; one from localhost or a sibling origin does not', async () => {
    const p = await newPerson(adm, 'Arthur');
    const l = await setupLink(adm, p.id);
    for (const auth of [softAuthenticator(), softAuthenticator({ origin: 'https://openmatte.dev', rpId: 'openmatte.dev' }), softAuthenticator({ origin: 'https://x.openmatte.dev', rpId: 'openmatte.dev' })]) {
      const r = await enroll(client(s.base), l.token, { auth });
      assert.equal(r.status, 400);
      assert.equal(r.data.error, 'passkey-invalid');
    }
    const opts = await client(s.base).post('/api/enroll/options', { token: l.token });
    assert.equal(opts.data.options.rp.id, 'openmatte.dev');
    const auth = softAuthenticator({ origin: PROD_URL, rpId: 'openmatte.dev' });
    assert.equal((await enroll(client(s.base), l.token, { auth })).status, 200);
    const b = client(s.base);
    const ok = await signIn(b, auth);
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    for (const origin of ['https://openmatte.dev', 'http://www.openmatte.dev', 'http://localhost:5173']) {
      const r = await signIn(client(s.base), auth, { origin });
      assert.equal(r.status, 401, origin);
      assert.equal(r.data.error, 'sign-in-failed', origin);
    }
  });
});

// ====================================================================== when passkeys are unavailable
describe('when passkeys are unavailable (production without WEBAUTHN_RP_ID)', () => {
  let s;
  let adm;
  before(async () => {
    const dir = tempDir();
    makeFilm(dir, 'arrival');
    s = await startServer({ mediaDir: dir, webauthn: { publicUrl: 'https://www.openmatte.dev', rpId: '', production: true } });
    adm = await adminBrowser(s.base);
    await adm.post('/api/admin/scan');
    const id = (await adm.get('/api/admin/films')).data[0].id;
    await adm.patch(`/api/admin/films/${id}`, { published: true });
  });
  after(() => s.close());

  test('every passkey endpoint and link creation answer 503 passkeys-unavailable', async () => {
    const c = client(s.base);
    const calls = [
      ['/api/enroll/options', { token: crypto.randomBytes(32).toString('base64url') }],
      ['/api/enroll/finish', { token: crypto.randomBytes(32).toString('base64url'), credential: {} }],
      ['/api/signin/options', {}],
      ['/api/signin/finish', { credential: {} }],
    ];
    for (const [url, body] of calls) {
      const r = await c.post(url, body);
      assert.equal(r.status, 503, url);
      assert.equal(r.data.error, 'passkeys-unavailable', url);
    }
    const p = await newPerson(adm, 'Sam');
    const link = await adm.post(`/api/admin/people/${p.id}/links`, {});
    assert.equal(link.status, 503);
    assert.equal(link.data.error, 'passkeys-unavailable');
    assert.equal((await adm.get(`/api/admin/people/${p.id}`)).data.links.length, 0);
    const settings = (await adm.get('/api/admin/settings')).data;
    assert.match(settings.passkeys.problem, /WEBAUTHN_RP_ID/);
  });

  test('a link ticket still opens and plays', async () => {
    const t = (await adm.post('/api/admin/tickets', { filmId: (await adm.get('/api/admin/films')).data[0].id })).data[0];
    const b = client(s.base);
    assert.equal((await b.post('/api/tickets/open', { code: t.code })).status, 200);
    assert.equal((await b.post('/api/films/arrival/screenings')).status, 200);
    assert.equal(await status(b, MASTER), 200);
    assert.equal(await status(b, SEGMENT), 200);
    assert.equal((await b.post('/api/signout')).status, 200);
  });
});

// ====================================================================== a flood of sign-ins
describe('a flood of sign-in attempts', () => {
  let s;
  let adm;
  before(async () => {
    s = await startServer({ mediaDir: tempDir() });
    adm = await adminBrowser(s.base);
  });
  after(() => s.close());

  test('2,000 sign-in options from 2,000 IPv6 /64s fill the pool without breaking a setup under way', async () => {
    const p = await newPerson(adm, 'Sam');
    const link = await setupLink(adm, p.id);
    const b = client(s.base);
    const opts = await b.post('/api/enroll/options', { token: link.token });
    assert.equal(opts.status, 200);

    const results = [];
    for (let i = 0; i < 2000; i += 100) {
      results.push(
        ...(await Promise.all(
          Array.from({ length: 100 }, (_, j) => {
            const k = i + j;
            return client(s.base, { 'x-forwarded-for': `2001:db8:${(k >> 8).toString(16)}:${(k & 0xff).toString(16)}::1` }).post('/api/signin/options');
          }),
        )),
      );
    }
    const ok = results.filter((r) => r.status === 200);
    const busy = results.filter((r) => r.status === 429);
    assert.equal(ok.length + busy.length, 2000, JSON.stringify([...new Set(results.map((r) => r.status))]));
    assert.equal(ok.length, 500, 'at most 500 sign-ins wait at once');
    assert.ok(busy.every((r) => r.data.error === 'busy'), 'busy, not rate-limited: each /64 asked once');
    assert.equal((await client(s.base, { 'x-forwarded-for': '2001:db8:ffff:1::1' }).post('/api/signin/options')).data.error, 'busy');

    // The setup under way finishes, and a new one can start.
    const auth = softAuthenticator();
    const done = await b.post('/api/enroll/finish', { token: link.token, credential: auth.create(opts.data.options) });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    const q = await newPerson(adm, 'Alex');
    const l2 = await setupLink(adm, q.id);
    assert.equal((await enroll(client(s.base), l2.token)).status, 200);

    // Nobody was evicted early: a challenge handed out during the flood still signs in.
    const r = await b.post('/api/signin/finish', { credential: auth.get(ok[0].data.options) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  });
});

// ====================================================================== rate limits
describe('rate limits (default limits)', () => {
  let s;
  before(async () => {
    s = await startServer({ mediaDir: tempDir() });
  });
  after(() => s.close());
  const from = (ip) => client(s.base, { 'x-forwarded-for': ip });

  test('IPv6 clients are counted by their /64; IPv4-mapped addresses as IPv4', () => {
    assert.equal(clientKey('2001:db8:1:2:3:4:5:6'), clientKey('2001:db8:1:2::9'));
    assert.equal(clientKey('2001:0db8:0001:0002::1'), clientKey('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    assert.equal(clientKey('2001:DB8:1:2::1'), clientKey('2001:db8:1:2::1'));
    assert.notEqual(clientKey('2001:db8:1:2::1'), clientKey('2001:db8:1:3::1'));
    assert.equal(clientKey('::ffff:203.0.113.9'), '203.0.113.9');
    assert.equal(clientKey('203.0.113.9'), '203.0.113.9');
    assert.notEqual(clientKey('203.0.113.9'), clientKey('203.0.113.10'));
  });

  test('enrolment: 20 tries per client in 15 minutes, options and finish together', async () => {
    const c = from('203.0.113.7');
    for (let i = 0; i < 20; i++) assert.equal((await c.post('/api/enroll/options', { token: 'nope' })).status, 404, String(i));
    const r = await c.post('/api/enroll/options', { token: 'nope' });
    assert.equal(r.status, 429);
    assert.equal(r.data.error, 'too-many-requests');
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    // One pool for both steps, not 20 of each.
    const finish = await c.post('/api/enroll/finish', { token: 'nope' });
    assert.equal(finish.status, 429);
    assert.equal(finish.data.error, 'too-many-requests');
    assert.equal((await from('203.0.113.8').post('/api/enroll/options', { token: 'nope' })).status, 404, 'another client is unaffected');
  });

  test('sign-in options: 60 per /64 in 10 minutes', async () => {
    for (let i = 0; i < 60; i++) {
      const ip = i % 2 ? '2001:db8:a:b::1' : `2001:db8:a:b:${(i + 1).toString(16)}::2`;
      assert.equal((await from(ip).post('/api/signin/options')).status, 200, ip);
    }
    const r = await from('2001:db8:a:b:ffff::3').post('/api/signin/options');
    assert.equal(r.status, 429);
    assert.equal(r.data.error, 'too-many-requests');
    assert.equal((await from('2001:db8:a:c::1').post('/api/signin/options')).status, 200, 'the next /64 is another client');
  });

  test('sign-in finish: 30 per client; an IPv4-mapped address is the same client', async () => {
    for (let i = 0; i < 30; i++) {
      const r = await from(i % 2 ? '::ffff:198.51.100.4' : '198.51.100.4').post('/api/signin/finish', { credential: {} });
      assert.equal(r.status, 400, String(i));
    }
    const r = await from('198.51.100.4').post('/api/signin/finish', { credential: {} });
    assert.equal(r.status, 429);
    assert.equal(r.data.error, 'too-many-requests');
  });
});

describe('after review', () => {
  test('a used link still shows where it was used after its passkey is removed or reset', async () => {
    const { p } = await enrolled();
    const setupUsedOn = () => srv.db.prepare("SELECT used_device FROM person_links WHERE person_id = ? AND purpose = 'setup'").get(p.id).used_device;
    assert.equal(setupUsedOn(), 'Browser on unknown device');
    await recoveryLink(p.id, { reset: true });
    assert.equal(passkeyCount(p.id), 0);
    assert.equal((await detail(p.id)).links.find((l) => l.purpose === 'setup').usedDevice, 'Browser on unknown device');
  });

  test('an expired link stays expired: a newer link or Cancel it neither cancels it nor logs a cancel', async () => {
    const p = await newPerson(admin, uniq('Kim'));
    await setupLink(admin, p.id, { hours: 1 });
    srv.db.prepare('UPDATE person_links SET expires_at = ? WHERE person_id = ?').run(Date.now() - 1000, p.id);
    assert.equal((await admin.post(`/api/admin/people/${p.id}/links/cancel`)).status, 200);
    assert.equal(srv.db.prepare('SELECT cancelled_at FROM person_links WHERE person_id = ?').get(p.id).cancelled_at, null);
    assert.ok(!(await activity(`person=${p.id}`)).some((e) => e.type === 'link-cancelled'));
    await setupLink(admin, p.id, { hours: 1 });
    const links = (await detail(p.id)).links;
    assert.equal(links.length, 2);
    assert.equal(links[1].cancelledAt, null, 'the expired one is still just expired');
  });

  test('sign-out counts leave out sessions that had already expired', async () => {
    const { p, auth } = await enrolled();
    const old = fresh();
    await signIn(old, auth);
    srv.db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(Date.now() - 1, sha256(old.jar.get('om_session')));
    assert.equal((await detail(p.id)).browsers.length, 1);
    assert.deepEqual((await admin.post(`/api/admin/people/${p.id}/sign-out`)).data, { signedOut: 1 });
  });

  test('names are unique ignoring case and Unicode form, not accents', async () => {
    const base = uniq('Élodie');
    assert.equal((await admin.post('/api/admin/people', { name: base })).status, 201);
    assert.equal((await admin.post('/api/admin/people', { name: base.toLowerCase() })).data.error, 'name-taken');
    // The same name typed in decomposed form (e + combining acute).
    assert.equal((await admin.post('/api/admin/people', { name: base.normalize('NFD') })).data.error, 'name-taken');
    assert.equal((await admin.post('/api/admin/people', { name: base.replace('É', 'E') })).status, 201, 'Elodie is a different name');
    const other = await newPerson(admin, uniq('Zoë'));
    assert.equal((await admin.patch(`/api/admin/people/${other.id}`, { name: base.toUpperCase() })).data.error, 'name-taken');
  });

  test('a session revoked while the passkey was being checked carries nothing over', async () => {
    const { tx } = await import('../server/db.js');
    const { createSessionStore } = await import('../server/sessions.js');
    const { p } = await enrolled();
    const b = await opened(fresh(), await newTicket());
    await play(b);
    const currentHash = sha256(b.jar.get('om_session'));
    // As "Sign out every viewer" would, after the route read the session and before the transaction.
    srv.db.prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ?').run(Date.now(), currentHash);
    const passkeyId = srv.db.prepare('SELECT id FROM passkeys WHERE person_id = ?').get(p.id).id;
    const r = tx(srv.db, () => createSessionStore(srv.db).signIn({ get: () => '' }, { personId: p.id, passkeyId, currentHash }), { immediate: true });
    const newHash = r.session.id_hash;
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM session_tickets WHERE session_hash = ?').get(newHash).n, 0);
    assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM screenings WHERE session_hash = ?').get(newHash).n, 0);
    assert.ok(srv.db.prepare('SELECT revoked_at FROM sessions WHERE id_hash = ?').get(currentHash).revoked_at);
  });
});
