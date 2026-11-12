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
    setLoanDays: db.prepare('UPDATE tickets SET loan_days = ? WHERE id = ?'),
    holds: db.prepare('SELECT 1 FROM session_tickets WHERE session_hash = ? AND ticket_id = ?'),
    // The film's tape, while it is out: at most one row (the loans_out index).
    filmLoan: db.prepare(`SELECT l.* FROM loans l WHERE l.film_id = :film AND ${LIVE}`),
    // The one time this link lent, live or over: at most one, ever (loans_once).
    ticketLoan: db.prepare('SELECT * FROM loans WHERE ticket_id = ?'),
    loanByScreening: db.prepare('SELECT * FROM loans WHERE screening_id = ?'),
    loan: db.prepare('SELECT * FROM loans WHERE id = ?'),
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
    insertLoan: db.prepare(`
      INSERT INTO loans (film_id, ticket_id, screening_id, person_id, session_hash, device, taken_at, due_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    endLoan: db.prepare('UPDATE loans SET ended_at = ?, ended_how = ? WHERE id = ? AND ended_at IS NULL'),
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
    voidScreening: db.prepare('UPDATE screenings SET voided_at = ? WHERE id = ? AND voided_at IS NULL'),
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
  // came due is dated its due time.
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

  // Where a link stands with its film's one tape, whatever the state of the film
  // itself. `loan` is the link's own, `out` the film's live one. A start-by date is
  // read only until the first play (a 1.x link played before the upgrade met its
  // date then, and may lend once more). One that passes while the tape is out on
  // another link leaves this link waiting until the tape is back: a link that lent
  // before its start-by stays lent, so otherwise a friend could tell the two kinds
  // of "out" apart by waiting for the date. One that had already passed when the
  // tape went out stays expired: that link could not have lent.
  function lending(ticket, loan, out, now) {
    if (loan) return out?.id === loan.id ? 'lent' : 'spent';
    const startBy = ticket.first_played_at ? null : ticket.start_by;
    if (startBy && startBy <= now && !(out && out.taken_at < startBy)) return 'expired';
    return out ? 'waiting' : 'in';
  }

  // The state of one link, the same whoever asks: revoked, unpublished,
  // unavailable (the film's files; the loan goes on, and its clock runs), spent (it
  // lent, and that loan is over), lent, expired (never lent, start-by missed),
  // waiting (never lent, the tape is out on another link) or in. `loan` and `out`
  // are filled in whatever the state. "Spent" is never stored: it is read from loans.
  function ticketStatus(ticket, now = Date.now()) {
    const film = q.film.get(ticket.film_id);
    const loan = q.ticketLoan.get(ticket.id) || null;
    const out = filmLoan(ticket.film_id, now);

    let state;
    if (ticket.revoked_at) state = 'revoked';
    else if (!film?.published) state = 'unpublished';
    else if (film.media_status === 'error' || film.media_status === 'missing') state = 'unavailable';
    else state = lending(ticket, loan, out, now);

    return {
      state,
      loan,
      out,
      // The start-by deadline only matters until the first play.
      startBy: ticket.first_played_at ? null : ticket.start_by,
      // How long Play would lend the tape for: the link's own days, or the shop's.
      loanDays: ticket.loan_days ?? settings.get().loanDays,
    };
  }

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
        const state = status.state === 'unavailable' ? lending(ticket, status.loan, status.out, now) : status.state;
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
  function endLoan(loan, how, at, by = loan.session_hash) {
    if (Number(q.endLoan.run(at, how, loan.id).changes) !== 1) return false;
    logEvent(
      'returned',
      { filmId: loan.film_id, ticketId: loan.ticket_id, sessionHash: by, screeningId: loan.screening_id, personId: loan.person_id, detail: { loanId: loan.id, how, response: false } },
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
    for (const l of q.stale.all({ film: filmId, now })) {
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
      if (endLoan(l, how, Math.max(l.taken_at, when))) closed++;
    }
    return closed;
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
  // from here, and the film's tape is in for the next Play. A response ("Hand it
  // back") comes with slice 4: until then the borrower who sends one is told it
  // can't be taken, and nothing changes, so a friend's words are never dropped.
  function returnTape(viewer, film, { takenAt, response = null }, now = Date.now()) {
    if (!viewer || !film) return { error: 'nothing-to-return' };
    return tx(
      db,
      () => {
        closeStale(film.id, now);
        const a = filmAccess({ viewer }, film, now);
        const loan = a.tape === 'yours' ? a.status.loan : null;
        if (!loan || loan.taken_at !== takenAt) return { error: 'nothing-to-return' };
        if (response != null) return { error: 'cannot-respond' };
        const at = Math.max(loan.taken_at, now);
        endLoan(loan, 'returned', at, viewer.id_hash);
        q.stop.run(at, loan.screening_id);
        return { returned: { at }, loan: q.loan.get(loan.id) };
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
    // Whose links: the loan's member, or (question 16) the member signed in right now
    // in the browser that has the tape on a link anyone can use.
    const personId = loan.person_id ?? q.holder.get(loan.session_hash, now)?.person_id ?? null;
    const alsoCancelled = [];
    if (personId != null) {
      for (const other of q.othersOf.all(personId, loan.film_id, loan.ticket_id)) {
        cancel(other, at);
        alsoCancelled.push(other.id);
      }
    }
    return alsoCancelled;
  }

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

  // Giving a play back was 1.x's way to let a link play again. A loan's playback
  // can't be given back: a link lends once, and the tape's own end says how it came
  // back. A play from 1.x that no loan names still can, until the button goes.
  function voidScreening(screeningId, now = Date.now()) {
    const s = q.screening.get(screeningId);
    if (!s) return { error: 'not-found' };
    if (q.loanByScreening.get(s.id)) return { error: 'tape-out' };
    q.voidScreening.run(now, s.id);
    return { screening: q.screening.get(s.id) };
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
  function setTicketPerson(ticketId, personId, { claimable = false } = {}, now = Date.now()) {
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
        const base = { filmId: t.film_id, ticketId: t.id };
        if (from != null && from !== personId) logEvent('ticket-released', { ...base, personId: from, detail: { to: personId == null ? 'anyone' : 'person' } }, now);
        if (personId != null && from !== personId) logEvent('ticket-given', { ...base, personId, detail: { from: from == null ? 'anyone' : 'person' } }, now);
        return { ticket: q.ticket.get(t.id), changed: true };
      },
      { immediate: true },
    );
  }

  return {
    ticketStatus, filmAccess, mayStream, startScreening, heartbeat, usableTickets, canKeep, keep, setTicketPerson, logEvent,
    endLoansOf, sweep, startSweeper, sweeperStatus,
    returnTape, takeBack, cancelTicket, restoreTicket, forgetBrowsers, setLoanDays, voidScreening,
  };
}
