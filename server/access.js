import { tx } from './db.js';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// A playing device reports in every 30 seconds. Its screening counts as busy
// for this long after each report, or until it says it has paused or closed;
// only then can another device take the screening over.
export const ACTIVE_MS = 75 * 1000;
// "Finished" means playback reached this share of the running time.
export const FINISHED_AT = 0.92;
// Heartbeats update the screening every time but are logged as events less often.
const HEARTBEAT_EVENT_MS = 5 * 60 * 1000;

// Best state first, for when one browser holds several tickets to the same film.
const RANK = { ok: 0, used_up: 1, expired: 2, unavailable: 3, unpublished: 4, revoked: 5 };
const NONE = Object.freeze({ canView: false, canPlay: false, ticket: null, status: null, via: null });

// All access rules live here. Pages, API calls and every media request ask
// these functions, so revoking or expiring a ticket applies on the next request.
export function createAccess(db, settings) {
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
    // Every ticket this browser may use, newest first, for /api/me.
    usable: db.prepare(`
      SELECT t.*, st.added_at AS since FROM session_tickets st JOIN tickets t ON t.id = st.ticket_id
      WHERE st.session_hash = :session AND t.person_id IS NULL
      UNION ALL
      SELECT t.*, t.created_at AS since FROM tickets t WHERE t.person_id = :person
      ORDER BY since DESC`),
    holds: db.prepare('SELECT 1 FROM session_tickets WHERE session_hash = ? AND ticket_id = ?'),
    used: db.prepare('SELECT COUNT(*) AS n FROM screenings WHERE ticket_id = ? AND voided_at IS NULL'),
    open: db.prepare(`
      SELECT * FROM screenings
      WHERE ticket_id = ? AND voided_at IS NULL AND resumable_until > ?
      ORDER BY started_at DESC LIMIT 1`),
    screening: db.prepare('SELECT * FROM screenings WHERE id = ?'),
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
    event: db.prepare(`
      INSERT INTO events (at, type, film_id, ticket_id, session_hash, screening_id, position, detail, person_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    lastScreeningEvent: db.prepare('SELECT at FROM events WHERE screening_id = ? AND type = ? ORDER BY at DESC LIMIT 1'),
    // The browser holding a screening, if it is still a live session: not revoked
    // or expired, and its person (if signed in) still there and enabled.
    holder: db.prepare(`
      SELECT s.id_hash, s.person_id FROM sessions s LEFT JOIN people p ON p.id = s.person_id
      WHERE s.id_hash = ? AND s.kind = 'viewer' AND s.revoked_at IS NULL AND s.expires_at > ?
        AND (s.person_id IS NULL OR (p.id IS NOT NULL AND p.disabled_at IS NULL))`),
  };

  // Only account events (sign-ins, passkeys, links) name a person directly;
  // viewing events find theirs through the session.
  function logEvent(type, { filmId = null, ticketId = null, sessionHash = null, screeningId = null, position = null, detail = null, personId = null }, now = Date.now()) {
    q.event.run(now, type, filmId, ticketId, sessionHash, screeningId, position, detail ? JSON.stringify(detail) : null, personId);
  }

  // May this browser use this ticket at all, before the ticket's own state?
  function mayHold(viewer, ticket) {
    if (!viewer || !ticket) return false;
    if (ticket.person_id != null) return ticket.person_id === viewer.person_id;
    return Boolean(q.holds.get(viewer.id_hash, ticket.id));
  }

  // Another browser holds the screening. It only blocks a takeover while it could
  // still play it: not once it is signed out, revoked or expired, its person
  // disabled, or the ticket no longer its to use.
  function holderCanPlay(hash, ticket, now) {
    const h = hash ? q.holder.get(hash, now) : null;
    return Boolean(h) && mayHold(h, ticket);
  }

  // The state of one ticket, whoever holds it.
  function ticketStatus(ticket, now = Date.now()) {
    const film = q.film.get(ticket.film_id);
    const open = q.open.get(ticket.id, now) || null;
    const used = q.used.get(ticket.id).n;
    const expiresAt =
      ticket.first_played_at && ticket.days_after_first_play ? ticket.first_played_at + ticket.days_after_first_play * DAY : null;
    // The start-by deadline only matters until the first screening starts.
    const startBy = ticket.first_played_at ? null : ticket.start_by;

    let state = 'ok';
    if (ticket.revoked_at) state = 'revoked';
    else if (!film?.published) state = 'unpublished';
    else if (film.media_status === 'error' || film.media_status === 'missing') state = 'unavailable';
    // Expiry wins over any resume window that is still running.
    else if ((expiresAt && expiresAt <= now) || (startBy && startBy <= now)) state = 'expired';
    else if (ticket.screening_limit != null && used >= ticket.screening_limit && !open) state = 'used_up';

    const limit = ticket.screening_limit;
    return {
      state,
      screeningsUsed: used,
      screeningLimit: limit,
      screeningsLeft: limit == null ? null : Math.max(0, limit - used),
      expiresAt,
      startBy,
      open,
    };
  }

  // Who may use a ticket is decided here and in mayHold, nowhere else.
  const ids = (viewer) => ({ session: viewer.id_hash, person: viewer.person_id ?? null });
  const candidates = (viewer, film) => q.forFilm.all({ film: film.id, ...ids(viewer) });

  // Best state first; then a ticket whose open screening this browser could resume
  // now, so Play resumes it (not one another browser is busy playing); then the
  // person's own ticket; then the oldest, which is the order before people existed.
  const byBest = (viewer, now) => {
    const resumable = ({ ticket, status: s }) =>
      Boolean(s.open) && (s.open.session_hash === viewer.id_hash || s.open.active_until <= now || !holderCanPlay(s.open.session_hash, ticket, now));
    return (a, b) =>
      RANK[a.status.state] - RANK[b.status.state] ||
      resumable(b) - resumable(a) ||
      (b.ticket.person_id != null) - (a.ticket.person_id != null) ||
      a.ticket.id - b.ticket.id;
  };

  // What this browser may do with a film page. Revoked and unpublished look
  // exactly like "no such film"; used-up, expired and broken media still show
  // the page so the viewer gets an explanation.
  function filmAccess({ viewer, admin }, film, now = Date.now()) {
    if (admin && film) return { canView: true, canPlay: true, ticket: null, status: null, via: 'admin' };
    if (!viewer || !film?.published) return NONE;
    const best = candidates(viewer, film)
      .map((ticket) => ({ ticket, status: ticketStatus(ticket, now) }))
      .sort(byBest(viewer, now))[0];
    if (!best) return NONE;
    const { state } = best.status;
    if (state === 'ok') return { canView: true, canPlay: true, via: 'ticket', ...best };
    if (state === 'used_up' || state === 'expired' || state === 'unavailable') return { canView: true, canPlay: false, via: 'ticket', ...best };
    return NONE;
  }

  // Playlists, segments, audio and subtitles need a screening that this
  // browser currently holds. A valid ticket alone is not enough.
  function mayStream({ viewer, admin }, film, now = Date.now()) {
    if (admin) return true;
    if (!viewer || !film?.published) return false;
    for (const ticket of candidates(viewer, film)) {
      const s = ticketStatus(ticket, now);
      if (s.state === 'ok' && s.open?.session_hash === viewer.id_hash) return true;
    }
    return false;
  }

  // Pressing Play. Resumes the ticket's open screening if there is one,
  // otherwise starts a new one if the limit allows. The check and the insert
  // share one write transaction, so two simultaneous presses can't both take
  // the last screening.
  function startScreening(viewer, film, now = Date.now()) {
    return tx(
      db,
      () => {
        const a = filmAccess({ viewer }, film, now);
        if (!a.canPlay) return { error: a.status?.state || 'no-access' };
        const { ticket, status } = a;
        let screening = status.open;
        let resumed = false;
        if (screening) {
          if (screening.session_hash !== viewer.id_hash && screening.active_until > now && holderCanPlay(screening.session_hash, ticket, now)) {
            return { error: 'playing-elsewhere' };
          }
          q.claim.run(viewer.id_hash, now, now + ACTIVE_MS, screening.id);
          resumed = true;
        } else {
          const until = now + settings.get().resumeWindowHours * HOUR;
          const id = Number(q.insertScreening.run(ticket.id, film.id, viewer.id_hash, now, until, now, now + ACTIVE_MS).lastInsertRowid);
          q.firstPlay.run(now, ticket.id);
          screening = { id };
        }
        screening = q.screening.get(screening.id);
        logEvent('play', { filmId: film.id, ticketId: ticket.id, sessionHash: viewer.id_hash, screeningId: screening.id, position: screening.position_seconds, detail: { resumed } }, now);
        return { screening, resumed, ticket };
      },
      { immediate: true },
    );
  }

  // Progress from the player. Also where "finished" is decided, so the
  // definition lives on the server rather than in each browser.
  function heartbeat(viewer, screeningId, { position, playing = true }, now = Date.now()) {
    const s = q.screening.get(screeningId);
    const ticket = s ? q.ticket.get(s.ticket_id) : null;
    if (!viewer || !s || s.voided_at || !mayHold(viewer, ticket)) return { error: 'not-found' };
    if (s.session_hash !== viewer.id_hash) return { error: 'playing-elsewhere' };
    const status = ticketStatus(ticket, now);
    if (status.state !== 'ok') return { error: status.state };
    if (status.open?.id !== s.id) return { error: 'screening-ended' };

    const film = q.film.get(s.film_id);
    const duration = JSON.parse(film.media || '{}').durationSeconds || null;
    const pos = Number.isFinite(position) ? Math.min(Math.max(position, 0), duration || 86400) : s.position_seconds;
    // A paused or closing player reports in once with playing=false, which
    // frees the screening for another device straight away.
    q.progress.run(now, playing ? now + ACTIVE_MS : now, pos, pos, duration, s.id);

    const base = { filmId: s.film_id, ticketId: s.ticket_id, sessionHash: viewer.id_hash, screeningId: s.id, position: pos };
    if (!s.finished_at && duration && Math.max(s.furthest_seconds, pos) >= FINISHED_AT * duration) {
      q.finish.run(now, s.id);
      logEvent('finished', base, now);
    }
    const last = q.lastScreeningEvent.get(s.id, 'heartbeat');
    if (playing && (!last || now - last.at >= HEARTBEAT_EVENT_MS)) logEvent('heartbeat', base, now);
    return { ok: true };
  }

  const usableTickets = (viewer) => (viewer ? q.usable.all(ids(viewer)) : []);

  return { ticketStatus, filmAccess, mayStream, startScreening, heartbeat, usableTickets, mayHold, logEvent };
}
