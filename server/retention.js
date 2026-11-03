import { tx } from './db.js';

// Deleting old records, once a day.
//
// Progress reports (heartbeat events) go after retainProgressDays, every other
// event after retainEventsDays, and browser sessions retainSessionsDays after
// they ended, once no remaining event names them. Nothing here touches tickets,
// screenings, people or passkeys: screening limits, "finished", resume
// positions, start-by deadlines, expiry and first-opened times all come from
// those, so deleting never changes what a viewer can do. Backups keep what they
// had until they expire themselves.

const DAY = 24 * 60 * 60 * 1000;

// An event still kept at :now, by its own window.
const KEPT_EVENT = "at >= CASE type WHEN 'heartbeat' THEN :progress ELSE :events END";

// A session to delete: ended (signed out or expired) more than
// retainSessionsDays ago, counted from the earlier of the two when it has both.
// Activity finds a viewing event's person and device through its session, so a
// session lives as long as any of its events. One still holding a screening that
// can be resumed stays too, although an ended session can't play it anyway.
// Screenings and events refer to sessions by plain text, never changed here;
// session_tickets rows go with their session (ON DELETE CASCADE).
const OLD_SESSION = `
  (revoked_at IS NOT NULL OR expires_at <= :now)
  AND MIN(expires_at, COALESCE(revoked_at, expires_at)) < :sessions
  AND id_hash NOT IN (SELECT session_hash FROM events WHERE session_hash IS NOT NULL AND ${KEPT_EVENT})
  AND id_hash NOT IN (SELECT session_hash FROM screenings WHERE session_hash IS NOT NULL AND resumable_until > :now)`;

export function createRetention({ db, settings }) {
  const q = {
    countProgress: db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'heartbeat' AND at < :progress"),
    countEvents: db.prepare("SELECT COUNT(*) AS n FROM events WHERE type <> 'heartbeat' AND at < :events"),
    countSessions: db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE ${OLD_SESSION}`),
    deleteProgress: db.prepare("DELETE FROM events WHERE type = 'heartbeat' AND at < :progress"),
    deleteEvents: db.prepare("DELETE FROM events WHERE type <> 'heartbeat' AND at < :events"),
    deleteSessions: db.prepare(`DELETE FROM sessions WHERE ${OLD_SESSION}`),
  };
  let lastRun = null;
  let lastError = null;

  const days = () => {
    const s = settings.get();
    return { retainProgressDays: s.retainProgressDays, retainEventsDays: s.retainEventsDays, retainSessionsDays: s.retainSessionsDays };
  };

  // The cut-off times at `now`: anything older goes.
  function cutoffs(now) {
    const s = days();
    return { now, progress: now - s.retainProgressDays * DAY, events: now - s.retainEventsDays * DAY, sessions: now - s.retainSessionsDays * DAY };
  }

  // What run(now) would delete, without deleting it. Sessions are counted as
  // they would be once the events have gone, as run deletes those first.
  function preview(now = Date.now()) {
    const c = cutoffs(now);
    return tx(db, () => ({
      progressReports: q.countProgress.get({ progress: c.progress }).n,
      events: q.countEvents.get({ events: c.events }).n,
      sessions: q.countSessions.get(c).n,
    }));
  }

  function run(now = Date.now()) {
    const c = cutoffs(now);
    try {
      const deleted = tx(
        db,
        () => ({
          progressReports: Number(q.deleteProgress.run({ progress: c.progress }).changes),
          events: Number(q.deleteEvents.run({ events: c.events }).changes),
          sessions: Number(q.deleteSessions.run(c).changes),
        }),
        { immediate: true },
      );
      lastRun = { at: now, deleted };
      lastError = null;
      return deleted;
    } catch (err) {
      lastError = { message: err.message, at: now };
      throw err;
    }
  }

  // About a minute after the server starts, then once a day. A failure is
  // logged and shown in the admin; it never stops the server.
  function start() {
    const tick = () => {
      try {
        const d = run();
        if (d.progressReports || d.events || d.sessions) {
          console.log(`Clean-up: deleted ${d.progressReports} progress report(s), ${d.events} other event(s) and ${d.sessions} ended session(s)`);
        }
      } catch (err) {
        console.error(`Clean-up failed: ${err.message}`);
      }
    };
    setTimeout(tick, 60 * 1000).unref();
    setInterval(tick, DAY).unref();
  }

  // Since the server started: nothing is stored.
  const status = () => ({ lastRun, lastError, settings: days() });

  return { preview, run, start, status };
}
