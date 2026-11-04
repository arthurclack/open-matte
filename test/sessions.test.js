// Device labels: enough for the admin to tell devices apart. Admin sessions, and
// reading the session cookies.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { createSessionStore, deviceLabel, parseCookies } = await import('../server/sessions.js');

test('device labels name the browser and device, including browsers on iPhone', () => {
  const cases = {
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1': 'Safari on iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/141.0 Mobile/15E148 Safari/605.1.15': 'Firefox on iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/140.0 Version/18.0 Mobile/15E148 Safari/604.1': 'Edge on iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1': 'Chrome on iPhone',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15': 'Safari on Mac',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0': 'Edge on Windows',
    'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36 EdgA/141.0': 'Edge on Android',
    'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0': 'Firefox on Linux',
  };
  for (const [ua, label] of Object.entries(cases)) assert.equal(deviceLabel(ua), label, ua);
});

// An admin session is keyed with a key made from ADMIN_PASSWORD, so a new password (deploy/.env, then
// docker compose up -d) signs every admin browser out. Viewers are unaffected.
test('a new admin password signs every admin browser out, and no viewer', async () => {
  const { openDb } = await import('../server/db.js');
  const db = openDb(':memory:');
  const cookies = [];
  const req = { get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/26.0 Safari/605.1.15', secure: false };
  const res = { append: (_, value) => cookies.push(value.split(';')[0]) };
  const old = createSessionStore(db, { adminPassword: 'the old password' });
  old.create(req, res, 'admin');
  old.create(req, res, 'viewer');
  // A fresh request each time: load() keeps the cookies it parsed on the request.
  const browser = () => ({ headers: { cookie: cookies.join('; ') } });

  assert.ok(old.load(browser(), 'admin'), 'signed in to the admin');
  const restarted = createSessionStore(db, { adminPassword: 'the old password' });
  assert.ok(restarted.load(browser(), 'admin'), 'a restart with the same password keeps it');
  const changed = createSessionStore(db, { adminPassword: 'a brand new password' });
  assert.equal(changed.load(browser(), 'admin'), null, 'a new password signs it out');
  assert.ok(changed.load(browser(), 'viewer'), 'the viewer stays signed in');
  db.close();
});

// The admin key is scrypt of the password and a salt made once per install, at OWASP's
// cost for scrypt, so with the database and a cookie each guess at the password is slow.
test('admin sessions are keyed with scrypt of the password and a salt kept in the database', async () => {
  const crypto = await import('node:crypto');
  const { openDb } = await import('../server/db.js');
  const { createSettings } = await import('../server/settings.js');
  const db = openDb(':memory:');
  const password = 'the admin password';
  let cookie;
  const req = { get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/26.0 Safari/605.1.15', secure: false };
  const store = createSessionStore(db, { adminPassword: password });
  const row = store.create(req, { append: (_, value) => (cookie = value.split(';')[0]) }, 'admin');
  const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));

  const salt = createSettings(db).getSecret('adminKeySalt');
  assert.match(salt, /^[\w-]{22}$/, '128 random bits');
  assert.notEqual(row.id_hash, crypto.createHmac('sha256', password).update(token).digest('hex'), 'not keyed with the password itself');
  // N 2^17, r 8, p 1: OWASP's minimum. Node's default, N 2^14, is not enough.
  const key = crypto.scryptSync(password, salt, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  assert.equal(row.id_hash, crypto.createHmac('sha256', key).update(token).digest('hex'));

  // A restart keeps the salt, and so the session.
  const restarted = createSessionStore(db, { adminPassword: password });
  assert.equal(createSettings(db).getSecret('adminKeySalt'), salt);
  assert.equal(restarted.load({ headers: { cookie } }, 'admin')?.id_hash, row.id_hash);
  // Another install has its own.
  const other = openDb(':memory:');
  createSessionStore(other, { adminPassword: password });
  assert.notEqual(createSettings(other).getSecret('adminKeySalt'), salt);

  // Checking a sign-in attempt is cheap and done at once, with no scrypt: the server
  // holds the password, and scrypt would run on the threads that read the films.
  assert.equal(store.adminPasswordMatches(password), true);
  assert.equal(store.adminPasswordMatches('the admin passwore'), false);
  assert.equal(store.adminPasswordMatches(''), false);
  assert.equal(store.adminPasswordMatches(['the admin password']), false, 'only a string can be the password');
  assert.equal(createSessionStore(db, { adminPassword: 'a brand new password' }).adminPasswordMatches(password), false);
  db.close();
});

test('a sign-in attempt runs no scrypt', async (t) => {
  const { default: crypto } = await import('node:crypto');
  const { openDb } = await import('../server/db.js');
  const db = openDb(':memory:');
  const store = createSessionStore(db, { adminPassword: 'the admin password' });
  const scrypt = t.mock.method(crypto, 'scrypt');
  const scryptSync = t.mock.method(crypto, 'scryptSync');
  const started = performance.now();
  for (let i = 0; i < 20; i++) assert.equal(store.adminPasswordMatches(`guess ${i}`), false);
  assert.equal(store.adminPasswordMatches('the admin password'), true);
  assert.equal(scrypt.mock.callCount() + scryptSync.mock.callCount(), 0);
  // Twenty-one scrypts at the key's cost would take seconds.
  assert.ok(performance.now() - started < 500, `${performance.now() - started} ms`);
  db.close();
});

// The cinema sets one om_session and one om_admin, so a second value of either was
// set by another host under the same parent domain, which also chose where in the
// header it goes. Neither value is used, whichever comes first.
test('a cookie sent twice with different values is left out, whichever comes first', () => {
  assert.deepEqual(parseCookies('om_session=ours; om_session=theirs; other=1'), { other: '1' });
  assert.deepEqual(parseCookies('om_session=theirs; other=1; om_session=ours'), { other: '1' });
  assert.deepEqual(parseCookies('om_session=ours; om_session='), {}, 'an empty one counts too');
  assert.deepEqual(parseCookies('om_admin=a; om_session=ours; om_admin=b; om_admin=a'), { om_session: 'ours' });
  assert.deepEqual(parseCookies('om_session=ours; om_session=ours'), { om_session: 'ours' }, 'the same value twice is one cookie');
  assert.deepEqual(parseCookies('om_session=ours; om_session=%E0%A4%A'), { om_session: 'ours' }, 'a malformed one is ignored, as before');
  assert.deepEqual(parseCookies('toString=x; __proto__=y'), { toString: 'x' });
});

test('two different session cookies sign the browser in as neither, viewer or admin', async () => {
  const { openDb } = await import('../server/db.js');
  const db = openDb(':memory:');
  const store = createSessionStore(db, { adminPassword: 'a password' });
  const req = { get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/26.0 Safari/605.1.15', secure: false };
  const issue = (kind) => {
    let cookie;
    const row = store.create(req, { append: (_, value) => (cookie = value.split(';')[0]) }, kind);
    return { cookie, row };
  };
  const load = (cookies, kind) => store.load({ headers: { cookie: cookies.join('; ') } }, kind);
  const [ours, theirs] = [issue('viewer'), issue('viewer')];
  const [admin, otherAdmin] = [issue('admin'), issue('admin')];
  assert.equal(load([ours.cookie], 'viewer').id_hash, ours.row.id_hash);
  assert.equal(load([admin.cookie], 'admin').id_hash, admin.row.id_hash);
  for (const [cookies, kind] of [
    [[ours.cookie, theirs.cookie], 'viewer'],
    [[theirs.cookie, ours.cookie], 'viewer'],
    [[admin.cookie, otherAdmin.cookie], 'admin'],
    [[otherAdmin.cookie, admin.cookie], 'admin'],
  ]) {
    assert.equal(load(cookies, kind), null, cookies.join('; '));
  }
  // One of each name is the usual admin's browser, and both are used.
  assert.ok(load([ours.cookie, admin.cookie], 'viewer'));
  assert.ok(load([ours.cookie, admin.cookie], 'admin'));
  db.close();
});
