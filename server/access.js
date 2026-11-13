import { tx } from './db.js';
import { sessionProlonger } from './sessions.js';

const DAY = 24 * 60 * 60 * 1000;

// A playing device reports in every 30 seconds. Its screening counts as busy
// for this long after each report, or until it says it has paused or closed;
// only then can another of the borrower's devices take the screening over.
export const ACTIVE_MS = 75 * 1000;
// "Finished" means playback reached this share of the running time.
export const FINISHED_AT = 0.92;
// Heartbeats update the screening every time but are logged as events less often.
const HEARTBEAT_EVENT_MS = 5 * 60 * 1000;
// Pressing Play again in the browser that already holds the screening (a refresh,
// a double click, a script in a loop) is logged at most this often, so presses
// can't fill the database. Taking the tape or taking a screening over always is.
const PLAY_EVENT_MS = 5 * 60 * 1000;

// When a tape is out: the one test, used by every read. A loan is live until its end
// is written, until it is due, or until its borrower can no longer play: the link's
// member with their card turned off, or the browser that pressed Play signed out,
// expired, or signed in as someone whose card is off (the rule sessions.load uses).
// Decided by the server's clock when asked, so a tape is back from its due time
// whether or not anything has written that down (closeStale, below, writes it).
const LIVE = `l.ended_at IS NULL AND l.due_at > :now AND (
  (l.person_id IS NOT NULL AND EXISTS (SELECT 1 FROM people p WHERE p.id = l.person_id AND p.disabled_at IS NULL))
  OR (l.person_id IS NULL AND EXISTS (SELECT 1 FROM sessions s LEFT JOIN people sp ON sp.id = s.person_id
      WHERE s.id_hash = l.session_hash AND s.kind = 'viewer' AND s.revoked_at IS NULL AND s.expires_at > :now
        AND (s.person_id IS NULL OR (sp.id IS NOT NULL AND sp.disabled_at IS NULL)))))`;

// Whether any time can have been given back to the start-by date of a link `t`, as
// SQL (`now` an SQL expression), for the reads that go through many links: Status and
// the counts of a film's or a member's links. Without it, the date the link goes by
// (effectiveStartBy) is the date as it was set, and no loans need reading for it.
// True is only "work it out". The first loan to give any time back was taken on
// another link before the date as set, and was still out once this link was made.
// Never one of the ended loans the upgrade made.
export const startByMayMove = (now) => `EXISTS (SELECT 1 FROM loans l
  WHERE l.film_id = t.film_id AND l.ticket_id <> t.id AND l.ended_how IS NOT 'before-2.0'
    AND l.taken_at < t.start_by AND COALESCE(l.ended_at, ${now}) > t.created_at)`;

// Whose loan it is: the link's person on any device, or else the browser that pressed Play.
export const isBorrower = (viewer, loan) =>
  Boolean(viewer && loan) && (loan.person_id != null ? viewer.person_id === loan.person_id : viewer.id_hash === loan.session_hash);

// A link that has lent, and whose tape is back: spent, whatever the state of the film
// itself. Read from what ticketStatus returns. Opening such a link in a browser that
// doesn't hold it, and its preview in a chat app, say nothing of the film.
export const isSpent = (status) => Boolean(status?.loan) && status.out?.id !== status.loan.id;

// What a browser sees of a link, by where the link stands with the film's one tape.
// A link whose tape is out with someone else (lent to another borrower, or waiting
// on another link) is `out` either way: nobody but the borrower can tell which.
const VIEW = { waiting: 'out', in: 'in', spent: 'spent', expired: 'expired' };
// The Ledger's kinds about links and loans, apart from viewing (opened, play,
// heartbeat, finished) and from accounts (every other kind).
export const LOAN_EVENTS = ['ticket-sent', 'lent', 'returned', 'due-changed', 'ticket-cancelled', 'ticket-restored'];
// A link's state as the back office names it: the last column of the state table in
// docs/version-2.md. A link the tape is in for is 'unopened' or 'opened' (linkState).
const LINK_STATE = { revoked: 'cancelled', unpublished: 'off', unavailable: 'unavailable', spent: 'done', lent: 'has', expired: 'missed', waiting: 'waiting' };
// Best view first, for when one browser holds several links to the same film.
const RANK = { yours: 0, in: 1, out: 2, spent: 3, expired: 4 };
const NONE = Object.freeze({ canView: false, canPlay: false, ticket: null, status: null, view: null, tape: null, via: null });
// A film shown to members, for a signed-in person with no link that shows it:
// the page and poster, never the media.
const MEMBER = Object.freeze({ canView: true, canPlay: false, ticket: null, status: null, view: null, tape: null, via: 'member' });

// All access rules live here. Pages, API calls and every media request ask
// these functions, so cancelling a link, or a tape coming due, applies on the next
// request. From version 2 a film is one tape: the first Play on one of its links
// takes it until it's due back, and a link lends once (the loans table).
export function createAccess(db, settings) {
  const prolong = sessionProlonger(db);
  const q = {
    ticket: db.prepare('SELECT * FROM tickets WHERE id = ?'),
    film: db.prepare('SELECT * FROM films WHERE id = ?'),
    // Tickets this browser may use for a film: link tickets it opened, while they're
    // still for anyone, plus tickets in the signed-in person's name. Oldest first,
    // as before. With :person NULL only link tickets match.
    forFilm: db.prepare(`
      SELECT t.* FROM tickets t
      WHERE t.film_id = :film AND (
        (t.person_id IS NULL AND t.id IN (SELECT ticket_id FROM session_tickets WHERE session_hash = :session))
        OR t.person_id = :person)
      ORDER BY t.id`),
    // Every ticket this browser may use, newest first, for /api/me. A kept ticket
    // counts from when it was kept.
    usable: db.prepare(`
      SELECT t.*, st.added_at AS since FROM session_tickets st JOIN tickets t ON t.id = st.ticket_id
      WHERE st.session_hash = :session AND t.person_id IS NULL
      UNION ALL
      SELECT t.*, COALESCE(t.claimed_at, t.created_at) AS since FROM tickets t WHERE t.person_id = :person
      ORDER BY since DESC`),
    // The two ways a ticket's person changes after it's issued. Keeping needs the
    // ticket still keepable and for anyone, so of two keeps only the first matches.
    keep: db.prepare(`
      UPDATE tickets SET person_id = ?, claimed_at = ?, claimable = 0
      WHERE id = ? AND person_id IS NULL AND claimable = 1 AND revoked_at IS NULL`),
    setPerson: db.prepare('UPDATE tickets SET person_id = ?, claimed_at = NULL, claimable = ? WHERE id = ?'),
    // "Picked for you" with it, when the admin changes the note in the same step.
    setPickNote: db.prepare('UPDATE tickets SET pick_note = ? WHERE id = ?'),
    // Cancelling a link, and undoing that. Each changes a row once, so each is logged once.
    revoke: db.prepare('UPDATE tickets SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL'),
    restore: db.prepare('UPDATE tickets SET revoked_at = NULL WHERE id = ? AND revoked_at IS NOT NULL'),
    // Forgets a link in every browser that opened it.
    forget: db.prepare('DELETE FROM session_tickets WHERE ticket_id = ?'),
    // A member's other links for a film that never lent and aren't cancelled: they go
    // with a tape taken back from that member.
    othersOf: db.prepare(`
      SELECT t.* FROM tickets t
      WHERE t.person_id = ? AND t.film_id = ? AND t.id <> ? AND t.revoked_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.ticket_id = t.id)
      ORDER BY t.id`),
    // Links anyone can use, for a film, that never lent and that a borrower's browsers
    // also hold: the browser that has the tape, and every live browser signed in as
    // :person. A take-back leaves these alone (other people hold them too), and the
    // admin is told of them before taking a tape back.
    heldLinks: db.prepare(`
      SELECT t.* FROM tickets t
      WHERE t.film_id = :film AND t.id <> :ticket AND t.person_id IS NULL AND t.revoked_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.ticket_id = t.id)
        AND EXISTS (
          SELECT 1 FROM session_tickets st JOIN sessions s ON s.id_hash = st.session_hash
          WHERE st.ticket_id = t.id AND s.kind = 'viewer' AND s.revoked_at IS NULL AND s.expires_at > :now
            AND (s.id_hash = :session OR (:person IS NOT NULL AND s.person_id = :person)))
      ORDER BY t.id`),
    setLoanDays: db.prepare('UPDATE tickets SET loan_days = ? WHERE id = ?'),
    holds: db.prepare('SELECT 1 FROM session_tickets WHERE session_hash = ? AND ticket_id = ?'),
    // The film's tape, while it is out: at most one row (the loans_out index).
    filmLoan: db.prepare(`SELECT l.* FROM loans l WHERE l.film_id = :film AND ${LIVE}`),
    // The one time this link lent, live or over: at most one, ever (loans_once).
    ticketLoan: db.prepare('SELECT * FROM loans WHERE ticket_id = ?'),
    loanByScreening: db.prepare('SELECT * FROM loans WHERE screening_id = ?'),
    loan: db.prepare('SELECT * FROM loans WHERE id = ?'),
    // The times a film's tape was out on any link but this one since :since (when
    // this link was made), for effectiveStartBy: the loans taken from then on, in the
    // order they were taken, and before them the last one taken earlier, which alone
    // can still have been out then (one tape: a loan ends before the next begins).
    // Never the ended ones the upgrade made for links 1.x had used up. Both go by
    // the loans_film index, so a film's history before the link was made is not read.
    loansSince: db.prepare(`
      SELECT l.id, l.taken_at, l.ended_at FROM loans l
      WHERE l.film_id = :film AND l.taken_at >= :since AND l.taken_at < :now
        AND l.ticket_id <> :ticket AND l.ended_how IS NOT 'before-2.0'
      ORDER BY l.taken_at, l.id`),
    loanBefore: db.prepare(`
      SELECT l.id, l.taken_at, l.ended_at FROM loans l
      WHERE l.film_id = :film AND l.taken_at < :since
        AND l.ticket_id <> :ticket AND l.ended_how IS NOT 'before-2.0'
      ORDER BY l.taken_at DESC, l.id DESC LIMIT 1`),
    // The same loans for every link of a film at once, in the same order, for a read
    // through many links (startByReader): one statement for each film, not two for
    // each link.
    datesLoans: db.prepare(`
      SELECT l.id, l.ticket_id, l.taken_at, l.ended_at FROM loans l
      WHERE l.film_id = ? AND l.ended_how IS NOT 'before-2.0'
      ORDER BY l.taken_at, l.id`),
    setDue: db.prepare('UPDATE loans SET due_at = ? WHERE id = ? AND ended_at IS NULL'),
    // Loans with no end written that are no longer live, for one film (or all, with
    // :film NULL), with what says when their borrower stopped being able to play.
    stale: db.prepare(`
      SELECT l.*, p.disabled_at AS person_disabled_at,
             s.id_hash AS session_found, s.revoked_at AS session_revoked_at, s.expires_at AS session_expires_at,
             s.person_id AS session_person_id, sp.id AS session_person_found, sp.disabled_at AS session_person_disabled_at
      FROM loans l
      LEFT JOIN people p ON p.id = l.person_id
      LEFT JOIN sessions s ON s.id_hash = l.session_hash AND s.kind = 'viewer'
      LEFT JOIN people sp ON sp.id = s.person_id
      WHERE l.ended_at IS NULL AND (:film IS NULL OR l.film_id = :film) AND NOT (${LIVE})
      ORDER BY l.id`),
    openLoansOf: db.prepare('SELECT * FROM loans WHERE person_id = ? AND ended_at IS NULL ORDER BY id'),
    // Loans as the admin is told of them (adminLoans), newest first: each with
    // whether it is live by the one test, what closeStale reads to date its end, and
    // its film, link, borrower, playback and response. Any of :film, :person (the
    // loan's own member) and :ticket narrows it; :live = 1 leaves only tapes out now.
    adminLoans: db.prepare(`
      SELECT l.*, (${LIVE}) AS is_live,
             f.slug AS film_slug, f.title AS film_title, t.label AS ticket_label,
             p.name AS person_name, p.disabled_at AS person_disabled_at,
             s.id_hash AS session_found, s.revoked_at AS session_revoked_at, s.expires_at AS session_expires_at,
             s.person_id AS session_person_id, sp.id AS session_person_found, sp.name AS session_person_name,
             sp.disabled_at AS session_person_disabled_at,
             sc.position_seconds, sc.finished_at, sc.voided_at, sc.active_until,
             r.id AS response_id, r.kind AS response_kind, r.message AS response_message,
             r.created_at AS response_created_at, r.read_at AS response_read_at
      FROM loans l
      JOIN films f ON f.id = l.film_id
      JOIN tickets t ON t.id = l.ticket_id
      JOIN screenings sc ON sc.id = l.screening_id
      LEFT JOIN people p ON p.id = l.person_id
      LEFT JOIN sessions s ON s.id_hash = l.session_hash AND s.kind = 'viewer'
      LEFT JOIN people sp ON sp.id = s.person_id
      LEFT JOIN responses r ON r.loan_id = l.id
      WHERE (:film IS NULL OR l.film_id = :film) AND (:person IS NULL OR l.person_id = :person)
        AND (:ticket IS NULL OR l.ticket_id = :ticket) AND (:live = 0 OR (${LIVE}))
      ORDER BY l.taken_at DESC, l.id DESC`),
    // Every tape that is out, the soonest due back first.
    tapesOut: db.prepare(`
      SELECT l.*, f.slug AS film_slug, f.title AS film_title FROM loans l JOIN films f ON f.id = l.film_id
      WHERE ${LIVE} ORDER BY l.due_at, l.id`),
    // Every link, with whether it has lent, for counting them by film or by member, and
    // whether its start-by date may have moved (startByMayMove).
    linksOf: db.prepare(`
      SELECT t.id, t.film_id, t.person_id, t.revoked_at, t.first_played_at, t.start_by, t.created_at, l.id AS loan_id,
             t.start_by IS NOT NULL AND ${startByMayMove(':now')} AS start_by_may_move
      FROM tickets t LEFT JOIN loans l ON l.ticket_id = t.id
      WHERE (:film IS NULL OR t.film_id = :film) AND (:person IS NULL OR t.person_id = :person)`),
    // How a film has been lent, from its links, loans and responses only, so deleting
    // old events never changes it. A play given back in 1.x doesn't count as finished.
    filmLending: db.prepare(`
      SELECT (SELECT COUNT(*) FROM tickets WHERE film_id = ?1) AS sent,
             (SELECT COUNT(*) FROM tickets WHERE film_id = ?1 AND revoked_at IS NOT NULL) AS cancelled,
             (SELECT COUNT(*) FROM tickets WHERE film_id = ?1 AND first_opened_at IS NOT NULL) AS opened,
             (SELECT COUNT(*) FROM loans WHERE film_id = ?1) AS lent,
             (SELECT COUNT(*) FROM loans l JOIN screenings s ON s.id = l.screening_id
              WHERE l.film_id = ?1 AND s.finished_at IS NOT NULL AND s.voided_at IS NULL) AS finished,
             (SELECT COUNT(*) FROM responses WHERE film_id = ?1) AS responses`),
    // The titles of the tapes one browser has out on links anyone can use: its own
    // loans and nobody else's. A film off the shelf is no film at all, here as anywhere.
    browserLoans: db.prepare(`
      SELECT f.title FROM loans l JOIN films f ON f.id = l.film_id
      WHERE l.session_hash = :session AND l.person_id IS NULL AND f.published = 1 AND ${LIVE}
      ORDER BY l.due_at, f.title COLLATE NOCASE`),
    insertLoan: db.prepare(`
      INSERT INTO loans (film_id, ticket_id, screening_id, person_id, session_hash, device, taken_at, due_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    endLoan: db.prepare('UPDATE loans SET ended_at = ?, ended_how = ? WHERE id = ? AND ended_at IS NULL'),
    // What a borrower said when handing a tape back: one for a loan, ever
    // (responses_once), and only from the loan's own member (the trigger).
    insertResponse: db.prepare('INSERT INTO responses (loan_id, person_id, film_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    screening: db.prepare('SELECT * FROM screenings WHERE id = ?'),
    // resumable_until is written once, as the due time, and never read: the loan says
    // when the tape is due (and a due date can move).
    insertScreening: db.prepare(`
      INSERT INTO screenings (ticket_id, film_id, session_hash, started_at, resumable_until, last_heartbeat_at, active_until)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
    claim: db.prepare('UPDATE screenings SET session_hash = ?, last_heartbeat_at = ?, active_until = ? WHERE id = ?'),
    firstPlay: db.prepare('UPDATE tickets SET first_played_at = ? WHERE id = ? AND first_played_at IS NULL'),
    progress: db.prepare(`
      UPDATE screenings
      SET last_heartbeat_at = ?, active_until = ?, position_seconds = ?, furthest_seconds = MAX(furthest_seconds, ?),
          duration_seconds = COALESCE(?, duration_seconds)
      WHERE id = ?`),
    finish: db.prepare('UPDATE screenings SET finished_at = ? WHERE id = ? AND finished_at IS NULL'),
    // A tape that is returned or taken back is playing nowhere from that moment.
    stop: db.prepare('UPDATE screenings SET active_until = MIN(active_until, ?) WHERE id = ?'),
    event: db.prepare(`
      INSERT INTO events (at, type, film_id, ticket_id, session_hash, screening_id, position, detail, person_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    lastScreeningEvent: db.prepare('SELECT at, session_hash FROM events WHERE screening_id = ? AND type = ? ORDER BY at DESC LIMIT 1'),
    // The browser holding a screening, if it is still a live session: not revoked
    // or expired, and its person (if signed in) still there and enabled.
    holder: db.prepare(`
      SELECT s.id_hash, s.person_id FROM sessions s LEFT JOIN people p ON p.id = s.person_id
      WHERE s.id_hash = ? AND s.kind = 'viewer' AND s.revoked_at IS NULL AND s.expires_at > ?
        AND (s.person_id IS NULL OR (p.id IS NOT NULL AND p.disabled_at IS NULL))`),
  };

  // The kinds of event. Viewing: opened (routes/viewer.js), play, heartbeat and
  // finished. Loans (LOAN_EVENTS, below): ticket-sent (routes/admin.js), lent,
  // returned, due-changed, ticket-cancelled and ticket-restored. Accounts, which is
  // every other kind: ticket-kept, ticket-given and ticket-released; and from
  // people.js, signed-in, signed-out, signed-out-everywhere, sign-in-refused,
  // passkey-added, passkey-removed, link-created, link-cancelled, person-disabled and
  // person-enabled.
  // Only account events (sign-ins, passkeys, links), a ticket sent to, kept by, given
  // to or released from a person, a member's link cancelled or restored, and what
  // happens to a member's own loan name a person directly; viewing events find theirs
  // through the session. A returned event is dated when the loan ended, so a tape that
  // came due is dated its due time. It says whether a response came with the tape,
  // and never what the response was: a friend's words are in the responses table
  // only, which the clean-up doesn't touch and the Ledger doesn't read.
  function logEvent(type, { filmId = null, ticketId = null, sessionHash = null, screeningId = null, position = null, detail = null, personId = null }, now = Date.now()) {
    q.event.run(now, type, filmId, ticketId, sessionHash, screeningId, position, detail ? JSON.stringify(detail) : null, personId);
  }

  // May this browser use this ticket at all, before the ticket's own state?
  function mayHold(viewer, ticket) {
    if (!viewer || !ticket) return false;
    if (ticket.person_id != null) return ticket.person_id === viewer.person_id;
    return Boolean(q.holds.get(viewer.id_hash, ticket.id));
  }

  // Another of the borrower's browsers holds the screening. It only blocks a
  // takeover while it could still play it: not once it is signed out, revoked or
  // expired, its person disabled, or the ticket no longer its to use.
  function holderCanPlay(hash, ticket, now) {
    const h = hash ? q.holder.get(hash, now) : null;
    return Boolean(h) && mayHold(h, ticket);
  }

  const filmLoan = (filmId, now) => q.filmLoan.get({ film: filmId, now }) || null;
  const live = (loan, now) => Boolean(loan) && filmLoan(loan.film_id, now)?.id === loan.id;

  // The date a link must be started by, with the time its film's tape was out on
  // other links given back: nobody can press Play on a link while the one tape is
  // with someone else, so that time doesn't count against it. Null for a link with
  // no start-by date, and for one that has been played: a start-by is read only
  // until the first play (a 1.x link played before the upgrade met its date then,
  // and may lend once more).
  //
  // From the date as the admin set it, through the film's loans on other links in
  // the order they were taken (never the ended ones the upgrade made, which 1.x
  // counted against the date already). Each one the link began to wait for before
  // the date as it then stands pushes the date back by the time the tape was out
  // since the link was made: to the loan's end, or to now while it is still out, so
  // the time left stands still. The wait begins when the tape is taken, or when the
  // link was made if the tape was out already (of the loans taken before the link
  // was made, only the last can have been: one tape). A wait that would begin on or after
  // the date as it then stands gives nothing back: the link had been missed by
  // then, and could not have lent. So a missed link's date never moves again. No
  // stretch of time is given back twice, should two loans' times ever overlap (a
  // clock that stepped back), and an end the clock hasn't reached counts only as far
  // as now.
  //
  // So a date that passes while the tape is out never makes a link expired until
  // the tape is back, which "never who has it" needs: a link that lent before its
  // start-by stays lent, and otherwise a friend could tell the two kinds of "out"
  // apart by waiting for the date. A reader never writes, so for a loan that is over
  // with no end written yet, its end is the one closeStale will write.
  // `out` is the film's live loan, for a caller that has it already, and `filmLoans`
  // every loan of the film as datesLoans reads them, for one that has those.
  function effectiveStartBy(ticket, now = Date.now(), out = filmLoan(ticket.film_id, now), filmLoans = null) {
    if (!ticket.start_by || ticket.first_played_at) return null;
    let startBy = ticket.start_by;
    // Up to here, time is before the link was made or has been given back already.
    let counted = ticket.created_at;
    const beside = { film: ticket.film_id, ticket: ticket.id, since: ticket.created_at };
    // The last loan taken before the link was made, then those taken since, as
    // loanBefore and loansSince read them. Those are read one at a time, so the
    // reading stops where the loop does: a link missed long ago reads no further
    // than its first loan taken after its date.
    function* loans() {
      if (!filmLoans) {
        const before = q.loanBefore.get(beside);
        if (before) yield before;
        yield* q.loansSince.iterate({ ...beside, now });
        return;
      }
      const others = filmLoans.filter((l) => l.ticket_id !== ticket.id);
      const before = others.findLast((l) => l.taken_at < ticket.created_at);
      if (before) yield before;
      for (const l of others) if (l.taken_at >= ticket.created_at && l.taken_at < now) yield l;
    }
    for (const l of loans()) {
      const from = Math.max(l.taken_at, counted);
      // In the order they were taken, so no later wait begins before the date either.
      if (from >= startBy) break;
      const to = Math.min(l.ended_at ?? (out?.id === l.id ? now : unwrittenEnd(ticket.film_id, l.id, now)), now);
      if (to <= from) continue;
      startBy += to - from;
      counted = to;
    }
    return startBy;
  }

  // When a loan that is over, with no end written yet, came back: what closeStale
  // will write for it (staleEnd). At most one of a film's loans is ever in that
  // state, for the minute until the sweeper runs.
  function unwrittenEnd(filmId, loanId, now) {
    const stale = q.stale.all({ film: filmId, now }).find((s) => s.id === loanId);
    return stale ? staleEnd(stale, now)[1] : now;
  }

  // Where a link stands with its film's one tape, whatever the state of the film
  // itself. `loan` is the link's own, `out` the film's live one. A link that never
  // lent is expired once its start-by date has passed, by effectiveStartBy: the
  // date with the time the tape was out on other links given back. While the tape
  // is out on a loan taken before that date the time left stands still, so the link
  // waits, and isn't expired before the tape is back. One whose date had already
  // passed when the tape went out (or when the link was made, with the tape out
  // already) stays expired: that link could not have lent.
  //
  // Every media request comes through here, so the date is only worked out when it
  // could matter, and two cases need no loans read at all. A date still ahead as it
  // was set can't have been missed: time is only ever given back. And while the tape
  // is out, a link that began to wait for it before the date as it was set can't be
  // missed either: the date it goes by is no earlier, and stands still until the
  // tape is back. `startBy` gives the date it goes by, for a caller with a quicker
  // way to it: the link's own status (ticketStatus), whose startBy is worked out once
  // however often it is read, or a read through many links (linkCounts).
  function lending(ticket, loan, out, now, startBy = () => effectiveStartBy(ticket, now, out)) {
    if (loan) return out?.id === loan.id ? 'lent' : 'spent';
    const set = ticket.first_played_at ? null : ticket.start_by;
    const waited = out && Math.max(out.taken_at, ticket.created_at) < set;
    if (set && set <= now && !waited && startBy() <= now) return 'expired';
    return out ? 'waiting' : 'in';
  }

  // Whether a link's time to start by stands still at this moment: it has a start-by
  // date still ahead, and the film's tape is out on another link, so every minute
  // the tape stays out is given back (effectiveStartBy). For the admin alone: a
  // viewer whose link waits is told "out" and the date the tape is due, and never
  // anything of a start-by. `status` is what ticketStatus returned for `now`.
  const startByPaused = (status, now = Date.now()) => Boolean(status.out) && status.startBy != null && status.startBy > now;

  // The state of one link, the same whoever asks: revoked, unpublished,
  // unavailable (the film's files; the loan goes on, and its clock runs), spent (it
  // lent, and that loan is over), lent, expired (never lent, start-by missed),
  // waiting (never lent, the tape is out on another link) or in. `loan` and `out`
  // are filled in whatever the state. "Spent" is never stored: it is read from loans.
  function ticketStatus(ticket, now = Date.now()) {
    const film = q.film.get(ticket.film_id);
    const loan = q.ticketLoan.get(ticket.id) || null;
    const out = filmLoan(ticket.film_id, now);
    const status = {
      state: null,
      loan,
      out,
      // The date to start by. It only matters until the first play: null from then
      // on, and for a link with no date.
      startBy: null,
      // How long Play would lend the tape for: the link's own days, or the shop's.
      loanDays: ticket.loan_days ?? settings.get().loanDays,
    };
    // For a link that has a date: the date with the time the tape was out on other
    // links given back, worked out when it is first read, and once. A media request
    // never reads it, and the link's state often doesn't need it (lending).
    if (ticket.start_by && !ticket.first_played_at) {
      let date;
      Object.defineProperty(status, 'startBy', { enumerable: true, get: () => (date === undefined ? (date = effectiveStartBy(ticket, now, out)) : date) });
    }

    if (ticket.revoked_at) status.state = 'revoked';
    else if (!film?.published) status.state = 'unpublished';
    else if (film.media_status === 'error' || film.media_status === 'missing') status.state = 'unavailable';
    else status.state = lending(ticket, loan, out, now, () => status.startBy);
    return status;
  }

  // The back office's name for a link's state: the tape is in for it and nobody has
  // opened it ('unopened') or somebody has ('opened'), or one of LINK_STATE's.
  const linkState = (ticket, status) => LINK_STATE[status.state] ?? (ticket.first_opened_at ? 'opened' : 'unopened');

  // Who may use a ticket once it's been opened is decided here and in mayHold,
  // nowhere else. Opening a link decides who may take a ticket on in the first place,
  // by the same rule: /api/tickets/open in routes/viewer.js.
  const ids = (viewer) => ({ session: viewer.id_hash, person: viewer.person_id ?? null });
  const candidates = (viewer, film) => q.forFilm.all({ film: film.id, ...ids(viewer) });

  // Best view first (yours, in, out, spent, expired); then the person's own link;
  // then the oldest, which is the order before people existed. So with their own
  // link and a link for anyone in one browser, Play takes their own, and of two
  // links for one member the older lends first.
  const byBest = (a, b) => RANK[a.tape] - RANK[b.tape] || (b.ticket.person_id != null) - (a.ticket.person_id != null) || a.ticket.id - b.ticket.id;

  // What this browser may do with a film page. Only this depends on who asks:
  //   yours        its link's tape is out, and this browser (or this person) took it;
  //   in           the tape is in, and Play would take it;
  //   out          the tape is out with someone else, on this link or another: the
  //                same answer for both, so nobody learns which link has it;
  //   spent        this link lent, and the tape came back;
  //   expired      it never lent, and its start-by date has passed;
  //   unavailable  the film's files are broken or missing. `tape` then still says
  //                yours, out or in, by the loan: the clock runs on.
  // Revoked and unpublished look exactly like "no such film". A film shown to
  // members is listed for anyone signed in, but listing never lets anything play.
  // The admin's own browser previews, and never takes a tape.
  function filmAccess({ viewer, admin }, film, now = Date.now()) {
    if (admin && film) return { canView: true, canPlay: true, ticket: null, status: null, view: 'preview', tape: null, via: 'admin' };
    if (!viewer || !film?.published) return NONE;
    const fallback = viewer.person_id != null && film.member_visible ? MEMBER : NONE;
    const best = candidates(viewer, film)
      .filter((ticket) => !ticket.revoked_at)
      .map((ticket) => {
        const status = ticketStatus(ticket, now);
        // A film's links are all unavailable together: among them the choice goes by the tape.
        const state = status.state === 'unavailable' ? lending(ticket, status.loan, status.out, now, () => status.startBy) : status.state;
        return { ticket, status, tape: state === 'lent' ? (isBorrower(viewer, status.loan) ? 'yours' : 'out') : VIEW[state] };
      })
      .sort(byBest)[0];
    if (!best) return fallback;
    const { ticket, status } = best;
    const view = status.state === 'unavailable' ? 'unavailable' : best.tape;
    const tape = best.tape === 'spent' || best.tape === 'expired' ? null : best.tape;
    return {
      canView: true,
      canPlay: view === 'in' || view === 'yours',
      via: 'ticket',
      ticket,
      status,
      view,
      tape,
      // This link's own loan, live or over, was this browser's (or this person's).
      mine: isBorrower(viewer, status.loan),
      // The loan's playback, for its borrower only: position, finished, the device holding it.
      screening: tape === 'yours' ? q.screening.get(status.loan.screening_id) : null,
      // Handing the tape back with a response: the loan is live, it was taken on a
      // link for one member, and this is that member, on any of their devices and
      // whether or not they reached the end. Never a browser's loan, on a link
      // anyone can use: that link may have been forwarded, and signing in doesn't
      // make the loan the member's. The film page says so (films.js) and returnTape
      // decides by this same answer, so the two can't disagree.
      canRespond: tape === 'yours' && status.loan.person_id != null && status.loan.person_id === viewer.person_id,
    };
  }

  // Playlists, segments, audio and subtitles need the tape, and its screening held
  // by this browser. A link alone is not enough, nor is the borrower's other device.
  function mayStream({ viewer, admin }, film, now = Date.now()) {
    if (admin) return true;
    const a = filmAccess({ viewer }, film, now);
    return a.view === 'yours' && a.screening?.session_hash === viewer.id_hash;
  }

  // Writes the end of one loan, and logs it. False if its end was written already.
  // The event names the browser that pressed Play, or `by`: the one that returned it.
  // `response`: the borrower said something with it. That it happened is logged; what
  // they said never is.
  function endLoan(loan, how, at, by = loan.session_hash, response = false) {
    if (Number(q.endLoan.run(at, how, loan.id).changes) !== 1) return false;
    logEvent(
      'returned',
      { filmId: loan.film_id, ticketId: loan.ticket_id, sessionHash: by, screeningId: loan.screening_id, personId: loan.person_id, detail: { loanId: loan.id, how, response: Boolean(response) } },
      at,
    );
    return true;
  }

  // Reads never write, so a loan that ran out has no end until this writes it: the
  // due time, or the moment the borrower's session ended or their card was turned
  // off if that came sooner. First thing inside every IMMEDIATE transaction that
  // takes a tape, returns it, takes it back, keeps or gives a link or moves a due
  // date, and every minute for all films (sweep). Never
  // before the loan began, nor after it was due, nor later than the moment of
  // writing, so a clock that stepped back, or a session row that is gone, can't break
  // the check on ended_at (one bad row would otherwise stop every Play on its film
  // and every sweep), nor date a tape's return in the future.
  function closeStale(filmId, now) {
    let closed = 0;
    for (const l of q.stale.all({ film: filmId, now })) if (endLoan(l, ...staleEnd(l, now))) closed++;
    return closed;
  }

  // How and when a loan that is no longer live ended, though nothing has written it
  // yet: [how, at], from a row of q.stale or q.adminLoans. closeStale writes this, and
  // until it has, the admin is told the same (adminLoans).
  function staleEnd(l, now) {
    // When the borrower stopped being able to play, if they did. A session row that
    // is gone, or names a person who is: the moment isn't known, so now.
    let gone = null;
    if (l.person_id != null) {
      if (l.person_disabled_at != null) gone = ['disabled', l.person_disabled_at];
    } else if (l.session_found == null || (l.session_person_id != null && l.session_person_found == null)) {
      gone = ['signed-out', now];
    } else {
      const ended = Math.min(l.session_revoked_at ?? Infinity, l.session_expires_at);
      if (ended <= now) gone = ['signed-out', ended];
      else if (l.session_person_disabled_at != null) gone = ['disabled', l.session_person_disabled_at];
    }
    // Not live and not yet due, with no moment found: a session signed out at a
    // time this clock hasn't reached (it stepped back) is signed out all the same,
    // by the one test. Back now, and never written as due at a time still ahead.
    if (!gone && l.due_at > now) gone = [l.person_id != null ? 'disabled' : 'signed-out', now];
    const at = gone ? Math.min(gone[1], now) : null;
    const [how, when] = gone && at < l.due_at ? [gone[0], at] : ['due', l.due_at];
    return [how, Math.max(l.taken_at, when)];
  }

  // Since the server started: nothing is stored.
  let lastSweep = null;
  let lastSweepError = null;

  // Writes the end of every loan that is over, for all films. Returns how many.
  function sweep(now = Date.now()) {
    try {
      const closed = tx(db, () => closeStale(null, now), { immediate: true });
      lastSweep = { at: now, closed };
      lastSweepError = null;
      return closed;
    } catch (err) {
      lastSweepError = { message: err.message, at: now };
      throw err;
    }
  }

  // Every minute. Nothing a friend sees waits for it: every read decides by the
  // clock. A failure is logged; it never stops the server.
  function startSweeper() {
    const tick = () => {
      try {
        const closed = sweep();
        if (closed) console.log(`Tapes: wrote down ${closed} that had come back`);
      } catch (err) {
        console.error(`Checking for tapes that have come back failed: ${err.message}`);
      }
    };
    setInterval(tick, 60 * 1000).unref();
  }

  const sweeperStatus = () => ({ lastRun: lastSweep, lastError: lastSweepError });

  // A member's card is turned off: their tapes come back at once. Written where it
  // happens (people.js, inside its transaction) and not left to the test above,
  // because a card can be turned on again, and a loan no sweep had closed in between
  // would come back to life. One already past due ended when it was due.
  function endLoansOf(personId, now = Date.now()) {
    let ended = 0;
    for (const l of q.openLoansOf.all(personId)) {
      if (endLoan(l, ...(l.due_at <= now ? ['due', l.due_at] : ['disabled', Math.max(l.taken_at, now)]))) ended++;
    }
    return ended;
  }

  // Pressing Play. The borrower resumes; with the tape in, Play takes it: a
  // screening and a loan, due after the link's days. Anything else is answered
  // with the view's name. The check and the take share one write transaction, so
  // two links pressed at once can't both take the tape; the loans_out index is the
  // backstop for a second process on the same file.
  function startScreening(viewer, film, now = Date.now()) {
    return tx(
      db,
      () => {
        closeStale(film.id, now);
        // The route read this browser's session before the step began. Read again
        // inside it: one signed out since (by another process on the same file)
        // takes nothing, where its loan would be over before it began and its link
        // spent with nobody having had the tape.
        if (viewer && !q.holder.get(viewer.id_hash, now)) return { error: 'no-access' };
        const a = filmAccess({ viewer }, film, now);
        if (a.via === 'member') return { error: 'no-ticket' };
        if (a.via !== 'ticket') return { error: 'no-access' };
        // Out, spent, expired or unavailable: decided before the takeover check, so
        // "playing elsewhere" only ever reaches the borrower's own devices.
        if (!a.canPlay) return { error: a.view };
        const { ticket, status } = a;
        let { loan } = status;
        let screening = a.screening;
        const resumed = a.view === 'yours';
        if (resumed) {
          if (screening.session_hash !== viewer.id_hash && screening.active_until > now && holderCanPlay(screening.session_hash, ticket, now)) {
            return { error: 'playing-elsewhere' };
          }
          q.claim.run(viewer.id_hash, now, now + ACTIVE_MS, screening.id);
        } else {
          const due = now + status.loanDays * DAY;
          const id = Number(q.insertScreening.run(ticket.id, film.id, viewer.id_hash, now, due, now, now + ACTIVE_MS).lastInsertRowid);
          const loanId = Number(q.insertLoan.run(film.id, ticket.id, id, ticket.person_id, viewer.id_hash, viewer.device ?? null, now, due).lastInsertRowid);
          q.firstPlay.run(now, ticket.id);
          loan = q.ticketLoan.get(ticket.id);
          screening = { id };
          logEvent('lent', { filmId: film.id, ticketId: ticket.id, sessionHash: viewer.id_hash, screeningId: id, detail: { loanId, dueAt: due } }, now);
        }
        // A browser's loan lives as long as its session: that lasts a day past the due time.
        if (loan.person_id == null) prolong(viewer.id_hash, loan.due_at + DAY);
        screening = q.screening.get(screening.id);
        const last = resumed ? q.lastScreeningEvent.get(screening.id, 'play') : null;
        if (!last || last.session_hash !== viewer.id_hash || now - last.at >= PLAY_EVENT_MS) {
          logEvent('play', { filmId: film.id, ticketId: ticket.id, sessionHash: viewer.id_hash, screeningId: screening.id, position: screening.position_seconds, detail: { resumed } }, now);
        }
        return { screening, resumed, ticket, loan };
      },
      { immediate: true },
    );
  }

  // The link's loan, while the link has the tape; else null.
  function tapeOf(ticket, now) {
    const loan = q.ticketLoan.get(ticket.id) || null;
    return live(loan, now) ? loan : null;
  }

  // Return it now. Only the borrower, while the tape is theirs, and only the loan
  // their page was showing: `takenAt` must be this loan's, so a tab left open from
  // an earlier loan can't hand back a later one. Anything else is one answer,
  // "nothing to return", whoever asks and whatever they send: no such film, a film
  // off the shelf, a link without the tape, somebody else's tape. The link is spent
  // from here, and the film's tape is in for the next Play.
  //
  // Hand it back: the same return, with a response for the admin alone: one of the
  // four kinds, and a message or none (the route checks both). Only for a tape
  // borrowed on a member's own link, by that member, at any time while they have it
  // (canRespond, in filmAccess). A borrower who can't respond, on a browser's loan,
  // is told so and nothing changes: the tape stays out, so a friend's words are
  // never dropped, and they can still return it without any. Everyone who isn't the
  // borrower gets "nothing to return" with or without a response, so a response
  // tells them nothing either. Once the tape is back, however it came back, there
  // is nothing to return and so nothing to respond to: not twice, and not after it
  // came back on its own or was taken back.
  function returnTape(viewer, film, { takenAt, response = null, message = null }, now = Date.now()) {
    if (!viewer || !film) return { error: 'nothing-to-return' };
    return tx(
      db,
      () => {
        closeStale(film.id, now);
        // Read the browser's session again inside the step, as Play does: one signed
        // out since (by another process on the same file) hands nothing back.
        if (!q.holder.get(viewer.id_hash, now)) return { error: 'nothing-to-return' };
        const a = filmAccess({ viewer }, film, now);
        const loan = a.tape === 'yours' ? a.status.loan : null;
        if (!loan || loan.taken_at !== takenAt) return { error: 'nothing-to-return' };
        const responded = response != null;
        if (responded && !a.canRespond) return { error: 'cannot-respond' };
        const at = Math.max(loan.taken_at, now);
        endLoan(loan, 'returned', at, viewer.id_hash, responded);
        q.stop.run(at, loan.screening_id);
        if (responded) q.insertResponse.run(loan.id, loan.person_id, loan.film_id, response, message, at);
        return { returned: { at }, responded, loan: q.loan.get(loan.id) };
      },
      { immediate: true },
    );
  }

  // Cancels a link that doesn't have the tape, inside the caller's transaction:
  // today's revoke, which also drops the link from every browser that opened it.
  function cancel(ticket, now) {
    if (Number(q.revoke.run(now, ticket.id).changes) === 1) {
      logEvent('ticket-cancelled', { filmId: ticket.film_id, ticketId: ticket.id, personId: ticket.person_id }, now);
    }
    q.forget.run(ticket.id);
  }

  // Takes a live loan's tape back, inside the caller's transaction. The loan's end is
  // written first, so the borrower's player is told "taken back" by the loan, and
  // only then is the link cancelled and dropped from the browsers that opened it.
  // A member's other links for the film that never lent are cancelled in the same
  // step: their next request would otherwise find the second link, offer Play where
  // the page should be gone, and start a new loan. The same goes for a member signed
  // in on the browser that took the tape on a link anyone can use. Links for anyone
  // that the borrowing browser also holds are left alone: other people hold them too.
  // Returns the ids of the other links it cancelled.
  function takeBackLoan(loan, now) {
    const at = Math.max(loan.taken_at, now);
    endLoan(loan, 'taken-back', at);
    q.stop.run(at, loan.screening_id);
    q.revoke.run(at, loan.ticket_id);
    q.forget.run(loan.ticket_id);
    const alsoCancelled = [];
    for (const other of goesWith(loan, now)) {
      cancel(other, at);
      alsoCancelled.push(other.id);
    }
    return alsoCancelled;
  }

  // Whose other links go with a tape taken back: the loan's member, or (question 16)
  // the member signed in right now in the browser that has the tape on a link anyone
  // can use. Nobody, for a browser that isn't signed in.
  const takenFrom = (loan, now) => loan.person_id ?? q.holder.get(loan.session_hash, now)?.person_id ?? null;

  // The links a take-back of this loan cancels with it: that member's other links for
  // the film that never lent. One answer for the take-back itself and for what the
  // admin is told beforehand (otherLinks), so the two can't disagree.
  function goesWith(loan, now) {
    const personId = takenFrom(loan, now);
    return personId == null ? [] : q.othersOf.all(personId, loan.film_id, loan.ticket_id);
  }

  // For the take-back's confirmation: the borrower's other links for the film.
  // `cancelledToo` ones are the member's own that never lent, which go with the tape
  // (goesWith: the ones waiting for it, and any past their start-by date). The rest
  // are links anyone can use that the borrower's browsers also hold and that could
  // still lend: a take-back leaves those alone, because other people hold them too,
  // and the borrower's page then shows that link, with the tape in.
  function otherLinks(loan, now) {
    const named = (t, cancelledToo) => ({
      id: t.id,
      label: t.label,
      kind: t.person_id != null ? 'person' : 'anyone',
      linkState: linkState(t, ticketStatus(t, now)),
      cancelledToo,
    });
    const held = q.heldLinks
      .all({ film: loan.film_id, ticket: loan.ticket_id, session: loan.session_hash, person: takenFrom(loan, now), now })
      .filter((t) => lending(t, null, loan, now) === 'waiting');
    return [...goesWith(loan, now).map((t) => named(t, true)), ...held.map((t) => named(t, false))];
  }

  // ------------------------------------------------------------ what the admin is told
  // Everything from here to tapeForPreview says who has a tape. It is for the admin
  // alone: routes/admin.js and routes/people.js sit behind the admin's session, the
  // projection booth with them, and the film page gets tapeForPreview only when its
  // browser is the admin's. No viewer route may send any of it.

  // Loans, newest first: { live, film, person, ticket } narrows them. Each says who
  // has (or had) the tape:
  //   borrower    a member, for a tape taken on their own link; or the browser that
  //               pressed Play on a link anyone can use: its device, kept on the loan,
  //               and the member it is signed in as while its session's row exists
  //               (the clean-up deletes ended sessions; the device then stands alone);
  //   live        by the one test, at this moment;
  //   endedAt     when it came back and how. For a loan that is over with no end
  //   endedHow    written yet, what closeStale will write: reads never write;
  //   playingNow  a device reported in within the last 75 seconds, on a live loan;
  //   response    what the borrower said handing it back, or null;
  //   otherLinks  on a live loan, for the take-back's confirmation (above).
  function adminLoans({ live: onlyLive = false, film = null, person = null, ticket = null } = {}, now = Date.now()) {
    return q.adminLoans.all({ film, person, ticket, live: onlyLive ? 1 : 0, now }).map((l) => {
      const isLive = Boolean(l.is_live);
      const [endedHow, endedAt] = l.ended_at != null ? [l.ended_how, l.ended_at] : isLive ? [null, null] : staleEnd(l, now);
      return {
        id: l.id,
        film: { id: l.film_id, slug: l.film_slug, title: l.film_title },
        ticket: { id: l.ticket_id, label: l.ticket_label },
        borrower:
          l.person_id != null
            ? { kind: 'person', person: { id: l.person_id, name: l.person_name, disabled: Boolean(l.person_disabled_at) } }
            : {
                kind: 'browser',
                device: l.device ?? null,
                signedInAs:
                  l.session_person_found != null
                    ? { id: l.session_person_found, name: l.session_person_name, disabled: Boolean(l.session_person_disabled_at) }
                    : null,
              },
        takenAt: l.taken_at,
        dueAt: l.due_at,
        endedAt,
        endedHow,
        live: isLive,
        playingNow: isLive && l.active_until > now,
        position: l.position_seconds,
        finished: l.finished_at != null && l.voided_at == null,
        response:
          l.response_id != null
            ? { id: l.response_id, kind: l.response_kind, message: l.response_message, createdAt: l.response_created_at, readAt: l.response_read_at }
            : null,
        otherLinks: isLive ? otherLinks(l, now) : [],
      };
    });
  }

  // A film's tape: 'off' (the film is off the shelf), 'out' or 'in', and its loan
  // while one is live, whatever the state: a film taken off the shelf with its tape
  // out still has it out, and the clock runs. `loan` may be handed in by a caller
  // that has every live loan already.
  function filmTape(film, now = Date.now(), loan = adminLoans({ film: film.id, live: true }, now)[0] ?? null) {
    return { state: !film.published ? 'off' : loan ? 'out' : 'in', loan };
  }

  // Links counted by film ('film_id') or by member ('person_id'): a Map from that id
  // to { live, waiting, total }.
  //   total    every link sent, cancelled ones included;
  //   live     not cancelled, and it has the tape or could still take it: not spent,
  //            and its start-by date not missed;
  //   waiting  the live ones that haven't lent: the tape is in, or out on another link.
  // By the link's own lending, whatever the state of the film (off the shelf, or its
  // files broken): putting the film back makes none of them lend twice.
  function linkCounts(by, { film = null, person = null } = {}, now = Date.now()) {
    const out = new Map(q.tapesOut.all({ now }).map((l) => [l.film_id, l]));
    const dateOf = startByReader(now, out);
    const counts = new Map();
    for (const t of q.linksOf.all({ film, person, now })) {
      const c = counts.get(t[by]) ?? { live: 0, waiting: 0, total: 0 };
      counts.set(t[by], c);
      c.total++;
      if (t.revoked_at) continue;
      const tape = out.get(t.film_id) ?? null;
      const startBy = () => (t.start_by_may_move ? dateOf(t, tape) : t.start_by);
      const state = lending(t, t.loan_id != null ? { id: t.loan_id } : null, tape, now, startBy);
      if (state === 'lent' || state === 'waiting' || state === 'in') c.live++;
      if (state === 'waiting' || state === 'in') c.waiting++;
    }
    return counts;
  }

  // effectiveStartBy for a read through many links: each film's loans are read once,
  // when a link of it first needs its date. `out` maps a film to its live loan, as
  // tapesOut reads them; read here when not handed in. Returns (ticket, out?) => date.
  function startByReader(now = Date.now(), out = null) {
    const loans = new Map();
    const tapes = () => (out ??= new Map(q.tapesOut.all({ now }).map((l) => [l.film_id, l])));
    return (ticket, tape = tapes().get(ticket.film_id) ?? null) => {
      if (!loans.has(ticket.film_id)) loans.set(ticket.film_id, q.datesLoans.all(ticket.film_id));
      return effectiveStartBy(ticket, now, tape, loans.get(ticket.film_id));
    };
  }

  // How a film has been lent: links sent, cancelled and opened, times lent (a link
  // lends once, so never more than links sent), times finished, and responses.
  const filmLending = (filmId) => ({ ...q.filmLending.get(filmId) });

  // For the projection booth: how many tapes are out, and the next one due back.
  function tapesOut(now = Date.now()) {
    const rows = q.tapesOut.all({ now });
    const next = rows[0];
    return { out: rows.length, next: next ? { film: { id: next.film_id, slug: next.film_slug, title: next.film_title }, dueAt: next.due_at } : null };
  }

  // The admin's preview of a film page says who has the tape. Only for an answer
  // filmAccess gave the admin's own browser; for anyone else there is no such key.
  function tapeForPreview(a, film, now = Date.now()) {
    if (a?.via !== 'admin' || !film) return undefined;
    const loan = adminLoans({ film: film.id, live: true }, now)[0] ?? null;
    return { out: Boolean(loan), borrower: loan?.borrower ?? null, takenAt: loan?.takenAt ?? null, dueAt: loan?.dueAt ?? null };
  }

  // ------------------------------------------------------------ what a viewer is told
  // The members' shelf (question 7): a film shown to members, for a member with no
  // link that shows it, is in or out, and due back when. Never who has it, nor on
  // which link: of the film's loan, its due time and nothing else. The same for every
  // member who asks, whoever has the tape.
  function shelfTape(film, now = Date.now()) {
    const out = filmLoan(film.id, now);
    return { tape: out ? 'out' : 'in', dueBack: out ? out.due_at : null };
  }

  // The titles of the tapes this browser has out on links anyone can use, for its
  // own sign-out confirmation: signing out sends those back. A member's own tape is
  // theirs on every device, and isn't among them.
  const browserLoans = (viewer, now = Date.now()) => (viewer ? q.browserLoans.all({ session: viewer.id_hash, now }).map((r) => r.title) : []);

  // The admin taking a tape back, by its loan. `ticketId` is the link the page showed
  // the loan on, as a check: a loan id is never reused, and a page left open can't
  // take back anything but the loan it showed. A loan that is over, by the clock or
  // written down, is "not out".
  function takeBack(loanId, ticketId, now = Date.now()) {
    return tx(
      db,
      () => {
        const found = q.loan.get(loanId);
        if (!found) return { error: 'not-found' };
        closeStale(found.film_id, now);
        const loan = q.loan.get(loanId);
        if (loan.ticket_id !== ticketId || !live(loan, now)) return { error: 'not-out' };
        const alsoCancelled = takeBackLoan(loan, now);
        return { loan: q.loan.get(loan.id), ticket: q.ticket.get(loan.ticket_id), alsoCancelled };
      },
      { immediate: true },
    );
  }

  // The admin cancelling a link. If it has the tape, this is taking the tape back.
  function cancelTicket(ticketId, now = Date.now()) {
    return tx(
      db,
      () => {
        const t = q.ticket.get(ticketId);
        if (!t) return { error: 'not-found' };
        closeStale(t.film_id, now);
        const loan = tapeOf(t, now);
        const alsoCancelled = loan ? takeBackLoan(loan, now) : [];
        if (!loan) cancel(t, now);
        return { ticket: q.ticket.get(t.id), tookBack: Boolean(loan), alsoCancelled };
      },
      { immediate: true },
    );
  }

  // Undoes a cancel, for a link that never lent: one that has (its tape was taken
  // back, or it was cancelled once spent) would otherwise come back spent, or with
  // 1.x's loan from the upgrade, and a link lends once. Browsers open the link again.
  function restoreTicket(ticketId, now = Date.now()) {
    return tx(
      db,
      () => {
        const t = q.ticket.get(ticketId);
        if (!t) return { error: 'not-found' };
        if (q.ticketLoan.get(t.id)) return { error: 'lent-once' };
        if (Number(q.restore.run(t.id).changes) === 1) {
          logEvent('ticket-restored', { filmId: t.film_id, ticketId: t.id, personId: t.person_id }, now);
        }
        return { ticket: q.ticket.get(t.id) };
      },
      { immediate: true },
    );
  }

  // Forgets a link in every browser that opened it; the link still works. Not while
  // it has the tape: on a link for anyone that would leave a tape out that the
  // browser which took it can't play.
  function forgetBrowsers(ticketId, now = Date.now()) {
    return tx(
      db,
      () => {
        const t = q.ticket.get(ticketId);
        if (!t) return { error: 'not-found' };
        closeStale(t.film_id, now);
        if (tapeOf(t, now)) return { error: 'tape-out' };
        q.forget.run(t.id);
        return { ticket: t };
      },
      { immediate: true },
    );
  }

  // How long a link lends for, set by the admin after it was sent: 1 to 30 days, or
  // null for the shop's default (the caller checks). On a link that has the tape a
  // new value moves the date it's due back, earlier or later, counted from when it
  // was taken; never into the past, which would end the loan: that is refused and
  // nothing changes. A browser's session is made to last a day past the new date, and its
  // cookie follows at the borrower's next Play or film page. Runs inside the
  // caller's IMMEDIATE transaction, with the link's other fields (routes/admin.js).
  function setLoanDays(ticketId, days, now = Date.now()) {
    const t = q.ticket.get(ticketId);
    if (!t) return { error: 'not-found' };
    // The value the link already has, sent again with a save of its other fields, is
    // no change: the date stays where it is, also when the shop's default has changed
    // since the tape went out (that is for new links), or the upgrade gave this loan
    // a date that isn't a whole number of days from when it was taken.
    if ((days ?? null) === (t.loan_days ?? null)) return { ticket: t, moved: null };
    closeStale(t.film_id, now);
    const loan = tapeOf(t, now);
    let moved = null;
    if (loan) {
      const to = loan.taken_at + (days ?? settings.get().loanDays) * DAY;
      if (to <= now) return { error: 'would-end-loan' };
      if (to !== loan.due_at) {
        q.setDue.run(to, loan.id);
        if (loan.person_id == null) prolong(loan.session_hash, to + DAY);
        moved = { loanId: loan.id, from: loan.due_at, to };
        logEvent('due-changed', { filmId: t.film_id, ticketId: t.id, sessionHash: loan.session_hash, screeningId: loan.screening_id, personId: loan.person_id, detail: moved }, now);
      }
    }
    q.setLoanDays.run(days, t.id);
    return { ticket: q.ticket.get(t.id), moved };
  }

  // Why a loan that is no longer live ended, as its borrower's player is told.
  const endedCode = (loan) => (loan.ended_how === 'returned' || loan.ended_how === 'taken-back' ? loan.ended_how : 'due');

  // Progress from the player. Also where "finished" is decided, so the
  // definition lives on the server rather than in each browser. Decided by the
  // loan first: only its borrower learns anything about it, and a browser that
  // merely holds the same link is told no such screening, whatever id it sends.
  // The check and the write are one step, as Play's are: a report can't land on a
  // tape that was returned or taken back in between.
  function heartbeat(viewer, screeningId, { position, playing = true }, now = Date.now()) {
    if (!viewer) return { error: 'not-found' };
    return tx(
      db,
      () => {
        const s = q.screening.get(screeningId);
        const loan = s ? q.loanByScreening.get(s.id) || null : null;
        const mine = isBorrower(viewer, loan);
        // This browser's own play, with no loan at all: one from 1.x that the upgrade
        // gave no loan (another play on its film became the loan). It has ended.
        const loanless = Boolean(s) && !loan && s.session_hash === viewer.id_hash;
        if (!mine && !loanless) return { error: 'not-found' };
        if (!mine) return { error: 'screening-ended' };
        // Returned, due or taken back: the reason reaches the borrower, and nobody else.
        if (!live(loan, now)) return { error: endedCode(loan) };
        // The tape is still theirs, but nothing can play: the film off the shelf or
        // its files broken.
        const { state } = ticketStatus(q.ticket.get(loan.ticket_id), now);
        if (state !== 'lent') return { error: state };
        // Another of the borrower's devices took the screening over.
        if (s.session_hash !== viewer.id_hash) return { error: 'playing-elsewhere' };

        const film = q.film.get(s.film_id);
        const duration = JSON.parse(film.media || '{}').durationSeconds || null;
        const pos = Number.isFinite(position) ? Math.min(Math.max(position, 0), duration || 86400) : s.position_seconds;
        // A paused or closing player reports in once with playing=false, which
        // frees the screening for another device straight away.
        q.progress.run(now, playing ? now + ACTIVE_MS : now, pos, pos, duration, s.id);

        // Reaching the end marks the play finished. The tape stays out until it's due.
        const base = { filmId: s.film_id, ticketId: s.ticket_id, sessionHash: viewer.id_hash, screeningId: s.id, position: pos };
        if (!s.finished_at && duration && Math.max(s.furthest_seconds, pos) >= FINISHED_AT * duration) {
          q.finish.run(now, s.id);
          logEvent('finished', base, now);
        }
        const last = q.lastScreeningEvent.get(s.id, 'heartbeat');
        if (playing && (!last || now - last.at >= HEARTBEAT_EVENT_MS)) logEvent('heartbeat', base, now);
        return { ok: true };
      },
      { immediate: true },
    );
  }

  const usableTickets = (viewer) => (viewer ? q.usable.all(ids(viewer)) : []);

  // Whether the link a film page shows could be kept in an account: a keepable
  // link for anyone, with the tape in. Not while the tape is out, whichever link
  // has it, nor once this link has lent: a tape never changes hands with its link.
  // Signing in comes after, if need be.
  const canKeep = (a) => a.via === 'ticket' && a.ticket.person_id == null && a.ticket.claimable === 1 && a.view === 'in';

  // Keeping the link this browser's film page shows in the signed-in person's
  // account. The first keep wins: the link becomes theirs, so every other
  // browser that opened it loses it from its next request.
  function keep(viewer, film, now = Date.now()) {
    if (viewer?.person_id == null) return { error: 'sign-in-required' };
    return tx(
      db,
      () => {
        closeStale(film.id, now);
        const a = filmAccess({ viewer }, film, now);
        if (!canKeep(a)) return { error: 'cannot-keep' };
        const { ticket } = a;
        if (q.keep.run(viewer.person_id, now, ticket.id).changes !== 1) return { error: 'cannot-keep' };
        logEvent('ticket-kept', { filmId: film.id, ticketId: ticket.id, sessionHash: viewer.id_hash, personId: viewer.person_id }, now);
        return { ticket: q.ticket.get(ticket.id) };
      },
      { immediate: true },
    );
  }

  // The admin giving a ticket to one person (personId), or letting anyone with the
  // link use it again (null), keepable or not. Browsers that opened the link get it
  // back on a release, unless they were signed out of it meanwhile. The caller
  // checks that the person exists and is enabled. Not while the link has the tape:
  // a tape never changes hands with its link, so the admin takes it back first.
  // pickNote (question 18, answer c): the link's "Picked for you" note as it is to be
  // once the link has changed hands, null to take it away, undefined to leave it as
  // it is. It is written only when the link does change hands, in the same step, so a
  // refused give or release leaves the note as it was, and the new holder never reads
  // a note that was meant to go.
  function setTicketPerson(ticketId, personId, { claimable = false, pickNote } = {}, now = Date.now()) {
    return tx(
      db,
      () => {
        const t = q.ticket.get(ticketId);
        if (!t) return { error: 'not-found' };
        const from = t.person_id ?? null;
        const keepable = personId == null && claimable ? 1 : 0;
        if (from === personId && (personId != null || t.claimable === keepable)) return { ticket: t, changed: false };
        closeStale(t.film_id, now);
        if (tapeOf(t, now)) return { error: 'tape-out' };
        q.setPerson.run(personId, keepable, t.id);
        // Only when it changes hands: a link anyone can use made keepable, or no longer,
        // is still for whoever has it, and keeps its note.
        if (pickNote !== undefined && from !== personId) q.setPickNote.run(pickNote, t.id);
        const base = { filmId: t.film_id, ticketId: t.id };
        if (from != null && from !== personId) logEvent('ticket-released', { ...base, personId: from, detail: { to: personId == null ? 'anyone' : 'person' } }, now);
        if (personId != null && from !== personId) logEvent('ticket-given', { ...base, personId, detail: { from: from == null ? 'anyone' : 'person' } }, now);
        return { ticket: q.ticket.get(t.id), changed: true };
      },
      { immediate: true },
    );
  }

  return {
    ticketStatus, effectiveStartBy, filmAccess, mayStream, startScreening, heartbeat, usableTickets, canKeep, keep, setTicketPerson, logEvent,
    endLoansOf, sweep, startSweeper, sweeperStatus,
    returnTape, takeBack, cancelTicket, restoreTicket, forgetBrowsers, setLoanDays,
    // For the admin alone: who has each tape.
    linkState, startByPaused, startByReader, adminLoans, filmTape, linkCounts, filmLending, tapesOut, tapeForPreview,
    // For a viewer: never who.
    shelfTape, browserLoans,
  };
}
