import express from 'express';
import { filmDetail, filmSummary, masterUrl, ticketForViewer } from '../films.js';

const OPENED_DEDUPE_MS = 30 * 60 * 1000;

// What a viewer's browser talks to. The ticket secret is only ever sent once,
// to /api/tickets/open; after that the browser uses its session cookie.
export function viewerRoutes({ db, sessions, access, settings, metadata, limit }) {
  // What the viewer site shows in its header and footer. TMDb asks for credit
  // wherever its data and images appear.
  const site = () => ({ ...settings.get(), tmdbCredit: metadata.status().configured });

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
    // In the admin's order. filmAccess still decides whether each one shows.
    memberFilms: db.prepare('SELECT * FROM films WHERE published = 1 AND member_visible = 1 ORDER BY sort_order, title COLLATE NOCASE'),
  };

  const who = (req) => ({ viewer: sessions.load(req, 'viewer'), admin: sessions.load(req, 'admin') });

  // Exchange a ticket link (your-domain/t/<code>) for a session. The page at
  // /t/<code> calls this from JavaScript, so link previews in chat apps, which
  // fetch the URL but don't run scripts, neither create sessions nor count as opens.
  const openLimit = limit({ windowMs: 10 * 60 * 1000, max: 30 });
  router.post('/api/tickets/open', openLimit, (req, res) => {
    const code = String(req.body?.code || '').trim().toLowerCase();
    const ticket = code && q.ticketByCode.get(code);
    if (!ticket) return res.status(404).json({ error: 'unknown-ticket' });
    const status = access.ticketStatus(ticket);
    if (status.state === 'revoked') return res.status(410).json({ error: 'ticket-revoked' });
    if (status.state === 'unpublished') return res.status(409).json({ error: 'film-unavailable' });

    // A ticket for one person works only for a browser signed in as them. Anyone
    // else gets nothing: no session, no cookie, no "opened", not even the film.
    if (ticket.person_id != null) {
      const viewer = sessions.load(req, 'viewer');
      if (!viewer?.person_id) return res.status(401).json({ error: 'sign-in-required' });
      if (viewer.person_id !== ticket.person_id) return res.status(403).json({ error: 'ticket-for-someone-else' });
      q.firstOpen.run(Date.now(), ticket.id);
      return res.json({ slug: q.filmById.get(ticket.film_id).slug });
    }

    const viewer = sessions.load(req, 'viewer') || sessions.create(req, res, 'viewer');
    q.attach.run(viewer.id_hash, ticket.id, Date.now());
    q.firstOpen.run(Date.now(), ticket.id);
    res.json({ slug: q.filmById.get(ticket.film_id).slug });
  });

  // What this browser can see: the cinema's name, the tickets it holds and, when
  // signed in, the films shown to members that none of those tickets is for.
  router.get('/api/me', (req, res) => {
    const { viewer, admin } = who(req);
    const seen = new Set();
    const tickets = [];
    for (const ticket of access.usableTickets(viewer)) {
      if (seen.has(ticket.film_id)) continue;
      const film = q.filmById.get(ticket.film_id);
      const a = access.filmAccess({ viewer }, film);
      // A revoked ticket for a film shown to members leaves only the listing, which
      // belongs under memberFilms.
      if (a.via !== 'ticket') continue;
      seen.add(film.id);
      tickets.push({ film: filmSummary(film), ticket: ticketForViewer(a.ticket, a.status) });
    }
    const person = viewer?.person_id != null ? { name: viewer.person_name } : null;
    const memberFilms = person
      ? q.memberFilms.all().filter((film) => access.filmAccess({ viewer }, film).via === 'member').map(filmSummary)
      : [];
    const linkTickets = viewer ? q.linkTitles.all(viewer.id_hash).map((r) => r.title) : [];
    res.json({ site: site(), admin: Boolean(admin), person, tickets, memberFilms, linkTickets });
  });

  router.get('/api/site', (req, res) => res.json(site()));

  // A film page. A film you have no ticket for looks the same as no film at all,
  // unless it's shown to members and you're signed in. Reading a member film's
  // page records nothing.
  router.get('/api/films/:slug', (req, res) => {
    const { viewer, admin } = who(req);
    const film = q.filmBySlug.get(req.params.slug);
    const a = access.filmAccess({ viewer, admin }, film);
    if (!a.canView) return res.status(404).json({ error: 'not-found' });

    if (a.via === 'ticket') {
      // A ticket for one person may never have been opened by its link.
      q.firstOpen.run(Date.now(), a.ticket.id);
      const last = q.lastOpened.get(viewer.id_hash, a.ticket.id);
      if (!last || Date.now() - last.at > OPENED_DEDUPE_MS) {
        access.logEvent('opened', { filmId: film.id, ticketId: a.ticket.id, sessionHash: viewer.id_hash });
      }
    }
    res.json({
      film: filmDetail(film),
      access: {
        canPlay: a.canPlay,
        via: a.via,
        ticket: ticketForViewer(a.ticket, a.status),
        preview: a.via === 'admin',
        published: Boolean(film?.published),
        mediaStatus: film.media_status,
      },
    });
  });

  // Pressing Play: start or resume a screening, then hand over the playlist.
  router.post('/api/films/:slug/screenings', (req, res) => {
    const { viewer, admin } = who(req);
    const film = q.filmBySlug.get(req.params.slug);
    if (!film) return res.status(404).json({ error: 'not-found' });
    // A browser signed in to the admin always plays in preview mode and never
    // uses a screening. Test tickets in another browser or a private window.
    if (admin) return res.json({ screeningId: null, preview: true, masterUrl: masterUrl(film), position: 0 });
    if (!viewer) return res.status(404).json({ error: 'not-found' });

    const r = access.startScreening(viewer, film);
    if (r.error === 'no-access') return res.status(404).json({ error: 'not-found' });
    // Including no-ticket: a film shown to members, which this browser may read about but not play.
    if (r.error) return res.status(409).json({ error: r.error });
    res.json({
      screeningId: r.screening.id,
      resumed: r.resumed,
      position: r.screening.position_seconds,
      resumableUntil: r.screening.resumable_until,
      masterUrl: masterUrl(film),
    });
  });

  router.post('/api/screenings/:id/heartbeat', (req, res) => {
    const viewer = sessions.load(req, 'viewer');
    const r = access.heartbeat(viewer, Number(req.params.id), {
      position: Number(req.body?.position),
      playing: req.body?.playing !== false,
    });
    if (r.error === 'not-found') return res.status(404).json({ error: 'not-found' });
    if (r.error) return res.status(409).json({ error: r.error });
    res.json({ ok: true });
  });

  return router;
}
