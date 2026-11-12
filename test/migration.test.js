// Upgrading a milestone 1 database to milestone 2, a schema 6 database to
// migration 7 (milestone 3, slice 4) and a schema 7 database to migration 8 (version
// 2, slice 1), and refusing one written by newer code.
// docs/history/milestone-2.md: "Data model" and "Existing rows";
// docs/history/milestone-3.md, slice 4; docs/version-2.md: "The model" and
// "Upgrading an existing shop".
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';

const { adminBrowser, browser, enroll, makeFilm, setupLink, signIn, tempDir, watchPlays } = await import('./helpers.js');
const { MIGRATIONS, openDb } = await import('../server/db.js');
const { DAY, MIN, TABLES_7, fillShop, schemaSevenDb } = await import('./schema7.js');
const { scanMedia } = await import('../server/scan.js');
const { createApp } = await import('../server/app.js');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const HOUR = 60 * 60 * 1000;
const userVersion = (db) => db.prepare('PRAGMA user_version').get().user_version;
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const rows = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((r) => ({ ...r }));

// A database as milestone 1 left it: the first two migrations, user_version 2.
function milestoneOneDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  for (let i = 0; i < 2; i++) {
    db.exec('BEGIN');
    db.exec(MIGRATIONS[i]);
    db.exec(`PRAGMA user_version = ${i + 1}`);
    db.exec('COMMIT');
  }
  return db;
}

describe('a milestone 1 database', () => {
  const dir = tempDir();
  const file = path.join(dir, 'open-matte.db');
  const mediaDir = tempDir();
  const token = crypto.randomBytes(32).toString('base64url');
  const M1_TABLES = ['settings', 'films', 'tickets', 'sessions', 'session_tickets', 'screenings', 'events'];
  let before1;
  let oldColumns;
  let db;
  let server;
  let base;

  before(async () => {
    assert.ok(MIGRATIONS.length >= 3, 'migration 3 exists');
    makeFilm(mediaDir, 'arrival');
    const m1 = milestoneOneDb(file);
    assert.equal(userVersion(m1), 2);
    await scanMedia(m1, mediaDir);
    const now = Date.now();
    m1.prepare('UPDATE films SET published = 1').run();
    const filmId = m1.prepare("SELECT id FROM films WHERE slug = 'arrival'").get().id;
    m1.prepare("INSERT INTO settings (key, value) VALUES ('cinemaName', '\"Home\"')").run();
    const ticketId = Number(
      m1.prepare('INSERT INTO tickets (code, film_id, label, screening_limit, first_opened_at, first_played_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('abcdefghjkmnp', filmId, 'Sam', 3, now - HOUR, now - 10 * 60 * 1000, now - 2 * HOUR).lastInsertRowid,
    );
    m1.prepare('INSERT INTO tickets (code, film_id, label, revoked_at, created_at) VALUES (?, ?, ?, ?, ?)').run('qrstuvwxyz234', filmId, 'Old', now - HOUR, now - 3 * HOUR);
    const hash = sha256(token);
    const insertSession = m1.prepare('INSERT INTO sessions (id_hash, kind, device, created_at, last_seen_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insertSession.run(hash, 'viewer', 'Safari on iPhone', now - HOUR, now - 60 * 1000, now + 80 * 24 * HOUR, null);
    insertSession.run(sha256('revoked'), 'viewer', 'Chrome on Mac', now - HOUR, now - HOUR, now + 80 * 24 * HOUR, now - 30 * 60 * 1000);
    insertSession.run(sha256('admin'), 'admin', 'Safari on Mac', now - HOUR, now - HOUR, now + 12 * HOUR, null);
    m1.prepare('INSERT INTO session_tickets (session_hash, ticket_id, added_at) VALUES (?, ?, ?)').run(hash, ticketId, now - HOUR);
    const screeningId = Number(
      m1.prepare('INSERT INTO screenings (ticket_id, film_id, session_hash, started_at, resumable_until, last_heartbeat_at, active_until, position_seconds, furthest_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(ticketId, filmId, hash, now - 10 * 60 * 1000, now + 47 * HOUR, now - 30 * 1000, now + 45 * 1000, 42, 42).lastInsertRowid,
    );
    const insertEvent = m1.prepare('INSERT INTO events (at, type, film_id, ticket_id, session_hash, screening_id, position, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    insertEvent.run(now - HOUR, 'opened', filmId, ticketId, hash, null, null, null);
    insertEvent.run(now - 10 * 60 * 1000, 'play', filmId, ticketId, hash, screeningId, 0, '{"resumed":false}');
    insertEvent.run(now - 5 * 60 * 1000, 'heartbeat', filmId, ticketId, hash, screeningId, 30, null);
    before1 = Object.fromEntries(M1_TABLES.map((t) => [t, rows(m1, t)]));
    oldColumns = Object.fromEntries(M1_TABLES.map((t) => [t, columns(m1, t)]));
    assert.equal(m1.prepare('PRAGMA foreign_key_check').all().length, 0);
    m1.close();

    db = openDb(file);
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    db?.close();
  });

  test('migrates to the current schema version', () => {
    assert.equal(userVersion(db), MIGRATIONS.length);
    for (const t of ['people', 'person_links', 'passkeys']) assert.deepEqual(rows(db, t), [], t);
    assert.ok(columns(db, 'tickets').includes('person_id'));
    for (const c of ['person_id', 'passkey_id', 'signed_in_at']) assert.ok(columns(db, 'sessions').includes(c), c);
    assert.ok(columns(db, 'events').includes('person_id'));
    assert.ok(columns(db, 'films').includes('member_visible'));
    for (const c of ['claimable', 'claimed_at']) assert.ok(columns(db, 'tickets').includes(c), c);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((i) => i.name);
    for (const i of ['people_name', 'person_links_person', 'passkeys_person', 'sessions_person', 'sessions_passkey', 'events_person']) assert.ok(indexes.includes(i), i);
  });

  test('every existing row is unchanged, and none gains a person', () => {
    for (const t of M1_TABLES) {
      const now = rows(db, t);
      assert.equal(now.length, before1[t].length, t);
      now.forEach((row, i) => {
        const old = Object.fromEntries(oldColumns[t].map((c) => [c, row[c]]));
        assert.deepEqual(old, before1[t][i], `${t} row ${i}`);
      });
    }
    for (const r of rows(db, 'tickets')) {
      assert.equal(r.person_id, null, 'every ticket is still a ticket for anyone');
      assert.equal(r.claimable, 0, 'and not keepable');
      assert.equal(r.claimed_at, null);
    }
    for (const r of rows(db, 'sessions')) {
      assert.equal(r.person_id, null, 'every session is anonymous');
      assert.equal(r.passkey_id, null);
      assert.equal(r.signed_in_at, null);
    }
    for (const r of rows(db, 'events')) assert.equal(r.person_id, null, 'guest history is never rewritten');
    for (const r of rows(db, 'films')) assert.equal(r.member_visible, 0, 'every film is hidden from members');
  });

  test('foreign_key_check is empty', () => {
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });

  test('opening it again changes nothing', () => {
    const again = openDb(file);
    assert.equal(userVersion(again), MIGRATIONS.length);
    assert.equal(rows(again, 'tickets').length, 2);
    again.close();
  });

  test('the browser that was watching still streams, anonymously', async () => {
    const app = createApp({
      db: watchPlays(db),
      mediaDir,
      dataDir: dir,
      metadataOptions: { envKey: '' },
      backupOptions: { backupDir: path.join(dir, 'backups') },
      webDist: path.join(mediaDir, 'no-web-build'),
      webauthn: { publicUrl: '', rpId: '', production: false },
    });
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    const get = (url) => fetch(base + url, { headers: { cookie: `om_session=${token}` } });
    const me = await (await get('/api/me')).json();
    assert.equal(me.person, null);
    assert.deepEqual(me.tickets.map((t) => t.film.slug), ['arrival']);
    // Its open play is now its loan: the tape is this browser's, where it had got to,
    // due back at the end of that play's time to come back.
    const mine = me.tickets[0].ticket;
    assert.deepEqual([mine.state, mine.tape, mine.loan.position, mine.loan.toBrowser], ['ok', 'yours', 42, true]);
    assert.equal(mine.dueBack, rows(db, 'screenings')[0].resumable_until);
    assert.deepEqual([mine.openScreening.position, mine.openScreening.resumableUntil, mine.expiresAt], [42, mine.dueBack, mine.dueBack]);
    for (const url of ['/media/arrival/hls/master.m3u8', '/media/arrival/hls/v_h264_720/index.m3u8', '/media/arrival/hls/v_h264_720/seg_0.m4s', '/media/arrival/subtitles/en.vtt']) {
      assert.equal((await get(url)).status, 200, url);
    }
    const screening = rows(db, 'screenings')[0];
    const hb = await fetch(`${base}/api/screenings/${screening.id}/heartbeat`, {
      method: 'POST',
      headers: { cookie: `om_session=${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ position: 50 }),
    });
    assert.equal(hb.status, 200);
    // Without the cookie, nothing.
    assert.equal((await fetch(`${base}/media/arrival/hls/master.m3u8`)).status, 403);
  });
});

test('a database written by newer code refuses to open, and is left alone', () => {
  const file = path.join(tempDir(), 'newer.db');
  openDb(file).close();
  const raw = new DatabaseSync(file);
  raw.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
  raw.close();
  assert.throws(() => openDb(file), /newer Open Matte/);
  const check = new DatabaseSync(file);
  assert.equal(userVersion(check), MIGRATIONS.length + 1);
  check.close();
});

test('a database at exactly the current version opens', () => {
  const file = path.join(tempDir(), 'current.db');
  openDb(file).close();
  const db = openDb(file);
  assert.equal(userVersion(db), MIGRATIONS.length);
  db.close();
});

describe('ids and constraints', () => {
  let db;
  before(() => {
    db = openDb(path.join(tempDir(), 'ids.db'));
  });
  after(() => db.close());

  const now = Date.now();
  const addPerson = (name) =>
    Number(db.prepare('INSERT INTO people (name, webauthn_user_id, created_at) VALUES (?, ?, ?)').run(name, crypto.randomBytes(32).toString('base64url'), now).lastInsertRowid);
  const addLink = (personId) =>
    Number(
      db.prepare("INSERT INTO person_links (person_id, token_hash, purpose, created_at, expires_at) VALUES (?, ?, 'setup', ?, ?)")
        .run(personId, sha256(crypto.randomUUID()), now, now + HOUR).lastInsertRowid,
    );
  const addPasskey = (personId, linkId = null) =>
    Number(
      db.prepare("INSERT INTO passkeys (person_id, credential_id, public_key, device_type, backed_up, link_id, created_at) VALUES (?, ?, ?, 'multiDevice', 1, ?, ?)")
        .run(personId, crypto.randomUUID(), Buffer.from('key'), linkId, now).lastInsertRowid,
    );

  test('an id deleted with foreign keys off is never reused', () => {
    addPerson('Alex');
    const newest = addPerson('Sam');
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.prepare('DELETE FROM people WHERE id = ?').run(newest);
      const next = addPerson('Someone else');
      assert.notEqual(next, newest);
      assert.ok(next > newest);

      const link = addLink(next);
      db.prepare('DELETE FROM person_links WHERE id = ?').run(link);
      assert.ok(addLink(next) > link, 'link ids are never reused');

      const key = addPasskey(next);
      db.prepare('DELETE FROM passkeys WHERE id = ?').run(key);
      assert.ok(addPasskey(next) > key, 'passkey ids are never reused');
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  });

  test('a person anything refers to cannot be deleted', () => {
    const cases = {
      'a passkey': (id) => addPasskey(id),
      'a link': (id) => addLink(id),
      'a session': (id) =>
        db.prepare("INSERT INTO sessions (id_hash, kind, created_at, last_seen_at, expires_at, person_id) VALUES (?, 'viewer', ?, ?, ?, ?)").run(sha256(crypto.randomUUID()), now, now, now + HOUR, id),
      'an event': (id) => db.prepare("INSERT INTO events (at, type, person_id) VALUES (?, 'signed-in', ?)").run(now, id),
    };
    for (const [what, refer] of Object.entries(cases)) {
      const id = addPerson(`Referred to by ${what}`);
      refer(id);
      assert.throws(() => db.prepare('DELETE FROM people WHERE id = ?').run(id), /FOREIGN KEY/, what);
    }
  });

  test('deleting a passkey leaves the sessions it signed in without one', () => {
    const id = addPerson('Deleted key');
    const key = addPasskey(id);
    const hash = sha256(crypto.randomUUID());
    db.prepare("INSERT INTO sessions (id_hash, kind, created_at, last_seen_at, expires_at, person_id, passkey_id) VALUES (?, 'viewer', ?, ?, ?, ?, ?)").run(hash, now, now, now + HOUR, id, key);
    db.prepare('DELETE FROM passkeys WHERE id = ?').run(key);
    const s = db.prepare('SELECT person_id, passkey_id FROM sessions WHERE id_hash = ?').get(hash);
    assert.deepEqual({ ...s }, { person_id: id, passkey_id: null });
  });

  test('names are unique ignoring case; CHECK constraints hold', () => {
    addPerson('Morgan');
    assert.throws(() => addPerson('MORGAN'), /UNIQUE/);
    const id = addPerson('Checks');
    const bad = [
      ["INSERT INTO person_links (person_id, token_hash, purpose, created_at, expires_at) VALUES (?, 'h1', 'admin', 0, 1)", [id]],
      ["INSERT INTO person_links (person_id, token_hash, purpose, reset, created_at, expires_at) VALUES (?, 'h2', 'recovery', 2, 0, 1)", [id]],
      ["INSERT INTO passkeys (person_id, credential_id, public_key, device_type, backed_up, created_at) VALUES (?, 'c1', x'00', 'phone', 1, 0)", [id]],
      ["INSERT INTO passkeys (person_id, credential_id, public_key, device_type, backed_up, created_at) VALUES (?, 'c2', x'00', 'singleDevice', 2, 0)", [id]],
    ];
    for (const [sql, args] of bad) assert.throws(() => db.prepare(sql).run(...args), /CHECK/, sql);
    // A token hash and a credential id are unique.
    const link = addLink(id);
    const hash = db.prepare('SELECT token_hash FROM person_links WHERE id = ?').get(link).token_hash;
    assert.throws(() => db.prepare("INSERT INTO person_links (person_id, token_hash, purpose, created_at, expires_at) VALUES (?, ?, 'setup', 0, 1)").run(id, hash), /UNIQUE/);
  });
});

// ====================================================================== migration 7
// Milestone 3, slice 4. Written from docs/history/milestone-3.md (slice 4), not from the
// implementation. Upgrading a schema 6 database (production when slice 4 started):
// people gain last_signed_in_at, filled in from their sessions, so "Last signed in"
// survives the clean-up deleting old sessions; events gain indexes for Activity's
// filters and the clean-up. Nothing else changes.
describe('a schema 6 database', () => {
  const dir = tempDir();
  const file = path.join(dir, 'open-matte.db');
  const now = Date.now();
  const DAY = 24 * HOUR;
  const TABLES = ['settings', 'films', 'tickets', 'sessions', 'session_tickets', 'screenings', 'events', 'people', 'person_links', 'passkeys'];
  const ids = {};
  let before6;
  let oldColumns;
  let db;
  let server;
  let base;

  before(() => {
    assert.ok(MIGRATIONS.length >= 7, 'migration 7 exists');
    const m6 = new DatabaseSync(file);
    m6.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    for (let i = 0; i < 6; i++) {
      m6.exec('BEGIN');
      m6.exec(MIGRATIONS[i]);
      m6.exec(`PRAGMA user_version = ${i + 1}`);
      m6.exec('COMMIT');
    }
    const film = Number(m6.prepare("INSERT INTO films (slug, title, media_status, published, created_at, updated_at) VALUES ('arrival', 'Arrival', 'ok', 1, ?, ?)").run(now, now).lastInsertRowid);
    const person = (name) => Number(m6.prepare('INSERT INTO people (name, webauthn_user_id, created_at) VALUES (?, ?, ?)').run(name, crypto.randomBytes(32).toString('base64url'), now - 100 * DAY).lastInsertRowid);
    ids.alex = person('Alex');
    ids.morgan = person('Morgan');
    ids.sam = person('Sam');
    const key = Number(m6.prepare("INSERT INTO passkeys (person_id, credential_id, public_key, device_type, backed_up, created_at) VALUES (?, 'credential', x'00', 'multiDevice', 1, ?)").run(ids.alex, now - 90 * DAY).lastInsertRowid);
    m6.prepare("INSERT INTO person_links (person_id, token_hash, purpose, created_at, expires_at, used_at) VALUES (?, 'hash', 'setup', ?, ?, ?)").run(ids.alex, now - 91 * DAY, now - 88 * DAY, now - 90 * DAY);
    const session = (hash, kind, personId, signedInAt, { revoked = null, expires = now + 80 * DAY } = {}) =>
      m6.prepare('INSERT INTO sessions (id_hash, kind, device, created_at, last_seen_at, expires_at, revoked_at, person_id, passkey_id, signed_in_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(hash, kind, 'Safari on iPhone', signedInAt ?? now - 50 * DAY, now - DAY, expires, revoked, personId, personId === ids.alex ? key : null, signedInAt);
    // Alex: a phone signed in two days ago, a laptop ten days ago and signed out since.
    session(sha256('alex phone'), 'viewer', ids.alex, now - 2 * DAY);
    session(sha256('alex laptop'), 'viewer', ids.alex, now - 10 * DAY, { revoked: now - 9 * DAY });
    // Morgan: once, a month ago, long expired. Sam: never.
    session(sha256('morgan'), 'viewer', ids.morgan, now - 30 * DAY, { expires: now - 5 * DAY });
    session(sha256('anonymous'), 'viewer', null, null);
    session(sha256('admin'), 'admin', null, null, { expires: now + 12 * HOUR });
    const ticket = Number(m6.prepare('INSERT INTO tickets (code, film_id, label, first_opened_at, first_played_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('abcdefghjkmnp', film, 'For anyone', now - 3 * DAY, now - 3 * DAY, now - 4 * DAY).lastInsertRowid);
    m6.prepare('INSERT INTO tickets (code, film_id, label, person_id, created_at) VALUES (?, ?, ?, ?, ?)').run('qrstuvwxyz234', film, 'For Alex', ids.alex, now - 4 * DAY);
    m6.prepare('INSERT INTO session_tickets (session_hash, ticket_id, added_at) VALUES (?, ?, ?)').run(sha256('anonymous'), ticket, now - 3 * DAY);
    const screening = Number(
      m6.prepare('INSERT INTO screenings (ticket_id, film_id, session_hash, started_at, resumable_until, last_heartbeat_at, active_until, position_seconds, furthest_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(ticket, film, sha256('anonymous'), now - 3 * DAY, now - DAY, now - 3 * DAY, now - 3 * DAY, 42, 42).lastInsertRowid,
    );
    const event = m6.prepare('INSERT INTO events (at, type, film_id, ticket_id, session_hash, screening_id, position, detail, person_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    event.run(now - 3 * DAY, 'opened', film, ticket, sha256('anonymous'), null, null, null, null);
    event.run(now - 3 * DAY, 'play', film, ticket, sha256('anonymous'), screening, 0, '{"resumed":false}', null);
    event.run(now - 3 * DAY, 'heartbeat', film, ticket, sha256('anonymous'), screening, 42, null, null);
    event.run(now - 2 * DAY, 'signed-in', null, null, sha256('alex phone'), null, null, '{"device":"Safari on iPhone"}', ids.alex);
    before6 = Object.fromEntries(TABLES.map((t) => [t, rows(m6, t)]));
    oldColumns = Object.fromEntries(TABLES.map((t) => [t, columns(m6, t)]));
    assert.equal(userVersion(m6), 6);
    m6.close();

    db = openDb(file);
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    db?.close();
  });

  const lastSignedIn = (id) => db.prepare('SELECT last_signed_in_at FROM people WHERE id = ?').get(id).last_signed_in_at;

  test('migrates to the current schema version, with last_signed_in_at and the new indexes', () => {
    assert.equal(userVersion(db), MIGRATIONS.length);
    assert.ok(columns(db, 'people').includes('last_signed_in_at'));
    const indexed = (name) => db.prepare(`PRAGMA index_info(${name})`).all().map((c) => c.name);
    assert.deepEqual(indexed('events_film'), ['film_id', 'at']);
    assert.deepEqual(indexed('events_type_at'), ['type', 'at']);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });

  test("each person's last sign-in is filled in from their sessions", () => {
    assert.equal(lastSignedIn(ids.alex), now - 2 * DAY, 'the latest of their sessions');
    assert.equal(lastSignedIn(ids.morgan), now - 30 * DAY, 'an expired session counts');
    assert.equal(lastSignedIn(ids.sam), null, 'never signed in');
  });

  test('every existing row is unchanged', () => {
    for (const t of TABLES) {
      const now6 = rows(db, t);
      assert.equal(now6.length, before6[t].length, t);
      now6.forEach((row, i) => {
        const old = Object.fromEntries(oldColumns[t].map((c) => [c, row[c]]));
        assert.deepEqual(old, before6[t][i], `${t} row ${i}`);
      });
    }
    // The new column is the only one migration 7 adds. Migration 8 (version 2) then
    // gives each link its loan length and its "Picked for you" note.
    const added = { people: ['last_signed_in_at'], tickets: ['loan_days', 'pick_note'] };
    for (const t of TABLES) {
      assert.deepEqual(columns(db, t).filter((c) => !oldColumns[t].includes(c)), added[t] ?? [], t);
    }
  });

  test('opening it again changes nothing', () => {
    const again = openDb(file);
    assert.equal(userVersion(again), MIGRATIONS.length);
    assert.equal(again.prepare('SELECT last_signed_in_at FROM people WHERE id = ?').get(ids.alex).last_signed_in_at, now - 2 * DAY);
    again.close();
  });

  test('a later sign-in moves it on, and Last signed in survives deleting the old sessions', async () => {
    const app = createApp({
      db: watchPlays(db),
      mediaDir: tempDir(),
      dataDir: dir,
      metadataOptions: { envKey: '' },
      backupOptions: { backupDir: path.join(dir, 'backups') },
      webDist: path.join(dir, 'no-web-build'),
      webauthn: { publicUrl: '', rpId: '', production: false },
    });
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    const admin = await adminBrowser(base);
    const lastSignedInAt = async (id) => (await admin.get(`/api/admin/people/${id}`)).data.lastSignedInAt;
    const listed = async (id) => (await admin.get('/api/admin/people')).data.find((p) => p.id === id).lastSignedInAt;
    assert.equal(await lastSignedInAt(ids.alex), now - 2 * DAY);
    assert.equal(await listed(ids.morgan), now - 30 * DAY);

    // Sam sets up a passkey (which signs Sam in), then signs in on another browser.
    const auth = softAuthenticator();
    const phone = browser(base);
    assert.equal((await enroll(phone, (await setupLink(admin, ids.sam)).token, { auth })).status, 200);
    const signedIn = (hash) => db.prepare('SELECT signed_in_at FROM sessions WHERE id_hash = ?').get(hash).signed_in_at;
    const first = signedIn(sha256(phone.jar.get('om_session')));
    assert.equal(lastSignedIn(ids.sam), first, 'creating a passkey signs in');
    await new Promise((r) => setTimeout(r, 5));
    const laptop = browser(base);
    assert.equal((await signIn(laptop, auth)).status, 200);
    const latest = signedIn(sha256(laptop.jar.get('om_session')));
    assert.ok(latest > first);
    assert.equal(lastSignedIn(ids.sam), latest);
    assert.equal(await lastSignedInAt(ids.sam), latest);

    // Every session of Sam's and Alex's deleted, as the clean-up does once they've ended.
    db.prepare('DELETE FROM sessions WHERE person_id IN (?, ?)').run(ids.sam, ids.alex);
    assert.equal(await lastSignedInAt(ids.sam), latest);
    assert.equal(await listed(ids.sam), latest);
    assert.equal(await lastSignedInAt(ids.alex), now - 2 * DAY);
  });
});

// ====================================================================== migration 8
// Version 2, slice 1. Written from docs/version-2.md ("The model", and the table under
// "Upgrading an existing shop"), not from the SQL. Upgrading a schema 7 database
// (1.1.0): each film has one tape, so of the plays open on a film one becomes its
// loan and the others stop; a link 1.x would no longer play has lent; every other
// link lends once. Nothing 1.x stored is changed. The shop itself is in schema7.js.
describe('a schema 7 database', () => {
  const dir = tempDir();
  const file = path.join(dir, 'open-matte.db');
  let now;
  let F;
  let T;
  let SC;
  let P;
  let S;
  let before7;
  let oldColumns;
  let db;

  before(() => {
    assert.ok(MIGRATIONS.length >= 8, 'migration 8 exists');
    const m7 = schemaSevenDb(file);
    // Taken here, not when the file loads: the shop has browsers "playing now" for a
    // minute or so, and the suites above run before this one is upgraded.
    now = Date.now();
    ({ F, T, SC, P, S } = fillShop(m7, now));
    before7 = Object.fromEntries(TABLES_7.map((t) => [t, rows(m7, t)]));
    oldColumns = Object.fromEntries(TABLES_7.map((t) => [t, columns(m7, t)]));
    assert.equal(userVersion(m7), 7);
    assert.deepEqual(m7.prepare('PRAGMA foreign_key_check').all(), []);
    m7.close();

    db = openDb(file);
  });

  after(() => db?.close());

  const one = (sql, ...args) => {
    const row = db.prepare(sql).get(...args);
    return row ? { ...row } : null;
  };
  const link = (id) => one('SELECT * FROM tickets WHERE id = ?', id);
  const playOf = (id) => one('SELECT * FROM screenings WHERE id = ?', id);
  const loanOf = (ticketId) => one('SELECT * FROM loans WHERE ticket_id = ?', ticketId);
  const loansOn = (filmId) => db.prepare('SELECT * FROM loans WHERE film_id = ? ORDER BY id').all(filmId).map((l) => ({ ...l }));
  const nameOf = (ticketId) => Object.keys(T).find((k) => T[k] === ticketId) ?? `ticket ${ticketId}`;
  const expiryOf = (ticketId) => link(ticketId).first_played_at + link(ticketId).days_after_first_play * DAY;

  // A tape that is out: the film's loan, on this link, with this play as its playback.
  const assertOut = (name, play, { personId = null, session, device, due }) => {
    const loan = loanOf(T[name]);
    assert.ok(loan, `${name} has the tape`);
    const s = playOf(play);
    assert.deepEqual(
      { film: loan.film_id, play: loan.screening_id, person: loan.person_id, session: loan.session_hash, device: loan.device, taken: loan.taken_at, due: loan.due_at, ended: loan.ended_at, how: loan.ended_how },
      { film: link(T[name]).film_id, play, person: personId, session, device, taken: s.started_at, due: due ?? s.resumable_until, ended: null, how: null },
      name,
    );
    assert.ok(loan.due_at > Date.now(), `${name}: not due yet`);
    assert.equal(link(T[name]).loan_days, null, `${name}: its one loan is this one, so it has no length for another`);
  };
  // A link that lent before the upgrade: one loan, over, marked before-2.0.
  const assertSpent = (name, play) => {
    const loan = loanOf(T[name]);
    const t = link(T[name]);
    assert.ok(loan, `${name} has lent`);
    assert.equal(loan.ended_how, 'before-2.0', name);
    assert.equal(loan.ended_at, loan.due_at, `${name}: it ended when it was due`);
    assert.ok(loan.ended_at <= now, `${name}: and that was before the upgrade`);
    assert.equal(loan.taken_at, t.first_played_at, `${name}: taken at its first play`);
    assert.deepEqual({ film: loan.film_id, play: loan.screening_id, person: loan.person_id }, { film: t.film_id, play, person: t.person_id }, name);
    assert.equal(t.loan_days, null, `${name}: no loan length, it can't lend`);
    return loan;
  };
  // A link that has lent nothing: the first Play on it takes the tape, for this long.
  const assertLends = (name, loanDays) => {
    assert.equal(loanOf(T[name]), null, `${name} has no loan`);
    assert.equal(link(T[name]).loan_days, loanDays, `${name}: loan_days`);
  };

  test('migrates to schema 8: loans, responses, and a loan length and a note on each link', () => {
    assert.equal(userVersion(db), MIGRATIONS.length);
    assert.ok(userVersion(db) >= 8);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.deepEqual(columns(db, 'loans'), ['id', 'film_id', 'ticket_id', 'screening_id', 'person_id', 'session_hash', 'device', 'taken_at', 'due_at', 'ended_at', 'ended_how']);
    assert.deepEqual(columns(db, 'responses'), ['id', 'loan_id', 'person_id', 'film_id', 'kind', 'message', 'created_at', 'read_at']);
    // The only new columns anywhere in 1.x's tables.
    for (const t of TABLES_7) {
      assert.deepEqual(columns(db, t).filter((c) => !oldColumns[t].includes(c)), t === 'tickets' ? ['loan_days', 'pick_note'] : [], t);
    }
    const indexed = (name) => db.prepare(`PRAGMA index_info(${name})`).all().map((c) => c.name);
    const unique = (table) => db.prepare(`PRAGMA index_list(${table})`).all().filter((i) => i.unique && i.origin === 'c').map((i) => i.name).sort();
    const indexes = (table) => db.prepare(`PRAGMA index_list(${table})`).all().map((i) => i.name).sort();
    assert.deepEqual(unique('loans'), ['loans_once', 'loans_out', 'loans_screening']);
    assert.deepEqual(unique('responses'), ['responses_once']);
    assert.deepEqual(indexes('loans'), ['loans_film', 'loans_once', 'loans_out', 'loans_person', 'loans_screening', 'loans_session']);
    assert.deepEqual(indexes('responses'), ['responses_created', 'responses_once']);
    assert.deepEqual(indexed('loans_film'), ['film_id', 'taken_at']);
    assert.deepEqual(indexed('loans_person'), ['person_id', 'taken_at']);
    assert.deepEqual(indexed('loans_session'), ['session_hash']);
    assert.deepEqual(indexed('responses_created'), ['created_at']);
    // What must be there, and what each row refers to.
    const required = (table) => db.prepare(`PRAGMA table_info(${table})`).all().filter((c) => c.notnull).map((c) => c.name);
    const refers = (table) => Object.fromEntries(db.prepare(`PRAGMA foreign_key_list(${table})`).all().map((k) => [k.from, `${k.table}.${k.to}`]));
    assert.deepEqual(required('loans'), ['film_id', 'ticket_id', 'screening_id', 'taken_at', 'due_at']);
    assert.deepEqual(required('responses'), ['loan_id', 'person_id', 'film_id', 'kind', 'created_at']);
    assert.deepEqual(refers('loans'), { film_id: 'films.id', ticket_id: 'tickets.id', screening_id: 'screenings.id', person_id: 'people.id' });
    assert.deepEqual(refers('responses'), { loan_id: 'loans.id', person_id: 'people.id', film_id: 'films.id' });
    assert.deepEqual(indexed('loans_out'), ['film_id'], 'one tape per film');
    assert.deepEqual(indexed('loans_once'), ['ticket_id'], 'a link lends once');
    assert.deepEqual(indexed('loans_screening'), ['screening_id']);
    assert.deepEqual(indexed('responses_once'), ['loan_id']);
    assert.match(one("SELECT sql FROM sqlite_master WHERE name = 'loans_out'").sql, /WHERE ended_at IS NULL/, 'only of the loans not yet ended');
    assert.deepEqual(one("SELECT type, tbl_name FROM sqlite_master WHERE name = 'responses_from_borrower'"), { type: 'trigger', tbl_name: 'responses' });
    assert.deepEqual(rows(db, 'responses'), []);
    // The migration's own working table is gone.
    assert.deepEqual(db.prepare('SELECT name FROM sqlite_temp_master').all(), []);
  });

  test('every row 1.x wrote is unchanged, column by column', () => {
    for (const t of TABLES_7) {
      const now8 = rows(db, t);
      assert.equal(now8.length, before7[t].length, t);
      now8.forEach((row, i) => {
        const old = Object.fromEntries(oldColumns[t].map((c) => [c, row[c]]));
        assert.deepEqual(old, before7[t][i], `${t} row ${i}`);
      });
    }
  });

  test('foreign_key_check is empty and integrity_check is ok', () => {
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map((r) => ({ ...r })), [{ integrity_check: 'ok' }]);
  });

  test('the loans it makes are these and no others', () => {
    const names = (where) => db.prepare(`SELECT ticket_id FROM loans WHERE ${where} ORDER BY ticket_id`).all().map((l) => nameOf(l.ticket_id)).sort();
    assert.deepEqual(names('ended_at IS NULL'), ['broken', 'crowdPlaying', 'fortnight', 'givenBack', 'kept', 'otherDevice', 'pairBen', 'rankLive', 'signedIn', 'solo', 'sooner', 'startByPassed', 'tieEarlier']);
    assert.deepEqual(names('ended_at IS NOT NULL'), ['finishedGivenBack', 'offShelfUsedUp', 'past', 'pastDays', 'pastDaysCancelled', 'pastDaysGivenBack', 'usedUp', 'usedUpCancelled', 'usedUpGaveOneBack', 'usedUpNobody']);
  });

  test('a film with several links nobody has played: nothing changes, and every link waits', () => {
    assert.deepEqual(loansOn(F.shelf), []);
    assertLends('shelfAnyone', null);
    assertLends('shelfKept', null);
    assertLends('shelfMissed', null);
    // Nobody played it, and its start-by date passed while another link's play was
    // open: it lends like any other, and its date is kept as it was set.
    assertLends('soloWaited', null);
    assert.equal(link(T.soloWaited).start_by, now - 30 * MIN);
    // A kept link is still that member's, and a keepable one still keepable.
    assert.deepEqual([link(T.shelfKept).person_id, link(T.shelfKept).claimed_at, link(T.shelfKept).claimable], [P.ben, now - 3 * DAY, 0]);
    assert.equal(link(T.shelfKeepable).claimable, 1);
    assert.equal(link(T.crowdKeepable).claimable, 1);
    assertLends('crowdKept', null);
    assertLends('crowdKeepable', null);
  });

  test('a link never played lends for the days it said after the first play, at most 30, or else the default', () => {
    assertLends('neverDays10', 10);
    assertLends('shelfAda', 10);
    assertLends('shelfKeepable', 30); // it said 3650
    assertLends('shelfCancelled', 30); // 45, and cancelled
    assertLends('neverPlain', null); // NULL: the shop's default when Play is pressed
    assertLends('cancelledOther', null);
    // Its start-by date is kept, passed or not.
    assert.equal(link(T.neverDays10).start_by, now + 3 * DAY);
    assert.equal(link(T.shelfAda).start_by, now + 5 * DAY);
    assert.equal(link(T.shelfMissed).start_by, now - DAY);
  });

  test("one play open, which its holder can still resume, becomes the film's loan, due at the end of its time to come back", () => {
    // A link for anyone: the borrower is the browser holding the play.
    assertOut('solo', SC.solo, { session: S.a, device: 'Safari on iPhone' });
    assert.equal(loanOf(T.solo).due_at, now - 3 * HOUR + 48 * HOUR);
    assert.equal(playOf(SC.solo).position_seconds, 1800, 'the position is kept');
    // Signed in or not, on a link for anyone it is still the browser.
    assertOut('signedIn', SC.signedIn, { session: S.dee, device: 'Edge on Windows' });
    // A member's link: the borrower is the member, wherever they last played it.
    assertOut('otherDevice', SC.otherDevice, { personId: P.ada, session: S.adaLaptop, device: 'Chrome on Mac' });
    assertOut('kept', SC.kept, { personId: P.ben, session: S.ben, device: 'Safari on iPad' });
    // Broken files don't end a loan: the clock keeps running.
    assertOut('broken', SC.broken, { session: S.b, device: 'Chrome on Windows' });
    for (const film of [F.solo, F.signedIn, F.otherDevice, F.kept, F.broken]) assert.equal(loansOn(film).length, 1);
  });

  test('a start-by date that has passed since the first play is no bar: 1.x stopped reading it then', () => {
    const t = link(T.startByPassed);
    assert.ok(t.first_played_at < t.start_by && t.start_by < now, 'first played in time, and the date has passed since');
    assertOut('startByPassed', SC.startByPassed, { session: S.c, device: 'Firefox on Mac' });
    assert.equal(loanOf(T.startByPassed).due_at, now + DAY);
    assert.equal(loansOn(F.startBy).length, 1);
  });

  test("or at the link's expiry, if that is sooner", () => {
    assertOut('sooner', SC.sooner, { session: S.c, device: 'Firefox on Mac', due: now - 36 * HOUR + 2 * DAY });
    assert.ok(loanOf(T.sooner).due_at < playOf(SC.sooner).resumable_until);
  });

  test('a link 1.x would have let play again gets the same loan, and no more (question 15)', () => {
    // 14 days from yesterday: due back when this play's two days are up, not in 13 days.
    assertOut('fortnight', SC.fortnight, { session: S.b, device: 'Chrome on Windows' });
    assert.equal(loanOf(T.fortnight).due_at, now - 26 * HOUR + 48 * HOUR);
    assert.ok(loanOf(T.fortnight).due_at < expiryOf(T.fortnight) - 11 * DAY);
    // Plays left (three, one used and one given back) or no limit: the same.
    assertOut('givenBack', SC.givenBackOlder, { session: S.a, device: 'Safari on iPhone' });
    assertOut('crowdPlaying', SC.crowdPlaying, { session: S.a, device: 'Safari on iPhone' });
  });

  test('several plays open on one film: the one playing now is the loan, and the others get none', () => {
    assertOut('crowdPlaying', SC.crowdPlaying, { session: S.a, device: 'Safari on iPhone' });
    assert.equal(loansOn(F.crowd).length, 1);
    // The member who paused five seconds ago was heard from last, and still loses to
    // the browser that is playing. Their links lend once when the tape is back.
    assert.ok(playOf(SC.crowdAda).last_heartbeat_at > playOf(SC.crowdPlaying).last_heartbeat_at);
    assertLends('crowdAda', 14);
    assertLends('crowdPaused', null);
    // Their plays are as 1.x left them: nothing is voided or ended to make room.
    for (const id of [SC.crowdAda, SC.crowdPaused]) assert.equal(playOf(id).voided_at, null);
  });

  test('with nobody playing now, it goes to the one heard from last', () => {
    assertOut('pairBen', SC.pairBen, { personId: P.ben, session: S.ben, device: 'Safari on iPad' });
    assert.equal(loansOn(F.pair).length, 1);
    assertLends('pairAnyone', null);
    // Not the one that started last, nor the lower id.
    assert.ok(playOf(SC.pairAnyone).started_at > playOf(SC.pairBen).started_at);
    assert.ok(SC.pairAnyone < SC.pairBen);
  });

  test('heard from at the same moment, it goes to the earlier play', () => {
    assert.equal(playOf(SC.tieEarlier).last_heartbeat_at, playOf(SC.tieLater).last_heartbeat_at);
    assert.ok(SC.tieEarlier < SC.tieLater && playOf(SC.tieEarlier).started_at < playOf(SC.tieLater).started_at);
    assertOut('tieEarlier', SC.tieEarlier, { session: S.b, device: 'Chrome on Windows' });
    assert.equal(loansOn(F.tie).length, 1);
    assertLends('tieLater', null);
    // Not the link that was made first.
    assert.ok(T.tieLater < T.tieEarlier);
  });

  test('a play its holder can no longer resume gets no loan, and its link is not spent', () => {
    const cases = {
      signedOut: 'the browser signed out',
      expired: "the browser's session ran out",
      left: 'the browser signed out of the link, and another still holds it',
      gone: "the browser's session has been deleted",
      cardOff: "the member's card is off",
      cardOffBrowser: 'a link for anyone, in the browser of a member whose card is off',
    };
    for (const [name, what] of Object.entries(cases)) {
      assert.deepEqual(loansOn(F[name]), [], what);
      assertLends(name, null);
    }
    // 1.x would say playing now, of two of them.
    for (const id of [SC.left, SC.cardOff]) assert.ok(playOf(id).active_until > Date.now());
  });

  test('a holder who can still resume comes before one playing now who cannot', () => {
    assertOut('rankLive', SC.rankLive, { session: S.c, device: 'Firefox on Mac' });
    assertLends('rankCy', null);
    assert.equal(loansOn(F.rank).length, 1);
  });

  test('the latest play given back, an older one still open: the older one is the loan', () => {
    assertOut('givenBack', SC.givenBackOlder, { session: S.a, device: 'Safari on iPhone' });
    assert.equal(playOf(SC.givenBackOlder).position_seconds, 777);
    assert.ok(playOf(SC.givenBackLatest).voided_at);
  });

  test('a link used up, or past its days after the first play, is spent: an ended loan marked before-2.0', () => {
    assertSpent('usedUp', SC.usedUp);
    assertSpent('usedUpCancelled', SC.usedUpCancelled2); // cancelled ones too
    assertSpent('pastDays', SC.pastDays);
    assertSpent('pastDaysCancelled', SC.pastDaysCancelled);
    assertSpent('pastDaysGivenBack', SC.pastDaysGivenBack); // past its days, though its only play was given back
    assertSpent('finishedGivenBack', SC.finishedGivenBack); // the same, watched to the end before it was given back
    assertSpent('offShelfUsedUp', SC.offShelfUsedUp); // whatever has become of its film
    // Its browser is remembered when the link was for anyone, and its row is still there.
    assert.deepEqual([loanOf(T.usedUp).session_hash, loanOf(T.usedUp).device], [S.c, 'Firefox on Mac']);
    assert.deepEqual([loanOf(T.usedUpCancelled).session_hash, loanOf(T.usedUpCancelled).device], [S.gone, null]);
    // A used-up link's loan ended when its last play could no longer be resumed.
    assert.equal(loanOf(T.usedUp).ended_at, playOf(SC.usedUp).resumable_until);
    assert.equal(loanOf(T.usedUp).ended_at, now - 9 * DAY + 48 * HOUR);
    assert.equal(loanOf(T.usedUpCancelled).ended_at, playOf(SC.usedUpCancelled2).resumable_until);
    assert.ok(playOf(SC.usedUpCancelled1).resumable_until < playOf(SC.usedUpCancelled2).resumable_until, 'the later of its two plays');
    // The film's tape is in: none of these is out.
    assert.deepEqual(loansOn(F.done).filter((l) => l.ended_at == null), []);
  });

  test("a used-up link's loan ended with the last play that counts, not with one that was given back", () => {
    const loan = assertSpent('usedUpGaveOneBack', SC.usedUpGaveOneBack2);
    const [first, givenBack, last] = [SC.usedUpGaveOneBack1, SC.usedUpGaveOneBackVoided, SC.usedUpGaveOneBack2].map((id) => playOf(id));
    assert.ok(givenBack.voided_at && first.resumable_until < last.resumable_until && last.resumable_until < givenBack.resumable_until);
    assert.equal(loan.ended_at, last.resumable_until);
    assert.equal(loan.ended_at, now - 6 * DAY + 48 * HOUR);
  });

  test('a used-up link whose play names no browser is spent all the same, with nobody on its loan', () => {
    assert.equal(playOf(SC.usedUpNobody).session_hash, null);
    const loan = assertSpent('usedUpNobody', SC.usedUpNobody);
    assert.deepEqual([loan.person_id, loan.session_hash, loan.device], [null, null, null]);
    assert.equal(loan.ended_at, playOf(SC.usedUpNobody).resumable_until);
  });

  test('past its days with its time to come back still open: spent at its expiry', () => {
    const loan = assertSpent('past', SC.past);
    assert.ok(playOf(SC.past).resumable_until > now + 26 * DAY, '1.x left the play open for weeks');
    assert.equal(loan.ended_at, expiryOf(T.past));
    assert.equal(loan.ended_at, now - DAY);
  });

  test('a link played, with plays left or no limit and nothing open, lends once more', () => {
    assertLends('playsLeft', 30); // its days, at most 30
    assertLends('noLimitWeek', 7);
    assertLends('noLimit', null);
    // Its start-by date has passed, but it first played in time: 1.x would play it
    // again, so it lends once more. The date is kept, as every 1.x column is.
    assertLends('metStartBy', null);
    assert.ok(link(T.metStartBy).start_by < now && link(T.metStartBy).first_played_at < link(T.metStartBy).start_by);
  });

  test("given-back plays don't count: a link whose only play was given back lends once", () => {
    assertLends('onlyGivenBack', null);
    assertLends('oneOfTwoGivenBack', null);
  });

  test('a play open on a film off the shelf, or on a cancelled link, gets no loan', () => {
    assertLends('offShelf', null);
    assert.deepEqual(loansOn(F.offShelf).filter((l) => l.ended_at == null), []);
    assertLends('cancelled', null);
    assert.deepEqual(loansOn(F.cancelled), []);
  });

  test('no film has two tapes out, no link two loans, and no loan is born already over', () => {
    assert.deepEqual(db.prepare('SELECT film_id FROM loans WHERE ended_at IS NULL GROUP BY film_id HAVING COUNT(*) > 1').all(), []);
    assert.deepEqual(db.prepare('SELECT ticket_id FROM loans GROUP BY ticket_id HAVING COUNT(*) > 1').all(), []);
    // The plan's one test for "out" ("When a tape is out"), by the clock after the upgrade.
    const LIVE = `l.ended_at IS NULL AND l.due_at > :now AND (
      (l.person_id IS NOT NULL AND EXISTS (SELECT 1 FROM people p WHERE p.id = l.person_id AND p.disabled_at IS NULL))
      OR (l.person_id IS NULL AND EXISTS (SELECT 1 FROM sessions s LEFT JOIN people sp ON sp.id = s.person_id
          WHERE s.id_hash = l.session_hash AND s.kind = 'viewer' AND s.revoked_at IS NULL AND s.expires_at > :now
            AND (s.person_id IS NULL OR (sp.id IS NOT NULL AND sp.disabled_at IS NULL)))))`;
    const open = db.prepare(`SELECT l.ticket_id, (${LIVE}) AS live FROM loans l WHERE l.ended_at IS NULL`).all({ now: Date.now() });
    assert.equal(open.length, 13);
    for (const l of open) assert.equal(l.live, 1, nameOf(l.ticket_id));
    // And every film off the shelf, or link cancelled, has no tape out.
    assert.deepEqual(db.prepare('SELECT l.id FROM loans l JOIN films f ON f.id = l.film_id JOIN tickets t ON t.id = l.ticket_id WHERE l.ended_at IS NULL AND (f.published = 0 OR t.revoked_at IS NOT NULL)').all(), []);
  });

  test('the Time to come back setting stays where it was, and no label becomes a note', () => {
    assert.deepEqual(one("SELECT value FROM settings WHERE key = 'resumeWindowHours'"), { value: '72' });
    assert.ok(rows(db, 'tickets').some((t) => t.label), 'the shop has labels');
    for (const t of rows(db, 'tickets')) assert.equal(t.pick_note, null, nameOf(t.id));
  });

  test('opening it again changes nothing', () => {
    const loans = rows(db, 'loans');
    const tickets = rows(db, 'tickets');
    const again = openDb(file);
    assert.equal(userVersion(again), MIGRATIONS.length);
    assert.deepEqual(rows(again, 'loans'), loans);
    assert.deepEqual(rows(again, 'tickets'), tickets);
    again.close();
  });

  // ------------------------------------------------- what the database now enforces
  // Each attempt is undone, so the tests above and below read the shop as upgraded.
  const undone = (fn) => {
    db.exec('SAVEPOINT attempt');
    try {
      return fn();
    } finally {
      db.exec('ROLLBACK TO attempt; RELEASE attempt');
    }
  };
  const addPlay = (ticketId) =>
    Number(
      db.prepare('INSERT INTO screenings (ticket_id, film_id, session_hash, started_at, resumable_until, last_heartbeat_at, active_until) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(ticketId, link(ticketId).film_id, S.a, now, now + 3 * DAY, now, now).lastInsertRowid,
    );
  // Play pressed on a link, as slice 2 will write it; `o` overrides a column.
  const lend = (ticketId, o = {}) => {
    const t = link(ticketId);
    const loan = { film_id: t.film_id, ticket_id: ticketId, screening_id: 'screening_id' in o ? o.screening_id : addPlay(ticketId), person_id: t.person_id, session_hash: S.a, device: 'Safari on iPhone', taken_at: now, due_at: now + 3 * DAY, ended_at: null, ended_how: null, ...o };
    const keys = Object.keys(loan);
    return Number(db.prepare(`INSERT INTO loans (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => loan[k])).lastInsertRowid);
  };
  const giveBack = (loanId, how = 'returned') => db.prepare('UPDATE loans SET ended_at = ?, ended_how = ? WHERE id = ?').run(now + HOUR, how, loanId);
  const respond = (loanId, personId, o = {}) => {
    const r = { loan_id: loanId, person_id: personId, film_id: one('SELECT film_id FROM loans WHERE id = ?', loanId)?.film_id ?? F.shelf, kind: 'loved-it', message: null, created_at: now, ...o };
    const keys = Object.keys(r);
    return db.prepare(`INSERT INTO responses (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => r[k]));
  };

  test('one tape per film: a second loan is refused until the first has ended', () => {
    undone(() => {
      const first = lend(T.shelfAda);
      assert.throws(() => lend(T.shelfAnyone), /UNIQUE constraint failed: loans\.film_id/);
      giveBack(first);
      assert.ok(lend(T.shelfAnyone) > first);
    });
    // And on a film whose tape the upgrade left out.
    undone(() => assert.throws(() => lend(T.crowdAda), /UNIQUE constraint failed: loans\.film_id/));
    undone(() => assert.throws(() => lend(T.pairAnyone), /UNIQUE constraint failed: loans\.film_id/));
  });

  test('a link lends once: never a second loan, whether its first is out, over, or from before 2.0', () => {
    undone(() => {
      const first = lend(T.shelfAda);
      giveBack(first);
      assert.throws(() => lend(T.shelfAda), /UNIQUE constraint failed: loans\.ticket_id/);
    });
    undone(() => assert.throws(() => lend(T.usedUp), /UNIQUE constraint failed: loans\.ticket_id/));
    undone(() => assert.throws(() => lend(T.pastDaysCancelled), /UNIQUE constraint failed: loans\.ticket_id/));
    // Question 15: the link good for 14 days is spent once its loan ends.
    undone(() => {
      giveBack(loanOf(T.fortnight).id, 'due');
      assert.throws(() => lend(T.fortnight), /UNIQUE constraint failed: loans\.ticket_id/);
    });
    // A play is the playback of one loan.
    undone(() => assert.throws(() => lend(T.shelfAnyone, { screening_id: SC.usedUp }), /UNIQUE constraint failed: loans\.screening_id/));
  });

  test('a link that could still lend does lend, once, after the upgrade', () => {
    for (const name of ['shelfAnyone', 'neverPlain', 'playsLeft', 'noLimit', 'metStartBy', 'onlyGivenBack', 'signedOut', 'cardOffBrowser', 'gone']) {
      undone(() => {
        assert.ok(lend(T[name]) > 0, name);
        assert.equal(one('SELECT COUNT(*) AS n FROM loans WHERE ticket_id = ?', T[name]).n, 1, name);
      });
    }
  });

  test('a loan is out or over, due after it was taken, and has a borrower', () => {
    const bad = {
      'an end with no way it ended': { ended_at: now + HOUR },
      'a way it ended with no end': { ended_how: 'returned' },
      'a way to end that is not one of the six': { ended_at: now + HOUR, ended_how: 'lost' },
      'due when it was taken': { due_at: now },
      'ended before it was taken': { ended_at: now - 1, ended_how: 'returned' },
      'nobody borrowing it': { person_id: null, session_hash: null },
      'no film': { film_id: null },
      'no link': { ticket_id: null },
      'no play': { screening_id: null },
      'no time it was taken': { taken_at: null },
      'no due time': { due_at: null },
    };
    for (const [what, o] of Object.entries(bad)) undone(() => assert.throws(() => lend(T.shelfAnyone, o), /CHECK constraint failed|NOT NULL constraint failed/, what));
    // Each way a loan can end, and a browser's loan with no member.
    for (const how of ['returned', 'due', 'taken-back', 'signed-out', 'disabled', 'before-2.0']) undone(() => assert.ok(lend(T.shelfAnyone, { ended_at: now + HOUR, ended_how: how }), how));
    // Only a loan from before 2.0 may have nobody on it.
    undone(() => assert.ok(lend(T.shelfAnyone, { person_id: null, session_hash: null, taken_at: now - DAY, due_at: now - HOUR, ended_at: now - HOUR, ended_how: 'before-2.0' })));
  });

  test('a loan length is 1 to 30 days, and a note at most 2000 characters', () => {
    const set = (column, value) => db.prepare(`UPDATE tickets SET ${column} = ? WHERE id = ?`).run(value, T.shelfAnyone);
    for (const days of [0, 31, -1, 3650]) undone(() => assert.throws(() => set('loan_days', days), /CHECK constraint failed/, String(days)));
    for (const days of [1, 3, 30, null]) undone(() => set('loan_days', days));
    undone(() => assert.throws(() => set('pick_note', 'x'.repeat(2001)), /CHECK constraint failed/));
    undone(() => {
      set('pick_note', 'x'.repeat(2000));
      assert.equal(link(T.shelfAnyone).label, 'Book club', 'the label is another thing');
    });
  });

  test('loans refer plainly to their film, link, play and member: none can be deleted from under one, and ids are never reused', () => {
    undone(() => assert.throws(() => lend(T.shelfAnyone, { film_id: 99999 }), /FOREIGN KEY constraint failed/));
    undone(() => assert.throws(() => lend(T.shelfAnyone, { ticket_id: 99999 }), /FOREIGN KEY constraint failed/));
    undone(() => assert.throws(() => lend(T.shelfAnyone, { screening_id: 99999 }), /FOREIGN KEY constraint failed/));
    undone(() => assert.throws(() => lend(T.shelfAnyone, { person_id: 99999 }), /FOREIGN KEY constraint failed/));
    const loan = loanOf(T.pairBen);
    for (const [table, id] of [['films', loan.film_id], ['tickets', loan.ticket_id], ['screenings', loan.screening_id], ['people', loan.person_id]]) {
      undone(() => assert.throws(() => db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id), /FOREIGN KEY constraint failed/, table));
    }
    undone(() => {
      const first = lend(T.shelfAnyone);
      db.prepare('DELETE FROM loans WHERE id = ?').run(first);
      assert.ok(lend(T.shelfAnyone) > first);
    });
  });

  test('a response comes from the member who borrowed the tape, once', () => {
    const bens = loanOf(T.pairBen).id;
    const browsers = loanOf(T.solo).id;
    const refusal = /a response comes from the person who borrowed the tape/;
    undone(() => {
      assert.equal(respond(bens, P.ben, { kind: 'lets-talk', message: 'Call me.' }).changes, 1);
      assert.deepEqual(rows(db, 'responses').map((r) => [r.loan_id, r.person_id, r.kind, r.message, r.read_at]), [[bens, P.ben, 'lets-talk', 'Call me.', null]]);
      assert.throws(() => respond(bens, P.ben, { kind: 'loved-it' }), /UNIQUE constraint failed: responses\.loan_id/);
    });
    // Never another member, and never anyone on a browser's loan, signed in or not.
    undone(() => assert.throws(() => respond(bens, P.ada), refusal));
    undone(() => assert.throws(() => respond(browsers, P.ada), refusal));
    undone(() => assert.throws(() => respond(loanOf(T.signedIn).id, P.dee), refusal));
    undone(() => assert.throws(() => respond(browsers, null), /NOT NULL constraint failed|a response comes from/));
    undone(() => assert.throws(() => respond(99999, P.ben), refusal), 'no such loan');
    // The four kinds, and a message of 1 to 2000 characters or none.
    for (const kind of ['loved-it', 'still-thinking', 'not-for-me', 'lets-talk']) undone(() => assert.equal(respond(bens, P.ben, { kind }).changes, 1, kind));
    for (const o of [{ kind: 'meh' }, { kind: null }, { message: '' }, { message: 'x'.repeat(2001) }, { created_at: null }, { film_id: null }]) {
      undone(() => assert.throws(() => respond(bens, P.ben, o), /CHECK constraint failed|NOT NULL constraint failed/, JSON.stringify(o).slice(0, 40)));
    }
    undone(() => assert.equal(respond(bens, P.ben, { message: 'x'.repeat(2000) }).changes, 1));
    // It names a film that is there, and its id is never used again.
    undone(() => assert.throws(() => respond(bens, P.ben, { film_id: 99999 }), /FOREIGN KEY constraint failed/));
    undone(() => {
      const first = Number(respond(bens, P.ben).lastInsertRowid);
      db.prepare('DELETE FROM responses WHERE id = ?').run(first);
      assert.ok(Number(respond(bens, P.ben).lastInsertRowid) > first);
    });
    // A loan that has a response can't be deleted from under it.
    undone(() => {
      respond(bens, P.ben);
      assert.throws(() => db.prepare('DELETE FROM loans WHERE id = ?').run(bens), /FOREIGN KEY constraint failed/);
    });
    assert.deepEqual(rows(db, 'responses'), [], 'every attempt was undone');
  });
});

// A migration that fails part-way rolls back whole: the database is still schema 7,
// and 1.1.0 still opens it. No 1.x data can break one of the new indexes, so the first
// file is one that already has a table called loans: migration 8 fails at its CREATE
// TABLE, after both ALTER TABLEs have run. The second has a row no screen can make,
// "0 days after first play", which fails the loan length's CHECK in the migration's
// last statement, after every loan has been made.
// The same shop, upgraded and then used: what the friends who were part-way through,
// and the ones who weren't, find when they come back (docs/version-2.md, "Upgrading an
// existing shop"). A shop of its own, so nothing here disturbs the rows read above.
describe('a schema 7 shop, upgraded, over HTTP', () => {
  const dir = tempDir();
  const mediaDir = tempDir();
  const file = path.join(dir, 'open-matte.db');
  let now;
  let F;
  let T;
  let SC;
  let db;
  let server;
  let base;

  before(async () => {
    const m7 = schemaSevenDb(file);
    now = Date.now();
    ({ F, T, SC } = fillShop(m7, now));
    m7.close();
    db = openDb(file);
    // The films' folders, for the ones played below. The shop's rows say they are well.
    for (const slug of ['crowd', 'solo', 'fortnight', 'done']) makeFilm(mediaDir, slug);
    const app = createApp({
      db: watchPlays(db),
      mediaDir,
      dataDir: dir,
      metadataOptions: { envKey: '' },
      backupOptions: { backupDir: path.join(dir, 'backups') },
      webDist: path.join(mediaDir, 'no-web-build'),
      webauthn: { publicUrl: '', rpId: '', production: false },
    });
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    db?.close();
  });

  // A browser of the shop's, by the name its session was made with (test/schema7.js).
  const as = (name) => {
    const headers = { cookie: `om_session=${encodeURIComponent(name)}`, 'content-type': 'application/json' };
    const answer = async (res) => ({ status: res.status, data: (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : await res.text() });
    return {
      get: async (url) => answer(await fetch(base + url, { headers })),
      post: async (url, body = {}) => answer(await fetch(base + url, { method: 'POST', headers, body: JSON.stringify(body) })),
    };
  };
  const pageOf = async (b, slug) => (await b.get(`/api/films/${slug}`)).data.access;
  const press = (b, slug) => b.post(`/api/films/${slug}/screenings`);
  const loanOf = (ticketId) => db.prepare('SELECT * FROM loans WHERE ticket_id = ?').get(ticketId);
  const comeDue = (ticketId) => {
    const l = loanOf(ticketId);
    db.prepare('UPDATE loans SET taken_at = ?, due_at = ? WHERE id = ?').run(Date.now() - 1 - (l.due_at - l.taken_at), Date.now() - 1, l.id);
  };
  const master = (slug) => `/media/${slug}/hls/master.m3u8`;

  test('several plays were open on one film: the winner streams from its position, a loser is told its play has ended, and every other link sees the tape out', async () => {
    const [a, b, c, ada, ben] = ['a', 'b', 'c', 'ada phone', 'ben'].map(as);
    const due = loanOf(T.crowdPlaying).due_at;
    assert.equal(due, now - HOUR + 48 * HOUR, 'the end of that play’s time to come back');

    // The browser that was playing has the tape, where it had got to.
    const mine = await pageOf(a, 'crowd');
    assert.equal(mine.canPlay, true);
    assert.deepEqual([mine.ticket.state, mine.ticket.tape, mine.ticket.dueBack], ['ok', 'yours', due]);
    assert.deepEqual(mine.ticket.loan, { takenAt: now - HOUR, position: 3000, finishedAt: null, toBrowser: true, canRespond: false });
    assert.equal((await a.get(master('crowd'))).status, 200);
    const resumed = await press(a, 'crowd');
    assert.equal(resumed.status, 200, JSON.stringify(resumed.data));
    assert.deepEqual([resumed.data.screeningId, resumed.data.resumed, resumed.data.took, resumed.data.position, resumed.data.dueBack], [SC.crowdPlaying, true, false, 3000, due]);
    assert.equal((await a.post(`/api/screenings/${SC.crowdPlaying}/heartbeat`, { position: 3010 })).status, 200);

    // The two who were also part-way: their player stops at its next report, their
    // page says the tape is out, and nothing plays.
    for (const [who, play] of [[c, SC.crowdPaused], [ada, SC.crowdAda]]) {
      const report = await who.post(`/api/screenings/${play}/heartbeat`, { position: 700 });
      assert.deepEqual([report.status, report.data], [409, { error: 'screening-ended' }]);
      const page = await pageOf(who, 'crowd');
      assert.deepEqual([page.canPlay, page.ticket.state, page.ticket.tape, page.ticket.dueBack, page.ticket.loan], [false, 'out', 'out', due, null]);
      assert.deepEqual((await press(who, 'crowd')).data, { error: 'out' });
      assert.equal((await who.get(master('crowd'))).status, 403);
    }
    assert.equal(db.prepare('SELECT position_seconds FROM screenings WHERE id = ?').get(SC.crowdPaused).position_seconds, 600, 'a refused report moves nothing');
    // Every other link: the same link in a second browser, a link nobody had played, a member's kept one.
    for (const who of [b, ben]) {
      const page = await pageOf(who, 'crowd');
      assert.deepEqual([page.canPlay, page.canKeep, page.ticket.state, page.ticket.tape, page.ticket.dueBack], [false, false, 'out', 'out', due]);
      assert.deepEqual((await press(who, 'crowd')).data, { error: 'out' });
    }
    // Nobody but the borrower learns which play has the tape.
    const others = await b.post(`/api/screenings/${SC.crowdPlaying}/heartbeat`, { position: 1 });
    assert.deepEqual([others.status, others.data], [404, { error: 'not-found' }]);

    // Once the tape is back, a loser's link lends once: from the beginning, not from
    // the place it had reached in 1.x. The winner's link is spent.
    comeDue(T.crowdPlaying);
    const again = await press(c, 'crowd');
    assert.equal(again.status, 200, JSON.stringify(again.data));
    assert.notEqual(again.data.screeningId, SC.crowdPaused);
    assert.deepEqual([again.data.took, again.data.resumed, again.data.position], [true, false, 0]);
    assert.equal(again.data.dueBack, again.data.takenAt + 3 * DAY, 'for the shop’s three days: the stored "Time to come back" is ignored');
    assert.deepEqual((await press(a, 'crowd')).data, { error: 'spent' });
    assert.deepEqual((await pageOf(a, 'crowd')).ticket.returned, { at: loanOf(T.crowdPlaying).due_at, how: 'due' });
    assert.equal(db.prepare('SELECT first_played_at FROM tickets WHERE id = ?').get(T.crowdPaused).first_played_at, now - 5 * HOUR, 'its first play in 1.x is still when it was first played');
  });

  // What the back office and the members are told of the loans the upgrade made
  // (slices 4 to 6), before any of them comes back.
  test('the back office’s loans, a response, the start-by date with time given back, and the members’ shelf, on the loans the upgrade made', async () => {
    const admin = await adminBrowser(base);
    const ok = async (promise) => {
      const r = await promise;
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data;
    };
    const loanAt = async (ticketId) => {
      const { loans } = await ok(admin.get(`/api/admin/loans?ticket=${ticketId}`));
      assert.equal(loans.length, 1);
      return loans[0];
    };

    // Lent before 2.0: over, as the upgrade wrote it, and a play that names no browser has no borrower to name.
    const nobody = await loanAt(T.usedUpNobody);
    assert.deepEqual([nobody.live, nobody.endedHow, nobody.borrower], [false, 'before-2.0', { kind: 'browser', device: null, signedInAs: null }]);
    assert.deepEqual([nobody.finished, nobody.response, nobody.otherLinks], [true, null, []]);
    // Watched to the end in 1.x and then given back: not finished, on the loan or in the film's count.
    const givenBack = await loanAt(T.finishedGivenBack);
    assert.deepEqual([givenBack.endedHow, givenBack.finished], ['before-2.0', false]);
    assert.deepEqual((await ok(admin.get(`/api/admin/films/${F.finishedGivenBack}`))).lending, { sent: 1, cancelled: 0, opened: 1, lent: 1, finished: 0, responses: 0 });
    // Every loan is listed: the upgrade's, live and over.
    const everyLoan = (await ok(admin.get('/api/admin/loans'))).loans;
    assert.equal(everyLoan.length, db.prepare('SELECT COUNT(*) AS n FROM loans').get().n);
    assert.ok(everyLoan.some((l) => l.live) && everyLoan.some((l) => l.endedHow === 'before-2.0'));

    // A member part-way through on his own link hands the tape back with a response,
    // and the owner reads it.
    const ben = as('ben');
    const kept = (await pageOf(ben, 'kept')).ticket.loan;
    assert.equal(kept.canRespond, true);
    const r = await ok(ben.post('/api/films/kept/return', { takenAt: kept.takenAt, response: 'lets-talk', message: '  Can we talk about the ending?  ' }));
    assert.equal(r.responded, true);
    const { responses, unread } = await ok(admin.get('/api/admin/responses'));
    assert.equal(unread, 1);
    assert.deepEqual(
      [responses[0].kind, responses[0].message, responses[0].person.name, responses[0].film.slug, responses[0].loan.takenAt],
      ['lets-talk', 'Can we talk about the ending?', 'Ben', 'kept', kept.takenAt],
    );
    assert.deepEqual((await loanAt(T.kept)).response.kind, 'lets-talk');

    // A link nobody played whose start-by passed half an hour ago, while the open play
    // on Solo had the tape: it waits, its time stands still, and the three hours the
    // tape has been out are given back, counted to the moment it is asked.
    const solo = loanOf(T.solo);
    const asked = Date.now();
    const waited = await ok(admin.get(`/api/admin/tickets/${T.soloWaited}`));
    const answered = Date.now();
    assert.deepEqual([waited.linkState, waited.startByPaused, waited.startBy], ['waiting', true, now - 30 * MIN]);
    assert.ok(
      waited.effectiveStartBy >= waited.startBy + (asked - solo.taken_at) && waited.effectiveStartBy <= waited.startBy + (answered - solo.taken_at),
      `the date given back the time out: ${waited.effectiveStartBy - waited.startBy} ms`,
    );
    const listed = (await ok(admin.get('/api/admin/booth'))).attention.tickets.find((t) => t.id === T.soloWaited);
    assert.deepEqual([listed.startByAsSet, listed.startByPaused, listed.startBy > answered], [now - 30 * MIN, true, true]);
    // Counted among the film's links that could still lend.
    assert.equal((await ok(admin.get(`/api/admin/films/${F.solo}`))).links.waiting, 1);

    // The members' shelf: a film shown to members that Dee has no link to is out, due
    // back when the play the upgrade found is due, and says nothing of who has it.
    await ok(admin.patch(`/api/admin/films/${F.crowd}`, { memberVisible: true }));
    const shelf = (await ok(as('dee').get('/api/me'))).memberFilms.find((f) => f.slug === 'crowd');
    const crowd = db.prepare(`SELECT * FROM loans WHERE film_id = ? AND ended_at IS NULL`).get(F.crowd);
    assert.deepEqual([shelf.tape, shelf.dueBack], ['out', crowd.due_at]);
    assert.ok(!JSON.stringify(shelf).includes('takenAt') && !JSON.stringify(shelf).includes('"c"'));
  });

  test('one play open: it is the link’s one loan, due at the end of its time to come back, and then the link is spent', async () => {
    const a = as('a');
    const page = await pageOf(a, 'solo');
    assert.deepEqual([page.ticket.state, page.ticket.tape, page.ticket.dueBack, page.ticket.loan.position], ['ok', 'yours', now - 3 * HOUR + 48 * HOUR, 1800]);
    assert.equal((await a.get(master('solo'))).status, 200);
    assert.equal((await a.post(`/api/screenings/${SC.solo}/heartbeat`, { position: 1900 })).status, 200);
    comeDue(T.solo);
    assert.equal((await a.get(master('solo'))).status, 403);
    assert.deepEqual((await a.post(`/api/screenings/${SC.solo}/heartbeat`, { position: 1950 })).data, { error: 'due' });
    assert.deepEqual((await press(a, 'solo')).data, { error: 'spent' });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM screenings WHERE film_id = ?').get(F.solo).n, 1);
  });

  test('a link 1.x would have let play again keeps the tape for that play only: due tomorrow, not in 13 days, then spent (question 15)', async () => {
    const b = as('b');
    const page = await pageOf(b, 'fortnight');
    const due = now - 26 * HOUR + 48 * HOUR;
    assert.deepEqual([page.ticket.state, page.ticket.tape, page.ticket.dueBack, page.ticket.loan.position], ['ok', 'yours', due, 5000]);
    assert.ok(due < now + 14 * DAY - 26 * HOUR, 'sooner than 1.x’s fourteen days');
    assert.equal((await press(b, 'fortnight')).data.position, 5000);
    comeDue(T.fortnight);
    assert.deepEqual((await press(b, 'fortnight')).data, { error: 'spent' });
    assert.equal((await pageOf(b, 'fortnight')).ticket.state, 'spent');
  });

  test('links with nothing open: a used-up one is spent, and one with plays left lends once more, from the new Play', async () => {
    const [a, b, c] = ['a', 'b', 'c'].map(as);
    // Used up in 1.x: spent, and its browser is told when its last play ran out.
    const used = await pageOf(c, 'done');
    assert.deepEqual([used.canPlay, used.ticket.state, used.ticket.tape], [false, 'spent', null]);
    assert.deepEqual(used.ticket.returned, { at: loanOf(T.usedUp).ended_at, how: 'due' }, 'never "before 2.0": the page learns nothing but that it was due');
    assert.deepEqual((await press(c, 'done')).data, { error: 'spent' });
    assert.equal((await pageOf(b, 'done')).ticket.state, 'spent');
    // Played 40 days ago, no limit: it lends once more, for the shop's default.
    const more = await pageOf(a, 'done');
    assert.deepEqual([more.canPlay, more.ticket.state, more.ticket.tape, more.ticket.loanDays, more.ticket.startBy], [true, 'ok', 'in', 3, null]);
    const took = await press(a, 'done');
    assert.equal(took.status, 200, JSON.stringify(took.data));
    assert.deepEqual([took.data.took, took.data.position, took.data.dueBack - took.data.takenAt], [true, 0, 3 * DAY]);
    assert.notEqual(took.data.screeningId, SC.noLimit);
    assert.equal(db.prepare('SELECT first_played_at FROM tickets WHERE id = ?').get(T.noLimit).first_played_at, now - 40 * DAY, 'no 1.x column is rewritten');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });

  // The loans the upgrade made are loans like any other: slice 3's ways back work on them.
  test('a tape the upgrade found out comes back like any other: its borrower returns it, or you take it back by its loan; and a link that lent before 2.0 is never restored', async () => {
    const admin = await adminBrowser(base);
    const answer = (r) => [r.status, r.data];

    // A browser part-way through, on a link anyone can use: it returns the tape.
    const dee = as('dee');
    const mine = loanOf(T.signedIn);
    assert.deepEqual([mine.ended_at, mine.person_id, mine.taken_at], [null, null, now - 2 * HOUR]);
    assert.deepEqual(answer(await dee.post('/api/films/signed-in/return', { takenAt: mine.taken_at + 1 })), [409, { error: 'nothing-to-return' }]);
    const back = await dee.post('/api/films/signed-in/return', { takenAt: mine.taken_at });
    assert.equal(back.status, 200, JSON.stringify(back.data));
    assert.deepEqual([loanOf(T.signedIn).ended_at, loanOf(T.signedIn).ended_how], [back.data.returned.at, 'returned']);
    const page = (await pageOf(dee, 'signed-in')).ticket;
    assert.deepEqual([page.state, page.tape, page.returned], ['spent', null, { at: back.data.returned.at, how: 'returned' }]);
    assert.deepEqual(answer(await dee.post(`/api/screenings/${SC.signedIn}/heartbeat`, { position: 61 })), [409, { error: 'returned' }]);
    assert.deepEqual(answer(await press(dee, 'signed-in')), [409, { error: 'spent' }]);
    assert.equal(db.prepare('SELECT position_seconds FROM screenings WHERE id = ?').get(SC.signedIn).position_seconds, 60);

    // A member part-way through on his own link, with a browser part-way on another:
    // you take his tape back, by its loan.
    const ben = as('ben');
    const his = loanOf(T.pairBen);
    assert.equal(his.ended_at, null);
    assert.equal(loanOf(T.pairAnyone), undefined, 'the other play on the film got no loan');
    const takeBack = (ticketId) => admin.post(`/api/admin/loans/${his.id}/take-back`, { ticketId });
    assert.deepEqual(answer(await takeBack(T.pairAnyone)), [409, { error: 'not-out' }]);
    const taken = await takeBack(T.pairBen);
    assert.equal(taken.status, 200, JSON.stringify(taken.data));
    assert.deepEqual([taken.data.loan.endedHow, taken.data.ticket.state, taken.data.alsoCancelled], ['taken-back', 'revoked', []]);
    assert.deepEqual(answer(await ben.post(`/api/screenings/${SC.pairBen}/heartbeat`, { position: 2500 })), [409, { error: 'taken-back' }]);
    assert.deepEqual(answer(await ben.get('/api/films/pair')), [404, { error: 'not-found' }]);
    assert.deepEqual(answer(await takeBack(T.pairBen)), [409, { error: 'not-out' }]);
    assert.deepEqual(answer(await admin.post(`/api/admin/tickets/${T.pairBen}/restore`)), [409, { error: 'lent-once' }]);
    // The link that was also part-way can take the tape now, once.
    assert.deepEqual([(await pageOf(as('b'), 'pair')).ticket.state, (await pageOf(as('b'), 'pair')).ticket.tape], ['ok', 'in']);

    // Lent before 2.0: used up in 1.x and cancelled there, or cancelled now. Neither comes back.
    assert.equal(loanOf(T.usedUpCancelled).ended_how, 'before-2.0');
    assert.deepEqual(answer(await admin.post(`/api/admin/tickets/${T.usedUpCancelled}/restore`)), [409, { error: 'lent-once' }]);
    assert.equal(loanOf(T.usedUpGaveOneBack).ended_how, 'before-2.0');
    assert.equal((await admin.post(`/api/admin/tickets/${T.usedUpGaveOneBack}/revoke`)).data.tookBack, false);
    assert.deepEqual(answer(await admin.post(`/api/admin/tickets/${T.usedUpGaveOneBack}/restore`)), [409, { error: 'lent-once' }]);
    assert.ok(db.prepare('SELECT revoked_at FROM tickets WHERE id = ?').get(T.usedUpGaveOneBack).revoked_at);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
});

describe('migration 8 failing part-way', () => {
  const failing = {
    'a table called loans already there': { break: (m7) => m7.exec("CREATE TABLE loans (note TEXT); INSERT INTO loans (note) VALUES ('mine')"), error: /table loans already exists/ },
    'a link with 0 days after first play': { break: (m7, { T }) => m7.prepare('UPDATE tickets SET days_after_first_play = 0 WHERE id = ?').run(T.neverPlain), error: /CHECK constraint failed/ },
  };

  for (const [what, { break: breakIt, error }] of Object.entries(failing)) {
    test(`${what}: schema 7 still, no new column or table, every row as it was`, () => {
      const file = path.join(tempDir(), 'open-matte.db');
      const m7 = schemaSevenDb(file);
      breakIt(m7, fillShop(m7));
      const tables = (db) => db.prepare("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => ({ ...r }));
      const everything = (db) => Object.fromEntries(tables(db).filter((t) => t.sql.startsWith('CREATE TABLE')).map((t) => [t.name, rows(db, t.name)]));
      const schema7 = tables(m7);
      const rows7 = everything(m7);
      m7.close();

      // Twice: a server that keeps restarting finds the same file each time.
      for (let attempt = 1; attempt <= 2; attempt++) {
        assert.throws(() => openDb(file), error, `attempt ${attempt}`);
        // The connection that failed is closed, not left holding the file: closing
        // the last one is what removes the -wal and -shm beside a database.
        assert.deepEqual(fs.readdirSync(path.dirname(file)), ['open-matte.db'], `attempt ${attempt}`);
        const raw = new DatabaseSync(file);
        assert.equal(userVersion(raw), 7, 'still schema 7');
        assert.ok(!columns(raw, 'tickets').includes('loan_days'));
        assert.ok(!columns(raw, 'tickets').includes('pick_note'));
        assert.deepEqual(tables(raw), schema7, 'no table, index or trigger gained, lost or changed');
        assert.ok(!tables(raw).some((t) => t.name === 'responses'));
        assert.deepEqual(everything(raw), rows7, 'every row as it was');
        assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []);
        assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
        raw.close();
      }
    });
  }
});
