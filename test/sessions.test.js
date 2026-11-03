// Device labels: enough for the admin to tell devices apart. And admin sessions.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { createSessionStore, deviceLabel } = await import('../server/sessions.js');

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

// An admin session is keyed with ADMIN_PASSWORD, so a new password (deploy/.env, then
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
