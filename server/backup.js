import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

// Daily database backups.
//
// Each backup is a consistent copy of the database (SQLite's VACUUM INTO, safe
// while the server runs), checked with PRAGMA integrity_check, and saved as
// BACKUP_DIR/open-matte-YYYY-MM-DD-HHMMSS.db (UTC). TMDb artwork is mirrored to
// BACKUP_DIR/artwork. Kept: the newest backup of each of the last 14 days, and
// the oldest of each of the last 12 months.

const NAME = /^open-matte-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/;
const HOUR = 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');

function backupName(at) {
  const d = new Date(at);
  return `open-matte-${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}.db`;
}

export function parseBackupName(name) {
  const m = NAME.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return { name, day: `${m[1]}-${m[2]}-${m[3]}`, month: `${m[1]}-${m[2]}`, at: Date.UTC(y, mo - 1, d, h, mi, s) };
}

// Which backups to delete: everything except the newest backup of each of the
// last `keepDays` days that have one, and the oldest of each of the last
// `keepMonths` months.
export function backupsToDelete(names, { keepDays, keepMonths }) {
  const all = names.map(parseBackupName).filter(Boolean).sort((a, b) => b.at - a.at);
  const keep = new Set();
  const days = new Set();
  for (const b of all) {
    if (days.has(b.day)) continue;
    if (days.size >= keepDays) break;
    days.add(b.day);
    keep.add(b.name);
  }
  const oldestInMonth = new Map();
  for (const b of all) oldestInMonth.set(b.month, b); // newest first, so the last one set is the oldest
  for (const month of [...oldestInMonth.keys()].sort().reverse().slice(0, keepMonths)) keep.add(oldestInMonth.get(month).name);
  return all.filter((b) => !keep.has(b.name)).map((b) => b.name);
}

export function createBackups({
  db,
  dataDir,
  backupDir = config.backupDir,
  hour = config.backupHour,
  keepDays = config.backupKeepDays,
  keepMonths = config.backupKeepMonths,
  now = () => Date.now(),
}) {
  let running = null;
  let lastError = null;
  const artworkDir = path.join(dataDir, 'artwork');

  function list() {
    if (!backupDir) return [];
    let names;
    try {
      names = fs.readdirSync(backupDir);
    } catch {
      return [];
    }
    return names
      .map(parseBackupName)
      .filter(Boolean)
      .sort((a, b) => b.at - a.at)
      .map(({ name, at }) => {
        let size = null;
        try {
          size = fs.statSync(path.join(backupDir, name)).size;
        } catch {
          // Removed since the listing.
        }
        return { name, at, size };
      });
  }

  // Makes a backup now. Concurrent calls share one run.
  function run() {
    if (!backupDir) return Promise.reject(Object.assign(new Error('backups are turned off (BACKUP_DIR=off)'), { status: 409 }));
    if (running) return running;
    running = (async () => {
      const at = now();
      const name = backupName(at);
      await fsp.mkdir(backupDir, { recursive: true });
      // Snapshot into the data folder first: VACUUM INTO is synchronous, and the
      // data folder is local and fast. The copy to BACKUP_DIR, which may be on
      // slower storage, then happens without holding up the server.
      const tmp = path.join(dataDir, `.backup-${process.pid}-${at}.db`);
      try {
        db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
        const check = new DatabaseSync(tmp, { readOnly: true });
        const verdict = check.prepare('PRAGMA integrity_check').get().integrity_check;
        check.close();
        if (verdict !== 'ok') throw new Error(`the copy failed its integrity check (${verdict})`);
        const partial = path.join(backupDir, `.${name}.partial`);
        await fsp.copyFile(tmp, partial);
        await fsp.rename(partial, path.join(backupDir, name));
      } finally {
        await fsp.rm(tmp, { force: true });
      }
      // Artwork files are named after their content, so copying only new ones is enough.
      if (fs.existsSync(artworkDir)) {
        await fsp.cp(artworkDir, path.join(backupDir, 'artwork'), { recursive: true, force: false, errorOnExist: false });
      }
      for (const old of backupsToDelete(list().map((b) => b.name), { keepDays, keepMonths })) {
        await fsp.rm(path.join(backupDir, old), { force: true });
      }
      lastError = null;
      return list().find((b) => b.name === name);
    })()
      .catch((err) => {
        lastError = { message: err.message, at: now() };
        throw err;
      })
      .finally(() => {
        running = null;
      });
    return running;
  }

  // Due once a day after `hour` (UTC), or straight away when the last backup is
  // over a day old (the server was down at the usual time) or there is none.
  function due(at = now()) {
    if (!backupDir) return false;
    const latest = list()[0];
    if (!latest || at - latest.at >= 25 * HOUR) return true;
    const d = new Date(at);
    const scheduled = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour);
    return at >= scheduled && latest.at < scheduled;
  }

  function start() {
    if (!backupDir) return;
    const tick = () => {
      if (due()) run().catch((err) => console.error(`Backup failed: ${err.message}`));
    };
    setTimeout(tick, 60 * 1000).unref();
    setInterval(tick, 15 * 60 * 1000).unref();
  }

  function status() {
    return { enabled: Boolean(backupDir), dir: backupDir, hour, keepDays, keepMonths, backups: list(), lastError, running: Boolean(running) };
  }

  return { run, list, due, start, status };
}
