import express from 'express';
import { LOAN_EVENTS } from '../access.js';
import { VERSION } from '../booth.js';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from '../branding.js';
import { publicOrigin } from '../config.js';
import { tx } from '../db.js';
import { artworkUrl, filmArtwork, filmMedia } from '../films.js';
import { MetadataError, TMDB_FIELDS } from '../metadata.js';
import { rangeKey } from '../ratelimit.js';
import { META_FIELDS, scanMedia } from '../scan.js';
import { peopleRoutes } from './people.js';
import { ADMIN_COOKIE, clearCookie, ticketCode } from '../sessions.js';
import { COLOR, check, palette } from '../theme.js';
import { guessTitleYear, looksLikeReleaseName } from '../titles.js';

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

const optInt = (v, name, { min = 0, max = 100000 } = {}) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number from ${min} to ${max}`);
  return n;
};
// Text, or nothing. Anything else is refused: an object would be stored as "[object Object]".
const optText = (v, max, name) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw bad(`${name} must be text`);
  return v.trim() === '' ? null : v.trim().slice(0, max);
};
// A switch is true or false. Anything else is refused: the string "false" would turn it on.
const bool = (v, name) => {
  if (typeof v !== 'boolean') throw bad(`${name} must be true or false`);
  return v;
};
const optTime = (v, name) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw bad(`${name} must be a timestamp`);
  return Math.round(n);
};

const parseJson = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

// TMDb problems (bad key, TMDb down) are worth showing as they are.
const metadataRoute = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (!(err instanceof MetadataError)) throw err;
    res.status(err.status).json({ error: err.message, code: err.code });
  }
};

export function adminRoutes(deps) {
  const { db, sessions, access, settings, mediaDir, metadata, backups, rp, limit, branding, retention, booth } = deps;
  const router = express.Router();
  // Ten tries per client: an IPv4 address, or an IPv6 /64. Someone holding a whole
  // range of IPv6 addresses would get ten fresh tries from each of its /64s, so
  // there are thirty across each /48 as well (rangeKey), whichever of its /64s they
  // come from. Only tries the first limit lets through count towards the second, so
  // a script hammering from one /64 can't use up its neighbours' tries on its own.
  // There's deliberately no limit across every address together: anyone could use
  // it up, and the real admin would be locked out along with them.
  const loginLimit = limit({ windowMs: 15 * 60 * 1000, max: 10 });
  const loginRangeLimit = limit({ windowMs: 15 * 60 * 1000, max: 30, key: rangeKey });

  // ------------------------------------------------------------ sign-in
  router.post('/api/admin/login', loginLimit, loginRangeLimit, (req, res) => {
    if (!sessions.adminPasswordMatches(req.body?.password)) return res.status(401).json({ error: 'wrong-password' });
    sessions.create(req, res, 'admin');
    res.json({ ok: true });
  });

  router.post('/api/admin/logout', (req, res) => {
    const s = sessions.load(req, 'admin');
    if (s) sessions.revoke(s.id_hash);
    clearCookie(req, res, ADMIN_COOKIE);
    res.json({ ok: true });
  });

  router.use('/api/admin', (req, res, next) => {
    req.admin = sessions.load(req, 'admin');
    if (!req.admin) return res.status(401).json({ error: 'not-signed-in' });
    next();
  });

  router.get('/api/admin/session', (req, res) => res.json({ ok: true }));

  // People and passkeys.
  router.use(peopleRoutes(deps));

  // ------------------------------------------------------------ films
  const filmRow = db.prepare('SELECT * FROM films WHERE id = ?');
  const getFilm = (id) => {
    const f = filmRow.get(Number(id));
    if (!f) throw bad('Film not found', 404);
    return f;
  };

  // How the film's tickets have been used, from tickets and screenings only, so
  // deleting old events never changes it. Revoked tickets count among those
  // issued (and are counted again on their own); played means any screening,
  // finished one that reached the end and wasn't given back.
  const filmViewing = {
    tickets: db.prepare(`
      SELECT COUNT(*) AS issued, COALESCE(SUM(revoked_at IS NOT NULL), 0) AS revoked,
             COALESCE(SUM(first_opened_at IS NOT NULL), 0) AS opened,
             COALESCE(SUM(EXISTS (SELECT 1 FROM screenings s WHERE s.ticket_id = t.id)), 0) AS played,
             COALESCE(SUM(EXISTS (SELECT 1 FROM screenings s WHERE s.ticket_id = t.id AND s.finished_at IS NOT NULL AND s.voided_at IS NULL)), 0) AS finished
      FROM tickets t WHERE t.film_id = ?`),
    screenings: db.prepare('SELECT COUNT(*) AS started, COALESCE(SUM(voided_at IS NOT NULL), 0) AS voided FROM screenings WHERE film_id = ?'),
  };
  function viewingOf(filmId) {
    const s = filmViewing.screenings.get(filmId);
    return { ...filmViewing.tickets.get(filmId), screenings: s.started, voided: s.voided };
  }

  // One film for the admin. The list leaves out `viewing`, which only the film's own page shows.
  function adminFilm(f, { viewing = true } = {}) {
    const media = filmMedia(f);
    const artwork = filmArtwork(f);
    const out = { id: f.id, slug: f.slug };
    for (const [key, { column }] of Object.entries(META_FIELDS)) out[key] = f[column];
    // A missing poster stops mattering once TMDb has supplied one.
    const scanReport = parseJson(f.scan_report, { errors: [], warnings: [] });
    if (artwork.poster) scanReport.warnings = scanReport.warnings.filter((w) => !w.startsWith('No poster in film.json'));
    const mediaStatus = f.media_status === 'warning' && !scanReport.warnings.length && !scanReport.errors.length ? 'ok' : f.media_status;
    return {
      ...out,
      published: Boolean(f.published),
      // Listed for signed-in people once published; playing still needs a ticket.
      memberVisible: Boolean(f.member_visible),
      sortOrder: f.sort_order,
      mediaStatus,
      scanReport,
      importedMeta: f.imported_meta ? JSON.parse(f.imported_meta) : null,
      scannedAt: f.scanned_at,
      updatedAt: f.updated_at,
      posterUrl: artworkUrl(f, 'poster'),
      backdropUrl: artworkUrl(f, 'backdrop'),
      artworkSource: {
        poster: artwork.poster ? 'tmdb' : media.poster ? 'folder' : null,
        backdrop: artwork.backdrop ? 'tmdb' : media.backdrop ? 'folder' : null,
      },
      tmdbId: f.tmdb_id,
      tmdbStatus: parseJson(f.tmdb_status, null),
      // What to search TMDb for: a file-name title is cleaned up first.
      lookup: looksLikeReleaseName(f.title) ? guessTitleYear(f.title) : { title: f.title, year: f.year },
      metaSources: parseJson(f.meta_sources, {}),
      media,
      ...(viewing && { viewing: viewingOf(f.id) }),
    };
  }

  router.post('/api/admin/scan', async (req, res) => {
    let report;
    try {
      report = await scanMedia(db, mediaDir);
    } catch (err) {
      console.error('Media scan failed:', err);
      return res.status(503).json({ error: `The scan failed: ${err.message}. Nothing was changed.` });
    }
    // New films get matched against TMDb in the background.
    metadata.queueUnmatched();
    res.json({ ...report, matching: metadata.status().configured });
  });

  router.get('/api/admin/films', (req, res) => {
    const counts = new Map(
      db.prepare('SELECT film_id, COUNT(*) AS total, SUM(revoked_at IS NULL) AS active FROM tickets GROUP BY film_id').all().map((r) => [r.film_id, r]),
    );
    const films = db.prepare('SELECT * FROM films ORDER BY published DESC, sort_order, title COLLATE NOCASE').all();
    res.json(films.map((f) => ({ ...adminFilm(f, { viewing: false }), tickets: { total: counts.get(f.id)?.total ?? 0, active: counts.get(f.id)?.active ?? 0 } })));
  });

  router.get('/api/admin/films/:id', (req, res) => res.json(adminFilm(getFilm(req.params.id))));

  router.patch('/api/admin/films/:id', (req, res) => {
    const f = getFilm(req.params.id);
    const b = req.body || {};
    const sets = [];
    const args = [];
    const sources = parseJson(f.meta_sources, {});
    for (const [key, { column, check }] of Object.entries(META_FIELDS)) {
      if (!(key in b)) continue;
      // The same rules as film.json, applied to admin edits.
      const value = typeof b[key] === 'string' && /^(year|runtimeMinutes)$/.test(key) ? (b[key].trim() === '' ? null : Number(b[key])) : b[key];
      const r = check(value === '' ? null : value);
      if (r.error) throw bad(`${key} ${r.error}`);
      if (key === 'title' && !r.value) throw bad('A film needs a title');
      sets.push(`${column} = ?`);
      args.push(r.value);
      // Your edit replaces whatever TMDb said.
      if (r.value !== f[column]) delete sources[key];
    }
    sets.push('meta_sources = ?');
    args.push(JSON.stringify(sources));
    if ('sortOrder' in b) sets.push('sort_order = ?'), args.push(optInt(b.sortOrder, 'Sort order', { min: -100000 }) ?? 0);
    if ('published' in b) {
      if (bool(b.published, 'published') && (f.media_status === 'error' || f.media_status === 'missing')) {
        throw bad("This film's media has errors. Fix the folder and scan again before putting it on the shelf.");
      }
      sets.push('published = ?'), args.push(b.published ? 1 : 0);
    }
    if ('memberVisible' in b) sets.push('member_visible = ?'), args.push(bool(b.memberVisible, 'memberVisible') ? 1 : 0);
    if (sets.length) db.prepare(`UPDATE films SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, Date.now(), f.id);
    res.json(adminFilm(getFilm(f.id)));
  });

  // Throw away admin edits and take the values film.json gave at the last scan.
  // Only edits: a value from TMDb isn't one (the page marks it "from TMDB", not
  // "edited here"), and stays. film.json usually has nothing there, and with the
  // film matched nothing would fill it again. (One taken by hand in place of
  // film.json's is an edit: metadata.js, applyDetails.) `fields`, if given,
  // narrows it to those keys.
  router.post('/api/admin/films/:id/reset-metadata', (req, res) => {
    const f = getFilm(req.params.id);
    const meta = f.imported_meta ? JSON.parse(f.imported_meta) : null;
    if (!meta) throw bad('This film has no imported metadata yet');
    const only = req.body?.fields;
    if (only != null && !(Array.isArray(only) && only.every((k) => typeof k === 'string' && Object.hasOwn(META_FIELDS, k)))) {
      throw bad(`fields must be a list of these: ${Object.keys(META_FIELDS).join(', ')}`);
    }
    const sources = parseJson(f.meta_sources, {});
    const fields = Object.entries(META_FIELDS).filter(([key]) => (!only || only.includes(key)) && sources[key] !== 'tmdb');
    if (fields.length) {
      db.prepare(`UPDATE films SET ${fields.map(([, { column }]) => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(
        ...fields.map(([key]) => meta[key] ?? (key === 'title' ? f.title : null)), Date.now(), f.id,
      );
    }
    res.json(adminFilm(getFilm(f.id)));
  });

  // ------------------------------------------------------------ film information (TMDb)
  router.get('/api/admin/metadata', (req, res) => res.json({ ...metadata.status(), language: settings.get().metadataLanguage }));

  router.get(
    '/api/admin/films/:id/metadata/search',
    metadataRoute(async (req, res) => {
      getFilm(req.params.id);
      const query = optText(req.query.q, 200, 'The search');
      if (!query) throw bad('Type a title to search for');
      const year = optInt(req.query.year, 'Year', { min: 1870, max: 2200 });
      res.json({ results: await metadata.search(query, year) });
    }),
  );

  // What applying this TMDb entry would change.
  router.get(
    '/api/admin/films/:id/metadata/:tmdbId',
    metadataRoute(async (req, res) => {
      const f = getFilm(req.params.id);
      const tmdbId = optInt(req.params.tmdbId, 'TMDB id', { min: 1, max: 1e9 });
      const d = await metadata.details(tmdbId);
      const current = Object.fromEntries(TMDB_FIELDS.map((k) => [k, f[META_FIELDS[k].column]]));
      const sources = parseJson(f.meta_sources, {});
      // Ticked by default: gaps, file-name titles, and values TMDb gave before.
      const suggestedFields = TMDB_FIELDS.filter((k) => {
        const value = d.fields[k];
        const now = current[k];
        if (value == null || value === now) return false;
        return now == null || now === '' || sources[k] === 'tmdb' || (k === 'title' && looksLikeReleaseName(now));
      });
      res.json({ ...d, current, sources, suggestedFields });
    }),
  );

  router.post(
    '/api/admin/films/:id/metadata/apply',
    metadataRoute(async (req, res) => {
      const f = getFilm(req.params.id);
      const b = req.body || {};
      const tmdbId = optInt(b.tmdbId, 'TMDB id', { min: 1, max: 1e9 });
      if (!tmdbId) throw bad('Choose a film first');
      const fields = Array.isArray(b.fields) ? b.fields.filter((k) => TMDB_FIELDS.includes(k)) : [];
      const image = (v) => (typeof v === 'string' && v ? v : undefined);
      const r = await metadata.apply(f, { tmdbId, fields, poster: image(b.poster), backdrop: image(b.backdrop) });
      res.json({ film: adminFilm(r.film), changed: r.changed });
    }),
  );

  // Go back to the folder's own poster or backdrop.
  router.post('/api/admin/films/:id/artwork/reset', (req, res) => {
    const f = getFilm(req.params.id);
    const kind = req.body?.kind;
    if (kind !== 'poster' && kind !== 'backdrop') throw bad('kind must be poster or backdrop');
    res.json(adminFilm(metadata.resetArtwork(f, kind)));
  });

  // ------------------------------------------------------------ tickets
  const ticketRow = db.prepare('SELECT * FROM tickets WHERE id = ?');
  const getTicket = (id) => {
    const t = ticketRow.get(Number(id));
    if (!t) throw bad('Tape not found', 404);
    return t;
  };
  const deviceOf = db.prepare('SELECT device FROM sessions WHERE id_hash = ?');

  // The browsers holding a ticket from its link: session_tickets joined to sessions
  // that are still live, by the rule sessions.load uses (not signed out or expired,
  // and if signed in, as a person who exists and isn't disabled). A signed-out
  // browser keeps its rows until the clean-up deletes the session, which can be
  // months, but it can't use the ticket, nor get it back on a release. Its one
  // parameter is the time now.
  const LIVE_HOLDERS = `
    session_tickets st JOIN sessions s ON s.id_hash = st.session_hash LEFT JOIN people p ON p.id = s.person_id
    WHERE s.revoked_at IS NULL AND s.expires_at > ? AND (s.person_id IS NULL OR (p.id IS NOT NULL AND p.disabled_at IS NULL))`;

  // What the admin shows about tickets besides the tickets themselves, in a few
  // grouped queries for the lot rather than several per ticket. Pass ticket ids
  // to limit it to those, or nothing for all tickets.
  function ticketContext(ids = null, now = Date.now()) {
    const only = ids ? `AND ticket_id IN (${ids.map(() => '?').join(', ')})` : '';
    const args = ids || [];
    const byTicket = (rows) => new Map(rows.map((r) => [r.ticket_id, r]));
    const films = new Map(
      db.prepare('SELECT id, slug, title, media FROM films').all()
        .map((f) => [f.id, { film: { id: f.id, slug: f.slug, title: f.title }, durationSeconds: filmMedia(f).durationSeconds ?? null }]),
    );
    const people = new Map(db.prepare('SELECT id, name, disabled_at FROM people').all().map((p) => [p.id, { id: p.id, name: p.name, disabled: Boolean(p.disabled_at) }]));
    if (ids && !ids.length) return { films, people, browsers: new Map(), lastEvent: new Map(), lastScreening: new Map(), progress: new Map() };
    return {
      films,
      people,
      browsers: byTicket(db.prepare(`SELECT st.ticket_id, COUNT(*) AS n FROM ${LIVE_HOLDERS} ${only} GROUP BY st.ticket_id`).all(now, ...args)),
      // The latest in Activity's order, (at, id), so of two events at the same
      // moment it's the one Activity lists first. Sending the link isn't activity on
      // it: one nobody has touched shows none, as it does once its events have gone.
      lastEvent: byTicket(db.prepare(`
        SELECT ticket_id, at, type FROM (
          SELECT ticket_id, at, type, ROW_NUMBER() OVER (PARTITION BY ticket_id ORDER BY at DESC, id DESC) AS n
          FROM events WHERE ticket_id IS NOT NULL AND type <> 'ticket-sent' ${only})
        WHERE n = 1`).all(...args)),
      // The latest screening's last report, which outlives the events the clean-up deletes.
      lastScreening: byTicket(db.prepare(`SELECT ticket_id, MAX(COALESCE(last_heartbeat_at, started_at)) AS at FROM screenings WHERE 1 ${only} GROUP BY ticket_id`).all(...args)),
      progress: byTicket(
        db.prepare(`SELECT ticket_id, COUNT(*) AS plays, MAX(furthest_seconds) AS furthest, MAX(finished_at IS NOT NULL) AS finished
                    FROM screenings WHERE voided_at IS NULL ${only} GROUP BY ticket_id`).all(...args),
      ),
    };
  }

  // Until the back office is rebuilt for loans, a link is still described to it in
  // 1.x's fields and states. A link that can lend, is waiting for the tape or has it
  // is 'ok'; one that has lent is 'used_up'. expiresAt and openScreening are its
  // loan's due time and playback while it has the tape. screeningLimit and
  // daysAfterFirstPlay are what a 1.x link was sent with: history, read by nothing.
  const OLD_STATE = { in: 'ok', waiting: 'ok', lent: 'ok', spent: 'used_up' };
  const screeningRow = db.prepare('SELECT * FROM screenings WHERE id = ?');

  function adminTicket(req, t, now = Date.now(), ctx = ticketContext([t.id])) {
    const status = access.ticketStatus(t, now);
    const film = ctx.films.get(t.film_id);
    const progress = ctx.progress.get(t.id) || {};
    // The latest event. Once the clean-up has deleted them all, the latest
    // screening's last report, and without a screening the first open: both
    // outlive the events, so a ticket that was used never shows as untouched.
    const screening = ctx.lastScreening.get(t.id);
    const last = ctx.lastEvent.get(t.id)
      ?? (screening && { at: screening.at, type: 'play' })
      ?? (t.first_opened_at && { at: t.first_opened_at, type: 'opened' });
    // Browsers that opened the link. Once the ticket has a person they can't use
    // it: they're waiting, and get it back if it's released.
    const opened = ctx.browsers.get(t.id)?.n ?? 0;
    // The loan's playback, while the link has the tape.
    const open = status.state === 'lent' ? screeningRow.get(status.loan.screening_id) : null;
    const limit = t.screening_limit;
    const plays = progress.plays ?? 0;
    return {
      id: t.id,
      code: t.code,
      link: `${publicOrigin(req)}/t/${t.code}`,
      film: film?.film ?? null,
      // Set: only this person can use it, signed in. Null: anyone with the link.
      person: t.person_id != null ? ctx.people.get(t.person_id) ?? null : null,
      // A ticket for anyone that whoever keeps it first can keep in their account.
      claimable: Boolean(t.claimable),
      // When its person kept it from a link. Null for one issued or given to them.
      claimedAt: t.claimed_at,
      label: t.label,
      screeningLimit: limit,
      startBy: t.start_by,
      daysAfterFirstPlay: t.days_after_first_play,
      firstOpenedAt: t.first_opened_at,
      firstPlayedAt: t.first_played_at,
      revokedAt: t.revoked_at,
      createdAt: t.created_at,
      state: OLD_STATE[status.state] ?? status.state,
      screeningsUsed: plays,
      screeningsLeft: limit == null ? null : Math.max(0, limit - plays),
      expiresAt: open ? status.loan.due_at : null,
      openScreening: open
        ? {
            id: open.id,
            resumableUntil: status.loan.due_at,
            playingNow: open.active_until > now,
            // The browser holding the play now; failing that, the one that took the tape.
            device: (open.session_hash && deviceOf.get(open.session_hash)?.device) ?? status.loan.device ?? null,
          }
        : null,
      browsers: t.person_id == null ? opened : 0,
      waitingBrowsers: t.person_id == null ? 0 : opened,
      furthestSeconds: progress.furthest ?? null,
      durationSeconds: film?.durationSeconds ?? null,
      finished: Boolean(progress.finished),
      lastActivity: last ? { at: last.at, type: last.type } : null,
    };
  }

  // screeningLimit and daysAfterFirstPlay, which 1.x's forms still send, are accepted
  // and ignored: a link lends once, for its loan's days, and nothing reads the two.
  function ticketFields(b, sets, args) {
    if ('label' in b) sets.push('label = ?'), args.push(optText(b.label, 200, 'The label'));
    if ('startBy' in b) sets.push('start_by = ?'), args.push(optTime(b.startBy, 'Start-by date'));
  }

  // Only a ticket for anyone with the link can be keepable.
  function claimableField(b, personId, sets, args) {
    if (!('claimable' in b)) return;
    if (bool(b.claimable, 'claimable') && personId != null) throw bad('Only a tape for anyone with the link can be kept');
    sets.push('claimable = ?'), args.push(b.claimable ? 1 : 0);
  }

  const personRow = db.prepare('SELECT * FROM people WHERE id = ?');
  // A person a ticket can be issued or given to. A missing one is a 400, not the
  // 404 of /api/admin/people/:id: here the address is fine, and it's the request
  // that names someone who isn't there. The page shows both codes in words.
  function enabledPerson(id) {
    const person = personRow.get(Number(id));
    if (!person) throw bad('person-not-found');
    if (person.disabled_at) throw bad('person-disabled', 409);
    return person;
  }

  router.get('/api/admin/tickets', (req, res) => {
    const where = [];
    const args = [];
    if (req.query.film) where.push('film_id = ?'), args.push(Number(req.query.film));
    if (req.query.person) where.push('person_id = ?'), args.push(Number(req.query.person));
    if (req.query.kind === 'anyone') where.push('person_id IS NULL');
    if (req.query.kind === 'person') where.push('person_id IS NOT NULL');
    const rows = db.prepare(`SELECT * FROM tickets ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC`).all(...args);
    const now = Date.now();
    const ctx = ticketContext();
    res.json(rows.map((t) => adminTicket(req, t, now, ctx)));
  });

  router.post('/api/admin/tickets', (req, res) => {
    const b = req.body || {};
    const film = getFilm(b.filmId);
    const count = optInt(b.count, 'Number of tapes', { min: 1, max: 50 }) ?? 1;
    const sets = [];
    const args = [];
    ticketFields({ label: b.label, startBy: b.startBy }, sets, args);
    // How long this link lends the tape for, from the moment Play is pressed. Left
    // out: the shop's default, as it is when Play is pressed.
    const loanDays = optInt(b.loanDays, 'Due back after', { min: 1, max: 30 });
    sets.push('loan_days = ?'), args.push(loanDays);
    // A ticket only one person can use, signed in with their passkey.
    if (b.personId != null) {
      const person = enabledPerson(b.personId);
      if (count !== 1) throw bad('One tape at a time for a member');
      sets.push('person_id = ?'), args.push(person.id);
    }
    claimableField(b, b.personId, sets, args);
    const cols = sets.map((s) => s.split(' = ')[0]);
    const ids = tx(db, () => {
      const out = [];
      for (let i = 0; i < count; i++) {
        const r = db
          .prepare(`INSERT INTO tickets (code, film_id, ${cols.join(', ')}, created_at) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?)`)
          .run(ticketCode(), film.id, ...args, Date.now());
        out.push(Number(r.lastInsertRowid));
        access.logEvent('ticket-sent', { filmId: film.id, ticketId: out.at(-1), personId: b.personId != null ? Number(b.personId) : null, detail: { loanDays, note: false } });
      }
      return out;
    });
    const ctx = ticketContext(ids);
    res.status(201).json(ids.map((id) => adminTicket(req, getTicket(id), Date.now(), ctx)));
  });

  router.get('/api/admin/tickets/:id', (req, res) => {
    const t = getTicket(req.params.id);
    // resumableUntil: a loan's playback until the tape is due (the due time as it is
    // now, not as it was when Play was pressed); a 1.x play as it was written.
    const screenings = db
      .prepare(`
        SELECT s.id, s.started_at AS startedAt, COALESCE(l.due_at, s.resumable_until) AS resumableUntil, s.last_heartbeat_at AS lastHeartbeatAt,
               s.active_until AS activeUntil, s.position_seconds AS position, s.furthest_seconds AS furthest,
               s.duration_seconds AS duration, s.finished_at AS finishedAt, s.voided_at AS voidedAt, COALESCE(ss.device, l.device) AS device
        FROM screenings s LEFT JOIN sessions ss ON ss.id_hash = s.session_hash LEFT JOIN loans l ON l.screening_id = s.id
        WHERE s.ticket_id = ? ORDER BY s.started_at DESC`)
      .all(t.id);
    const now = Date.now();
    const browserList = db
      .prepare(`
        SELECT st.added_at AS addedAt, s.device, s.last_seen_at AS lastSeenAt, substr(s.id_hash, 1, 8) AS ref
        FROM ${LIVE_HOLDERS} AND st.ticket_id = ? ORDER BY st.added_at`)
      .all(now, t.id);
    res.json({ ...adminTicket(req, t, now, ticketContext([t.id], now)), screenings, browserList });
  });

  // What access.js refuses is answered 409 with its code: tape-out (the link has the
  // tape, so it can't be given, released or forgotten in its browsers, and its
  // playback can't be given back), lent-once (a link that has lent can't be
  // restored), would-end-loan (a due date moved into the past) and not-out.
  const allowed = (r) => {
    if (r.error) throw bad(r.error, 409);
    return r;
  };

  // loanDays, on a link that has the tape, moves the date it's due back (access.js,
  // setLoanDays). Everything is checked before anything is saved, and saved in one
  // step: a refused due date leaves the link's other fields as they were too.
  router.patch('/api/admin/tickets/:id', (req, res) => {
    const t = getTicket(req.params.id);
    const b = req.body || {};
    const sets = [];
    const args = [];
    ticketFields(b, sets, args);
    claimableField(b, t.person_id, sets, args);
    const loanDays = 'loanDays' in b ? optInt(b.loanDays, 'Due back after', { min: 1, max: 30 }) : undefined;
    allowed(
      tx(
        db,
        () => {
          const r = loanDays === undefined ? {} : access.setLoanDays(t.id, loanDays);
          if (!r.error && sets.length) db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...args, t.id);
          return r;
        },
        { immediate: true },
      ),
    );
    res.json(adminTicket(req, getTicket(t.id)));
  });

  // Gives the ticket to one person ({ personId }), or lets anyone with the link use
  // it again ({ personId: null, claimable }). Browsers that opened the link lose it
  // to a person, and get it back on a release. Refused while the link has the tape.
  router.post('/api/admin/tickets/:id/holder', (req, res) => {
    const t = getTicket(req.params.id);
    const b = req.body || {};
    if (!('personId' in b)) throw bad('Say who gets it: personId, or null for anyone with the link');
    const personId = b.personId == null ? null : enabledPerson(b.personId).id;
    const claimable = 'claimable' in b ? bool(b.claimable, 'claimable') : false;
    const r = allowed(access.setTicketPerson(t.id, personId, { claimable }));
    res.json(adminTicket(req, r.ticket));
  });

  // Cancelling a link also drops it from every browser that opened it. If the link
  // has the tape, this is taking the tape back: alsoCancelled then lists the
  // member's other links for the film that went with it.
  router.post('/api/admin/tickets/:id/revoke', (req, res) => {
    const t = getTicket(req.params.id);
    const r = access.cancelTicket(t.id);
    res.json({ ...adminTicket(req, r.ticket), tookBack: r.tookBack, alsoCancelled: r.alsoCancelled });
  });

  // Undoes a cancel, for a link that never lent. Browsers have to open the link again.
  router.post('/api/admin/tickets/:id/restore', (req, res) => {
    const t = getTicket(req.params.id);
    res.json(adminTicket(req, allowed(access.restoreTicket(t.id)).ticket));
  });

  // Forgets the ticket in every browser that opened it. The link still works.
  // Refused while the link has the tape.
  router.post('/api/admin/tickets/:id/sign-out-browsers', (req, res) => {
    const t = getTicket(req.params.id);
    allowed(access.forgetBrowsers(t.id));
    res.json(adminTicket(req, getTicket(t.id)));
  });

  // Taking a tape back, by its loan: the borrower's player stops with "taken back",
  // the link is cancelled, and the film's tape is in for the next Play. ticketId is
  // the link the page showed the loan on, and must be the loan's.
  router.post('/api/admin/loans/:id/take-back', (req, res) => {
    const loanId = Number(req.params.id);
    const ticketId = req.body?.ticketId;
    if (!Number.isSafeInteger(ticketId)) throw bad('Say which link the tape is out on: ticketId');
    const r = access.takeBack(Number.isSafeInteger(loanId) ? loanId : 0, ticketId);
    if (r.error === 'not-found') throw bad('Loan not found', 404);
    allowed(r);
    res.json({
      loan: { id: r.loan.id, takenAt: r.loan.taken_at, dueAt: r.loan.due_at, endedAt: r.loan.ended_at, endedHow: r.loan.ended_how },
      ticket: adminTicket(req, r.ticket),
      alsoCancelled: r.alsoCancelled,
    });
  });

  // Gives a 1.x play back. It stays in the history. A loan's playback is refused.
  router.post('/api/admin/screenings/:id/void', (req, res) => {
    const r = access.voidScreening(Number(req.params.id));
    if (r.error === 'not-found') throw bad('Play not found', 404);
    allowed(r);
    res.json(adminTicket(req, getTicket(r.screening.ticket_id)));
  });

  // ------------------------------------------------------------ activity
  // Newest first, a page at a time: `next` is passed back as `before` for the
  // page after, which holds the events strictly older in (at, id) order, so
  // events at the same moment are neither repeated nor skipped.
  // Three kinds: viewing, loans (what happens to a link and its tape), and accounts,
  // which is every other kind: cards, passkeys, and links kept, given or released.
  const VIEWING = "('opened', 'play', 'heartbeat', 'finished')";
  const LOANS = `(${LOAN_EVENTS.map((type) => `'${type}'`).join(', ')})`;
  router.get('/api/admin/activity', (req, res) => {
    const where = [];
    const args = [];
    if (req.query.ticket) where.push('e.ticket_id = ?'), args.push(Number(req.query.ticket));
    if (req.query.film) where.push('e.film_id = ?'), args.push(Number(req.query.film));
    // Account events name their person; viewing events find theirs through the session.
    if (req.query.person) where.push('COALESCE(e.person_id, s.person_id) = ?'), args.push(Number(req.query.person));
    if (req.query.heartbeats !== '1') where.push("e.type <> 'heartbeat'");
    if (req.query.kind === 'viewing') where.push(`e.type IN ${VIEWING}`);
    else if (req.query.kind === 'loans') where.push(`e.type IN ${LOANS}`);
    else if (req.query.kind === 'accounts') where.push(`e.type NOT IN ${VIEWING} AND e.type NOT IN ${LOANS}`);
    else if (req.query.kind) throw bad('kind must be viewing, loans or accounts');
    if (req.query.before) {
      const m = /^(\d+)\.(\d+)$/.exec(String(req.query.before));
      if (!m) throw bad('before must be the next value of a previous page');
      where.push('(e.at, e.id) < (?, ?)'), args.push(Number(m[1]), Number(m[2]));
    }
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 200, 1), 1000);
    // One more than asked for, to know whether there is a page after this one.
    const rows = db
      .prepare(`
        SELECT e.id, e.at, e.type, e.position, e.detail, e.screening_id AS screeningId,
               f.id AS filmId, f.title AS filmTitle, t.id AS ticketId, t.label AS ticketLabel, s.device,
               p.id AS personId, p.name AS personName
        FROM events e
        LEFT JOIN films f ON f.id = e.film_id
        LEFT JOIN tickets t ON t.id = e.ticket_id
        LEFT JOIN sessions s ON s.id_hash = e.session_hash
        LEFT JOIN people p ON p.id = COALESCE(e.person_id, s.person_id)
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY e.at DESC, e.id DESC LIMIT ?`)
      .all(...args, limit + 1);
    const more = rows.length > limit;
    const events = rows.slice(0, limit).map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
    const last = events.at(-1);
    res.json({ events, next: more ? `${last.at}.${last.id}` : null });
  });

  // ------------------------------------------------------------ the projection booth
  // What needs attention and whether the server is well. Reading it records nothing.
  router.get('/api/admin/booth', async (req, res) => res.json(await booth.report()));

  // ------------------------------------------------------------ keeping records
  // The clean-up's settings, its last run since the server started, and what it
  // would delete now.
  const retentionView = () => ({ ...retention.status(), preview: retention.preview(Date.now()) });
  router.get('/api/admin/retention', (req, res) => res.json(retentionView()));
  router.post('/api/admin/retention/run', (req, res) => {
    try {
      retention.run(Date.now());
    } catch (err) {
      console.error('Clean-up failed:', err);
      return res.status(500).json({ error: `The clean-up failed: ${err.message}.` });
    }
    res.json(retentionView());
  });

  // ------------------------------------------------------------ settings
  // With the version for the page's footer: viewers never see it.
  const adminSettings = () => ({
    ...branding.publicView(settings.get()),
    tmdb: metadata.status(),
    passkeys: { rpId: rp.id, origin: rp.origin, problem: rp.problem },
    version: VERSION,
  });
  router.get('/api/admin/settings', (req, res) => res.json(adminSettings()));
  router.patch(
    '/api/admin/settings',
    metadataRoute(async (req, res) => {
      // The TMDB key is a secret, kept apart from the settings proper.
      const { tmdbApiKey, ...patch } = req.body || {};
      // Check everything before saving anything, so a save either applies in full or not at all.
      settings.validate(patch);
      const changingKey = Object.hasOwn(req.body || {}, 'tmdbApiKey');
      // Text, or empty or null to remove it: anything else is a mistake, not a removal.
      if (changingKey && tmdbApiKey !== null && typeof tmdbApiKey !== 'string') throw bad('A TMDB key is text');
      const key = changingKey && tmdbApiKey !== null ? tmdbApiKey.trim() : '';
      if (key) {
        if (key.length > 1000) throw bad('That is too long to be a TMDB key');
        // Check it with TMDb before saving, so a typo shows up now rather than at the next scan.
        await metadata.verifyKey(key);
      }
      tx(db, () => {
        if (changingKey) settings.setSecret('tmdbApiKey', key || null);
        settings.update(patch);
      });
      if (key) metadata.queueUnmatched();
      res.json(adminSettings());
    }),
  );

  // ------------------------------------------------------------ branding
  // The logo and the tab icon arrive as the image itself (app.js lets these two
  // through its JSON check). The declared type only gets them that far: the
  // bytes decide what they are.
  const upload = express.raw({ type: IMAGE_TYPES, limit: MAX_IMAGE_BYTES });
  for (const kind of ['logo', 'icon']) {
    router.post(`/api/admin/branding/${kind}`, upload, (req, res) => {
      branding.save(kind, Buffer.isBuffer(req.body) ? req.body : null);
      res.json(adminSettings());
    });
    router.post(`/api/admin/branding/${kind}/remove`, (req, res) => {
      branding.remove(kind);
      res.json(adminSettings());
    });
  }

  // What's wrong with a pair of colours, and the page's colours with them, for
  // the admin to preview as you pick. Saves nothing.
  router.post('/api/admin/branding/check', (req, res) => {
    const colors = { accentColor: req.body?.accentColor, backgroundColor: req.body?.backgroundColor };
    if (!Object.values(colors).every((c) => typeof c === 'string' && COLOR.test(c))) throw bad('Colours are written as #rrggbb, for example #e8b04a.');
    res.json({ problems: check(colors), theme: palette(colors) });
  });

  // ------------------------------------------------------------ backups
  router.get('/api/admin/backups', (req, res) => res.json(backups.status()));
  router.post('/api/admin/backups', async (req, res) => {
    try {
      const backup = await backups.run();
      res.status(201).json({ ...backups.status(), backup });
    } catch (err) {
      res.status(err.status || 500).json({ error: `The backup failed: ${err.message}.` });
    }
  });

  // Signs out every viewer's browser, members' included: they open their ticket
  // links or sign in again. Live sessions only, as sessions.js does for one
  // person: expired ones are refused anyway, and counting them would tell you more
  // browsers were signed out than were ever signed in.
  router.post('/api/admin/sessions/expire-all', (req, res) => {
    const r = db.prepare("UPDATE sessions SET revoked_at = ?1 WHERE kind = 'viewer' AND revoked_at IS NULL AND expires_at > ?1").run(Date.now());
    res.json({ expired: Number(r.changes) });
  });

  return router;
}
