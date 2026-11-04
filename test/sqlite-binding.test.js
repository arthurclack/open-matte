// The server's statements bind the same values on every Node it runs on (db.js).
// Node 26, which the tests and the server's image usually run on, binds undefined
// as NULL, while Node 24 refuses it, and Node 22.13 refuses true and false as
// well. Here SQLite's own methods refuse them too, as on those versions, before
// the server prepares anything.
import assert from 'node:assert/strict';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { test } from 'node:test';

const valuesOf = (args) => args.flatMap((a) => (a !== null && typeof a === 'object' && !ArrayBuffer.isView(a) ? Object.values(a) : [a]));
for (const method of ['run', 'get', 'all', 'iterate']) {
  const original = StatementSync.prototype[method];
  StatementSync.prototype[method] = function (...args) {
    if (valuesOf(args).some((v) => v === undefined || typeof v === 'boolean')) {
      throw new TypeError('Provided value cannot be bound to SQLite parameter (as on Node 24 and 22)');
    }
    return original.apply(this, args);
  };
}

const { openDb } = await import('../server/db.js');
const { FILM_SECONDS, adminBrowser, browser, makeFilm, startServer, tempDir } = await import('./helpers.js');

test('SQLite here refuses undefined and booleans, as on Node 24 and 22', () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('CREATE TABLE t (a, b)');
  assert.throws(() => raw.prepare('INSERT INTO t VALUES (?, ?)').run(1, undefined), /cannot be bound/);
  assert.throws(() => raw.prepare('INSERT INTO t VALUES (?, ?)').run(1, true), /cannot be bound/);
});

test("the server's statements bind undefined as NULL and booleans as 1 and 0, as Node 26 does", () => {
  const db = openDb(':memory:');
  db.exec('CREATE TABLE t (a, b, c)');
  db.prepare('INSERT INTO t VALUES (?, ?, ?)').run('positional', undefined, true);
  db.prepare('INSERT INTO t VALUES (:a, :b, :c)').run({ a: 'named', b: undefined, c: false });
  db.prepare('INSERT INTO t VALUES (?, ?, ?)').run(new Uint8Array([1, 2]), null, 7);
  const rows = db.prepare('SELECT * FROM t ORDER BY rowid').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { a: 'positional', b: null, c: 1 },
    { a: 'named', b: null, c: 0 },
    { a: new Uint8Array([1, 2]), b: null, c: 7 },
  ]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM t WHERE b IS ?').get(undefined).n, 3);
  assert.deepEqual([...db.prepare('SELECT a FROM t WHERE c = ?').iterate(true)].map((r) => r.a), ['positional']);
});

test('a ticket opens, plays and is watched to the end with SQLite as strict as on Node 24', async () => {
  const mediaDir = tempDir();
  makeFilm(mediaDir, 'arrival');
  const srv = await startServer({ mediaDir });
  try {
    const admin = await adminBrowser(srv.base);
    await admin.post('/api/admin/scan');
    const filmId = (await admin.get('/api/admin/films')).data[0].id;
    assert.equal((await admin.patch(`/api/admin/films/${filmId}`, { published: true })).status, 200);
    const ticket = (await admin.post('/api/admin/tickets', { filmId, label: 'Sam', screeningLimit: 1 })).data[0];
    const viewer = browser(srv.base);
    assert.equal((await viewer.post('/api/tickets/open', { code: ticket.code })).status, 200);
    const play = await viewer.post('/api/films/arrival/screenings');
    assert.equal(play.status, 200, JSON.stringify(play.data));
    const beat = (position, playing) => viewer.post(`/api/screenings/${play.data.screeningId}/heartbeat`, { position, playing });
    assert.equal((await beat(10, true)).status, 200);
    assert.equal((await beat(FILM_SECONDS, false)).status, 200);
    assert.equal((await admin.get('/api/admin/activity')).status, 200);
  } finally {
    await srv.close();
  }
});
