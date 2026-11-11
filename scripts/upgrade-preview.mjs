#!/usr/bin/env node
// What upgrading a shop to version 2 would do, before you do it.
//
//   node scripts/upgrade-preview.mjs ~/open-matte-backups/open-matte-2026-11-11-153012.db
//
// Give it a backup you have copied off the server (docs/deploying.md, "Before you
// update"). It copies that one file to a temporary folder and opens the copy with
// this code, which upgrades the copy as the server would on starting. Then it prints
// the tapes that would be out and who would have each, the plays that would be cut
// off, the links that would be spent once their loan ends though 1.x would have let
// them play again, the links that would be spent, the links that lend once more,
// and the loan lengths that would be capped at 30 days. The rules are in
// docs/version-2.md, "Upgrading an existing shop".
//
// The file you give it is only read, to copy it: it is never opened as a database,
// and nothing is written beside it. The copy is deleted before the report prints.
//
// The report is as of the backup, by this computer's clock. The real upgrade
// decides by the clock when the server starts, so a Play pressed in between can
// change it.
//
// Needs Node 22.13 or later, and nothing else: no npm install.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS, openDb } from '../server/db.js';

const DAY = 24 * 60 * 60 * 1000;
// The schema that brings loans. A database already there has nothing to preview.
const LOANS_SCHEMA = 8;
// A link with no loan length of its own lends for the shop's default, and no loan
// is longer than 30 days (docs/version-2.md, "Upgrading an existing shop").
const DEFAULT_LOAN_DAYS = 3;
const MAX_LOAN_DAYS = 30;

const USAGE = 'Usage: node scripts/upgrade-preview.mjs <a backup file, copied off the server>';

// ------------------------------------------------------------------ the preview

// The schema a copy is at. Throws unless it is an Open Matte database.
function schemaOf(copy) {
  let db;
  try {
    db = new DatabaseSync(copy);
    const version = db.prepare('PRAGMA user_version').get().user_version;
    db.prepare('SELECT 1 FROM tickets LIMIT 1').get();
    return version;
  } catch (err) {
    throw new Error(`This is not an Open Matte database (${err.message}).`);
  } finally {
    db?.close();
  }
}

// Copies `file`, upgrades the copy and reports what that did. `file` itself is
// read once, by the copy, and never opened. The copy is gone when this returns.
export function previewUpgrade(file, { tmpDir = os.tmpdir() } = {}) {
  const given = path.resolve(file);
  // The file itself, when what was given is a link to it: what is beside a link
  // says nothing about the file it leads to.
  let original = given;
  let stat = null;
  let linked = false;
  try {
    original = fs.realpathSync(given);
    stat = fs.statSync(original);
    linked = fs.lstatSync(given).isSymbolicLink();
  } catch {
    // Reported below.
  }
  if (!stat?.isFile()) throw new Error(`No such file: ${given}`);
  // A backup is one file. A database a server has open keeps its latest writes in
  // a second one beside it, which a copy of the first would miss.
  if (fs.existsSync(`${original}-wal`)) {
    const beside = linked ? `the file this link leads to, ${original}` : 'it';
    throw new Error(`This is a database in use, not a backup: its latest changes are in ${path.basename(original)}-wal beside ${beside}. Preview a backup instead.`);
  }

  const dir = fs.mkdtempSync(path.join(tmpDir, 'open-matte-preview-'));
  try {
    const copy = path.join(dir, 'open-matte.db');
    fs.copyFileSync(original, copy);
    // A backup kept read-only would make a copy that can't be upgraded.
    fs.chmodSync(copy, 0o600);

    const report = { file: given, from: schemaOf(copy), to: MIGRATIONS.length };
    if (report.from > MIGRATIONS.length) {
      throw new Error(`This database was written by a newer Open Matte (schema ${report.from}; this code knows ${MIGRATIONS.length}).`);
    }
    if (report.from >= LOANS_SCHEMA) return { ...report, upgraded: true };

    let db;
    try {
      db = openDb(copy);
    } catch (err) {
      // The migration is one transaction: the copy is as it was copied.
      return { ...report, failed: err.message, stays: schemaOf(copy) };
    }
    try {
      return { ...report, ...readUpgraded(db, Date.now()) };
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

// What the upgrade made of the copy. Loans are read as the migration wrote them.
// What 1.x would have done with each link is worked out here, by 1.1.0's rules
// (server/access.js as released), from columns the migration never changes.
function readUpgraded(db, now) {
  const all = (sql) => db.prepare(sql).all().map((row) => ({ ...row }));
  const films = new Map(all('SELECT id, slug, title, published FROM films').map((f) => [f.id, f]));
  const people = new Map(all('SELECT id, name, disabled_at FROM people').map((p) => [p.id, p]));
  const sessions = new Map(all('SELECT id_hash, kind, device, revoked_at, expires_at, person_id FROM sessions').map((s) => [s.id_hash, s]));
  const holds = new Set(all('SELECT session_hash, ticket_id FROM session_tickets').map((h) => `${h.session_hash} ${h.ticket_id}`));
  const tickets = all('SELECT * FROM tickets ORDER BY id');
  const loans = new Map(all('SELECT * FROM loans').map((l) => [l.ticket_id, l]));
  // Each link's plays, the latest first.
  const plays = new Map();
  for (const s of all('SELECT * FROM screenings ORDER BY started_at DESC, id DESC')) {
    if (!plays.has(s.ticket_id)) plays.set(s.ticket_id, []);
    plays.get(s.ticket_id).push(s);
  }

  // A link as 1.x read it: the plays that count (not given back), the one that
  // could still be resumed, and when its days after the first play run out.
  const in1x = (t) => {
    const counted = (plays.get(t.id) ?? []).filter((s) => s.voided_at == null);
    return {
      used: counted.length,
      open: counted.find((s) => s.resumable_until > now) ?? null,
      expiresAt: t.first_played_at && t.days_after_first_play ? t.first_played_at + t.days_after_first_play * DAY : null,
    };
  };
  // A browser that can still play: signed out of nothing, not expired, and the
  // member signed in there, if any, with their card on.
  const liveBrowser = (hash) => {
    const s = sessions.get(hash);
    if (!s || s.kind !== 'viewer' || s.revoked_at != null || s.expires_at <= now) return false;
    return s.person_id == null || (people.has(s.person_id) && people.get(s.person_id).disabled_at == null);
  };
  // Could the holder of this play still resume it: the link's member, with their
  // card on; or on a link for anyone, the browser, if it still holds the link.
  const canResume = (t, play) =>
    t.person_id != null
      ? people.has(t.person_id) && people.get(t.person_id).disabled_at == null
      : liveBrowser(play.session_hash) && holds.has(`${play.session_hash} ${t.id}`);

  const filmOf = (t) => {
    const f = films.get(t.film_id);
    return { title: f.title, slug: f.slug, onShelf: Boolean(f.published) };
  };
  // A link by what the back office shows of it: never its code, which is the link itself.
  const linkOf = (t) => ({ id: t.id, label: t.label, for: t.person_id != null ? people.get(t.person_id)?.name ?? null : null, cancelled: t.revoked_at != null });
  // Who a play belongs to: the link's member, or else the browser, with the name
  // signed in there while its session is still kept.
  const whoOf = (t, hash, device) => {
    if (t.person_id != null) return { person: people.get(t.person_id)?.name ?? null, device: device ?? sessions.get(hash)?.device ?? null };
    const s = sessions.get(hash);
    return { person: null, device: device ?? s?.device ?? null, signedInAs: s?.person_id != null ? people.get(s.person_id)?.name ?? null : null };
  };
  const loanDaysOf = (t) => t.loan_days ?? DEFAULT_LOAN_DAYS;

  const out = [];
  const cutOff = [];
  const spent = [];
  const lendOnceMore = [];
  const capped = [];
  let neverPlayed = 0;
  let cancelled = 0;

  for (const t of tickets) {
    const loan = loans.get(t.id);
    const { used, open, expiresAt } = in1x(t);
    const base = { film: filmOf(t), link: linkOf(t) };

    if (loan && loan.ended_at == null) {
      const play = (plays.get(t.id) ?? []).find((s) => s.id === loan.screening_id);
      // Question 15: 1.x would have let this link play again after this play.
      const again = (t.screening_limit == null || used < t.screening_limit) && (expiresAt == null || expiresAt > loan.due_at);
      out.push({
        ...base,
        borrower: whoOf(t, loan.session_hash, loan.device),
        takenAt: loan.taken_at,
        dueAt: loan.due_at,
        positionSeconds: play?.position_seconds ?? 0,
        spentEarly: again ? { playsLeft: t.screening_limit == null ? null : t.screening_limit - used, until: expiresAt } : null,
      });
    } else if (loan) {
      spent.push({ ...base, why: expiresAt && expiresAt <= now ? 'past-its-days' : 'used-up', endedAt: loan.ended_at });
    } else if (open && !t.revoked_at && base.film.onShelf && !(expiresAt && expiresAt <= now) && canResume(t, open)) {
      // Its holder could carry on in 1.x, and the film's tape went to another link.
      cutOff.push({
        ...base,
        who: whoOf(t, open.session_hash, null),
        positionSeconds: open.position_seconds,
        lastHeardAt: open.last_heartbeat_at,
        playingNow: open.active_until > now,
        loanDays: loanDaysOf(t),
      });
    } else if (t.first_played_at != null && !t.revoked_at) {
      lendOnceMore.push({ ...base, loanDays: loanDaysOf(t), open: Boolean(open) });
    } else if (!t.revoked_at) {
      neverPlayed++;
    } else {
      cancelled++;
    }
    if (!loan && t.days_after_first_play > MAX_LOAN_DAYS) capped.push({ ...base, said: t.days_after_first_play, loanDays: t.loan_days });
  }

  const byFilm = (a, b) => a.film.title.localeCompare(b.film.title) || a.link.id - b.link.id;
  for (const list of [out, cutOff, spent, lendOnceMore, capped]) list.sort(byFilm);
  return {
    at: now,
    out,
    cutOff,
    spentEarly: out.filter((o) => o.spentEarly),
    spent,
    lendOnceMore,
    capped,
    // Links in none of the lists: never played, or cancelled before they were spent.
    counts: { films: films.size, links: tickets.length, neverPlayed, cancelled },
  };
}

// ------------------------------------------------------------------ the report

const when = (ms) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ms);
const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
const minutesIn = (seconds) => `${Math.floor(seconds / 60)} min in`;
// `named`: the line goes on to name the link's member, so "for Ada" would say it twice.
const nameOfLink = ({ id, label, for: person, cancelled }, named = false) => `link ${id}${label ? ` "${label}"` : ''}${person && !named ? `, for ${person}` : ''}${cancelled ? ' (cancelled)' : ''}`;
const nameOfWho = ({ person, device, signedInAs }) => person ?? `a browser (${device ?? 'no longer known'})${signedInAs ? `, signed in as ${signedInAs}` : ''}`;
const line = (row, rest, named) => `  ${row.film.title}${row.film.onShelf ? '' : ' (off the shelf)'}: ${nameOfLink(row.link, named)}, ${rest}`;

function section(title, rows, about, each) {
  if (!rows.length) return ['', `${title}: none`];
  return ['', `${title}: ${rows.length}`, ...about.map((l) => `  ${l}`), ...rows.map(each)];
}

export function formatReport(r) {
  const lines = ['Open Matte upgrade preview', `  ${r.file}`];
  if (r.upgraded) {
    lines.push(`  This database is already at schema ${r.from}, which has loans: there is nothing to preview.`);
    return lines.join('\n');
  }
  lines.push(`  Schema ${r.from} now; the upgrade takes it to schema ${r.to}.`);
  lines.push('  This file was only read, to copy it. The copy has been deleted.');
  if (r.failed) {
    lines.push('', 'The upgrade would fail:', `  ${r.failed}`);
    lines.push(`  Nothing would change: the database would stay at schema ${r.stays}, the new server would not start on it, and the code you run today still would.`);
    lines.push('  Please report this before you update, and keep running the release you have.');
    return lines.join('\n');
  }
  lines.push(`  As of this backup, by this computer's clock: ${when(r.at)} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`);
  lines.push('  The real upgrade decides by the clock when the server starts, so a Play pressed in between can change it.');

  lines.push(
    ...section(
      'Tapes out after the upgrade',
      r.out,
      ["Each is the play open on its film, which becomes the film's one loan. The position is kept."],
      (o) => line(o, `out to ${nameOfWho(o.borrower)}, ${minutesIn(o.positionSeconds)}, due back ${when(o.dueAt)}`, true),
    ),
    ...section(
      'Plays cut off',
      r.cutOff,
      [
        "Part-way through a film whose tape goes to someone else: the one playing now, or else the one heard from last.",
        'Their player stops, their page says "Out on loan", and their link lends once when the tape is back, from the beginning.',
        'Updating while nobody is watching avoids this.',
      ],
      (c) => line(c, `${nameOfWho(c.who)}, ${minutesIn(c.positionSeconds)}, ${c.playingNow ? 'playing now' : `last heard from ${when(c.lastHeardAt)}`}`, true),
    ),
    ...section(
      'Links spent early',
      r.spentEarly,
      ['Each has its tape now, and is spent when that is due back, though 1.x would have let it play again.', 'Send a new link to anyone who should have longer.'],
      (o) => line(o, `due back ${when(o.dueAt)}; in 1.x it had ${o.spentEarly.playsLeft == null ? 'no limit on plays' : `${o.spentEarly.playsLeft} more ${o.spentEarly.playsLeft === 1 ? 'play' : 'plays'}`}${o.spentEarly.until ? ` until ${when(o.spentEarly.until)}` : ''}`),
    ),
    ...section(
      'Links already spent',
      r.spent,
      ["1.x would not play these either. Restoring a cancelled one can't make it lend."],
      (s) => line(s, s.why === 'past-its-days' ? 'past its days after the first play' : 'used up'),
    ),
    ...section(
      'Links that lend once more',
      r.lendOnceMore,
      ['Played before, with nothing open that its holder could carry on. The next Play takes the tape, from the beginning.'],
      (l) => line(l, `for ${days(l.loanDays)}`),
    ),
    ...section(
      `Loan lengths capped at ${days(MAX_LOAN_DAYS)}`,
      r.capped,
      [],
      (c) => line(c, `said ${days(c.said)} after the first play`),
    ),
  );
  lines.push('', `Links never played: ${r.counts.neverPlayed} of ${r.counts.links}`);
  lines.push(`  Each waits for its first Play and lends once: for the days it said after the first play, at most ${MAX_LOAN_DAYS}, or else for ${days(DEFAULT_LOAN_DAYS)}.`);
  lines.push('  A start-by date is kept, missed or not.');
  if (r.counts.cancelled) lines.push('', `Cancelled links that were not spent: ${r.counts.cancelled}`, '  They stay cancelled.');
  lines.push('', 'Films, members, passkeys, sessions, settings and the Ledger are as they were.');
  return lines.join('\n');
}

// ------------------------------------------------------------------ main

function main(argv) {
  if (argv.length !== 1 || argv[0].startsWith('-')) {
    console.error(USAGE);
    process.exit(argv[0] === '--help' || argv[0] === '-h' ? 0 : 2);
  }
  let report;
  try {
    report = previewUpgrade(argv[0]);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(formatReport(report));
  if (report.failed) process.exitCode = 1;
}

// Only when run as a script, so the tests can import the functions.
const runAsScript = (() => {
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (runAsScript) main(process.argv.slice(2));
