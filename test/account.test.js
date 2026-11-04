// The account page: milestone 2, slice 5. Written from docs/history/milestone-2.md
// ("Endpoints", "Screens: Account", "Slice 5"), not from the implementation. No viewer
// browser here holds the admin cookie.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';
import { adminBrowser, browser, enroll, makeFilm, newPerson, setupLink, signIn, startServer, tempDir } from './helpers.js';

const mediaDir = tempDir();
const MASTER = '/media/arrival/hls/master.m3u8';

let srv;
let admin;
let filmId;

before(async () => {
  makeFilm(mediaDir, 'arrival');
  srv = await startServer({ mediaDir, limits: { scale: 100 } });
  admin = await adminBrowser(srv.base);
  await admin.post('/api/admin/scan');
  filmId = (await admin.get('/api/admin/films')).data[0].id;
  await admin.patch(`/api/admin/films/${filmId}`, { published: true });
});
after(() => srv.close());

let counter = 0;
const uniq = (name) => `${name} ${++counter}`;
const fresh = () => browser(srv.base);
const account = (b) => b.get('/api/account');
const everywhere = (b) => b.post('/api/account/sign-out-everywhere');

// A person whose phone used the setup link; device() signs another browser in.
async function member(name = uniq('Sam'), { synced = true } = {}) {
  const p = await newPerson(admin, name);
  const auth = softAuthenticator({ synced });
  const phone = fresh();
  const r = await enroll(phone, (await setupLink(admin, p.id)).token, { auth });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const device = async (b = fresh()) => {
    const s = await signIn(b, auth);
    assert.equal(s.status, 200, JSON.stringify(s.data));
    return b;
  };
  return { p, auth, phone, device };
}

describe('GET /api/account', () => {
  test('needs a browser signed in as a person', async () => {
    assert.equal((await account(fresh())).status, 401, 'no session');
    // A browser that opened a link ticket has a session, but no person.
    const t = (await admin.post('/api/admin/tickets', { filmId })).data[0];
    const b = fresh();
    await b.post('/api/tickets/open', { code: t.code });
    assert.ok(b.jar.get('om_session'));
    const r = await account(b);
    assert.equal(r.status, 401);
    assert.equal(r.data.error, 'sign-in-required');
    assert.equal((await everywhere(b)).status, 401);
  });

  test("lists this person's passkeys and signed-in browsers, and nobody else's", async () => {
    const sam = await member();
    const laptop = await sam.device();
    const alex = await member(uniq('Alex'));
    await alex.device();
    // A browser of Sam's that signed out isn't listed.
    const old = await sam.device();
    await old.post('/api/signout');

    const r = await account(laptop);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.person, { name: sam.p.name });
    assert.equal(r.data.passkeys.length, 1);
    const [k] = r.data.passkeys;
    assert.equal(k.synced, true);
    assert.equal(k.viaLink, 'setup');
    assert.equal(k.current, true, 'the passkey this browser signed in with');
    assert.ok(k.addedAt && k.lastUsedAt);
    assert.equal(r.data.browsers.length, 2, 'the phone and this laptop');
    assert.deepEqual(r.data.browsers.map((b) => b.current).sort(), [false, true]);
    for (const b of r.data.browsers) assert.ok(b.signedInAt && b.lastSeenAt);

    // Nothing to act on, and nothing that identifies a session or a passkey.
    const text = JSON.stringify(r.data);
    assert.deepEqual(Object.keys(k).sort(), ['addedAt', 'addedFrom', 'current', 'lastUsedAt', 'synced', 'viaLink']);
    assert.deepEqual(Object.keys(r.data.browsers[0]).sort(), ['current', 'device', 'lastSeenAt', 'signedInAt']);
    assert.ok(!text.includes(alex.p.name), "never another person's");
    const hashes = srv.db.prepare('SELECT id_hash FROM sessions').all().map((s) => s.id_hash);
    assert.ok(hashes.every((h) => !text.includes(h)), 'no session hashes');
    const credentials = srv.db.prepare('SELECT credential_id FROM passkeys').all().map((c) => c.credential_id);
    assert.ok(credentials.every((c) => !text.includes(c)), 'no credential ids');
  });

  test('a passkey added with a recovery link, kept on one device', async () => {
    const sam = await member(uniq('Sam'), { synced: false });
    const recovery = await setupLink(admin, sam.p.id, { confirmedContact: true });
    const tablet = fresh();
    const r = await enroll(tablet, recovery.token, { auth: softAuthenticator() });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const keys = (await account(tablet)).data.passkeys;
    assert.deepEqual(keys.map((k) => [k.synced, k.viaLink, k.current]), [
      [false, 'setup', false],
      [true, 'recovery', true],
    ]);
  });

  test('a disabled person, or a signed-out browser, gets a 401', async () => {
    const sam = await member();
    const laptop = await sam.device();
    await laptop.post('/api/signout');
    assert.equal((await account(laptop)).status, 401);
    await admin.post(`/api/admin/people/${sam.p.id}/disable`);
    assert.equal((await account(sam.phone)).status, 401);
  });
});

describe('Sign out everywhere, from the account page', () => {
  test("revokes every one of the person's sessions, clears this browser's cookie, and leaves others alone", async () => {
    const sam = await member();
    const laptop = await sam.device();
    const tv = await sam.device();
    const alex = await member(uniq('Alex'));
    // Sam's TV is playing a ticket for Sam.
    await admin.post('/api/admin/tickets', { filmId, personId: sam.p.id });
    assert.equal((await tv.post('/api/films/arrival/screenings')).status, 200);
    assert.equal((await tv.get(MASTER)).status, 200);

    const r = await everywhere(laptop);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.signedOut, 3, 'phone, laptop and TV');
    assert.match(r.headers.get('set-cookie') || '', /om_session=;.*Max-Age=0/);
    assert.equal(laptop.jar.get('om_session'), undefined);

    const live = srv.db
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE person_id = ? AND revoked_at IS NULL AND expires_at > ?")
      .get(sam.p.id, Date.now()).n;
    assert.equal(live, 0);
    for (const b of [sam.phone, tv]) assert.equal((await b.get('/api/me')).data.person, null);
    assert.equal((await tv.get(MASTER)).status, 403, 'playback stops on the next request');
    assert.equal((await account(alex.phone)).status, 200, "Alex isn't affected");

    // Recorded against Sam, as their own doing, with this browser's device.
    const e = srv.db.prepare("SELECT * FROM events WHERE type = 'signed-out-everywhere' AND person_id = ? ORDER BY id DESC").get(sam.p.id);
    assert.deepEqual(JSON.parse(e.detail), { by: 'person', signedOut: 3 });
    assert.ok(e.session_hash);

    // The passkey still works.
    await sam.device(laptop);
    assert.equal((await account(laptop)).data.browsers.length, 1);
  });
});
