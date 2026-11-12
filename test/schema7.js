// A shop as 1.1.0 left it: a schema 7 database with a row for every line of the
// upgrade table in docs/version-2.md ("Upgrading an existing shop"), and the awkward
// ones beside them. The migration suite and the upgrade preview's tests both start
// from it. Nothing here knows what migration 8 does: only what 1.x could store.
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const { MIGRATIONS } = await import('../server/db.js');

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// The tables 1.1.0 has, and so the ones whose rows an upgrade must leave as they were.
export const TABLES_7 = ['settings', 'films', 'tickets', 'sessions', 'session_tickets', 'screenings', 'events', 'people', 'person_links', 'passkeys'];

// An empty database as 1.1.0 opens it: the first seven migrations, user_version 7.
export function schemaSevenDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  for (let i = 0; i < 7; i++) {
    db.exec('BEGIN');
    db.exec(MIGRATIONS[i]);
    db.exec(`PRAGMA user_version = ${i + 1}`);
    db.exec('COMMIT');
  }
  return db;
}

// Fills it. Returns the ids by name: F films, T links (tickets), SC plays
// (screenings), P people, S browsers (session hashes). Each film is one case, named
// in the comment above it; times are counted back from `now`.
export function fillShop(db, now = Date.now()) {
  const F = {};
  const T = {};
  const SC = {};
  const P = {};
  const S = {};
  let codes = 0;

  const film = (slug, title, { published = 1, media = 'ok' } = {}) =>
    Number(db.prepare('INSERT INTO films (slug, title, published, media_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(slug, title, published, media, now - 90 * DAY, now - 90 * DAY).lastInsertRowid);
  const person = (name, { disabledAt = null } = {}) =>
    Number(db.prepare('INSERT INTO people (name, webauthn_user_id, disabled_at, created_at, last_signed_in_at) VALUES (?, ?, ?, ?, ?)').run(name, crypto.randomBytes(32).toString('base64url'), disabledAt, now - 60 * DAY, now - 20 * DAY).lastInsertRowid);
  const session = (name, { kind = 'viewer', device = 'Safari on iPhone', personId = null, revokedAt = null, expiresAt = now + 70 * DAY } = {}) => {
    const hash = sha256(name);
    db.prepare('INSERT INTO sessions (id_hash, kind, device, created_at, last_seen_at, expires_at, revoked_at, person_id, signed_in_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(hash, kind, device, now - 20 * DAY, now - HOUR, expiresAt, revokedAt, personId, personId ? now - 20 * DAY : null);
    return hash;
  };
  const ticket = (filmId, { label = null, limit = null, startBy = null, days = null, played = null, revoked = null, personId = null, claimable = 0, claimedAt = null } = {}) =>
    Number(
      db.prepare(`INSERT INTO tickets (code, film_id, label, screening_limit, start_by, days_after_first_play, first_opened_at, first_played_at, revoked_at, created_at, person_id, claimable, claimed_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`code${String(++codes).padStart(9, '0')}`, filmId, label, limit, startBy, days, played ? played - HOUR : null, played, revoked, now - 30 * DAY, personId, claimable, claimedAt).lastInsertRowid,
    );
  const hold = (ticketId, ...hashes) => {
    for (const hash of hashes) db.prepare('INSERT INTO session_tickets (session_hash, ticket_id, added_at) VALUES (?, ?, ?)').run(hash, ticketId, now - 10 * DAY);
  };
  // A play. 1.x gave it 48 hours to come back unless `until` says otherwise; `beat`
  // is when its browser was last heard from, and `playing` is a browser playing now.
  const play = (ticketId, { session: hash = null, started, until = started + 48 * HOUR, beat = started + MIN, playing = false, position = 42, finished = null, voided = null }) => {
    const filmId = db.prepare('SELECT film_id FROM tickets WHERE id = ?').get(ticketId).film_id;
    return Number(
      db.prepare(`INSERT INTO screenings (ticket_id, film_id, session_hash, started_at, resumable_until, last_heartbeat_at, active_until, position_seconds, furthest_seconds, duration_seconds, finished_at, voided_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(ticketId, filmId, hash, started, until, beat, playing ? beat + 75 * 1000 : beat, position, position, 6000, finished, voided).lastInsertRowid,
    );
  };

  // ------------------------------------------------------------ people and browsers
  P.ada = person('Ada');
  P.ben = person('Ben');
  P.cy = person('Cy', { disabledAt: now - 2 * HOUR }); // a member whose card is off
  P.dee = person('Dee');
  const passkey = Number(db.prepare("INSERT INTO passkeys (person_id, credential_id, public_key, device_type, backed_up, created_at) VALUES (?, 'ada-credential', x'00', 'multiDevice', 1, ?)").run(P.ada, now - 50 * DAY).lastInsertRowid);
  db.prepare("INSERT INTO person_links (person_id, token_hash, purpose, created_at, expires_at, used_at) VALUES (?, 'ada-link', 'setup', ?, ?, ?)").run(P.ada, now - 51 * DAY, now - 48 * DAY, now - 50 * DAY);

  S.a = session('a');
  S.b = session('b', { device: 'Chrome on Windows' });
  S.c = session('c', { device: 'Firefox on Mac' });
  S.ada = session('ada phone', { personId: P.ada });
  S.adaLaptop = session('ada laptop', { personId: P.ada, device: 'Chrome on Mac', revokedAt: now - DAY }); // signed out since
  S.ben = session('ben', { personId: P.ben, device: 'Safari on iPad' });
  S.dee = session('dee', { personId: P.dee, device: 'Edge on Windows' });
  S.cy = session('cy', { personId: P.cy, device: 'Safari on Mac' }); // the card is off; this row was never signed out
  S.signedOut = session('signed out', { revokedAt: now - 30 * MIN });
  S.expired = session('expired', { expiresAt: now - HOUR });
  S.left = session('left the link'); // a live browser that "Sign out browsers" took the link from
  S.gone = sha256('gone'); // no row: the clean-up has deleted it
  session('admin', { kind: 'admin', device: 'Safari on Mac', expiresAt: now + 12 * HOUR });
  db.prepare('UPDATE sessions SET passkey_id = ? WHERE id_hash = ?').run(passkey, S.ada);

  // ---------------------------------------------- a film with several links nobody has played
  F.shelf = film('shelf', 'The Shelf');
  T.shelfAnyone = ticket(F.shelf, { label: 'Book club' });
  hold(T.shelfAnyone, S.a, S.b, S.left); // the browser that left another link still holds this one
  T.shelfAda = ticket(F.shelf, { label: 'For Ada', personId: P.ada, startBy: now + 5 * DAY, days: 10 });
  T.shelfKeepable = ticket(F.shelf, { claimable: 1, days: 3650 }); // days over 30
  T.shelfKept = ticket(F.shelf, { personId: P.ben, claimedAt: now - 3 * DAY });
  T.shelfMissed = ticket(F.shelf, { label: 'Too late', startBy: now - DAY }); // its start-by has passed
  hold(T.shelfMissed, S.b);
  T.shelfCancelled = ticket(F.shelf, { revoked: now - 2 * DAY, days: 45 });

  // --------------------------------- several plays open on one film, a link of every kind
  // Three people are part-way through. One is playing now; a member paused five
  // seconds ago, so was heard from last; a third paused hours ago.
  F.crowd = film('crowd', 'The Crowd');
  T.crowdPaused = ticket(F.crowd, { limit: 1, played: now - 5 * HOUR });
  hold(T.crowdPaused, S.c);
  SC.crowdPaused = play(T.crowdPaused, { session: S.c, started: now - 5 * HOUR, beat: now - 4 * HOUR, position: 600 });
  T.crowdAda = ticket(F.crowd, { label: 'Ada again', personId: P.ada, limit: 2, days: 14, played: now - 2 * HOUR });
  SC.crowdAda = play(T.crowdAda, { session: S.ada, started: now - 2 * HOUR, beat: now - 5 * 1000, position: 1200 });
  T.crowdPlaying = ticket(F.crowd, { label: 'For the flat', played: now - HOUR });
  hold(T.crowdPlaying, S.a, S.b);
  SC.crowdPlaying = play(T.crowdPlaying, { session: S.a, started: now - HOUR, beat: now - 20 * 1000, playing: true, position: 3000 });
  T.crowdKept = ticket(F.crowd, { personId: P.ben, claimedAt: now - DAY });
  T.crowdKeepable = ticket(F.crowd, { claimable: 1 });
  hold(T.crowdKeepable, S.b);

  // --------------------------- two people part-way through one film, neither playing now
  // The member was heard from half an hour ago, the browser three hours ago.
  F.pair = film('pair', 'The Pair');
  T.pairAnyone = ticket(F.pair, { played: now - 4 * HOUR });
  hold(T.pairAnyone, S.b);
  SC.pairAnyone = play(T.pairAnyone, { session: S.b, started: now - 4 * HOUR, beat: now - 3 * HOUR, position: 900 });
  T.pairBen = ticket(F.pair, { label: 'Ben', personId: P.ben, played: now - 20 * HOUR });
  SC.pairBen = play(T.pairBen, { session: S.ben, started: now - 20 * HOUR, beat: now - 30 * MIN, position: 2400 });

  // -------------------- two part-way through one film, last heard from at the same moment
  // Neither is playing now. The play that began first has the lower id; its link was
  // made second, so has the higher one.
  F.tie = film('tie', 'The Tie');
  T.tieLater = ticket(F.tie, { limit: 1, played: now - 5 * HOUR });
  hold(T.tieLater, S.c);
  T.tieEarlier = ticket(F.tie, { label: 'Lou', limit: 1, played: now - 6 * HOUR });
  hold(T.tieEarlier, S.b);
  SC.tieEarlier = play(T.tieEarlier, { session: S.b, started: now - 6 * HOUR, beat: now - 2 * HOUR, position: 2000 });
  SC.tieLater = play(T.tieLater, { session: S.c, started: now - 5 * HOUR, beat: now - 2 * HOUR, position: 100 });

  // ------------------------------------- one play open, which its holder can still resume
  // A link sent with one play, the form's default.
  F.solo = film('solo', 'Solo');
  T.solo = ticket(F.solo, { label: 'Sam', limit: 1, played: now - 3 * HOUR });
  hold(T.solo, S.a);
  SC.solo = play(T.solo, { session: S.a, started: now - 3 * HOUR, beat: now - 2 * HOUR, position: 1800 });
  // Beside it, a link nobody has played whose start-by date passed half an hour ago,
  // while that play was open: once upgraded it waits for the tape, and has that time back.
  T.soloWaited = ticket(F.solo, { label: 'Waited', startBy: now - 30 * MIN });

  // ------------------ the same, on a link whose start-by date has passed since its first play
  // First played two days ago, in time, with the shop's 72 hours to come back; the
  // start-by date was yesterday. 1.x stopped reading a start-by at the first play.
  F.startBy = film('start-by', 'Start By');
  T.startByPassed = ticket(F.startBy, { label: 'Viv', limit: 1, startBy: now - DAY, played: now - 2 * DAY });
  hold(T.startByPassed, S.c);
  SC.startByPassed = play(T.startByPassed, { session: S.c, started: now - 2 * DAY, until: now + DAY, beat: now - 26 * HOUR, position: 2700 });

  // ---------------------- the same, on a link 1.x would have let play again (question 15)
  // "As often as you like for 14 days", started yesterday, part-way through.
  F.fortnight = film('fortnight', 'A Fortnight');
  T.fortnight = ticket(F.fortnight, { label: 'Jo', days: 14, played: now - 26 * HOUR });
  hold(T.fortnight, S.b);
  SC.fortnight = play(T.fortnight, { session: S.b, started: now - 26 * HOUR, beat: now - 25 * HOUR, position: 5000 });

  // ------------------------------- one play open, and the link's expiry comes sooner
  // Two days after the first play; a second play begun two hours ago could come
  // back for 46 hours more, but the link runs out in 12.
  F.sooner = film('sooner', 'Sooner');
  T.sooner = ticket(F.sooner, { days: 2, played: now - 36 * HOUR });
  hold(T.sooner, S.c);
  SC.soonerFirst = play(T.sooner, { session: S.c, started: now - 36 * HOUR, until: now - 30 * HOUR, finished: now - 34 * HOUR });
  SC.sooner = play(T.sooner, { session: S.c, started: now - 2 * HOUR, beat: now - HOUR, position: 700 });

  // ---------------------------- a play open that its holder can no longer resume, six ways
  F.signedOut = film('signed-out', 'Signed Out');
  T.signedOut = ticket(F.signedOut, { limit: 1, played: now - 3 * HOUR });
  hold(T.signedOut, S.signedOut);
  SC.signedOut = play(T.signedOut, { session: S.signedOut, started: now - 3 * HOUR, beat: now - 2 * HOUR });
  F.expired = film('browser-expired', 'Browser Expired');
  T.expired = ticket(F.expired, { played: now - 3 * HOUR });
  hold(T.expired, S.expired);
  SC.expired = play(T.expired, { session: S.expired, started: now - 3 * HOUR, beat: now - 2 * HOUR });
  // "Sign out browsers" on the link: the browser is live and no longer holds it. Another does.
  F.left = film('left-the-link', 'Left the Link');
  T.left = ticket(F.left, { played: now - HOUR });
  hold(T.left, S.b);
  SC.left = play(T.left, { session: S.left, started: now - HOUR, beat: now - 30 * 1000, playing: true, position: 900 });
  F.gone = film('browser-gone', 'Browser Gone');
  T.gone = ticket(F.gone, { played: now - HOUR });
  SC.gone = play(T.gone, { session: S.gone, started: now - HOUR });
  // A member whose card is off, alone on a film, "playing now" by the clock.
  F.cardOff = film('card-off', 'Card Off');
  T.cardOff = ticket(F.cardOff, { label: 'Cy', personId: P.cy, played: now - 5 * HOUR });
  SC.cardOff = play(T.cardOff, { session: S.cy, started: now - 5 * HOUR, beat: now - 10 * 1000, playing: true });
  // A link for anyone, in the browser where that member is signed in.
  F.cardOffBrowser = film('card-off-browser', 'Card Off, Any Link');
  T.cardOffBrowser = ticket(F.cardOffBrowser, { played: now - 4 * HOUR });
  hold(T.cardOffBrowser, S.cy);
  SC.cardOffBrowser = play(T.cardOffBrowser, { session: S.cy, started: now - 4 * HOUR, beat: now - 3 * HOUR });

  // ------------------ playing most recently, but can't; a browser that can, paused long ago
  F.rank = film('rank', 'Rank');
  T.rankCy = ticket(F.rank, { personId: P.cy, played: now - 3 * HOUR });
  SC.rankCy = play(T.rankCy, { session: S.cy, started: now - 3 * HOUR, beat: now - 10 * 1000, playing: true });
  T.rankLive = ticket(F.rank, { label: 'Kit', played: now - 20 * HOUR });
  hold(T.rankLive, S.c);
  SC.rankLive = play(T.rankLive, { session: S.c, started: now - 20 * HOUR, beat: now - 19 * HOUR, position: 333 });

  // ------------------------------ the latest play given back, an older one still open
  F.givenBack = film('given-back', 'Given Back');
  T.givenBack = ticket(F.givenBack, { limit: 3, played: now - 10 * HOUR });
  hold(T.givenBack, S.a);
  SC.givenBackOlder = play(T.givenBack, { session: S.a, started: now - 10 * HOUR, beat: now - 9 * HOUR, position: 777 });
  SC.givenBackLatest = play(T.givenBack, { session: S.a, started: now - 2 * HOUR, voided: now - HOUR });

  // -------------------------------------------------- nothing open: every kind of link
  F.done = film('done', 'Done');
  T.usedUp = ticket(F.done, { label: 'Once', limit: 1, played: now - 9 * DAY });
  hold(T.usedUp, S.c);
  SC.usedUp = play(T.usedUp, { session: S.c, started: now - 9 * DAY, finished: now - 9 * DAY + 2 * HOUR });
  T.usedUpCancelled = ticket(F.done, { limit: 2, played: now - 12 * DAY, revoked: now - DAY });
  SC.usedUpCancelled1 = play(T.usedUpCancelled, { session: S.gone, started: now - 12 * DAY });
  SC.usedUpCancelled2 = play(T.usedUpCancelled, { session: S.gone, started: now - 8 * DAY });
  // Used up by two plays. Between them a third was given back: its time to come back
  // was the longest of the three, and would have ended last.
  T.usedUpGaveOneBack = ticket(F.done, { label: 'Twice', limit: 2, played: now - 10 * DAY });
  hold(T.usedUpGaveOneBack, S.b);
  SC.usedUpGaveOneBack1 = play(T.usedUpGaveOneBack, { session: S.b, started: now - 10 * DAY });
  SC.usedUpGaveOneBackVoided = play(T.usedUpGaveOneBack, { session: S.b, started: now - 8 * DAY, until: now - 2 * DAY, voided: now - 7 * DAY });
  SC.usedUpGaveOneBack2 = play(T.usedUpGaveOneBack, { session: S.b, started: now - 6 * DAY });
  // Used up, and its only play names no browser. No 1.x release wrote such a play,
  // but the column allows it.
  T.usedUpNobody = ticket(F.done, { limit: 1, played: now - 15 * DAY });
  SC.usedUpNobody = play(T.usedUpNobody, { started: now - 15 * DAY, finished: now - 15 * DAY + 2 * HOUR });
  T.pastDays = ticket(F.done, { label: 'A weekend', days: 2, played: now - 5 * DAY });
  SC.pastDays = play(T.pastDays, { session: S.c, started: now - 5 * DAY, until: now - 4 * DAY });
  T.pastDaysCancelled = ticket(F.done, { personId: P.ada, days: 3, played: now - 6 * DAY, revoked: now - DAY });
  SC.pastDaysCancelled = play(T.pastDaysCancelled, { session: S.ada, started: now - 6 * DAY });
  // Past its days, and its only play was given back.
  T.pastDaysGivenBack = ticket(F.done, { days: 2, played: now - 5 * DAY });
  SC.pastDaysGivenBack = play(T.pastDaysGivenBack, { session: S.c, started: now - 5 * DAY, voided: now - 5 * DAY + HOUR });
  // Played, with plays left or no limit, and nobody part-way.
  T.playsLeft = ticket(F.done, { label: 'Three goes', limit: 3, days: 3650, played: now - 8 * DAY });
  SC.playsLeft = play(T.playsLeft, { session: S.b, started: now - 8 * DAY });
  T.noLimitWeek = ticket(F.done, { personId: P.dee, days: 7, played: now - 4 * DAY });
  SC.noLimitWeek = play(T.noLimitWeek, { session: S.dee, started: now - 4 * DAY, finished: now - 4 * DAY + 2 * HOUR });
  T.noLimit = ticket(F.done, { played: now - 40 * DAY });
  hold(T.noLimit, S.a);
  SC.noLimit = play(T.noLimit, { session: S.a, started: now - 40 * DAY });
  // Given-back plays don't count: one play, given back; and two plays, one of them given back.
  T.onlyGivenBack = ticket(F.done, { limit: 1, played: now - 6 * DAY });
  SC.onlyGivenBack = play(T.onlyGivenBack, { session: S.b, started: now - 6 * DAY, voided: now - 6 * DAY + HOUR });
  T.oneOfTwoGivenBack = ticket(F.done, { limit: 2, played: now - 7 * DAY });
  SC.oneOfTwoCounted = play(T.oneOfTwoGivenBack, { session: S.b, started: now - 7 * DAY });
  SC.oneOfTwoGivenBack = play(T.oneOfTwoGivenBack, { session: S.b, started: now - 6 * DAY, voided: now - 6 * DAY + HOUR });
  // First played in time, with plays left; its start-by date has passed since. 1.x
  // stopped reading a start-by at the first play.
  T.metStartBy = ticket(F.done, { label: 'In time', limit: 3, startBy: now - 2 * DAY, played: now - 5 * DAY });
  SC.metStartBy = play(T.metStartBy, { session: S.b, started: now - 5 * DAY });
  T.neverDays10 = ticket(F.done, { days: 10, startBy: now + 3 * DAY });
  T.neverPlain = ticket(F.done, {});

  // --------------- watched to the end, then given back: a film of its own, so its counts are its own
  // Past its days, and its only play was finished and given back afterwards. 1.x
  // didn't count it; the upgrade still makes it the link's loan, and a given-back
  // play isn't one finished.
  F.finishedGivenBack = film('finished-given-back', 'Finished, Given Back');
  T.finishedGivenBack = ticket(F.finishedGivenBack, { days: 2, played: now - 5 * DAY });
  SC.finishedGivenBack = play(T.finishedGivenBack, { session: S.c, started: now - 5 * DAY, finished: now - 5 * DAY + 2 * HOUR, voided: now - 5 * DAY + 3 * HOUR });

  // --------------- past its days, with its time to come back still open (30 days of it)
  F.past = film('past', 'Past');
  T.past = ticket(F.past, { label: 'Long window', days: 2, played: now - 3 * DAY });
  hold(T.past, S.a);
  SC.past = play(T.past, { session: S.a, started: now - 3 * DAY, until: now + 27 * DAY });

  // ------------------------------------------------ a play open on a film off the shelf
  F.offShelf = film('off-the-shelf', 'Off the Shelf', { published: 0 });
  T.offShelf = ticket(F.offShelf, { played: now - HOUR });
  hold(T.offShelf, S.a);
  SC.offShelf = play(T.offShelf, { session: S.a, started: now - HOUR, beat: now - 30 * 1000, playing: true });
  T.offShelfUsedUp = ticket(F.offShelf, { limit: 1, played: now - 20 * DAY });
  SC.offShelfUsedUp = play(T.offShelfUsedUp, { session: S.b, started: now - 20 * DAY });

  // -------------------------------------------------- a play open on a cancelled link
  F.cancelled = film('cancelled', 'Cancelled');
  T.cancelled = ticket(F.cancelled, { limit: 1, played: now - HOUR, revoked: now - 30 * MIN });
  hold(T.cancelled, S.a);
  SC.cancelled = play(T.cancelled, { session: S.a, started: now - HOUR, beat: now - 40 * MIN });
  T.cancelledOther = ticket(F.cancelled, {});

  // ------------------------------------------ the film's files broke with a play open
  F.broken = film('broken', 'Broken', { media: 'error' });
  T.broken = ticket(F.broken, { played: now - HOUR });
  hold(T.broken, S.b);
  SC.broken = play(T.broken, { session: S.b, started: now - HOUR, beat: now - 50 * MIN });

  // ------------- a member's link, last played on a device the member has since signed out of
  F.otherDevice = film('other-device', 'Other Device');
  T.otherDevice = ticket(F.otherDevice, { label: 'Ada', personId: P.ada, limit: 1, played: now - 30 * HOUR });
  SC.otherDevice = play(T.otherDevice, { session: S.adaLaptop, started: now - 30 * HOUR, beat: now - 29 * HOUR, position: 4000 });

  // ------------------------- a link for anyone, playing in a browser that is signed in
  F.signedIn = film('signed-in', 'Signed In');
  T.signedIn = ticket(F.signedIn, { limit: 1, played: now - 2 * HOUR });
  hold(T.signedIn, S.dee);
  SC.signedIn = play(T.signedIn, { session: S.dee, started: now - 2 * HOUR, beat: now - HOUR, position: 60 });

  // ------------------- a link that was kept after Play: the play is still the browser's
  F.kept = film('kept', 'Kept');
  T.kept = ticket(F.kept, { personId: P.ben, claimedAt: now - HOUR, played: now - 3 * HOUR });
  hold(T.kept, S.ben);
  SC.kept = play(T.kept, { session: S.ben, started: now - 3 * HOUR, beat: now - 2 * HOUR, position: 1500 });

  // ------------------------------------------------- settings, and a little of the Ledger
  db.prepare("INSERT INTO settings (key, value) VALUES ('cinemaName', '\"Home\"'), ('resumeWindowHours', '72')").run();
  const event = db.prepare('INSERT INTO events (at, type, film_id, ticket_id, session_hash, screening_id, position, detail, person_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  event.run(now - 2 * HOUR, 'opened', F.crowd, T.crowdPlaying, S.a, null, null, null, null);
  event.run(now - HOUR, 'play', F.crowd, T.crowdPlaying, S.a, SC.crowdPlaying, 0, '{"resumed":false}', null);
  event.run(now - 30 * MIN, 'heartbeat', F.crowd, T.crowdPlaying, S.a, SC.crowdPlaying, 3000, null, null);
  event.run(now - 20 * DAY, 'signed-in', null, null, S.ada, null, null, '{"device":"Safari on iPhone"}', P.ada);
  event.run(now - 2 * HOUR, 'person-disabled', null, null, null, null, null, null, P.cy);

  return { F, T, SC, P, S };
}
