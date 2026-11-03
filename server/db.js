import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Timestamps are integer milliseconds since the epoch throughout.
// Each entry runs once, in order; never edit one that has shipped, add a new one.
export const MIGRATIONS = [
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
  // Milestone 2: people and passkeys. Existing sessions stay anonymous and
  // existing tickets stay tickets for anyone with the link.
  `
  -- Someone the admin has added. The name is how they appear to themselves and
  -- in their password manager; it is never used to sign in.
  CREATE TABLE people (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,  -- never reused
    name             TEXT NOT NULL,
    note             TEXT,                   -- for the admin only; never sent to a viewer
    webauthn_user_id TEXT NOT NULL UNIQUE,   -- base64url of 32 random bytes: WebAuthn user.id; never changes
    disabled_at      INTEGER,
    created_at       INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX people_name ON people(name COLLATE NOCASE);

  -- Single-use, short-lived links that let a person create a passkey. Only the
  -- hash is kept: the admin sees the link once, when it is made.
  CREATE TABLE person_links (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id    INTEGER NOT NULL REFERENCES people(id),
    token_hash   TEXT NOT NULL UNIQUE,       -- sha256 of the token in /enroll#<token>
    purpose      TEXT NOT NULL CHECK (purpose IN ('setup', 'recovery')),
    reset        INTEGER NOT NULL DEFAULT 0 CHECK (reset IN (0, 1)),  -- recovery that removed the old passkeys
    ticket_id    INTEGER REFERENCES tickets(id) ON DELETE SET NULL,   -- open this film afterwards
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    opened_at    INTEGER,                    -- first opened (perhaps by a link scanner)
    used_at      INTEGER,                    -- a passkey was created with it
    used_device  TEXT,                       -- where, coarse; kept even if that passkey is removed later
    cancelled_at INTEGER                     -- by the admin, by a newer link, or by disabling the person
  );
  CREATE INDEX person_links_person ON person_links(person_id, created_at);

  CREATE TABLE passkeys (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id     INTEGER NOT NULL REFERENCES people(id),
    credential_id TEXT NOT NULL UNIQUE,      -- base64url, as the library returns it
    public_key    BLOB NOT NULL,             -- COSE key, as the library returns it
    sign_count    INTEGER NOT NULL DEFAULT 0,
    device_type   TEXT NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
    backed_up     INTEGER NOT NULL CHECK (backed_up IN (0, 1)),  -- "Synced" or "This device only"
    transports    TEXT,                      -- JSON array; a hint for excludeCredentials
    aaguid        TEXT,                      -- which provider, when it says
    added_device  TEXT,                      -- coarse, e.g. "Safari on iPhone"
    link_id       INTEGER REFERENCES person_links(id),
    created_at    INTEGER NOT NULL,
    last_used_at  INTEGER
  );
  CREATE INDEX passkeys_person ON passkeys(person_id);

  -- A viewer session signed in as a person. Anonymous ticket browsers keep NULL.
  ALTER TABLE sessions ADD COLUMN person_id INTEGER REFERENCES people(id);
  ALTER TABLE sessions ADD COLUMN passkey_id INTEGER REFERENCES passkeys(id) ON DELETE SET NULL;
  ALTER TABLE sessions ADD COLUMN signed_in_at INTEGER;
  CREATE INDEX sessions_person ON sessions(person_id) WHERE person_id IS NOT NULL;
  CREATE INDEX sessions_passkey ON sessions(passkey_id) WHERE passkey_id IS NOT NULL;

  -- Tickets only one person can use, signed in. NULL = anyone with the link, as before.
  ALTER TABLE tickets ADD COLUMN person_id INTEGER REFERENCES people(id);

  -- The person an account event is about (sign-ins, passkeys, links, disabling).
  -- Viewing events find their person through the session instead.
  ALTER TABLE events ADD COLUMN person_id INTEGER REFERENCES people(id);
  CREATE INDEX events_person ON events(person_id, at) WHERE person_id IS NOT NULL;
  `,
  // From here on tickets.person_id is set, so code from before tickets for one
  // person, which ignores it, must refuse this database rather than treat those
  // tickets as tickets for anyone.
  `
  CREATE INDEX tickets_person ON tickets(person_id) WHERE person_id IS NOT NULL;
  `,
  // Films shown to members: signed-in people see the page and poster. Playing
  // still needs a ticket. Every existing film starts hidden from members.
  `
  ALTER TABLE films ADD COLUMN member_visible INTEGER NOT NULL DEFAULT 0 CHECK (member_visible IN (0, 1));
  `,
  // Keeping a ticket: a ticket for anyone can be marked keepable, and the first
  // signed-in person to keep it makes it theirs. From here on a ticket's person
  // can change after it's issued, so older code must refuse this database.
  `
  -- Only a ticket for anyone can be keepable; only a ticket with a person can have been kept.
  ALTER TABLE tickets ADD COLUMN claimable INTEGER NOT NULL DEFAULT 0
    CHECK (claimable IN (0, 1) AND (claimable = 0 OR person_id IS NULL));
  ALTER TABLE tickets ADD COLUMN claimed_at INTEGER
    CHECK (claimed_at IS NULL OR person_id IS NOT NULL);
  `,
  // Activity and retention. Old events and ended browser sessions are deleted
  // from here on (retention.js), so "last signed in" moves onto the person, where
  // it outlives the sessions it was read from. Indexes for Activity's filters and
  // the clean-up. As with every migration, going back to older code now needs a
  // restore of the backup taken before the update.
  `
  ALTER TABLE people ADD COLUMN last_signed_in_at INTEGER;
  UPDATE people SET last_signed_in_at = (SELECT MAX(signed_in_at) FROM sessions WHERE person_id = people.id);
  CREATE INDEX events_film ON events(film_id, at);
  CREATE INDEX events_type_at ON events(type, at);
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
  // A careless rollback should fail loudly, not treat tickets for one person as
  // tickets for anyone.
  if (version > MIGRATIONS.length) {
    throw new Error(
      `This database was written by a newer Open Matte (schema ${version}; this code knows ${MIGRATIONS.length}). ` +
        'Deploy the newer code, or restore a backup from before the upgrade.',
    );
  }
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
