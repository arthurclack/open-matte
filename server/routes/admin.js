import crypto from 'node:crypto';
import express from 'express';
import { config } from '../config.js';
import { tx } from '../db.js';
import { artworkUrl, filmArtwork, filmMedia } from '../films.js';
import { MetadataError, TMDB_FIELDS } from '../metadata.js';
import { rateLimit } from '../ratelimit.js';
import { META_FIELDS, scanMedia } from '../scan.js';
import { ADMIN_COOKIE, clearCookie, ticketCode } from '../sessions.js';
import { guessTitleYear, looksLikeReleaseName } from '../titles.js';

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

function passwordMatches(given) {
  // Compare digests so the comparison is constant-time whatever the length.
  const a = crypto.createHash('sha256').update(String(given ?? '')).digest();
  const b = crypto.createHash('sha256').update(config.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

const optInt = (v, name, { min = 0, max = 100000 } = {}) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number from ${min} to ${max}`);
  return n;
};
const optText = (v, max = 10000) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
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

export function adminRoutes({ db, sessions, access, settings, mediaDir, metadata, backups }) {
  const router = express.Router();
  const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

  // ------------------------------------------------------------ sign-in
  router.post('/api/admin/login', loginLimit, (req, res) => {
    if (!passwordMatches(req.body?.password)) return res.status(401).json({ error: 'wrong-password' });
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

  const origin = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;

  // ------------------------------------------------------------ films
  const filmRow = db.prepare('SELECT * FROM films WHERE id = ?');
  const getFilm = (id) => {
    const f = filmRow.get(Number(id));
    if (!f) throw bad('Film not found', 404);
    return f;
  };

  function adminFilm(f) {
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
    res.json(films.map((f) => ({ ...adminFilm(f), tickets: { total: counts.get(f.id)?.total ?? 0, active: counts.get(f.id)?.active ?? 0 } })));
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
      if (b.published && (f.media_status === 'error' || f.media_status === 'missing')) {
        throw bad("This film's media has errors. Fix the folder and scan again before publishing.");
      }
      sets.push('published = ?'), args.push(b.published ? 1 : 0);
    }
    if (sets.length) db.prepare(`UPDATE films SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, Date.now(), f.id);
    res.json(adminFilm(getFilm(f.id)));
  });

  // Throw away admin edits and take the values film.json gave at the last scan.
  router.post('/api/admin/films/:id/reset-metadata', (req, res) => {
    const f = getFilm(req.params.id);
    const meta = f.imported_meta ? JSON.parse(f.imported_meta) : null;
    if (!meta) throw bad('This film has no imported metadata yet');
    const fields = Object.entries(META_FIELDS).filter(([key]) => !req.body?.fields || req.body.fields.includes(key));
    const sources = parseJson(f.meta_sources, {});
    for (const [key] of fields) delete sources[key];
    if (fields.length) {
      db.prepare(`UPDATE films SET ${fields.map(([, { column }]) => `${column} = ?`).join(', ')}, meta_sources = ?, updated_at = ? WHERE id = ?`).run(
        ...fields.map(([key]) => meta[key] ?? (key === 'title' ? f.title : null)), JSON.stringify(sources), Date.now(), f.id,
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
      const query = optText(req.query.q, 200);
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
    if (!t) throw bad('Ticket not found', 404);
    return t;
  };
  const deviceOf = db.prepare('SELECT device FROM sessions WHERE id_hash = ?');

  // What the admin shows about tickets besides the tickets themselves, in a few
  // grouped queries for the lot rather than several per ticket. Pass ticket ids
  // to limit it to those, or nothing for all tickets.
  function ticketContext(ids = null) {
    const only = ids ? `AND ticket_id IN (${ids.map(() => '?').join(', ')})` : '';
    const args = ids || [];
    const byTicket = (rows) => new Map(rows.map((r) => [r.ticket_id, r]));
    const films = new Map(
      db.prepare('SELECT id, slug, title, media FROM films').all()
        .map((f) => [f.id, { film: { id: f.id, slug: f.slug, title: f.title }, durationSeconds: filmMedia(f).durationSeconds ?? null }]),
    );
    if (ids && !ids.length) return { films, browsers: new Map(), lastEvent: new Map(), progress: new Map() };
    return {
      films,
      browsers: byTicket(db.prepare(`SELECT ticket_id, COUNT(*) AS n FROM session_tickets WHERE 1 ${only} GROUP BY ticket_id`).all(...args)),
      // SQLite takes `type` from the row that holds MAX(at).
      lastEvent: byTicket(db.prepare(`SELECT ticket_id, MAX(at) AS at, type FROM events WHERE ticket_id IS NOT NULL ${only} GROUP BY ticket_id`).all(...args)),
      progress: byTicket(
        db.prepare(`SELECT ticket_id, MAX(furthest_seconds) AS furthest, MAX(finished_at IS NOT NULL) AS finished
                    FROM screenings WHERE voided_at IS NULL ${only} GROUP BY ticket_id`).all(...args),
      ),
    };
  }

  function adminTicket(req, t, now = Date.now(), ctx = ticketContext([t.id])) {
    const status = access.ticketStatus(t, now);
    const film = ctx.films.get(t.film_id);
    const progress = ctx.progress.get(t.id) || {};
    const last = ctx.lastEvent.get(t.id);
    // A screening only counts as open while the ticket can still play it.
    const open = status.state === 'ok' ? status.open : null;
    return {
      id: t.id,
      code: t.code,
      link: `${origin(req)}/t/${t.code}`,
      film: film?.film ?? null,
      label: t.label,
      screeningLimit: t.screening_limit,
      startBy: t.start_by,
      daysAfterFirstPlay: t.days_after_first_play,
      firstOpenedAt: t.first_opened_at,
      firstPlayedAt: t.first_played_at,
      revokedAt: t.revoked_at,
      createdAt: t.created_at,
      state: status.state,
      screeningsUsed: status.screeningsUsed,
      screeningsLeft: status.screeningsLeft,
      expiresAt: status.expiresAt,
      openScreening: open
        ? {
            id: open.id,
            resumableUntil: open.resumable_until,
            playingNow: open.active_until > now,
            device: open.session_hash ? deviceOf.get(open.session_hash)?.device ?? null : null,
          }
        : null,
      browsers: ctx.browsers.get(t.id)?.n ?? 0,
      furthestSeconds: progress.furthest ?? null,
      durationSeconds: film?.durationSeconds ?? null,
      finished: Boolean(progress.finished),
      lastActivity: last ? { at: last.at, type: last.type } : null,
    };
  }

  function ticketFields(b, sets, args) {
    if ('label' in b) sets.push('label = ?'), args.push(optText(b.label, 200));
    if ('screeningLimit' in b) sets.push('screening_limit = ?'), args.push(optInt(b.screeningLimit, 'Screening limit', { min: 1, max: 1000 }));
    if ('startBy' in b) sets.push('start_by = ?'), args.push(optTime(b.startBy, 'Start-by date'));
    if ('daysAfterFirstPlay' in b) sets.push('days_after_first_play = ?'), args.push(optInt(b.daysAfterFirstPlay, 'Days after first play', { min: 1, max: 3650 }));
  }

  router.get('/api/admin/tickets', (req, res) => {
    const filter = req.query.film ? 'WHERE film_id = ?' : '';
    const rows = db.prepare(`SELECT * FROM tickets ${filter} ORDER BY created_at DESC, id DESC`).all(...(req.query.film ? [Number(req.query.film)] : []));
    const now = Date.now();
    const ctx = ticketContext();
    res.json(rows.map((t) => adminTicket(req, t, now, ctx)));
  });

  router.post('/api/admin/tickets', (req, res) => {
    const b = req.body || {};
    const film = getFilm(b.filmId);
    const count = optInt(b.count, 'Number of tickets', { min: 1, max: 50 }) ?? 1;
    const sets = [];
    const args = [];
    ticketFields({ label: b.label, screeningLimit: b.screeningLimit, startBy: b.startBy, daysAfterFirstPlay: b.daysAfterFirstPlay }, sets, args);
    const cols = sets.map((s) => s.split(' = ')[0]);
    const ids = tx(db, () => {
      const out = [];
      for (let i = 0; i < count; i++) {
        const r = db
          .prepare(`INSERT INTO tickets (code, film_id, ${cols.join(', ')}, created_at) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?)`)
          .run(ticketCode(), film.id, ...args, Date.now());
        out.push(Number(r.lastInsertRowid));
      }
      return out;
    });
    const ctx = ticketContext(ids);
    res.status(201).json(ids.map((id) => adminTicket(req, getTicket(id), Date.now(), ctx)));
  });

  router.get('/api/admin/tickets/:id', (req, res) => {
    const t = getTicket(req.params.id);
    const screenings = db
      .prepare(`
        SELECT s.id, s.started_at AS startedAt, s.resumable_until AS resumableUntil, s.last_heartbeat_at AS lastHeartbeatAt,
               s.active_until AS activeUntil, s.position_seconds AS position, s.furthest_seconds AS furthest,
               s.duration_seconds AS duration, s.finished_at AS finishedAt, s.voided_at AS voidedAt, ss.device
        FROM screenings s LEFT JOIN sessions ss ON ss.id_hash = s.session_hash
        WHERE s.ticket_id = ? ORDER BY s.started_at DESC`)
      .all(t.id);
    const browserList = db
      .prepare(`
        SELECT st.added_at AS addedAt, s.device, s.last_seen_at AS lastSeenAt, substr(s.id_hash, 1, 8) AS ref
        FROM session_tickets st JOIN sessions s ON s.id_hash = st.session_hash
        WHERE st.ticket_id = ? ORDER BY st.added_at`)
      .all(t.id);
    res.json({ ...adminTicket(req, t), screenings, browserList });
  });

  router.patch('/api/admin/tickets/:id', (req, res) => {
    const t = getTicket(req.params.id);
    const sets = [];
    const args = [];
    ticketFields(req.body || {}, sets, args);
    if (sets.length) db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...args, t.id);
    res.json(adminTicket(req, getTicket(t.id)));
  });

  // Revoking also drops the ticket from every browser that opened it.
  router.post('/api/admin/tickets/:id/revoke', (req, res) => {
    const t = getTicket(req.params.id);
    tx(db, () => {
      db.prepare('UPDATE tickets SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(Date.now(), t.id);
      db.prepare('DELETE FROM session_tickets WHERE ticket_id = ?').run(t.id);
    });
    res.json(adminTicket(req, getTicket(t.id)));
  });

  // Undoes a revoke. Browsers have to open the link again.
  router.post('/api/admin/tickets/:id/restore', (req, res) => {
    const t = getTicket(req.params.id);
    db.prepare('UPDATE tickets SET revoked_at = NULL WHERE id = ?').run(t.id);
    res.json(adminTicket(req, getTicket(t.id)));
  });

  // Forgets the ticket in every browser that opened it. The link still works.
  router.post('/api/admin/tickets/:id/sign-out-browsers', (req, res) => {
    const t = getTicket(req.params.id);
    db.prepare('DELETE FROM session_tickets WHERE ticket_id = ?').run(t.id);
    res.json(adminTicket(req, getTicket(t.id)));
  });

  // Gives a screening back (say playback failed). It stays in the history.
  router.post('/api/admin/screenings/:id/void', (req, res) => {
    const s = db.prepare('SELECT * FROM screenings WHERE id = ?').get(Number(req.params.id));
    if (!s) throw bad('Screening not found', 404);
    db.prepare('UPDATE screenings SET voided_at = ? WHERE id = ? AND voided_at IS NULL').run(Date.now(), s.id);
    res.json(adminTicket(req, getTicket(s.ticket_id)));
  });

  // ------------------------------------------------------------ activity
  router.get('/api/admin/activity', (req, res) => {
    const where = [];
    const args = [];
    if (req.query.ticket) where.push('e.ticket_id = ?'), args.push(Number(req.query.ticket));
    if (req.query.film) where.push('e.film_id = ?'), args.push(Number(req.query.film));
    if (req.query.heartbeats !== '1') where.push("e.type <> 'heartbeat'");
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const rows = db
      .prepare(`
        SELECT e.id, e.at, e.type, e.position, e.detail, e.screening_id AS screeningId,
               f.id AS filmId, f.title AS filmTitle, t.id AS ticketId, t.label AS ticketLabel, s.device
        FROM events e
        LEFT JOIN films f ON f.id = e.film_id
        LEFT JOIN tickets t ON t.id = e.ticket_id
        LEFT JOIN sessions s ON s.id_hash = e.session_hash
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY e.at DESC, e.id DESC LIMIT ?`)
      .all(...args, limit);
    res.json(rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })));
  });

  // ------------------------------------------------------------ settings
  const adminSettings = () => ({ ...settings.get(), tmdb: metadata.status() });
  router.get('/api/admin/settings', (req, res) => res.json(adminSettings()));
  router.patch(
    '/api/admin/settings',
    metadataRoute(async (req, res) => {
      const b = req.body || {};
      // Check everything before saving anything, so a save either applies in full or not at all.
      settings.validate(b);
      const changingKey = 'tmdbApiKey' in b;
      const key = changingKey && typeof b.tmdbApiKey === 'string' ? b.tmdbApiKey.trim() : '';
      if (key) {
        if (key.length > 1000) throw bad('That is too long to be a TMDB key');
        // Check it with TMDb before saving, so a typo shows up now rather than at the next scan.
        await metadata.verifyKey(key);
      }
      tx(db, () => {
        if (changingKey) settings.setSecret('tmdbApiKey', key || null);
        settings.update(b);
      });
      if (key) metadata.queueUnmatched();
      res.json(adminSettings());
    }),
  );

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

  // Every viewer has to open their ticket link again.
  router.post('/api/admin/sessions/expire-all', (req, res) => {
    const r = db.prepare("UPDATE sessions SET revoked_at = ? WHERE kind = 'viewer' AND revoked_at IS NULL").run(Date.now());
    res.json({ expired: Number(r.changes) });
  });

  return router;
}
