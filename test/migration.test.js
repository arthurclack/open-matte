// Upgrading a milestone 1 database to milestone 2, and a schema 6 database to
// migration 7 (milestone 3, slice 4), and refusing one written by newer code.
// docs/history/milestone-2.md: "Data model" and "Existing rows";
// docs/history/milestone-3.md, slice 4.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { softAuthenticator } from './softauth.js';

const { adminBrowser, browser, enroll, makeFilm, setupLink, signIn, tempDir } = await import('./helpers.js');
const { MIGRATIONS, openDb } = await import('../server/db.js');
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
      db,
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
    assert.equal(me.tickets[0].ticket.openScreening.position, 42);
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
    // The new column is the only new one.
    for (const t of TABLES) {
      const added = columns(db, t).filter((c) => !oldColumns[t].includes(c));
      assert.deepEqual(added, t === 'people' ? ['last_signed_in_at'] : [], t);
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
      db,
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
