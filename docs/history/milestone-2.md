# Milestone 2: people and passkeys

The plan for milestone 2, agreed on 26 October 2026. It starts from commit b28a56d
(82 tests passing). [access.md](../access.md) describes what is built; this describes
what will be. As each slice ships, its rules move into access.md and its box in
[roadmap.md](../roadmap.md) gets ticked.

**Status, 1 November:** slices 1 to 5 are built and deployed (slice 4 before slice 3,
so films shown to members are migration 5 and keeping is 6), and so are slice 6's
keyboard fixes and the bare-domain redirect. Slice 6's device checks were split: the
ones that test this milestone's risks (signing in on each platform, keeping, in-app
browsers, AirPlay and Chromecast) close it; the playback-only ones (a TV browser,
desktop Firefox, a non-HDR screen, keyboard only in Safari) moved to milestone 3. Both
lists are in [device-checks.md](device-checks.md).

## What it's for

Friends who want an account can have one, and nobody has to. You add a person and
send them a setup link, and they create a passkey. From then on you can issue tickets
that only that person can use, alongside today's tickets for anyone with the link. A
signed-in person sees their tickets on every device they sign in on, can keep a link
ticket in their account when you allow it, and sees the films you show to members.
After losing a device they get back in only because you did something about it.

A friend with no account who opens a link ticket gets exactly what milestone 1 gives
them, in any browser, TVs included.

A passkey never unlocks media. It proves who is signed in; the existing
ticket → screening → media check decides everything else.

## Decisions

### Yours (26 October)

| Decision | Choice |
|---|---|
| Relying-party ID | `openmatte.dev`, with the origin exactly `https://www.openmatte.dev`. Every passkey is tied to it for good, so it is set before the first setup link exists. It also covers the bare domain or another subdomain later; in return, every `*.openmatte.dev` subdomain must stay under your control. |
| Films shown to members | **Listed only**: signed-in people see the page, poster and recommendation. Playing still needs a ticket. |
| Who creates people | **Only you.** There is no self-registration. A setup link can carry a ticket, so a new friend still gets one link that ends on the film. |
| Passkey verification | **`@simplewebauthn/server` 14.0.3** at runtime, pinned; `@simplewebauthn/browser` 14.0.0 bundled by Vite. |

### Two changes to settled rules (agreed 26 October)

1. **Takeover.** A screening held by a browser that can no longer play it (signed out,
   session revoked or expired, its person disabled, the ticket now someone else's) can
   be taken over straight away instead of after about 75 seconds. This applies to link
   tickets too, for example after **Sign out every viewer**.
2. **The code in the address.** For a ticket that only one person can use, the code
   stays in the `/t/` address until that person signs in, so "Open in Safari" works
   from an in-app browser. The code is useless to anyone else, and no Referer is sent.
   Link tickets are unchanged: the code still leaves the address at once.

Slice 1 builds the first (`holderCanPlay`) and updates the Switch device row of
access.md's Screenings table; slice 2 builds the second and updates Opening a link. If
you decline the first, `startScreening` keeps today's check and the take-over-at-once
tests go. If you decline the second, TicketOpen replaces the address at once and keeps
the code in memory for **Copy link**, so "Open in Safari" from an in-app browser no
longer works.

### Engineering decisions

These need no decision from you, but you can overrule any of them.

| Decision | Choice | Why |
|---|---|---|
| Ticket kinds | `tickets.person_id`: NULL means anyone with the link, as today; set means only that person, signed in. No separate kind column. | One rule, and existing rows need no change. |
| A stranger opens a ticket for one person | A sign-in page. No session, cookie, `first_opened_at` or event is created, and neither the film nor the name is shown. | "Viewing requires signing in as the person." Strangers learn nothing. |
| Ticket links never set up passkeys | A ticket for someone with no passkey is sent as a setup link that opens the film afterwards. | Ticket codes are stored readable, can be copied again and last until first play. If one could create a passkey, a leaked ticket would become a takeover of the account. |
| Keeping | A per-ticket "Let them keep it" box, off by default, for link tickets only. Keeping binds the ticket to the keeper; limits and clocks don't change. You can release it or give it to someone else. | "Keep" then means something, and access.js keeps one rule. |
| Recovery | Yours only, as two actions. **Add a sign-in method** keeps existing passkeys. **Reset after loss** removes them and signs the person out everywhere *when you create the link*. | A lost device is cut off at once. Nothing works from a name. |
| Setup and recovery links | A 256-bit token in the address fragment (`/enroll#…`), stored as SHA-256, shown once. Setup links last 1 hour to 7 days (default 3 days); recovery links 1 hour or 1 day (default 1 hour). One live link per person. Only creating a passkey uses one up. | The fragment never reaches the server, Caddy's logs or a link-preview fetcher. Recovery links are the most attractive to steal, so they're the shortest. |
| Signing in | Always a new session row and cookie; the old one is revoked in the same transaction. Link tickets and a held screening move across only from an anonymous session or one belonging to the same person. | No session fixation. |
| Signing out | Revokes the session, so the browser also forgets the link tickets it opened. The confirmation names them. | The next person at a shared device isn't signed in and holds none of those tickets; the links still work. The browser's own history still lists every link opened there, so a borrowed computer is safer with a private window. |
| A person's session | The same 90 days (`VIEWER_SESSION_DAYS`). | Revocation already takes effect on the next request. |
| People are disabled, not deleted | No delete in milestone 2; the foreign keys refuse one. Ids use `AUTOINCREMENT` so they are never reused. | Erasure is later work ([roadmap.md](../roadmap.md#later)); milestone 3's retention never deletes people. A reused id would hand one person's passkeys, sessions and tickets to the next. |
| Names | `name` is shown to the person and saved in their password manager. `note` is for you only. Names are unique, ignoring case. | A note like "Sam (rude about Nolan)" must never reach a friend's keychain. |
| Ceremony settings | Discoverable credentials required; user verification `preferred` and not enforced; attestation `none`; no `allowCredentials`; no autofill. | No usernames. Phones and computers verify the user anyway, and requiring it mainly shuts out PIN-less security keys. |
| Adding a passkey yourself | **Not in milestone 2.** A new device signs in with the phone's QR code, or you send an **Add a sign-in method** link. | With attestation `none`, anyone holding a session cookie could register a key with a script. That would turn a stolen cookie into a permanent way in. |
| Cross-site rule | Mutating `/api` requests also refuse `Sec-Fetch-Site: same-site`. | With the RP ID on the parent domain, subdomains count as same-site. |
| Activity | Viewing events show the signed-in person, read from the session. `events.person_id` is set only for account events. | No new viewing data is stored. |
| Admin sign-in | `ADMIN_PASSWORD`, unchanged. A person can never become an admin. | An admin passkey needs its own recovery path. |

## Data model

Four migrations, appended to `MIGRATIONS` in `server/db.js`, take `user_version` from
2 to 6, numbered in the order their slices ship (if slice 4 goes before slice 3, its
migration comes first). Each runs inside `tx()` like the existing ones, and none
backfills anything. Two other changes to `server/db.js`, in slice 1:

- Export `MIGRATIONS` for `test/migration.test.js`.
- Refuse a database written by newer code:

```js
const version = db.prepare('PRAGMA user_version').get().user_version;
// A careless rollback should fail loudly, not treat tickets for one person as tickets for anyone.
if (version > MIGRATIONS.length) {
  throw new Error(`This database was written by a newer Open Matte (schema ${version}; this code knows ${MIGRATIONS.length}). Deploy the newer code, or restore a backup from before the upgrade.`);
}
```

### Migration 3 (slice 1): people, links, passkeys

```sql
-- Someone you've added. The name is how they appear to themselves and in their
-- password manager; it is never used to sign in.
CREATE TABLE people (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,  -- never reused
  name             TEXT NOT NULL,
  note             TEXT,                       -- for the admin only; never sent to a viewer
  webauthn_user_id TEXT NOT NULL UNIQUE,       -- base64url of 32 random bytes: WebAuthn user.id; never changes
  disabled_at      INTEGER,
  created_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX people_name ON people(name COLLATE NOCASE);

-- Single-use, short-lived links that let a person create a passkey. Only the hash
-- is kept: the admin sees the link once, when it is made.
CREATE TABLE person_links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id    INTEGER NOT NULL REFERENCES people(id),
  token_hash   TEXT NOT NULL UNIQUE,           -- sha256 of the token in /enroll#<token>
  purpose      TEXT NOT NULL CHECK (purpose IN ('setup', 'recovery')),
  reset        INTEGER NOT NULL DEFAULT 0 CHECK (reset IN (0, 1)),  -- recovery that removed the old passkeys
  ticket_id    INTEGER REFERENCES tickets(id) ON DELETE SET NULL,   -- open this film afterwards (from slice 2)
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  opened_at    INTEGER,                        -- first opened (perhaps by a link scanner)
  used_at      INTEGER,                        -- a passkey was created with it
  used_device  TEXT,                           -- where, coarse; kept even if that passkey is removed later
  cancelled_at INTEGER                         -- by the admin, by a newer link, or by disabling the person
);
CREATE INDEX person_links_person ON person_links(person_id, created_at);

CREATE TABLE passkeys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id     INTEGER NOT NULL REFERENCES people(id),
  credential_id TEXT NOT NULL UNIQUE,          -- base64url, as the library returns it
  public_key    BLOB NOT NULL,                 -- COSE key, as the library returns it
  sign_count    INTEGER NOT NULL DEFAULT 0,
  device_type   TEXT NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up     INTEGER NOT NULL CHECK (backed_up IN (0, 1)),  -- "Synced" or "This device only"
  transports    TEXT,                          -- JSON array; a hint for excludeCredentials
  aaguid        TEXT,                          -- which provider, when it says; labels come later
  added_device  TEXT,                          -- coarse, e.g. "Safari on iPhone"
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
-- Nothing sets it until slice 2.
ALTER TABLE tickets ADD COLUMN person_id INTEGER REFERENCES people(id);

-- The person an account event is about (sign-ins, passkeys, links, disabling).
-- Viewing events find their person through the session instead.
ALTER TABLE events ADD COLUMN person_id INTEGER REFERENCES people(id);
CREATE INDEX events_person ON events(person_id, at) WHERE person_id IS NOT NULL;
```

### Migration 4 (slice 2): tickets for one person in use

```sql
-- From here on tickets.person_id is set, so code from before slice 2, which ignores it,
-- must refuse this database rather than treat those tickets as tickets for anyone.
CREATE INDEX tickets_person ON tickets(person_id) WHERE person_id IS NOT NULL;
```

Slice 4 shipped before slice 3 (27 October), so films shown to members are migration 5
and keeping is migration 6.

### Migration 5 (slice 4): films shown to members

```sql
ALTER TABLE films ADD COLUMN member_visible INTEGER NOT NULL DEFAULT 0 CHECK (member_visible IN (0, 1));
```

### Migration 6 (slice 3): keeping

```sql
-- Only a ticket for anyone can be keepable; only a ticket with a person can have been kept.
ALTER TABLE tickets ADD COLUMN claimable INTEGER NOT NULL DEFAULT 0
  CHECK (claimable IN (0, 1) AND (claimable = 0 OR person_id IS NULL));
ALTER TABLE tickets ADD COLUMN claimed_at INTEGER
  CHECK (claimed_at IS NULL OR person_id IS NOT NULL);
```

A keep therefore sets `person_id`, `claimed_at` and `claimable = 0` in one UPDATE,
and a release clears `person_id` and `claimed_at` together. Giving a ticket to a person
also clears `claimed_at` (as built, 27 October): only a keep sets it, so "kept from a
link" always means the person kept it themselves.

### Existing rows

Every existing ticket comes out with `person_id` NULL and `claimable` 0, which is
exactly a milestone 1 ticket. Every session is anonymous, every film is hidden from
members, and no event gains a person, so guest history is never rewritten. Every new
column is nullable or has a default that passes its CHECK.

A person can't be deleted while anything refers to them (no `ON DELETE` action), so
their tickets can never quietly become tickets for anyone.

**Not stored:** WebAuthn challenges (kept in memory, below), how often a link was
opened, removed passkeys (deleted; the event keeps the device label), IP addresses and
full user agents (still never stored).

## Access rules

### Invariants (these go into access.md)

1. A **ticket for anyone with the link** (`person_id` NULL): a browser can use it if
   and only if it opened the link (`session_tickets`). Unchanged.
2. A **ticket for one person** (`person_id` set): a browser can use it if and only if
   it is signed in as that person. `session_tickets` rows are ignored for it, which
   matters for tickets that were kept.
3. A session counts as **signed in** only while it is unrevoked and unexpired and its
   person exists and isn't disabled. `sessions.load` checks this on every request,
   playlists and segments included.
4. **Listing never grants playback**: member films now, programmes and collections later.
5. Every **playlist, init segment, media segment, audio and subtitle** request needs
   a ticket this browser may use under 1–3, in the `ok` state, and an open screening
   this browser holds. The last part is unchanged.
6. **Nothing authenticates by name.** People sign in only with a passkey; passkeys are
   created only from a link you made.
7. `ticketStatus` stays a property of the ticket alone. Who may use a ticket is decided
   in one place: the lookups in access.js.

### Two kinds of ticket

| | For anyone with the link | Only for a person, signed in |
|---|---|---|
| You see | "Anyone with the link" (+ "· can be kept") | "Only Sam, signed in" (+ "· kept from a link") |
| Who can use it | Any browser that opened the link | Any browser signed in as that person; they don't need to open the link |
| Opening the link | Adds it to this browser, as before | Signed in as the person: opens the film. Not signed in: a sign-in page, with nothing created or recorded. Signed in as someone else: "This ticket is for someone else" |
| Forwarding the link | Works for whoever gets it | Does nothing |
| Under Your tickets | In that browser only | On every device the person signs in on |
| TVs and in-app browsers | Work | Need a browser that can use passkeys |
| Revoke / restore | Stops on the next request; after a restore, browsers must open the link again | Stops on the next request; after a restore it works for the person at once |
| Person disabled | Not affected | Stops on the next request |
| Limits, start by, days after first play, resume window, one device at a time | The same | The same |

### Who can do what

| Browser | A link ticket it opened | A ticket only for P | A film shown to members, no ticket |
|---|---|---|---|
| Anonymous | page, Play, stream | nothing (the link shows a sign-in page) | nothing |
| Signed in as P | page, Play, stream | page, Play, stream, on every device | page and poster |
| Signed in as Q | page, Play, stream | nothing ("for someone else") | page and poster |
| P disabled | P's sessions are gone, so P is anonymous and can reopen link tickets | nothing | nothing |

### Keeping a ticket

| | Before | After P keeps it | After you choose **Let anyone with the link use it** |
|---|---|---|---|
| `person_id` / `claimable` / `claimed_at` | NULL / 1 / NULL | P / 0 / now | NULL / your choice (default 0) / NULL |
| Browsers that opened the link | hold it | lose it on their next request, and are told "This ticket has been kept in someone's account. Ask whoever sent it." (no name) | hold it again, unless you signed them out or revoked the ticket meanwhile |
| P's devices | only browsers that opened it | every device P signs in on | lose it, unless they opened the link |
| An open screening | where it is | P can take it over at once, same screening and position | the same rule |
| Screenings used, first play, expiry, resume deadline | unchanged throughout | | |

Only a ticket in the `ok` state can be kept, only while no other browser is actively
playing it, and the first keep wins.

### Sessions

| Event | Cookie | Old session | Link tickets in this browser | Screening held here | P's other devices |
|---|---|---|---|---|---|
| Sign in; the browser was anonymous or already P | new | revoked | carried over | carried over | unaffected |
| Sign in; the browser was signed in as Q | new | revoked | not carried over (they were Q's) | free | unaffected |
| Setup or recovery link used | as signing in | | | | Reset after loss already signed them out |
| Sign out | cleared | revoked | forgotten | free | unaffected |
| Sign out everywhere, disable, Reset after loss | all of P's sessions revoked | | forgotten | free | signed out |
| You remove a passkey | the sessions it signed in are revoked | | forgotten | free | others unaffected |

On a shared browser, signing in carries over the link tickets opened there. Keeping one
is still a deliberate act with a confirmation, and you can release it.

### Screenings: what changes

| Situation | Result |
|---|---|
| Signing in while this browser holds a screening | The screening moves to the new session. Sign-in is never offered while the player is open |
| Two of one person's devices | One at a time, with the same takeover rules as two anonymous browsers |
| The holding browser can no longer play | Another device can take over at once (amendment 1) |

### Changes to `server/access.js`

`heldForFilm`, `held` and `heldTickets` go, so nothing outside these functions finds a
viewer's tickets. In their place:

```js
// Tickets this browser may use for a film: link tickets it opened, while they're
// still for anyone, plus tickets in the signed-in person's name. Oldest first, as today.
forFilm: db.prepare(`
  SELECT t.* FROM tickets t
  WHERE t.film_id = :film AND (
    (t.person_id IS NULL AND t.id IN (SELECT ticket_id FROM session_tickets WHERE session_hash = :session))
    OR t.person_id = :person)
  ORDER BY t.id`),
// Every ticket this browser may use, for /api/me (replaces held).
usable: db.prepare(`
  SELECT t.*, st.added_at AS since FROM session_tickets st JOIN tickets t ON t.id = st.ticket_id
  WHERE st.session_hash = :session AND t.person_id IS NULL
  UNION ALL
  SELECT t.*, COALESCE(t.claimed_at, t.created_at) AS since FROM tickets t WHERE t.person_id = :person
  ORDER BY since DESC`),
// The browser holding a screening, if it is still a live, enabled session.
holder: db.prepare(`
  SELECT s.id_hash, s.person_id FROM sessions s LEFT JOIN people p ON p.id = s.person_id
  WHERE s.id_hash = ? AND s.kind = 'viewer' AND s.revoked_at IS NULL AND s.expires_at > ?
    AND (s.person_id IS NULL OR p.disabled_at IS NULL)`),
```

Binding `:person` to NULL returns only link tickets. (Until slice 3, `claimed_at`
doesn't exist; slice 2 orders by `t.created_at`.)

```js
// May this browser use this ticket at all, before the ticket's own state?
function mayHold(viewer, ticket) {
  if (!viewer || !ticket) return false;
  if (ticket.person_id != null) return ticket.person_id === viewer.person_id;
  return Boolean(q.holds.get(viewer.id_hash, ticket.id));
}

// Best state first; then a ticket whose open screening this browser could resume now,
// so Play resumes it (not one another browser is busy playing); then the person's own
// ticket; then the oldest, which is today's order.
const byBest = (viewer, now) => {
  const resumable = ({ ticket, status: s }) =>
    Boolean(s.open) && (s.open.session_hash === viewer.id_hash || s.open.active_until <= now || !holderCanPlay(s.open.session_hash, ticket, now));
  return (a, b) =>
    RANK[a.status.state] - RANK[b.status.state] ||
    resumable(b) - resumable(a) ||
    (b.ticket.person_id != null) - (a.ticket.person_id != null) ||
    a.ticket.id - b.ticket.id;
};
```

- **`filmAccess`** sorts `forFilm` results with `byBest(viewer, now)`. In slice 4: keep
  `!film?.published` first; then, wherever the result would be `NONE` and
  `viewer.person_id != null && film.member_visible`, return
  `{ canView: true, canPlay: false, ticket: null, status: null, via: 'member' }`. A member
  holding a revoked ticket for that film still sees the listing.
- **`mayStream`** loops over the same lookup. `server/routes/media.js` needs no new branch.
- **`startScreening`** stays in `tx(..., { immediate: true })`. `via: 'member'` returns
  `no-ticket`. The takeover check becomes
  `screening.session_hash !== viewer.id_hash && screening.active_until > now && holderCanPlay(screening.session_hash, ticket, now)`:

  ```js
  // Another browser holds the screening. It only blocks a takeover while it could still
  // play it: not once it is signed out, revoked or expired, its person disabled, or the
  // ticket someone else's.
  function holderCanPlay(hash, ticket, now) {
    const h = hash ? q.holder.get(hash, now) : null;
    return Boolean(h) && mayHold(h, ticket);
  }
  ```

  Route handlers are synchronous on one `DatabaseSync` in one process, so
  `sessions.load` and the transaction can't interleave with another request.
- **`heartbeat`** replaces its `q.holds`-only check with `mayHold(viewer, ticket)`.
- **`logEvent`** gains `personId`; only account events pass it.
- **Slice 3** adds `keep(viewer, film, now)` and `setTicketPerson(ticketId, personId | null, { claimable }, now)`,
  the only code that changes a ticket's `person_id` after it is issued. Each is one
  IMMEDIATE transaction:

  ```sql
  -- keep: signed in; a claimable ticket for anyone, held by this browser, in the ok
  -- state, and not being played by another browser that could still play it
  UPDATE tickets SET person_id = ?, claimed_at = ?, claimable = 0
   WHERE id = ? AND person_id IS NULL AND claimable = 1 AND revoked_at IS NULL;  -- 1 row, else 409 cannot-keep
  ```

  `session_tickets` rows are left as they are: invariant 2 ignores them while the
  ticket belongs to a person, they let a browser that lost the ticket be told why, and
  after a release they give it back to the browsers that had opened the link.
- **Exports:** `{ ticketStatus, filmAccess, mayStream, startScreening, heartbeat, usableTickets, canKeep, keep, setTicketPerson, logEvent }`; `mayHold` is used only inside the module.

### Changes to `server/sessions.js`

- `get` joins the person: `SELECT s.*, p.name AS person_name, p.disabled_at AS person_disabled_at, p.id AS person_found FROM sessions s LEFT JOIN people p ON p.id = s.person_id WHERE s.id_hash = ? AND s.kind = ?`.
- **`load`**, after the existing checks: `if (row.person_id != null && (row.person_found == null || row.person_disabled_at)) return null;`.
  Disabling also revokes the sessions; this is the backstop.
- **`signIn(req, { personId, passkeyId }, now)`** runs inside the caller's IMMEDIATE
  transaction (`tx()` can't nest). It re-reads the current session there, because
  verification awaited the library before the transaction began. It inserts a new
  viewer session with `person_id`, `passkey_id` and `signed_in_at`; moves
  `session_tickets` and `screenings` across if the current session is live and
  anonymous or the same person; revokes the current session; and returns
  `{ token, ttl, session }`. The route sets the cookie **after COMMIT**, so a
  rolled-back sign-in never sends one.
- **`signOut(req, res)`**, **`revokePersonSessions(personId, now)`** and
  **`revokePasskeySessions(passkeyId, now)`**; the last two return the count.
- `create` is unchanged. Person sessions keep `kind = 'viewer'` and the `om_session`
  cookie, so the media check, **Sign out every viewer** and `expire-all` cover them.

### Route changes

- **`POST /api/tickets/open`**: unknown, revoked and unpublished tickets fail first, as
  today. Then, for a ticket with a person, in this order: signed in as that person →
  `first_opened_at`, then `{ slug }`, with no `session_tickets` row; this browser opened
  the link before the ticket was kept or given (it has a `session_tickets` row for it) →
  **410 `ticket-kept`**; otherwise no signed-in session → **401 `sign-in-required`**, with
  no session, cookie, `first_opened_at` or event; signed in as someone else → **403
  `ticket-for-someone-else`**. Tickets for anyone are unchanged.
- **`GET /api/me`** is built from `usableTickets`, best per film as now, and adds
  `person: { name } | null` and (slice 4) `memberFilms`. When the browser also has the
  admin cookie, the site shows "Admin preview: person rules don't apply in this browser".
- **`GET /api/films/:slug`** sets `first_opened_at` on the first page load through a
  ticket, adds `ticket.inAccount` and (slice 3) `canKeep`, and `via` can be `'member'`.
  Where it would answer 404 for a published film, a browser with a `session_tickets` row
  for an unrevoked ticket for that film that now has a person gets 410 `ticket-kept`
  instead.
- **Screenings** maps `no-ticket` to 409. **`media.js`** changes only its log wording.
- **`admin.js`**: `adminTicket` adds `person`, `claimable` and `claimedAt`; issuing and
  listing accept `personId`, `claimable`, `?person=` and `?kind=anyone|person`; Activity
  joins `people` on `COALESCE(e.person_id, s.person_id)` and accepts `?person=`. For a
  ticket with a person, `browsers` is 0, and the rows left in `session_tickets` are
  reported separately as `waitingBrowsers`, listed as "Opened the link before it was kept:
  they get it back if you release it". **Sign out browsers** still deletes those rows, so
  a release then gives the ticket to nobody until the link is opened again; for a
  person's ticket the page also offers that person's **Sign out everywhere**. Revoking
  deletes the rows as today, so after a restore and a release the link must be opened
  again.

## Passkeys

### The library

`@simplewebauthn/server@14.0.3` (pinned, no caret) in `dependencies`;
`@simplewebauthn/browser@14.0.0` in `devDependencies`, bundled by Vite. Wrapped in
`server/webauthn.js`, so routes never call the library directly:

```js
const ALGS = [-7, -8, -257]; // ES256, EdDSA, RS256. v14 would put ML-DSA first.

registrationOptions(rp, person, existing) → generateRegistrationOptions({
  rpName: settings.get().cinemaName, rpID: rp.id,
  userID: Buffer.from(person.webauthn_user_id, 'base64url'),
  userName: person.name, userDisplayName: person.name,
  timeout: 300_000, attestationType: 'none', supportedAlgorithmIDs: ALGS,
  excludeCredentials: existing.map((k) => ({ id: k.credential_id, transports: JSON.parse(k.transports || '[]') })),
  // A fresh object every call: the library mutates it.
  authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
})

signInOptions(rp) → generateAuthenticationOptions({ rpID: rp.id, timeout: 300_000, userVerification: 'preferred' })

// The library takes one origin string (or a list). rp.originFor() returns the response's
// own origin when it is allowed, and null otherwise (then we refuse before calling it).
verifyRegistration(rp, response, challenge) → verifyRegistrationResponse({
  response, expectedChallenge: challenge, expectedOrigin: rp.originFor(clientOrigin), expectedRPID: rp.id,
  requireUserVerification: false, supportedAlgorithmIDs: ALGS })

// counter: 0, so the library never refuses a counter; see below.
verifySignIn(rp, response, challenge, passkey) → verifyAuthenticationResponse({
  response, expectedChallenge: challenge, expectedOrigin: rp.originFor(clientOrigin), expectedRPID: rp.id,
  requireUserVerification: false,
  credential: { id: passkey.credential_id, publicKey: passkey.public_key, counter: 0, transports } })
```

Two checks of our own, before calling the library: `clientDataJSON.crossOrigin` must
not be true (the library only checks it when the browser sends `topOrigin`, and Safari
doesn't), and the response must parse at all. A thrown error and `verified: false` both
count as failure: the library returns the latter for some bad signatures.

After a registration, two more: a credential id over 1023 bytes is refused, as the
standard says (the library doesn't check), and of the transports the browser sent,
only the names the standard gives are kept. The same filter applies when stored
transports go back out in `excludeCredentials`.

After a sign-in's signature checks out, `verifySignIn` checks the counter itself, so a
refusal is known to be about the counter and never comes from a forged response. On a
device-bound key a counter that doesn't move on from the stored one is refused; synced
passkeys report 0 and pass.

Verification is asynchronous, so it runs **before** the IMMEDIATE transaction, and the
transaction then re-checks everything that could have changed in between.

### Relying party

- `server/config.js`: `webauthnRpId: env.WEBAUTHN_RP_ID || ''`, the only new variable.
- `relyingParty({ publicUrl, rpId, production })` in `server/webauthn.js` is a pure
  function, unit-tested, returning `{ id, originFor(origin), problem }`:
  - **Development and tests** (not `NODE_ENV=production`, and no `PUBLIC_URL` or one on
    `localhost`): `id = 'localhost'`, and `originFor` accepts
    `/^http:\/\/localhost(:\d{1,5})?$/`, which covers `npm run dev`, Vite and any test
    port. `127.0.0.1` is not a valid RP ID; the README says to use localhost.
  - **Production without `PUBLIC_URL`**: `problem` = "PUBLIC_URL is not set".
  - **Otherwise** `originFor` accepts only `new URL(PUBLIC_URL).origin`. `problem` is set
    when `WEBAUTHN_RP_ID` is unset, so the host is never chosen silently; when the ID is
    an IP, has a port or scheme, isn't lowercase or has no dot; when the host is neither
    the ID nor ends with `'.' + id`; or when the origin isn't https.
- When `problem` is set, passkey endpoints and link creation answer 503
  `passkeys-unavailable`, People and Settings show a banner, and the startup log says
  why. Link tickets are unaffected, and the site always starts.
- At startup, log `Passkeys: RP ID openmatte.dev, origin https://www.openmatte.dev`.
- `deploy/compose.yml` passes `WEBAUTHN_RP_ID: ${WEBAUTHN_RP_ID:-}`. `deploy/.env.example`
  gets `WEBAUTHN_RP_ID=` with "Decide before inviting anyone: every passkey is tied to it
  for good." This deployment sets `openmatte.dev`.
- **Never change after anyone enrols:** the RP ID and `people.webauthn_user_id`. Free to
  change: the cinema name and people's names.

### Challenges (`server/ceremonies.js`, in memory)

Entries last 5 minutes and are taken once, whatever the outcome. Two separate pools, so
one can't push the other out:

- **Sign-in:** at most 500 entries. When full, new sign-in attempts get 429 `busy`;
  nothing is evicted early.
- **Setup and recovery:** keyed by link, at most 3 live entries per link; a fourth
  replaces that link's oldest. Only a valid, unexpired token can create one, so strangers
  can't fill it.

Finish handlers read the challenge out of `clientDataJSON`, take the entry, and check
its binding (purpose, and the link for setup). A restart loses ceremonies in progress;
the page fetches new options and asks for another tap. If the app ever runs as several
processes, the store moves to a table.

`server/ratelimit.js` keys IPv6 clients on their /64 (IPv4 on the full address,
IPv4-mapped IPv6 as IPv4) and caps the size of its map; when the map is full it drops
the entry whose window ends soonest, and never refuses a client because the map is
full. www.openmatte.dev has no AAAA record, so today every client arrives over IPv4. If
one is ever added, give the compose network IPv6 first (`enable_ipv6`): otherwise
Docker's proxy hands Caddy every IPv6 visitor as the bridge gateway's address, and they
all share one bucket.

### Setup and recovery links

**Creating one** (admin; one IMMEDIATE transaction):

1. The person must be enabled, and passkeys available.
2. Cancel the person's other unused links.
3. **Reset after loss** only: revoke all the person's sessions, then delete their
   passkeys (`sessions.passkey_id` becomes NULL).
4. `purpose` is `recovery` if the person has ever created a passkey (one of their links
   has `used_at` set), otherwise `setup`; removing someone's last passkey doesn't turn the
   next link back into a setup link. A recovery link requires `confirmedContact: true`
   (the tick box below); without it, 400 `confirm-contact`.
5. Lifetime: setup 1, 24, 72 or 168 hours (default 72); recovery 1 or 24 hours
   (default 1).
6. Store `sha256(token)` of a 32-byte random token, and the optional `ticket_id`, which
   must be a ticket for this person (slice 2 onward; 400 before).
7. Log `link-created { purpose, reset, hours, passkeysRemoved, browsersSignedOut }`.
8. Return `{ link: `${origin}/enroll#${token}`, expiresAt, purpose }`, **once**. `origin`
   is the one ticket links use: `PUBLIC_URL`, or the request's own host in development.

**Opening it**: `/enroll` is a page of the app; the token is in the fragment, so it
never reaches the server or a link-preview fetcher. The page checks passkey support
first (see `<PasskeySignIn>` under Screens). In an in-app or unsupported browser it calls
nothing, leaves the address as it is and shows "Open this in Safari or Chrome" with
**Copy link**. Otherwise it reads the token once (a ref, as in TicketOpen, so
StrictMode's second run doesn't see an empty fragment), keeps it in `sessionStorage` for
this tab, clears the fragment with React Router's `navigate({ hash: '' }, { replace: true })`,
and sends it to `POST /api/enroll/options`, which sets `opened_at` and uses nothing up. A
reload in the same tab carries on from `sessionStorage`; that copy is removed once the
link is used or answers 404 or 410, once the page says this device already has a
passkey, and when the browser signs out. `/enroll` with no token says "Open the link you were
sent again: it works until a passkey has been created with it." Passkey support doesn't
need a platform authenticator: a computer without one creates the passkey on a phone
(QR code) or a security key.

**Finishing** (`POST /api/enroll/finish`):

1. Look up the link (404 / 410 as below), take the ceremony and check that it belongs to
   this link (400 `ceremony-expired`).
2. `await verifyRegistration(...)`; on failure 400 `passkey-invalid`, with the reason in
   the server log only.
3. One IMMEDIATE transaction: `UPDATE person_links SET used_at = ? WHERE id = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?`
   must change one row, otherwise 410 `link-used`, `link-expired` or `link-cancelled`;
   insert the passkey (a UNIQUE clash rolls everything back: 409 `passkey-exists`, link
   unused); `sessions.signIn`; log `passkey-added { via, device }`.
4. After COMMIT, set the cookie and return `{ person: { name }, slug }`.

Two browsers finishing one link: the first wins and the second gets `link-used`: "This
link has already been used. If that wasn't you, tell whoever sent it straight away."

What protects a link is that it is secret, single-use and short-lived. Anyone holding
the token could register a key with a script, without a device. A link scanner won't,
but it may open the page, so "opened" doesn't prove the person opened it.

### Signing in (`POST /api/signin/finish`)

1. Take the `signin` ceremony (400 `ceremony-expired`); refuse `crossOrigin`.
2. Find the passkey by credential id (401 `passkey-unknown`; unknown credentials aren't
   logged).
3. `await verifySignIn(...)`; on failure 401 `sign-in-failed`, and a counter that went
   backwards logs `sign-in-refused { reason: 'counter' }`.
4. `userHandle` must equal the person's `webauthn_user_id` (401 `sign-in-failed`).
5. One IMMEDIATE transaction: re-read the passkey (gone: 401 `passkey-unknown`); a
   disabled person gets 403 `account-disabled` and `sign-in-refused { reason: 'disabled' }`,
   only ever after a valid signature; `UPDATE passkeys SET sign_count = ?, backed_up = ?, last_used_at = ? WHERE id = ? AND sign_count = ?`
   must change one row (409 `try-again` if another sign-in got there first); collect the
   person's other passkeys created after this passkey was last used (its `last_used_at`
   as read before the UPDATE, or its `created_at` if it has never signed in):
   `SELECT created_at AS addedAt, added_device AS device FROM passkeys WHERE person_id = ? AND id <> ? AND created_at > ?`.
   Only someone holding this passkey can move that point, so a passkey added from an
   intercepted link, even one then used to sign in elsewhere, is still reported. (Anchoring
   on the person's latest sign-in wouldn't work: finishing a link also signs in.) Then
   `sessions.signIn`; log `signed-in { device }`. Refusals return from the transaction
   rather than throwing, so their events are kept.
6. After COMMIT, set the cookie and return `{ person: { name }, newPasskeys: [{ addedAt, device }] }`.
   The page shows each new passkey once per passkey that signs in: "A passkey was added on
   Tue 29 Oct from Chrome on Windows. Not you? Tell whoever runs {cinemaName}."

### Endpoints

Everything that changes something is a POST with a JSON body, so it passes `app.js`'s
JSON-only rule and the tightened `Sec-Fetch-Site` check. Rate limits are per client as
described above, and injectable for tests.

**Viewer** (new `server/routes/account.js`, plus `viewer.js`)

| Method | Path | Needs | Body | Success | Errors | Limit | Slice |
|---|---|---|---|---|---|---|---|
| POST | /api/enroll/options | link token | `{token}` | `{person:{name}, purpose, reset, expiresAt, film\|null, options}` | 404 `link-unknown`; 410 `link-used`/`-expired`/`-cancelled`; 503 | 20 / 15 min, shared with finish | 1 |
| POST | /api/enroll/finish | token + ceremony | `{token, credential}` | `{person:{name}, slug\|null}`, new cookie | 400 `ceremony-expired`/`passkey-invalid`; 409 `passkey-exists`; 410 | shared with options | 1 |
| POST | /api/signin/options | – | `{}` | `{options}` | 429 `busy`; 503 | 60 / 10 min | 1 |
| POST | /api/signin/finish | ceremony | `{credential}` | `{person:{name}, newPasskeys}`, new cookie | 400; 401 `passkey-unknown`/`sign-in-failed`; 403 `account-disabled`; 409 `try-again`; 503 | 30 / 10 min | 1 |
| POST | /api/signout | a viewer session | `{}` | `{ok}`, cookie cleared | – | – | 1 |
| GET | /api/me | – | – | adds `person`, `ticket.inAccount`, `memberFilms` | – | – | 1/2/4 |
| POST | /api/tickets/open | (changed) | `{code}` | `{slug}` | 401 `sign-in-required`; 403 `ticket-for-someone-else`; 410 `ticket-kept` | 30 / 10 min | 2/3 |
| POST | /api/films/:slug/keep | a person's session | `{}` | `{ticket}` | 401; 409 `cannot-keep`/`playing-elsewhere` | 30 / 10 min | 3 |
| GET | /api/account | a person's session | – | `{person:{name}, passkeys:[{synced, addedAt, addedFrom, viaLink, lastUsedAt}], browsers:[{device, signedInAt, lastSeenAt, current}]}` | 401 | – | 5 |
| POST | /api/account/sign-out-everywhere | a person's session | `{}` | `{signedOut}`, cookie cleared | – | – | 5 |

**Admin** (new `server/routes/people.js`, mounted inside `adminRoutes` after its guard)

| Method | Path | Body | Result | Slice |
|---|---|---|---|---|
| GET | /api/admin/people | – | `[{id, name, disabled, passkeys, tickets, lastSignedInAt, linkWaiting}]` | 1 |
| POST | /api/admin/people | `{name, note}` | 201 person; 409 `name-taken` | 1 |
| GET | /api/admin/people/:id | – | person, passkeys, browsers, links (never the token) | 1 |
| PATCH | /api/admin/people/:id | `{name?, note?}` | person | 1 |
| POST | /api/admin/people/:id/links | `{hours, reset, confirmedContact?, ticketId?}` | 201 `{link, expiresAt, purpose}`, only here, once; 400 `confirm-contact`; 400 `bad-hours`; 400 `bad-ticket` (not this person's ticket, or revoked); 409 `person-disabled`; 503 `passkeys-unavailable` | 1 |
| POST | /api/admin/people/:id/links/cancel | `{}` | person | 1 |
| POST | /api/admin/people/:id/sign-out | `{}` | `{signedOut}` | 1 |
| POST | /api/admin/people/:id/disable, /enable | `{}` | person (disable also revokes sessions and cancels links) | 1 |
| POST | /api/admin/passkeys/:id/remove | `{}` | `{signedOut}`: revokes the sessions it signed in, then deletes it, in that order (deleting first would set their `passkey_id` to NULL, leaving nothing to revoke) | 1 |
| GET | /api/admin/settings | – | adds `passkeys: {rpId, origin, problem}` for the People and Settings banners | 1 |
| POST | /api/admin/tickets | adds `personId` (an enabled person; `count` must be 1) and `claimable` | | 2/3 |
| PATCH | /api/admin/tickets/:id | adds `claimable` (tickets for anyone only) | | 3 |
| POST | /api/admin/tickets/:id/holder | `{personId \| null, claimable?}` | assign or release | 3 |
| PATCH | /api/admin/films/:id | adds `memberVisible` | | 4 |
| GET | /api/admin/tickets, /activity | add `?person=` (tickets also `?kind=`) | | 1/2 |

## Screens

### Viewer (`web/src`)

- **Routes:** `/signin`, `/enroll` and (slice 5) `/account`. Add `account` to
  `RESERVED_SLUGS` in `server/scan.js`; `signin` and `enroll` are already there.
- **`<PasskeySignIn>`**: one component for SignIn, TicketOpen and the keep panel. It shows
  **Sign in with a passkey**, or, where passkeys can't work, "Open this in Safari or
  Chrome" with **Copy link**. "Can't work" means no `PublicKeyCredential`, or a known
  in-app browser by user agent (`FBAN|FBAV|Instagram|LinkedInApp|Line/|Snapchat|TikTok|musical_ly|GSA/|MicroMessenger|; wv)`,
  best effort): their web views often expose the API and then fail. Any other browser
  that refuses a passkey gets the same advice and Copy link under its message, since an
  unlisted app browser refuses just as a cancelled attempt does. It fetches options
  before the tap and calls the browser inside the click handler, as Safari requires.
  Options are fetched again after `ceremony-expired`, after 4½ minutes, and when the page
  becomes visible with options more than 4 minutes old, since challenges last 5. Errors:
  `NotAllowedError` "Cancelled or timed out. Try again."; `SecurityError` "This address
  can't use passkeys" (also logged: the RP ID is wrong); `ceremony-expired` "That took a
  little too long. Try again." Enroll uses the same detection, timing and copy; after a
  refusal its Copy link rebuilds the whole link from the token it kept, since the
  fragment has already left the address.
- **Header:** signed in, **Sam ▾** with Your tickets · Your account (slice 5) · Sign out.
  Anonymous, a quiet **Sign in** link from slice 2. Signing out confirms when the browser
  holds link tickets that aren't in the account: "Sign out of this browser? It also
  forgets 1 ticket you opened from a link here (Arrival). The link still works if you
  open it again."
- **Sign in:** one button. The browser offers "Use a phone or tablet" (the QR code)
  itself. No account: "Accounts here are set up by whoever runs {cinemaName}. You don't
  need one to watch: open the ticket link you were sent." No passkey found: "If your
  passkey is on another phone or computer, choose 'Use a phone or tablet'. Lost it? Ask
  whoever runs {cinemaName}." After signing in it goes to `?next=` only when that matches
  `^/(?!/|\\)` (one leading slash, not `//` or `/\`), using React Router; otherwise to `/`.
- **Enroll:** "Welcome, Sam" (setup) or "Welcome back, Sam" (recovery). "Create a passkey
  to sign in to {cinemaName}. Your phone or computer keeps it and unlocks it with Face ID,
  a fingerprint or your screen lock. No password, no email address." Then **Create a
  passkey**, and "This link works once, until Tue 29 Oct, 21:00. Not Sam? Stop here and let
  whoever sent it know." After a reset, before the button: "Before you continue: if your
  old phone or computer was lost or stolen, remove it from your Apple ID, Google account or
  password manager first. A new passkey would otherwise reach it too." If the browser says
  this device already has one of Sam's passkeys (`ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED`
  from `@simplewebauthn/browser`), the page says "This phone or computer already has your
  passkey, so you don't need this link: sign in instead", with **Sign in**; the link stays
  unused.
- **TicketOpen**, for a ticket for one person: "This ticket is for one person, and works
  once they sign in with their passkey", then `<PasskeySignIn>`, which opens the ticket
  again and goes to the film. Signed in as someone else: "This ticket is for someone else.
  You're signed in as Alex", with **Sign out**. Kept: "This ticket has been kept in
  someone's account. Ask whoever sent it."
- **Film panel:** a ticket in the account adds "This ticket is in your account, so it's on
  every device you sign in on." Keepable and not signed in: "Keep this ticket in your
  account? **Sign in and keep it**. You don't need an account to watch: just press Play."
  Keepable and signed in: **Keep it**, confirming "Keeping this ticket links it to your
  account. Other browsers that opened the link will lose it, and the link will only work
  for you." Neither is offered while the player is open. Member film: "Showing to members.
  You don't have a ticket for this one. If you'd like to see it, ask whoever runs
  {cinemaName}." No Play button. The privacy line adds "…and, because you're signed in,
  that it was you".
- **Home:** Your tickets combines account and link tickets, best per film, open screenings
  first; link tickets add "on this device only" when signed in. Showing to members (slice
  4), marked "No ticket yet". Signed in with nothing: "No tickets yet. When someone sends
  you one, it'll be here."
- **Account** (slice 5): name; passkeys (Synced or This device only, added when and from
  where, from which link, last used); browsers signed in (device, signed in, last seen,
  "this browser"); **Sign out** and **Sign out everywhere** ("Every browser signed in as
  you is signed out, this one included, and playback stops on them. Your passkeys still
  work."). Removing or adding passkeys is something to ask you for.

### Admin (`web/src/admin`)

- **Navigation:** Films · Tickets · **People** · Activity · Settings.
- **People:** "People who can sign in here with a passkey. Nobody can sign up on their
  own: you add someone, then send them a setup link. Tickets for anyone with the link
  don't need any of this." **Add a person**: Name ("They'll see it, and their password
  manager stores it") and Note ("Only you see this"). The list shows passkeys ("None
  yet"), tickets, last signed in, and Active / Setup link waiting / Disabled. A banner when
  passkeys are unavailable.
- **Person page:** **Create a setup link** (never set up) or **Help Sam sign in again**;
  **Issue a ticket for Sam**; **Sign out everywhere**; **Disable** / **Enable**; edit name
  and note.
  - The **copy-once box** appears only in the response to creating a link: "Setup link
    for Sam: works once, until …", **Copy link**, **Copy message**, and "You won't see this
    link again. If it goes astray, create a new one: this one then stops working."
    Afterwards: "A setup link is waiting: created 2 h ago, opened 1 h ago (perhaps a link
    scanner), works until … **Cancel it**". A used link shows where it was used,
    prominently: "Used Tue 21:04 from Chrome on Windows".
  - **Help Sam sign in again:** first a required tick, "I'm replying on a contact I
    already know is Sam's: not a new number or account", with "If someone says they've lost
    their phone, a quick call is the surest check." Then **Works for** (1 hour / 1 day) and
    two choices. **Add a sign-in method**: "Sam's 2 passkeys keep working: for a new
    device." **Reset after loss**: "Removes Sam's 2 passkeys and signs Sam out of 3
    browsers now, before the link is used. If the device was stolen, ask Sam to remove it
    from their Apple ID, Google account or password manager first, or change that
    password: a passkey saved there reaches every device still signed in to it."
  - **Passkeys** (Synced or This device only, added when, from where and from which link,
    last used, **Remove**: "It stops working straight away, and the 2 browsers it signed in
    are signed out."), **Signed in on**, **Tickets**, **Activity**.
  - **Disable** confirms: "Sam is signed out everywhere and can't sign in, and tickets only
    for Sam stop working from the next request. Tickets for anyone with the link aren't
    affected. Disabling doesn't remove passkeys: for a lost or stolen device, use Reset
    after loss."
- **Issuing a ticket:** the first field is **Who can use it?**
  - (•) **Anyone with the link**: "Like a paper ticket: whoever has the link can use it,
    on any device, TVs included. The name is only a note for you." From slice 3, a
    **Let them keep it in their account** box: "Whoever keeps it first takes it from
    everyone else with the link."
  - ( ) **Only a person, signed in** [choose ▾]: "The link only works for that person,
    signed in with their passkey. Forwarding it does nothing. TV browsers usually can't
    sign in." Disabled people aren't listed; with no people the choice is disabled ("Add
    people under People first"). How many tickets is hidden.
  - The button says which: "Issue ticket for anyone with the link" or "Issue ticket for Sam
    only". If Sam has no passkey yet, the result offers **Create a setup link that opens
    Arrival**, with the message "You should watch Arrival. Here's your ticket; you'll sign in
    with your passkey: {link}".
- **Tickets list and ticket page:** a second line under For ("Anyone with the link", "· can
  be kept", "Only Sam, signed in", "Only Sam · kept from a link"); a filter (All · Anyone with
  the link · For a person ▾); a "Person disabled" badge. From slice 3, **Let anyone with the
  link use it** and **Give it to a person…**.
- **Film page** (slice 4): **Show to members**: "Signed-in members see it on their front
  page and can read its page. Watching still needs a ticket." A Members badge in the list.
- **Activity:** a **Who** column (the person, linked, otherwise the ticket label) and the new
  events: signed in, signed out, passkey added or removed, setup link created, cancelled or
  used, person disabled or enabled, ticket kept, given or released, sign-in refused.
- **Settings:** a **People and passkeys** card: "Passkeys here belong to openmatte.dev. If the
  site ever moves to another domain, everyone will need a new passkey." The Sessions card
  says "Sign out every viewer and member. Tickets keep working: people open their link or
  sign in again."

## Build slices

Slices 1 to 4 each append their own migration (never editing a shipped one), so code
from an earlier slice refuses the database; slices 5 and 6 add none. Every slice leaves
the 82 milestone 1 tests passing **unmodified**, updates access.md and roadmap.md, passes
`npm test` under Node 24 (the container's version) as well as locally, and is deployed
after **Back up now**.

### Slice 1: passkeys work (grants nothing yet)

- **Scope:** migration 3, the newer-database guard; `WEBAUTHN_RP_ID` and
  `relyingParty()`; `server/webauthn.js`, `ceremonies.js`, `people.js`; the sessions.js
  changes; `holderCanPlay` (signing out exists from now on); `routes/account.js` (enroll,
  sign in, sign out) and `routes/people.js`; `/api/me` `person`; the same-site refusal;
  /64 rate limiting; the Activity person join; `account` reserved. Web: `<PasskeySignIn>`,
  Sign in, Enroll, the signed-in header (no public Sign in link yet), People, Person page,
  the Settings card, the Activity Who column, the admin-preview banner.
- **Acceptance**, on www.openmatte.dev with you as the first person:
  1. Back up now; set `WEBAUTHN_RP_ID=openmatte.dev`; deploy. The startup log and Settings
     name openmatte.dev.
  2. Add "Arthur"; create a setup link. After a reload the page only says a link is
     waiting.
  3. Open it on the iPhone; create a passkey; "You're in". The same link elsewhere says
     it's been used.
  4. In a browser with no admin cookie on the Mac, go to `/signin` and sign in with the
     synced passkey. The admin shows one Synced passkey and two browsers.
  5. Sign out everywhere: both browsers are anonymous on their next request.
  6. Help Arthur sign in again → Reset after loss: the passkey is gone, and signing in
     with it fails. The recovery link works.
  7. A browser holding a link ticket with an open screening signs in: the ticket and the
     screening carry over, and media stays at 200.
- **Tests:** `test/webauthn.test.js` (the wrapper: ES256, EdDSA and RS256 each register
  and sign in twice; wrong challenge, origin, type, RP ID, missing UP flag, bad signature,
  counter going backwards, `crossOrigin: true` and a replayed challenge are refused;
  against the production relying party (origin `https://www.openmatte.dev`, ID
  `openmatte.dev`), responses carrying the right rpIdHash from `https://openmatte.dev`,
  `https://x.openmatte.dev` and `http://www.openmatte.dev` are refused; `relyingParty()`
  sets `problem` for production without `PUBLIC_URL` or without `WEBAUTHN_RP_ID`, an IP,
  a port, upper case, no dot, an http origin, and the host `evilopenmatte.dev` with the ID
  `openmatte.dev`, and not for `https://www.openmatte.dev` with `openmatte.dev`; in
  development `http://localhost:5173` and `http://localhost:41234` are accepted and
  `http://127.0.0.1:5173` and `http://localhost.evil.dev` refused). `test/migration.test.js` (a milestone 1 database with a ticket,
  session, screening and events migrates; rows as described; `foreign_key_check` empty;
  that browser still streams; a newer database refuses to open; an id deleted with foreign
  keys off isn't reused). `test/people.test.js` (duplicate names; the link only in the
  create response and never in any table; options don't use a link up and finish does;
  reused, expired, cancelled and replaced links; two finishes at once give 200 and 410
  with one passkey stored; duplicate credential; recovery without `confirmedContact`;
  recovery lifetimes over a day refused; after you remove a person's only passkey, the
  next link is still a recovery link; sign-in rotation, carry-over and not carrying over
  from another person; sign out; removing a passkey signs out only its sessions; disable;
  Reset versus Add; a valid assertion carrying another person's `userHandle` gives 401;
  `newPasskeys`, including a passkey added from a link someone else finished and then used
  to sign in, which is still reported at the owner's next sign-in with their own passkey;
  2,000 sign-in options from 2,000 different IPv6 /64s don't break a setup in progress;
  takeover after the holder signs out).
  Boundaries: cross-site and same-site POSTs refused; a person's cookie in `om_admin` gets
  401; `/api/me` exposes no user handles, credential ids or other people.
- **Docs:** access.md (people and passkeys, links, sign-in records, secrets, and the
  Screenings takeover row); deploying.md (`WEBAUTHN_RP_ID` and why it's permanent;
  restoring a backup brings back removed passkeys and sessions, so check People
  afterwards; never delete people or passkeys by hand; testing from home; tagging,
  backing up and copying the backup off the server before each slice; Rolling back, as
  in this plan; IPv6 and the compose network); README (localhost, not 127.0.0.1);
  `.env.example`, `deploy/.env.example`, `deploy/compose.yml`.
- **Deploy:** set the RP ID **before** creating the first link. Check no media folder is
  called `account`. Rolling back to milestone 1 code is still possible here without a
  restore, because nothing yet sets `tickets.person_id`.

### Slice 2: tickets for one person, Your tickets

- **Scope:** migration 4; the access.js changes above; the person branch of `/api/tickets/open`;
  `first_opened_at` on page load; `inAccount`; setup links that carry a ticket. Web:
  TicketOpen states, Home with account tickets, the public Sign in link, the **Who can use
  it?** choice, the ticket list and page changes, the person's tickets.
- **Acceptance:** issue a ticket "for Sam only", and the form, button, list and page all
  say so. A private window gets the sign-in page, no cookie, and every playback file 403.
  Signed in as Sam, Play works, and Sam's other device lists the ticket without opening
  the link. Signed in as Alex: "for someone else". Disable Sam: the next segment is 403;
  enable and sign in, and the same screening resumes. Revoke → 403; restore → Sam sees it
  at once. Issuing for someone without a passkey offers a setup link that opens the film.
  The milestone 1 journey still passes.
- **Tests** (`test/identity.test.js`): issuing needs an enabled person and `count` 1; the
  anonymous open creates nothing; signed in as someone else, refused everywhere; signed in
  as the person, everything works; a `session_tickets` row inserted by hand for a person's
  ticket grants nothing; disable mid-stream; two of the person's devices, one at a time; a
  limit of one with two Plays at once gives 200 and 409; revoke and restore; a setup link
  carrying a ticket returns the slug; a browser holding a link ticket and the person's
  ticket for the same film resumes the open screening; a browser holding a link ticket
  that another browser is playing, and the person's own ticket for the same film, plays
  the person's ticket; with people present, a link
  ticket behaves exactly as before; a ticket for film A unlocks nothing of film B.
- **Deploy:** from here on, **rolling back needs a restore** (see Deploying and rolling
  back).

### Slice 3: keeping a ticket

- **Scope:** migration 6; `keep` and `setTicketPerson`; `POST /api/films/:slug/keep`;
  `canKeep`; the "Let them keep it" box when issuing and editing; release and give; the
  keep panel, including Sign in and keep it; `ticket-kept` answers; the kept, given and
  released events; `usable` ordering by `COALESCE(claimed_at, created_at)`.
- **Acceptance:** a keepable ticket opened in two anonymous browsers, playing in one. While
  it plays, the other can't keep it (`playing-elsewhere`). After a pause it keeps it as Sam;
  the first browser is told the ticket was kept; Sam's third device lists it; screenings
  used, first play, expiry and the resume deadline are unchanged. A ticket without the box
  never offers keeping; an expired one can't be kept. Two keeps at once: one wins. Release:
  the browsers that had opened the link can use it again.
- **Tests** (`test/keep.test.js`): needs a sign-in, a keepable ticket held by this browser
  in the `ok` state, and no other browser actively playing it; the row after keeping, and
  other browsers refused at once with `ticket-kept`; the keeper resumes the same screening;
  two keeps in parallel; limits and clocks unchanged; release with and without the box;
  give to a person; the CHECK constraints; a friend with no account still plays a keepable
  ticket.

### Slice 4: films shown to members

- **Scope:** migration 5; `via: 'member'`; `no-ticket`; `memberFilms`; the Home shelf and
  member panel; the film toggle and badge. Independent of slices 2 and 3, so it can move.
- **Acceptance:** show Arrival to members. Anonymous: the front page is unchanged and
  `/arrival` says nothing is showing. Signed in as Sam: the film is listed and its page says
  to ask for a ticket; Play gives 409 and playlists 403, while the poster loads. Issue Sam a
  ticket and it moves to Your tickets and plays. Unpublish, or disable Sam, and it's gone.
- **Tests** (`test/members.test.js`): the steps above, including a member holding a revoked
  ticket for that film still seeing the listing.

### Slice 5: account page

- **Scope:** `GET /api/account`, **Sign out everywhere** for the person, the Account page
  and menu entry.
- **Tests** (`test/account.test.js`): the page lists the person's passkeys and browsers
  only; Sign out everywhere revokes every one of the person's sessions and clears this
  browser's cookie.

### Slice 6: device checks and close-out

- Setup, sign-in and playback of tickets for one person on: iPhone Safari, Mac Safari,
  Chrome on Mac and Windows (including QR sign-in), Android Chrome, desktop Firefox, one
  password-manager provider and one security key; in-app browsers (WhatsApp, Instagram,
  Messenger), for the Copy link path; a smart-TV browser (link tickets only); AirPlay and
  Chromecast from a signed-in phone. If receivers fetch media without the phone's cookie,
  screening-bound media addresses become separate work rather than a looser check.
- These fold in milestone 1's open device checks (Android, desktop Firefox, a non-HDR
  screen, keyboard only).
- Record the results in roadmap.md, do a last pass over access.md and the README, and
  decide on the bare-domain redirect in `deploy/Caddyfile` (with the RP ID on openmatte.dev
  it costs passkeys nothing).

## Testing

- **A software authenticator** in `test/softauth.js` produces what a browser and passkey
  provider would send, with every field overridable for negative tests (see the appendix).
  The library verifies it like any other response.
- **Helpers** in `test/helpers.js`: `newPerson`, `setupLink`, `enroll`, `signIn`, with
  every test signing in through the software authenticator (there's no fast path); and
  `playbackFiles`, a copy of the journey's playback file list, so milestone 2's tests
  leave `journey.test.js` as it was.
- **Rate limits** are passed in through `createApp({ limits })`, generous in
  `startServer`, with one test asserting the 429. Otherwise suites that enrol and sign in
  dozens of times from 127.0.0.1 would fail for the wrong reason.
- **No admin cookie** in identity and keep tests: the admin's preview bypasses every
  person rule, so a pass there would prove nothing. The same goes for checks done by hand.
- **Node 24:** run `npm test` in `node:24-slim` before each deploy, since the container's
  SQLite differs from the one in local Node 26. Before slice 1 goes out, also open a copy
  of the latest production backup with the new code and check `foreign_key_check` and row
  counts.

## Deploying and rolling back

- **From home:** your gateway sinkholes openmatte.dev, and passkeys need the real
  hostname, so `curl --resolve` doesn't help a browser. For each check either put the
  device on the phone's hotspot, allow openmatte.dev on the gateway for the session, or add
  `65.21.54.126 www.openmatte.dev` to the computer's hosts file (the certificate stays
  valid). The TV needs the gateway exception or the hotspot.
- **Before each slice:** tag the commit, press **Back up now**, note the file name, and
  copy that file off the server (`scp vps:/srv/open-matte/backups/<file> .`): Back up now
  writes to the same disk, and the off-server copy runs only once a day.
- **Rolling back:** once the newer-database guard is deployed, older code refuses a newer
  database, so the backup must be in place before the older code starts.
  1. `cd /srv/open-matte/app/deploy && docker compose stop app`.
  2. Copy the backup taken before the upgrade over `/srv/open-matte/data/open-matte.db`
     and delete the `-wal` and `-shm` files, as in the restore steps, but **don't** run
     their final `docker compose start app`: that would start the newer code, which would
     migrate the restored database straight back.
  3. Locally, `git checkout <previous tag>` and `scripts/deploy.sh vps`, whose
     `docker compose up -d --build` builds and starts the older code.

  Screenings, events, people and tickets written since that backup are lost. The only
  rollback without a restore is from slice 1 to milestone 1 (b28a56d), before any ticket
  for a person exists. Milestone 1 code has no guard and ignores `tickets.person_id`:
  started on a database that has tickets for one person, it would let anyone with their
  links use them.
- **Restoring an older backup** brings back passkeys, sessions and links removed since it
  was made: check People afterwards and remove them again.

## Threats

| Threat | What happens | Defence |
|---|---|---|
| A ticket for one person is forwarded or leaks | A sign-in page; nothing created or recorded | The person branch of the open endpoint; the same lookup on every page, Play, heartbeat and media request |
| A setup or recovery link is forwarded or intercepted | Whoever finishes first becomes that person | Secret, single-use, short-lived (recovery at most a day); stored hashed; shown once; in the fragment, so never logged; a new link cancels the old one; you see where it was opened and used; the person sees "already used, tell whoever sent it"; new passkeys are shown to the person at their next sign-in |
| Someone messages you pretending to be Sam | Without a check, a recovery link would go to them | The required tick and the advice to call; Reset after loss only on a contact you know |
| A lost or stolen device | Its sessions and old passkeys stop at once | Reset after loss. With synced passkeys, the new one reaches every device on the person's Apple, Google or password-manager account, so that account must be secured first: the dialog and recovery page say so |
| A stolen session cookie | Use until it is signed out, expires or the person is disabled | No way to turn a cookie into a passkey in this milestone; Sign out everywhere; disable |
| Session fixation, or a cookie planted from a subdomain | Never becomes a signed-in session | Every sign-in issues a new token and revokes the old one; only anonymous or same-person state carries over |
| CSRF | Refused | JSON-only (forces a preflight); cross-site and same-site refused; the origin checked exactly |
| Enumerating people | Nothing to find | No usernames; credential ids go only to a link's holder, as `excludeCredentials`, and never to anyone else; "disabled" only after a valid signature |
| A replayed response | Refused | Challenges taken once, 5 minutes, bound to purpose and link; the counter for device-bound keys |
| A flood of sign-in attempts | New sign-ins wait | Separate pools, so setups in progress survive; per-/64 limits |
| A shared family device or password manager | Housemates can use Sam's tickets while signed in | "Sam ▾ · Sign out" always visible; access.md says "only Sam" means "whoever can use Sam's passkeys" |
| A person disabled, or a passkey removed, mid-film | The next playlist or segment is refused | Sessions revoked; `sessions.load` checks the person every time; only the buffer plays on |
| A leaked database or backup | Sessions and links are unusable; tickets for one person need the passkey | Hashed session and link tokens; public keys aren't secret. Link tickets stay usable, as in milestone 1. People's names are personal data in the off-server copy |
| A rollback to older code | Milestone 2 code refuses a newer database; milestone 1 code can't check, and would let anyone with the link use a ticket for one person | The newer-database guard, with a migration in every slice that changes what rows mean; the rolling-back steps |
| A misconfigured RP ID | Passkeys unavailable, said plainly | `relyingParty()` problems: 503, banner, log; the site keeps running |
| XSS on our origin | Could start a ceremony the person still has to approve | React escaping; a Content-Security-Policy comes later |
| The admin account | Can issue links for anyone | Inherent in a cinema you run. The password stays in the environment and is rate-limited; links and passkeys appear in Activity; people never become admins |

## Not in this milestone

- Self-registration, and people adding or removing their own passkeys.
- Deleting or erasing people (later work, under Later in [roadmap.md](../roadmap.md#later);
  milestone 3's retention never deletes people). Erasure must remove or anonymise their
  passkeys, sessions, links and events and revoke their tickets in one go.
- Display names edited by the person; passkey provider names (the AAGUID is kept for
  later).
- Admin passkeys (later: an admin passkey set up from a one-time link printed over SSH,
  then password sign-in turned off).
- Autofill sign-in, the Signal API (after restoring an older backup it could make
  providers drop valid passkeys), a Content-Security-Policy, `__Host-` cookie names,
  Related Origin Requests, a shared-device mode, signing out single browsers from the
  admin, a "request a ticket" button, email, one ticket for several people.
- Screening-bound media addresses for AirPlay and Cast receivers, if slice 6 shows they're
  needed.

### What this leaves open for later ideas

None of the ideas in [roadmap.md](../roadmap.md) is made harder:

- **Programmes, double bills, screening nights** hang off `people.id` and film ids, and
  follow "listing never grants playback".
- **The sealed after-film note** is its own viewer-declared event, kept apart from the
  server's `finished` at 92%.
- **Surprise tickets** need an opaque landing page; nothing here puts the title in an
  address earlier than today.
- **Invitation cards** that include a setup link must be made in the copy-once box,
  because setup links are never shown again.
- **Living-room pairing** can create a person session without a passkey
  (`sessions.passkey_id` is nullable), and the takeover rule already moves a screening
  between one person's devices without using another.
- **The readiness clip** must live outside film folders, since everything under
  `/media/<film>/` needs a screening.
- **Uploading and encoding on the server** should refer to films by `id`, never by folder
  name; nothing here adds a new dependency on folder names.

## Appendix: the test authenticator

From the planning prototype, checked against `@simplewebauthn/server` 14.0.3: ES256,
EdDSA and RS256 each register and sign in, and forged fields are refused. It becomes
`test/softauth.js`.

```js
import crypto from 'node:crypto';

// Minimal deterministic CBOR encoder: unsigned/negative ints, byte/text strings, arrays, maps.
function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}
export function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error(`cbor: unsupported ${typeof v}`);
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const b64u = (b) => Buffer.from(b).toString('base64url');
const FLAGS = { up: 0x01, uv: 0x04, be: 0x08, bs: 0x10, at: 0x40 };

function authData({ rpId, flags, counter, attested }) {
  const head = Buffer.alloc(37);
  sha256(rpId).copy(head, 0);
  head[32] = flags;
  head.writeUInt32BE(counter, 33);
  return attested ? Buffer.concat([head, attested]) : head;
}

// One passkey. Options let tests forge every field the server must check.
export function softAuthenticator({ origin = 'http://localhost:5173', rpId = 'localhost', synced = true, alg = -7 } = {}) {
  const { publicKey, privateKey } =
    alg === -8 ? crypto.generateKeyPairSync('ed25519')
    : alg === -257 ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    : crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const id = crypto.randomBytes(16);
  let counter = 0;
  let userHandle = null;
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = alg === -8
    ? new Map([[1, 1], [3, -8], [-1, 6], [-2, Buffer.from(jwk.x, 'base64url')]])
    : alg === -257
    ? new Map([[1, 3], [3, -257], [-1, Buffer.from(jwk.n, 'base64url')], [-2, Buffer.from(jwk.e, 'base64url')]])
    : new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  const baseFlags = FLAGS.up | FLAGS.uv | (synced ? FLAGS.be | FLAGS.bs : 0);
  const sign = (data) => (alg === -8 ? crypto.sign(null, data, privateKey) : crypto.sign('sha256', data, privateKey));

  return {
    id: b64u(id),
    // navigator.credentials.create() -> RegistrationResponseJSON
    create(options, over = {}) {
      userHandle = options.user.id;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: over.type ?? 'webauthn.create', challenge: over.challenge ?? options.challenge, origin: over.origin ?? origin, crossOrigin: over.crossOrigin ?? false }));
      const idLen = Buffer.alloc(2); idLen.writeUInt16BE(id.length);
      const attested = Buffer.concat([Buffer.alloc(16) /* aaguid */, idLen, id, cbor(cose)]);
      const ad = authData({ rpId: over.rpId ?? rpId, flags: (over.flags ?? baseFlags) | FLAGS.at, counter, attested });
      const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]));
      return { id: b64u(id), rawId: b64u(id), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal', 'hybrid'] } };
    },
    // navigator.credentials.get() -> AuthenticationResponseJSON
    get(options, over = {}) {
      if (!synced) counter += 1;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: over.type ?? 'webauthn.get', challenge: over.challenge ?? options.challenge, origin: over.origin ?? origin, crossOrigin: over.crossOrigin ?? false }));
      const ad = authData({ rpId: over.rpId ?? rpId, flags: over.flags ?? baseFlags, counter: over.counter ?? counter });
      const signature = over.signature ?? sign(Buffer.concat([ad, sha256(clientDataJSON)]));
      return { id: b64u(id), rawId: b64u(id), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(ad), signature: b64u(signature), userHandle: over.userHandle ?? userHandle } };
    },
  };
}
```
