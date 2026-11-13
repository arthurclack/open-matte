import express from 'express';
import { isSpent } from '../access.js';
import { filmDetail, filmSummary, masterUrl, ticketForViewer } from '../films.js';

const OPENED_DEDUPE_MS = 30 * 60 * 1000;

// What a viewer's browser talks to. The ticket secret is only ever sent to
// /api/tickets/open: once for a ticket for anyone, and for a ticket for one person
// again after signing in, since its code waits in /t/ until then. Everything else
// goes by the session cookie.
export function viewerRoutes({ db, sessions, access, site, limit }) {
  const router = express.Router();

  const q = {
    ticketByCode: db.prepare('SELECT * FROM tickets WHERE code = ?'),
    filmById: db.prepare('SELECT * FROM films WHERE id = ?'),
    filmBySlug: db.prepare('SELECT * FROM films WHERE slug = ?'),
    firstOpen: db.prepare('UPDATE tickets SET first_opened_at = ? WHERE id = ? AND first_opened_at IS NULL'),
    attach: db.prepare('INSERT OR IGNORE INTO session_tickets (session_hash, ticket_id, added_at) VALUES (?, ?, ?)'),
    // Every link ticket this browser holds, for the sign-out warning: /api/me lists
    // only the best ticket per film, which may be the person's own.
    linkTitles: db.prepare(`
      SELECT DISTINCT f.title FROM session_tickets st JOIN tickets t ON t.id = st.ticket_id JOIN films f ON f.id = t.film_id
      WHERE st.session_hash = ? AND t.person_id IS NULL AND t.revoked_at IS NULL AND f.published = 1
      ORDER BY f.title`),
    lastOpened: db.prepare(`SELECT at FROM events WHERE type = 'opened' AND session_hash = ? AND ticket_id = ? ORDER BY at DESC LIMIT 1`),
    holds: db.prepare('SELECT 1 FROM session_tickets WHERE session_hash = ? AND ticket_id = ?'),
    // This browser opened the link of a ticket for this film that someone has kept
    // since (or that was given to someone). Revoking forgets these rows.
    keptFrom: db.prepare(`
      SELECT 1 FROM session_tickets st JOIN tickets t ON t.id = st.ticket_id
      WHERE st.session_hash = ? AND t.film_id = ? AND t.person_id IS NOT NULL AND t.revoked_at IS NULL LIMIT 1`),
    // In the admin's order. filmAccess still decides whether each one shows.
    memberFilms: db.prepare('SELECT * FROM films WHERE published = 1 AND member_visible = 1 ORDER BY sort_order, title COLLATE NOCASE'),
  };

  const who = (req) => ({ viewer: sessions.load(req, 'viewer'), admin: sessions.load(req, 'admin') });

  // Exchange a ticket link (your-domain/t/<code>) for a session. The page at
  // /t/<code> calls this from JavaScript, so link previews in chat apps, which
  // fetch the URL but don't run scripts, neither create sessions nor count as opens.
  const openLimit = limit({ windowMs: 10 * 60 * 1000, max: 30 });
  router.post('/api/tickets/open', openLimit, (req, res) => {
    // Only a string can be a code. Anything else (a number, an object built to
    // break String()) is no ticket, not a server error.
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toLowerCase() : '';
    const ticket = code && q.ticketByCode.get(code);
    if (!ticket) return res.status(404).json({ error: 'unknown-ticket' });
    const status = access.ticketStatus(ticket);
    if (status.state === 'revoked') return res.status(410).json({ error: 'ticket-revoked' });
    if (status.state === 'unpublished') return res.status(409).json({ error: 'film-unavailable' });

    // A ticket for one person works only for a browser signed in as them. Anyone
    // else gets nothing: no session, no cookie, no "opened", not even the film.
    // A browser that opened the link while it was for anyone is told it was kept.
    if (ticket.person_id != null) {
      const viewer = sessions.load(req, 'viewer');
      if (viewer && viewer.person_id === ticket.person_id) {
        q.firstOpen.run(Date.now(), ticket.id);
        return res.json({ slug: q.filmById.get(ticket.film_id).slug });
      }
      if (viewer && q.holds.get(viewer.id_hash, ticket.id)) return res.status(410).json({ error: 'ticket-kept' });
      if (!viewer?.person_id) return res.status(401).json({ error: 'sign-in-required' });
      return res.status(403).json({ error: 'ticket-for-someone-else' });
    }

    // A link that has lent, and whose tape is back, has done its job. A browser that
    // holds it still has its page (returned, or it was due). Any other gets nothing:
    // no session, no cookie, not the film. Whether the film's tape is out now is
    // never read here: opening is the same with the tape in or out, and takes nothing.
    const known = sessions.load(req, 'viewer');
    if (isSpent(status) && !(known && q.holds.get(known.id_hash, ticket.id))) return res.status(410).json({ error: 'ticket-spent' });

    const viewer = known || sessions.create(req, res, 'viewer');
    q.attach.run(viewer.id_hash, ticket.id, Date.now());
    q.firstOpen.run(Date.now(), ticket.id);
    res.json({ slug: q.filmById.get(ticket.film_id).slug });
  });

  // What this browser can see: the cinema's name, the tickets it holds and, when
  // signed in, the films shown to members that none of those tickets is for.
  // tickets: what this browser has out comes first, the soonest due back first; then
  // the rest, newest first. Only a tape that is this browser's (or this person's)
  // moves a film up, so the order says nothing of anyone else's.
  // memberFilms: each with whether its tape is in or out and when it's due back
  // (access.shelfTape): never who has it.
  // browserLoans: the titles this browser has out on links anyone can use, which a
  // sign-out sends back; linkTickets: every link for anyone it holds.
  router.get('/api/me', (req, res) => {
    const { viewer, admin } = who(req);
    const seen = new Set();
    const held = [];
    for (const ticket of access.usableTickets(viewer)) {
      if (seen.has(ticket.film_id)) continue;
      const film = q.filmById.get(ticket.film_id);
      const a = access.filmAccess({ viewer }, film);
      // A revoked ticket for a film shown to members leaves only the listing, which
      // belongs under memberFilms.
      if (a.via !== 'ticket') continue;
      seen.add(film.id);
      held.push({ film: filmSummary(film), ticket: ticketForViewer(a) });
    }
    const yours = held.filter((x) => x.ticket.tape === 'yours').sort((a, b) => a.ticket.dueBack - b.ticket.dueBack);
    const tickets = [...yours, ...held.filter((x) => x.ticket.tape !== 'yours')];
    const person = viewer?.person_id != null ? { name: viewer.person_name } : null;
    const memberFilms = person
      ? q.memberFilms.all()
          .filter((film) => access.filmAccess({ viewer }, film).via === 'member')
          .map((film) => ({ ...filmSummary(film), ...access.shelfTape(film) }))
      : [];
    const linkTickets = viewer ? q.linkTitles.all(viewer.id_hash).map((r) => r.title) : [];
    res.json({ site: site(), admin: Boolean(admin), person, tickets, memberFilms, linkTickets, browserLoans: access.browserLoans(viewer) });
  });

  router.get('/api/site', (req, res) => res.json(site()));

  // A film page. A film you have no ticket for looks the same as no film at all,
  // unless it's shown to members and you're signed in. Reading a member film's
  // page records nothing. ?again=1 is the page reading itself again, after Play or
  // once the player stops: nobody opened anything, so that isn't logged as opened.
  router.get('/api/films/:slug', (req, res) => {
    const { viewer, admin } = who(req);
    const film = q.filmBySlug.get(req.params.slug);
    const a = access.filmAccess({ viewer, admin }, film);
    // No ticket shows the film, but this browser opened the link of one that has
    // been kept in someone's account since: say so, rather than "nothing showing".
    const kept = Boolean(viewer && film?.published && (a.via === null || a.via === 'member') && q.keptFrom.get(viewer.id_hash, film.id));
    if (!a.canView) return kept ? res.status(410).json({ error: 'ticket-kept' }) : res.status(404).json({ error: 'not-found' });

    if (a.via === 'ticket') {
      // A ticket for one person may never have been opened by its link.
      q.firstOpen.run(Date.now(), a.ticket.id);
      const last = q.lastOpened.get(viewer.id_hash, a.ticket.id);
      if (req.query.again !== '1' && (!last || Date.now() - last.at > OPENED_DEDUPE_MS)) {
        access.logEvent('opened', { filmId: film.id, ticketId: a.ticket.id, sessionHash: viewer.id_hash });
      }
    }
    // A tape this browser has out lives as long as its session, which was made to
    // last a day past the due time (and again when a due date is moved later): the
    // cookie is sent again here, so the browser keeps it that long too.
    if (a.tape === 'yours' && a.status.loan.person_id == null) sessions.refreshViewerCookie(req, res);
    // Who has the tape, since when and until when: for the admin's preview only.
    // access.js gives nothing for any other browser, and then there is no such key.
    const tape = access.tapeForPreview(a, film);
    res.json({
      film: filmDetail(film),
      access: {
        canPlay: a.canPlay,
        via: a.via,
        ticket: ticketForViewer(a),
        preview: a.via === 'admin',
        published: Boolean(film?.published),
        mediaStatus: film.media_status,
        // The ticket shown here could be kept in an account (after signing in, if need be).
        canKeep: access.canKeep(a),
        // A film shown to members whose ticket this browser had was kept by someone.
        ticketKept: kept,
        ...(tape && { tape }),
      },
    });
  });

  // Pressing Play: take the tape if it is in, or carry on with it if it is this
  // browser's, then hand over the playlist. A person presses it a few times an
  // evening; the limit stops a script that presses it in a loop with a forwarded link.
  const playLimit = limit({ windowMs: 10 * 60 * 1000, max: 60 });
  router.post('/api/films/:slug/screenings', playLimit, (req, res) => {
    const { viewer, admin } = who(req);
    const film = q.filmBySlug.get(req.params.slug);
    if (!film) return res.status(404).json({ error: 'not-found' });
    // A browser signed in to the admin always plays in preview mode and never
    // takes a tape. Trying a link in another browser or a private window does.
    if (admin) return res.json({ screeningId: null, preview: true, masterUrl: masterUrl(film), position: 0 });
    if (!viewer) return res.status(404).json({ error: 'not-found' });

    const r = access.startScreening(viewer, film);
    if (r.error === 'no-access') return res.status(404).json({ error: 'not-found' });
    // The view's name is the code: out, spent, expired, unavailable. Also
    // playing-elsewhere, and no-ticket: a film shown to members, which this browser
    // may read about but not play.
    if (r.error) return res.status(409).json({ error: r.error });
    // The tape is this browser's, and its session was made to last a day past the
    // due time: the cookie is sent again with that life, after the transaction.
    const toBrowser = r.loan.person_id == null;
    if (toBrowser) sessions.refreshViewerCookie(req, res);
    res.json({
      screeningId: r.screening.id,
      resumed: r.resumed,
      took: !r.resumed,
      position: r.screening.position_seconds,
      masterUrl: masterUrl(film),
      takenAt: r.loan.taken_at,
      dueBack: r.loan.due_at,
      toBrowser,
    });
  });

  // Keeping the ticket this film's page shows in the signed-in person's account.
  // No such film is answered as a film with no ticket here to keep, which is what
  // every film this browser can't see gets: a 404 for one and not the other would
  // tell anyone signed in which films there are, unpublished ones included.
  const keepLimit = limit({ windowMs: 10 * 60 * 1000, max: 30 });
  router.post('/api/films/:slug/keep', keepLimit, (req, res) => {
    const viewer = sessions.load(req, 'viewer');
    if (viewer?.person_id == null) return res.status(401).json({ error: 'sign-in-required' });
    const film = q.filmBySlug.get(req.params.slug);
    const r = film ? access.keep(viewer, film) : { error: 'cannot-keep' };
    if (r.error) return res.status(409).json({ error: r.error });
    res.json({ ticket: ticketForViewer(access.filmAccess({ viewer }, film)) });
  });

  // Return it now: the borrower hands the tape back before it's due. takenAt is the
  // loan's, as the film page gave it, so a tab left open from an earlier loan can't
  // return a later one. Anyone who isn't the borrower of that loan gets one answer,
  // whatever they send and whether or not there is such a film, as keep does: 409
  // nothing-to-return. A request that couldn't be a return (no takenAt, a message
  // with no response) is a 400 before anything is looked up, the same for everyone.
  // Hand it back: the same return with one of the four responses, and a message or
  // none, for the admin alone. Only the member who borrowed the tape on their own
  // link can (access.js): a borrower who can't, on a browser's loan, gets 409
  // cannot-respond and the tape stays out. Nothing a viewer is ever sent holds a
  // response: this answers only that one was taken.
  const RESPONSES = ['loved-it', 'still-thinking', 'not-for-me', 'lets-talk'];
  const returnLimit = limit({ windowMs: 10 * 60 * 1000, max: 30 });
  router.post('/api/films/:slug/return', returnLimit, (req, res) => {
    const b = req.body || {};
    if (!Number.isSafeInteger(b.takenAt)) return res.status(400).json({ error: 'taken-at-required' });
    if (b.response != null && !RESPONSES.includes(b.response)) return res.status(400).json({ error: 'bad-response' });
    if (b.message != null && (typeof b.message !== 'string' || b.message.length > 2000)) return res.status(400).json({ error: 'bad-message' });
    if (b.message != null && b.response == null) return res.status(400).json({ error: 'message-needs-response' });
    const { viewer, admin } = who(req);
    const film = q.filmBySlug.get(req.params.slug);
    // The admin's browser sees every film as a preview, which never takes a tape and
    // shows no loan: so it has nothing to return either, as Play there takes nothing,
    // even if it is also signed in as the member who has the tape. The page and
    // this route then agree for every browser.
    if (admin) return res.status(409).json({ error: 'nothing-to-return' });
    // A message of nothing but spaces is no message. (A NUL has no place in words,
    // and SQLite would count a message that starts with one as empty.)
    const message = b.message == null ? null : b.message.replaceAll('\0', '').trim() || null;
    const r = access.returnTape(viewer, film, { takenAt: b.takenAt, response: b.response ?? null, message });
    if (r.error) return res.status(409).json({ error: r.error });
    res.json({ returned: r.returned, responded: r.responded });
  });

  router.post('/api/screenings/:id/heartbeat', (req, res) => {
    const viewer = sessions.load(req, 'viewer');
    // No session any more: this browser was signed out (or its person disabled)
    // while it played. Saying so tells nothing that /api/me doesn't.
    if (!viewer) return res.status(404).json({ error: 'signed-out' });
    const r = access.heartbeat(viewer, Number(req.params.id), {
      // Only a number is a position. Anything else keeps the last one (access.js).
      position: typeof req.body?.position === 'number' ? req.body.position : NaN,
      playing: req.body?.playing !== false,
    });
    if (r.error === 'not-found') return res.status(404).json({ error: 'not-found' });
    if (r.error) return res.status(409).json({ error: r.error });
    res.json({ ok: true });
  });

  return router;
}
