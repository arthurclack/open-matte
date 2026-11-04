// Settings read from the environment: the ones that could quietly undo a promise
// stop the start instead, and a production site on https always sends Secure cookies.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';

// This file's server runs as in production on https: set before anything reads config.js.
process.env.NODE_ENV = 'production';
process.env.PUBLIC_URL = 'https://cinema.example.com';
process.env.COOKIE_SECURE = ''; // unset, as in Docker (helpers.js would set it to false)
const { makeFilm, startServer, tempDir, adminBrowser } = await import('./helpers.js');

// config.js as it would be read with these settings: a fresh copy of the module,
// with the environment put back afterwards.
let copies = 0;
async function configWith(settings) {
  const saved = {};
  for (const [k, v] of Object.entries(settings)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return (await import(`../server/config.js?copy=${++copies}`)).config;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('backup settings that would delete backups as they are made stop the start', async () => {
  await assert.rejects(configWith({ BACKUP_KEEP_DAYS: '0' }), /BACKUP_KEEP_DAYS must be 1 or more/);
  await assert.rejects(configWith({ BACKUP_KEEP_DAYS: '-3' }), /BACKUP_KEEP_DAYS must be 1 or more/);
  await assert.rejects(configWith({ BACKUP_KEEP_MONTHS: '-1' }), /BACKUP_KEEP_MONTHS must be 0 or more/);
  await assert.rejects(configWith({ BACKUP_HOUR: '24' }), /BACKUP_HOUR must be from 0 to 23/);
  await assert.rejects(configWith({ BACKUP_HOUR: '-1' }), /BACKUP_HOUR must be from 0 to 23/);
  const ok = await configWith({ BACKUP_KEEP_DAYS: '1', BACKUP_KEEP_MONTHS: '0', BACKUP_HOUR: '23' });
  assert.deepEqual([ok.backupKeepDays, ok.backupKeepMonths, ok.backupHour], [1, 0, 23]);
  // Empty, as Compose passes an unset one: the defaults.
  const empty = await configWith({ BACKUP_KEEP_DAYS: '', BACKUP_KEEP_MONTHS: '', BACKUP_HOUR: '' });
  assert.deepEqual([empty.backupKeepDays, empty.backupKeepMonths, empty.backupHour], [14, 12, 4]);
});

test('TRUST_PROXY takes a number of proxies, or their addresses; anything else stops the start', async () => {
  // What Express then believes: whether the proxy at this address, one hop in
  // front of the app, says who the visitor is.
  const trusts = async (value, address) => {
    const app = express();
    app.set('trust proxy', (await configWith({ TRUST_PROXY: value })).trustProxy);
    return app.get('trust proxy fn')(address, 0);
  };
  // The default: Caddy on Docker's private network, never a public address.
  assert.equal(await trusts(undefined, '172.18.0.3'), true);
  assert.equal(await trusts(undefined, 'fd12:3456::3'), true);
  assert.equal(await trusts(undefined, '2001:db8:1::3'), false);
  // A number counts proxies, so a proxy on a public IPv6 subnet can be trusted.
  // Read as an address, "1" would be 0.0.0.1 and trust nobody.
  assert.equal(await trusts('1', '2001:db8:1::3'), true);
  assert.equal(await trusts('0', '172.18.0.3'), false);
  assert.equal(await trusts('2001:db8:1::/64', '2001:db8:1::3'), true);
  // Set but empty, as Compose passes an unset one: the default, not a crash.
  assert.equal(await trusts('', '172.18.0.3'), true);
  await assert.rejects(configWith({ TRUST_PROXY: 'true' }), /TRUST_PROXY must be/);
  await assert.rejects(configWith({ TRUST_PROXY: 'caddy' }), /TRUST_PROXY must be/);
});

test('cookies are Secure on a production site on https, unless COOKIE_SECURE says otherwise', async () => {
  assert.equal((await configWith({})).cookieSecure, 'true');
  assert.equal((await configWith({ COOKIE_SECURE: 'auto' })).cookieSecure, 'auto');
  assert.equal((await configWith({ PUBLIC_URL: 'http://localhost:3000' })).cookieSecure, 'auto');
  assert.equal((await configWith({ NODE_ENV: 'development' })).cookieSecure, 'auto');
});

test("a production site on https sends Secure cookies even when it can't tell the request came over HTTPS", async () => {
  const mediaDir = tempDir();
  makeFilm(mediaDir, 'arrival');
  const srv = await startServer({ mediaDir });
  try {
    const admin = await adminBrowser(srv.base);
    await admin.post('/api/admin/scan');
    const filmId = (await admin.get('/api/admin/films')).data[0].id;
    await admin.patch(`/api/admin/films/${filmId}`, { published: true });
    const ticket = (await admin.post('/api/admin/tickets', { filmId, label: 'Sam' })).data[0];
    // Plain HTTP, with no proxy saying otherwise: what the app sees when it doesn't
    // trust the proxy in front of it.
    const res = await fetch(`${srv.base}/api/tickets/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: ticket.code }) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie'), /^om_session=[^;]+;.*; Secure/);
    const signIn = await fetch(`${srv.base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
    assert.match(signIn.headers.get('set-cookie'), /^om_admin=[^;]+;.*; Secure/);
  } finally {
    await srv.close();
  }
});
