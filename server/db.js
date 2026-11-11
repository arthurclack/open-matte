import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Timestamps are integer milliseconds since the epoch throughout.
// Each entry runs once, in order; never edit one that has shipped, add a new one.
// So the comments inside describe each table as it shipped: events.type, for one,
// has more kinds now than migration 1 lists (see logEvent in access.js).
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
  // Version 2: one tape per film. The first Play on one of a film's links takes its
  // tape until it's due back, and a link lends once. A loan is one time the tape
  // went out; a screening is now the playback of one loan. From here on two links
  // can't play one film at once, and older code, which knows nothing of loans, must
  // refuse this database. Every 1.x link that could still play can take the tape,
  // or has it; one that couldn't (used up, or past its days after first play) has lent.
  `
  -- One "now" for the whole migration, in whole milliseconds. julianday works on
  -- every SQLite that Node 22.13 or later bundles.
  CREATE TEMP TABLE m8 AS SELECT CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) AS now;
  -- How long this link lends the tape for, in days. NULL: the shop's default when Play is pressed.
  ALTER TABLE tickets ADD COLUMN loan_days INTEGER CHECK (loan_days IS NULL OR loan_days BETWEEN 1 AND 30);
  -- Picked for you: the owner's note to whoever has this link. Never films.recommendation,
  -- and never label, which stays a note for the admin only.
  ALTER TABLE tickets ADD COLUMN pick_note TEXT CHECK (pick_note IS NULL OR length(pick_note) <= 2000);
  -- One time a film's tape went out. Out (ended_at NULL) until it is returned, due,
  -- taken back, or its borrower can no longer play; access.js writes the end.
  CREATE TABLE loans (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,          -- never reused, so a stale page can't name another loan
    film_id      INTEGER NOT NULL REFERENCES films(id),
    ticket_id    INTEGER NOT NULL REFERENCES tickets(id),    -- the link it was taken on
    screening_id INTEGER NOT NULL REFERENCES screenings(id), -- its playback: position, furthest, finished
    person_id    INTEGER REFERENCES people(id),              -- the borrower, when the link is for one person
    session_hash TEXT,      -- the browser that pressed Play: the borrower on a link for anyone. Plain text, as on screenings
    device       TEXT,      -- that browser, coarse; kept after its session is deleted
    taken_at     INTEGER NOT NULL,
    due_at       INTEGER NOT NULL,
    ended_at     INTEGER,
    ended_how    TEXT CHECK (ended_how IN ('returned', 'due', 'taken-back', 'signed-out', 'disabled', 'before-2.0')),
    CHECK ((ended_at IS NULL) = (ended_how IS NULL)),
    CHECK (due_at > taken_at),
    CHECK (ended_at IS NULL OR ended_at >= taken_at),
    CHECK (person_id IS NOT NULL OR session_hash IS NOT NULL OR ended_how IS 'before-2.0')
  );
  CREATE UNIQUE INDEX loans_out ON loans(film_id) WHERE ended_at IS NULL;   -- one tape per film
  CREATE UNIQUE INDEX loans_once ON loans(ticket_id);                       -- a link lends once
  CREATE UNIQUE INDEX loans_screening ON loans(screening_id);
  CREATE INDEX loans_film ON loans(film_id, taken_at);
  CREATE INDEX loans_person ON loans(person_id, taken_at) WHERE person_id IS NOT NULL;
  CREATE INDEX loans_session ON loans(session_hash) WHERE ended_at IS NULL;
  -- What a borrower said when handing a tape back. Only the admin ever reads these.
  CREATE TABLE responses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id    INTEGER NOT NULL REFERENCES loans(id),
    person_id  INTEGER NOT NULL REFERENCES people(id),
    film_id    INTEGER NOT NULL REFERENCES films(id),
    kind       TEXT NOT NULL CHECK (kind IN ('loved-it', 'still-thinking', 'not-for-me', 'lets-talk')),
    message    TEXT CHECK (message IS NULL OR length(message) BETWEEN 1 AND 2000),
    created_at INTEGER NOT NULL,
    read_at    INTEGER
  );
  CREATE UNIQUE INDEX responses_once ON responses(loan_id);
  CREATE INDEX responses_created ON responses(created_at);
  -- Only the person who borrowed the tape: never a browser on a link for anyone.
  CREATE TRIGGER responses_from_borrower BEFORE INSERT ON responses
    WHEN NEW.person_id IS NOT (SELECT person_id FROM loans WHERE id = NEW.loan_id)
    BEGIN SELECT RAISE(ABORT, 'a response comes from the person who borrowed the tape'); END;
  -- 1. Each film's one loan: of the screenings their own holder could resume now
  -- (each ticket's latest open one, the ticket not revoked nor past its days, the
  -- film published; the ticket's person not disabled, or else the browser holding
  -- the play still signed in and still holding the ticket), the one playing, then
  -- the one heard from last. Due at the end of that play's time to come back, or at
  -- the ticket's expiry if sooner. A play nobody could resume gets no loan, so no
  -- loan is born that isn't out.
  INSERT INTO loans (film_id, ticket_id, screening_id, person_id, session_hash, device, taken_at, due_at)
  SELECT film_id, ticket_id, id, person_id, session_hash, device, started_at, due FROM (
    SELECT s.id, s.film_id, s.ticket_id, t.person_id, s.session_hash, ss.device, s.started_at,
           MIN(s.resumable_until, COALESCE(t.first_played_at + t.days_after_first_play * 86400000, s.resumable_until)) AS due,
           ROW_NUMBER() OVER (PARTITION BY s.film_id ORDER BY
             (s.active_until > m8.now) DESC, s.last_heartbeat_at DESC, s.id) AS place
    FROM screenings s JOIN tickets t ON t.id = s.ticket_id JOIN films f ON f.id = s.film_id CROSS JOIN m8
    LEFT JOIN sessions ss ON ss.id_hash = s.session_hash
    WHERE f.published = 1 AND t.revoked_at IS NULL
      AND (t.days_after_first_play IS NULL OR t.first_played_at + t.days_after_first_play * 86400000 > m8.now)
      AND s.id = (SELECT s2.id FROM screenings s2 WHERE s2.ticket_id = s.ticket_id AND s2.voided_at IS NULL
                    AND s2.resumable_until > m8.now ORDER BY s2.started_at DESC, s2.id DESC LIMIT 1)
      AND (CASE WHEN t.person_id IS NOT NULL
             THEN EXISTS (SELECT 1 FROM people p WHERE p.id = t.person_id AND p.disabled_at IS NULL)
             ELSE EXISTS (SELECT 1 FROM sessions h JOIN session_tickets st ON st.session_hash = h.id_hash AND st.ticket_id = t.id
                          LEFT JOIN people hp ON hp.id = h.person_id
                          WHERE h.id_hash = s.session_hash AND h.kind = 'viewer' AND h.revoked_at IS NULL AND h.expires_at > m8.now
                            AND (h.person_id IS NULL OR (hp.id IS NOT NULL AND hp.disabled_at IS NULL))) END)
  ) WHERE place = 1;
  -- 2. Links 1.x would no longer let play (used up, or past their days after first
  -- play, revoked or not) have lent: one ended loan each, so they are spent by the
  -- same rule as every link from now on, and a restore can't make them lend.
  INSERT INTO loans (film_id, ticket_id, screening_id, person_id, session_hash, device, taken_at, due_at, ended_at, ended_how)
  SELECT t.film_id, t.id, last.id, t.person_id, last.session_hash, ss.device, t.first_played_at, e.at, e.at, 'before-2.0'
  FROM tickets t CROSS JOIN m8
  JOIN screenings last ON last.id = (SELECT id FROM screenings WHERE ticket_id = t.id ORDER BY started_at DESC, id DESC LIMIT 1)
  LEFT JOIN sessions ss ON ss.id_hash = last.session_hash
  JOIN (SELECT t2.id AS ticket_id,
               MIN(COALESCE(t2.first_played_at + t2.days_after_first_play * 86400000, 9000000000000000),
                   COALESCE((SELECT MAX(resumable_until) FROM screenings WHERE ticket_id = t2.id AND voided_at IS NULL),
                            t2.first_played_at + t2.days_after_first_play * 86400000)) AS at
        FROM tickets t2) e ON e.ticket_id = t.id
  WHERE t.first_played_at IS NOT NULL AND t.id NOT IN (SELECT ticket_id FROM loans)
    AND ((t.days_after_first_play IS NOT NULL AND t.first_played_at + t.days_after_first_play * 86400000 <= m8.now)
      OR (t.screening_limit IS NOT NULL
          AND (SELECT COUNT(*) FROM screenings WHERE ticket_id = t.id AND voided_at IS NULL) >= t.screening_limit
          AND NOT EXISTS (SELECT 1 FROM screenings WHERE ticket_id = t.id AND voided_at IS NULL AND resumable_until > m8.now)));
  -- 3. "Valid N days after first play" becomes the loan length of a link that can
  -- still lend, at most 30 days. No row of 1.x's own columns is changed anywhere.
  UPDATE tickets SET loan_days = MIN(days_after_first_play, 30)
  WHERE days_after_first_play IS NOT NULL AND id NOT IN (SELECT ticket_id FROM loans);
  DROP TABLE temp.m8;
  `,
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = bindsAlike(new DatabaseSync(file));
  // A file that can't be opened as a database, or upgraded, is closed again: the
  // caller gets the error and no connection, so nothing is left holding the file.
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

// Node's SQLite binds values differently from one version to the next. Node 26,
// which the server's image runs, binds undefined as NULL; Node 24 refuses it with
// an error, and Node 22.13 refuses true and false as well. So a request field left
// out could pass on one Node and answer 500 on another, such as a computer running
// the server with an older Node. Every statement here binds as Node 26 does, on any
// version: undefined as NULL, true and false as 1 and 0.
const bindable = (v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v);
const isParamsObject = (v) => v !== null && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const bindables = (args) => args.map((a) => (isParamsObject(a) ? Object.fromEntries(Object.entries(a).map(([k, v]) => [k, bindable(v)])) : bindable(a)));

function bindsAlike(db) {
  const prepare = db.prepare;
  db.prepare = (...args) => {
    const statement = prepare.apply(db, args);
    for (const method of ['run', 'get', 'all', 'iterate']) {
      const bind = statement[method];
      statement[method] = (...values) => bind.apply(statement, bindables(values));
    }
    return statement;
  };
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
