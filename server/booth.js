import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { startByMayMove } from './access.js';
import { folderProblem, oneAtATime, within } from './backup.js';

// The projection booth: what needs attention, and whether the server is well,
// for the admin. Everything is worked out when asked, and reading it records
// nothing. Each part says what it checked, so the admin can say exactly that:
// "Backup file written at 04:03", never "recovery verified", since nothing here
// tries a restore.

const DAY = 24 * 60 * 60 * 1000;
// package.json's version: the booth and the Settings page show it, only to the admin.
export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
// Folders the media and data may live on can be network storage that hangs
// rather than fails. A check gets this long.
const CHECK_MS = 5000;

export function createBooth({ db, mediaDir, dataDir, backups, retention, refusals, access, startedAt }) {
  const q = {
    waitingLinks: db.prepare(`
      SELECT l.person_id AS personId, p.name AS personName, l.purpose, l.created_at AS createdAt, l.expires_at AS expiresAt, l.opened_at AS openedAt
      FROM person_links l JOIN people p ON p.id = l.person_id
      WHERE l.used_at IS NULL AND l.cancelled_at IS NULL AND l.expires_at > ?
      ORDER BY l.expires_at`),
    // Only the person's latest link, and not for someone disabled since: a newer
    // link (or disabling them) has already dealt with it.
    expiredLinks: db.prepare(`
      SELECT l.person_id AS personId, p.name AS personName, l.purpose, l.created_at AS createdAt, l.expires_at AS expiresAt, l.opened_at AS openedAt
      FROM person_links l JOIN people p ON p.id = l.person_id
      WHERE l.used_at IS NULL AND l.cancelled_at IS NULL AND l.expires_at <= ?1 AND l.expires_at > ?1 - ?2
        AND p.disabled_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM person_links n WHERE n.person_id = l.person_id AND n.id > l.id)
      ORDER BY l.expires_at DESC`),
    // Links that never lent and have a start-by date, no later than a few days from
    // now as it was set. The date each goes by can be later than that (the time the
    // tape was out on other links is given back, access.js), never earlier: so the
    // few days either side of now are a filter in report(), and a link set to a date
    // further back is read only if a loan may have moved its date (startByMayMove).
    startBy: db.prepare(`
      SELECT t.*, f.title AS filmTitle, p.name AS personName
      FROM tickets t JOIN films f ON f.id = t.film_id LEFT JOIN people p ON p.id = t.person_id
      WHERE t.revoked_at IS NULL AND t.first_played_at IS NULL AND t.start_by <= ?1 + ?2
        AND (t.start_by > ?1 - ?2 OR ${startByMayMove('?1')})
        AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.ticket_id = t.id)`),
    films: db.prepare("SELECT COUNT(*) AS films, COALESCE(SUM(media_status <> 'missing'), 0) AS found, MAX(scanned_at) AS scannedAt FROM films"),
    sqlite: db.prepare('SELECT sqlite_version() AS v'),
    schema: db.prepare('PRAGMA user_version'),
  };

  // Whether the media folder is there and readable now, and what the last scan
  // found (from the films table: the scan keeps no other record).
  async function media() {
    const checkedAt = Date.now();
    const out = { dir: mediaDir, checkedAt, readable: false, folders: null, error: null };
    try {
      out.folders = await within(CHECK_MS, () =>
        oneAtATime(`media:${mediaDir}`, async () => {
          await fsp.access(mediaDir, fs.constants.R_OK);
          const entries = await fsp.readdir(mediaDir, { withFileTypes: true });
          // As the scan sees them: folders, not hidden ones like .open-matte-backups.
          return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).length;
        }),
      );
      out.readable = true;
    } catch (err) {
      out.error = folderProblem(err);
    }
    const f = q.films.get();
    return { ...out, lastScan: { at: f.scannedAt, films: f.found, missing: f.films - f.found } };
  }

  // Free and total bytes on the disk holding a folder, or the reason there are none.
  async function disk(dir) {
    const checkedAt = Date.now();
    try {
      const s = await within(CHECK_MS, () => oneAtATime(`disk:${dir}`, () => fsp.statfs(dir)));
      return { dir, checkedAt, free: s.bavail * s.bsize, total: s.blocks * s.bsize, error: null };
    } catch (err) {
      return { dir, checkedAt, free: null, total: null, error: folderProblem(err) };
    }
  }

  async function report(now = Date.now()) {
    // Never lent, with a start-by date in the next few days or the last few: the date
    // the link goes by now, soonest first. `startByAsSet` is the date on the link
    // itself, earlier when the tape has been out on other links since. `startByPaused`:
    // the tape is out now, so the time left stands still and `startBy` moves with it.
    // Each film's loans are read once for them all (startByReader).
    const dateOf = access.startByReader(now);
    const tickets = q.startBy
      .all(now, 3 * DAY)
      .filter((t) => {
        const date = dateOf(t);
        return date > now - 3 * DAY && date <= now + 3 * DAY;
      })
      .map((t) => ({ t, status: access.ticketStatus(t, now) }))
      .sort((a, b) => a.status.startBy - b.status.startBy || a.t.id - b.t.id)
      .map(({ t, status }) => ({
        id: t.id,
        label: t.label,
        film: { id: t.film_id, title: t.filmTitle },
        person: t.person_id != null ? { id: t.person_id, name: t.personName } : null,
        startBy: status.startBy,
        startByAsSet: t.start_by,
        startByPaused: access.startByPaused(status, now),
      }));
    const b = backups.status();
    const [mediaCheck, dataDisk, mediaDisk, copy] = await Promise.all([media(), disk(dataDir), disk(mediaDir), backups.copyStatus({ timeoutMs: CHECK_MS })]);
    return {
      checkedAt: now,
      attention: {
        links: { waiting: q.waitingLinks.all(now), expired: q.expiredLinks.all(now, 7 * DAY) },
        tickets,
        // How many tapes are out, and the next one due back (access.js, by its one
        // test for "out", so a tape past due isn't counted while its end waits to be written).
        tapes: access.tapesOut(now),
        refusals: refusals.view(10),
      },
      server: {
        media: mediaCheck,
        disk: { data: dataDisk, media: mediaDisk },
        backups: {
          enabled: b.enabled,
          // The newest backup file written, as the backups folder lists it now.
          newest: b.backups[0] ?? null,
          count: b.backups.length,
          lastError: b.lastError,
          running: b.running,
          copy,
        },
        retention: retention.status(),
        // Writing down which tapes have come back, every minute: its last run since
        // the server started, how many it wrote, and its last failure.
        sweeper: access.sweeperStatus(),
        version: {
          app: VERSION,
          node: process.version,
          sqlite: q.sqlite.get().v,
          schema: q.schema.get().user_version,
          startedAt,
        },
      },
    };
  }

  return { report };
}
