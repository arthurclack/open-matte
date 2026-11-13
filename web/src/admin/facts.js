// What the back office reads off the booth (GET /api/admin/booth) for its status line,
// the attention strip on Films and Status: plain JavaScript, so the tests can check
// the rules (test/office.test.js). Every value is the booth's; nothing here is new.

const HOUR = 3600 * 1000;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// A tenth or less left is worth a look; backups are made every day, so a day and a bit
// is late; the off-server copy is made by a timer outside the app, so two days is old.
export const diskLow = (d) => Boolean(d.total && d.free / d.total < 0.1);
export const backupLate = (n, now = Date.now()) => Boolean(n && now - n.at > 26 * HOUR);
export const copyOld = (n, now = Date.now()) => Boolean(n && now - n.at > 2 * 24 * HOUR);

// How many of the server's checks want a look: the media folder, each disk, the
// backups, the off-server copy (when it is set up), the clean-up and the check for
// tapes that have come back. The status line
// at the foot of every screen says "Server well" only when none does.
export function serverTrouble(s, now = Date.now()) {
  if (!s) return 0;
  const { media, disk, backups, retention } = s;
  let n = 0;
  if (!media.readable) n++;
  for (const d of [disk.data, disk.media]) if (d.error || diskLow(d)) n++;
  if (backups.enabled && (backups.lastError || !backups.newest || backupLate(backups.newest, now))) n++;
  const c = backups.copy;
  if (c?.configured && (c.error || !c.newest || copyOld(c.newest, now))) n++;
  if (retention.lastError) n++;
  // Version 2: writing down which tapes have come back, every minute.
  if (s.sweeper?.lastError) n++;
  return n;
}

// The attention list in a few words each, for the strip at the top of Films. `when`
// writes the time the refusals were counted from. Empty when all is quiet.
export function attentionLine(a, when) {
  const out = [];
  const waiting = a.links.waiting;
  if (waiting.length) {
    const kind = waiting.every((l) => l.purpose === 'setup') ? 'setup link' : waiting.every((l) => l.purpose === 'recovery') ? 'recovery link' : 'link';
    out.push(`${plural(waiting.length, kind)} waiting`);
  }
  if (a.links.expired.length) out.push(`${plural(a.links.expired.length, 'link')} expired unused`);
  const n = a.tickets.length;
  if (n) out.push(n === 1 ? "1 link's start-by date is close" : `${n} links' start-by dates are close`);
  if (a.refusals.total) out.push(`${plural(a.refusals.total, 'media request')} refused since ${when(a.refusals.since)}`);
  return out;
}
