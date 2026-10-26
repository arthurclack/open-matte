import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Timestamps are integer milliseconds since the epoch throughout.
// Each entry runs once, in order; never edit one that has shipped, add a new one.
const MIGRATIONS = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE films (
    id              INTEGER PRIMARY KEY,
    slug            TEXT NOT NULL UNIQUE,   -- the folder name and the URL
    -- Editable metadata. Imported from film.json, then owned by the admin.
    title           TEXT NOT NULL,
    original_title  TEXT,
    year            INTEGER,
    runtime_minutes INTEGER,
    directors       TEXT,
    country         TEXT,
    synopsis        TEXT,
    recommendation  TEXT,
    content_note    TEXT,
    imported_meta   TEXT,                   -- JSON: metadata as last read from film.json
    published       INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    -- Media, always taken from the latest scan.
    media_status    TEXT NOT NULL,          -- ok | warning | error | missing
    media           TEXT,                   -- JSON: playlists, artwork, subtitles, renditions
    scan_report     TEXT,                   -- JSON: { errors, warnings }
    scanned_at      INTEGER,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );

  -- An "admit one" invitation to one film. Whoever holds the link can use it.
  CREATE TABLE tickets (
    id                    INTEGER PRIMARY KEY,
    code                  TEXT NOT NULL UNIQUE,
    film_id               INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
    label                 TEXT,             -- who it's for; a note for the admin, not an identity check
    screening_limit       INTEGER,          -- NULL = unlimited
    start_by              INTEGER,          -- the first screening must start before this; NULL = no deadline
    days_after_first_play INTEGER,          -- valid this long after the first screening starts; NULL = no limit
    first_opened_at       INTEGER,
    first_played_at       INTEGER,
    revoked_at            INTEGER,
    created_at            INTEGER NOT NULL
  );
  CREATE INDEX tickets_film ON tickets(film_id);

  CREATE TABLE sessions (
    id_hash      TEXT PRIMARY KEY,          -- sha256 of the cookie value
    kind         TEXT NOT NULL,             -- viewer | admin
    device       TEXT,                      -- coarse, e.g. "Safari on iPhone"
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    revoked_at   INTEGER
  );

  -- The tickets a browser has opened. One browser can hold several.
  CREATE TABLE session_tickets (
    session_hash TEXT NOT NULL REFERENCES sessions(id_hash) ON DELETE CASCADE,
    ticket_id    INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    added_at     INTEGER NOT NULL,
    PRIMARY KEY (session_hash, ticket_id)
  );
  CREATE INDEX session_tickets_ticket ON session_tickets(ticket_id);

  -- One use of a ticket: created by pressing Play, resumable until resumable_until,
  -- and held by one browser at a time.
  CREATE TABLE screenings (
    id                INTEGER PRIMARY KEY,
    ticket_id         INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    film_id           INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
    session_hash      TEXT,                 -- the browser currently holding it
    started_at        INTEGER NOT NULL,
    resumable_until   INTEGER NOT NULL,
    last_heartbeat_at INTEGER NOT NULL,
    active_until      INTEGER NOT NULL,     -- playing on its holder until then; others may take over after
    position_seconds  REAL NOT NULL DEFAULT 0,
    furthest_seconds  REAL NOT NULL DEFAULT 0,
    duration_seconds  REAL,
    finished_at       INTEGER,
    voided_at         INTEGER               -- given back by the admin; no longer counts
  );
  CREATE INDEX screenings_ticket ON screenings(ticket_id, started_at);

  CREATE TABLE events (
    id           INTEGER PRIMARY KEY,
    at           INTEGER NOT NULL,
    type         TEXT NOT NULL,             -- opened | play | heartbeat | finished
    film_id      INTEGER REFERENCES films(id) ON DELETE CASCADE,
    ticket_id    INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
    session_hash TEXT,
    screening_id INTEGER REFERENCES screenings(id) ON DELETE CASCADE,
    position     REAL,
    detail       TEXT
  );
  CREATE INDEX events_at ON events(at);
  CREATE INDEX events_ticket ON events(ticket_id, at);
  `,
  // Film information and artwork from TMDb.
  `
  ALTER TABLE films ADD COLUMN tmdb_id INTEGER;
  ALTER TABLE films ADD COLUMN tmdb_status TEXT;    -- JSON: { state, at, message, candidates }
  ALTER TABLE films ADD COLUMN meta_sources TEXT;   -- JSON: { field: 'tmdb' } for values taken from TMDb
  ALTER TABLE films ADD COLUMN artwork TEXT;        -- JSON: { poster: { file, tmdbPath }, backdrop: { … } }, stored in DATA_DIR/artwork
  `,
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = version; i < MIGRATIONS.length; i++) {
    tx(db, () => {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

// Runs fn in a transaction. IMMEDIATE takes the write lock up front, so a
// read-check-write sequence inside fn can't interleave with another writer.
export function tx(db, fn, { immediate = false } = {}) {
  db.exec(immediate ? 'BEGIN IMMEDIATE' : 'BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
