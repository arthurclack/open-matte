import { Fragment, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatAgo, formatBytes, formatDateTime, formatDay, formatDayTime, formatTime, plural } from '../api.js';
import { CrtScreen } from '../look/crt.jsx';
import { Line } from '../look/ui.jsx';
import { attentionLine, backupLate, copyOld, diskLow } from './facts.js';
import { sweeperText, tapesOutLine } from './loanWords.js';
import { AdminContext, ErrorNote, Head, Mark, Table, keptFor, lastClearedText, useLoad } from './ui.jsx';

// Every value in the booth is worked out when it's asked for.
const loadBooth = () => api.get('/api/admin/booth');

const errorText = (e) => (typeof e === 'string' ? e : e?.message);
const sentence = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const linkName = (purpose) => (purpose === 'recovery' ? 'recovery link' : 'setup link');
const ticketName = (t) => t.label || t.person?.name || 'Unnamed link';

// "14:02" today, "2 Nov, 14:02" before then.
const when = (ms) => (new Date(ms).toDateString() === new Date().toDateString() ? formatTime(ms) : formatDateTime(ms));

// The one-line strip at the top of Films, from the booth the back office last read.
// Says nothing when all is quiet, or when the booth can't be read (Status shows why).
export function AttentionStrip() {
  const { facts } = useContext(AdminContext);
  const items = facts.booth ? attentionLine(facts.booth.attention, when) : [];
  if (!items.length) return null;
  return (
    <Line kind="info">
      {items.join(' · ')}: <Link to="/admin/status">Status</Link>
    </Line>
  );
}

export default function Status() {
  const { data: b, error, reload } = useLoad(loadBooth, []);
  const { facts, refreshFacts } = useContext(AdminContext);
  const [busy, setBusy] = useState(false);

  // The status line and Films' attention strip show this reading too.
  useEffect(() => {
    if (b) refreshFacts(b);
  }, [b, refreshFacts]);

  async function refresh() {
    setBusy(true);
    await reload();
    setBusy(false);
  }

  // Nothing on the shelf yet: the video recorder nobody has set.
  const unset = Array.isArray(facts.films) && !facts.films.some((f) => f.published);

  return (
    <>
      <Head
        title="Status"
        lede="What needs attention, and whether the server is well. Each line says what was checked; nothing here tests a restore. Reading this page records nothing."
        actions={
          <button type="button" className="ui-btn" onClick={refresh} disabled={busy}>
            {busy ? 'Checking…' : 'Refresh'}
          </button>
        }
      />
      <ErrorNote error={error} />
      {b && (
        <>
          <p className="ui-key">Checked {formatDateTime(b.checkedAt)}</p>
          {unset && <Unset />}
          <h2 className="of-h2">Needs attention</h2>
          <Attention a={b.attention} />
          <h2 className="of-h2">The server</h2>
          <Server s={b.server} />
        </>
      )}
    </>
  );
}

// While nothing is on the shelf: the still 12:00 of a video recorder nobody has set, and
// the three steps that put the first film there. It goes with the first film.
function Unset() {
  return (
    <div className="of-unset">
      <CrtScreen className="of-clock" aria-hidden="true">
        <p className="of-clock__t">12:00</p>
        <p className="of-clock__s">Nothing on the shelf</p>
      </CrtScreen>
      <div>
        <h2 className="of-h2">Nothing on the shelf yet</h2>
        <ol>
          <li>Copy a prepared film folder into the media directory (see docs/import-format.md).</li>
          <li>
            Press Scan media folder on <Link to="/admin">Films</Link>.
          </li>
          <li>Open the film and press Put on the shelf.</li>
        </ol>
      </div>
    </div>
  );
}

function Attention({ a }) {
  const { links, tickets, refusals, tapes } = a;
  const out = tapesOutLine(tapes);
  const reasons = Object.entries(refusals.byReason || {}).sort((x, y) => y[1] - x[1]);
  const linkRows = [...links.waiting.map((l) => ({ ...l, expired: false })), ...links.expired.map((l) => ({ ...l, expired: true }))];
  const waitingKind = links.waiting.every((l) => l.purpose === 'setup') ? 'setup link' : links.waiting.every((l) => l.purpose === 'recovery') ? 'recovery link' : 'setup or recovery link';
  return (
    <>
      <Line kind={linkRows.length ? 'warn' : 'info'}>
        <p>
          {links.waiting.length ? `${plural(links.waiting.length, waitingKind)} waiting to be used` : 'No setup or recovery links waiting to be used'}
          {links.expired.length ? `, and ${plural(links.expired.length, 'link')} expired unused in the last 7 days.` : '; none expired unused in the last 7 days.'}
        </p>
      </Line>
      {linkRows.length > 0 && (
        <Table
          head={
            <>
              <th>For</th>
              <th>Link</th>
              <th>Created</th>
              <th>Opened</th>
              <th>State</th>
            </>
          }
        >
          {linkRows.map((l) => (
            <tr key={`${l.expired}-${l.personId}-${l.createdAt}`}>
              <td className="ui-title">
                <Link to={`/admin/people/${l.personId}`}>{l.personName}</Link>
              </td>
              <td data-label="Link">{sentence(linkName(l.purpose))}</td>
              <td className="ui-when" data-label="Created">
                {formatDateTime(l.createdAt)}
              </td>
              <td className="ui-when" data-label="Opened">
                {l.openedAt ? formatDateTime(l.openedAt) : 'Not opened'}
              </td>
              <td data-label="State">
                {l.expired ? <Mark tone="off">Expired {formatDateTime(l.expiresAt)}</Mark> : <Mark tone="warn">Works until {formatDayTime(l.expiresAt)}</Mark>}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Line kind="info" lead={out.lead}>
        {out.next && (
          <>
            The next due back is <Link to={`/admin/films/${out.next.film.id}`}>{out.next.film.title}</Link>, {formatDayTime(out.next.dueAt)}.{' '}
          </>
        )}
        {out.text}{' '}
        {tapes?.out > 0 && <Link to="/admin/tickets">Tapes</Link>}
      </Line>

      <Line kind={tickets.length ? 'warn' : 'info'}>
        <p>
          {tickets.length
            ? `${plural(tickets.length, 'link')} that ${tickets.length === 1 ? "hasn't" : "haven't"} lent, with a start-by date in the next 3 days or the last 3.`
            : "No link that hasn't lent has a start-by date in the next 3 days or the last 3."}
        </p>
        <p className="of-faint of-small">A date stands still while the tape is out with someone else, and moves on with the clock until it's back.</p>
      </Line>
      {tickets.length > 0 && (
        <Table
          head={
            <>
              <th>Link</th>
              <th>Film</th>
              <th>For</th>
              <th>Start by</th>
            </>
          }
        >
          {tickets.map((t) => (
            <tr key={t.id}>
              <td className="ui-title">
                <Link to={`/admin/tickets/${t.id}`}>{ticketName(t)}</Link>
              </td>
              <td data-label="Film">
                <Link to={`/admin/films/${t.film.id}`}>{t.film.title}</Link>
              </td>
              <td data-label="For">{t.person ? <Link to={`/admin/people/${t.person.id}`}>{t.person.name}</Link> : <span className="of-dim">Anyone with the link</span>}</td>
              <td data-label="Start by">
                <span className="of-cell">
                  <time>{t.startByPaused || formatDayTime(t.startByAsSet) !== formatDayTime(t.startBy) ? formatDayTime(t.startBy) : formatDay(t.startBy)}</time>
                  {t.startByPaused ? (
                    <Mark tone="info">Paused: the tape is out with someone else</Mark>
                  ) : t.startBy < Date.now() ? (
                    <Mark tone="bad">Passed</Mark>
                  ) : (
                    <small>{formatAgo(t.startBy)}</small>
                  )}
                  {t.startByAsSet != null && formatDayTime(t.startByAsSet) !== formatDayTime(t.startBy) && <small>Set as {formatDayTime(t.startByAsSet)}</small>}
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Line kind={refusals.total ? 'warn' : 'info'}>
        <p>
          {refusals.total
            ? `${plural(refusals.total, 'media request')} refused since the server started, ${when(refusals.since)}.`
            : `No media requests refused since the server started, ${when(refusals.since)}.`}
        </p>
        <p className="of-faint of-small">
          Kept in memory only, with no addresses, and forgotten on restart. The server's log has the first of each kind each minute, up to a few dozen
          a minute, then how many more there were. Repeats share a row, with the time of the last.
        </p>
      </Line>
      {reasons.length > 0 && (
        <dl className="of-kv of-w">
          {reasons.map(([reason, n]) => (
            <Fragment key={reason}>
              <dt className="ui-n">{n}</dt>
              <dd>{sentence(reason)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {refusals.recent.length > 0 && (
        <>
          <p className="ui-key of-gap">
            {refusals.recent.length === 1 ? 'The last one:' : `The last ${refusals.recent.length}, newest first:`}
          </p>
          <Table
            head={
              <>
                <th>Time</th>
                <th className="ui-n">Count</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Kind</th>
                <th>Film</th>
                <th>Client</th>
              </>
            }
          >
            {refusals.recent.map((r, i) => (
              <tr key={`${r.at}-${i}`}>
                <td className="ui-when" data-label="Time">
                  {formatDateTime(r.at)}
                </td>
                <td className="ui-n" data-label="Count">
                  {r.count ?? 1}
                </td>
                <td className="ui-n" data-label="Status">
                  {r.status}
                </td>
                <td className="ui-title">{sentence(r.reason)}</td>
                <td className="of-nowrap" data-label="Kind">
                  {r.kind}
                </td>
                <td className="of-mono of-nowrap" data-label="Film">
                  {r.film ? `/${r.film}` : '–'}
                </td>
                <td className="of-faint" data-label="Client">
                  {r.client || '–'}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}

function Server({ s }) {
  const { media, disk, backups, retention, version, sweeper } = s;
  return (
    <dl className="of-kv">
      <dt>Media folder</dt>
      <dd>
        {media.readable ? (
          <Line kind="done" lead="Readable.">
            {plural(media.folders, 'folder')} in it now.
          </Line>
        ) : (
          <Line kind="bad" lead="Not readable.">
            {sentence(media.error)}.
          </Line>
        )}
        <p>
          {media.lastScan.at ? (
            <>
              The last scan, {formatDateTime(media.lastScan.at)}, found {plural(media.lastScan.films, 'film')}
              {media.lastScan.missing ? `, and ${plural(media.lastScan.missing, "film's folder", "films' folders")} missing` : ''}.
            </>
          ) : (
            'No scan yet.'
          )}
        </p>
        <p className="of-mono of-faint">{media.dir}</p>
      </dd>

      <dt>Disk space</dt>
      <dd>
        <Disk label="Data" d={disk.data} />
        <Disk label="Media" d={disk.media} />
      </dd>

      <dt>Backups</dt>
      <dd>
        <Backup b={backups} />
      </dd>

      <dt>Off-server copy</dt>
      <dd>
        <Copy c={backups.copy} />
      </dd>

      <dt>Tapes back in</dt>
      <dd>
        {sweeper?.lastError && (
          <Line kind="bad" lead="Failed.">
            The last check failed: {errorText(sweeper.lastError)}
          </Line>
        )}
        <p>{sweeperText(sweeper)}</p>
      </dd>

      <dt>Clean-up</dt>
      <dd>
        {retention.lastError && (
          <Line kind="bad" lead="Failed.">
            The last clean-up failed: {errorText(retention.lastError)}
          </Line>
        )}
        <p>
          {lastClearedText(retention.lastRun)}
          {!retention.lastRun && ' It runs a minute after the server starts, then every day.'}
        </p>
        {retention.settings && (
          <p className="of-faint">
            Progress reports are kept for {keptFor(retention.settings.retainProgressDays)}, other events for {keptFor(retention.settings.retainEventsDays)},
            signed-out browsers for {keptFor(retention.settings.retainSessionsDays)}. <Link to="/admin/settings">Settings</Link>
          </p>
        )}
      </dd>

      <dt>Version</dt>
      <dd>
        <p>
          Open Matte {version.app} · Node {version.node} · SQLite {version.sqlite} · database schema {version.schema}
        </p>
        <p className="of-faint">
          Running since {formatDateTime(version.startedAt)} ({formatAgo(version.startedAt)})
        </p>
      </dd>
    </dl>
  );
}

// Free space where the data or the media live.
function Disk({ label, d }) {
  if (d.error) {
    return (
      <Line kind="bad" lead="Unknown.">
        <span title={d.dir}>
          {label}: {d.error}.
        </span>
      </Line>
    );
  }
  const text = (
    <span title={d.dir}>
      {label}: {formatBytes(d.free)} free of {formatBytes(d.total)}
      {d.total ? <span className="of-faint"> ({Math.round((d.free / d.total) * 100)}% free)</span> : null}
    </span>
  );
  return diskLow(d) ? (
    <Line kind="warn" lead="Low.">
      {text}
    </Line>
  ) : (
    <p>{text}</p>
  );
}

// The newest backup file is the one written by the daily run (or Back up now).
function Backup({ b }) {
  if (!b.enabled) return <p className="of-dim">Backups are turned off on this server (BACKUP_DIR=off).</p>;
  const n = b.newest;
  return (
    <>
      {b.running && <p className="of-dim">A backup is being written now.</p>}
      {b.lastError && (
        <Line kind="bad" lead="Failed.">
          The last backup failed: {errorText(b.lastError)}
        </Line>
      )}
      {n ? (
        <Line kind={backupLate(n) ? 'warn' : 'done'}>
          <p>
            <b>{backupLate(n) ? 'Late.' : 'Recent.'}</b> Backup file written at {formatDateTime(n.at)}, {formatAgo(n.at)}.
          </p>
          <p className="of-faint">
            <span className="of-mono">{n.name}</span>
            {b.count > 1 && `, the newest of ${b.count}`}
          </p>
        </Line>
      ) : (
        <Line kind="warn" lead="None yet.">
          No backup file written yet.
        </Line>
      )}
    </>
  );
}

// The off-server copy is made by a timer outside the app; all the app can do is
// look for the newest file where that copy lands.
function Copy({ c }) {
  if (!c?.configured) {
    return <p className="of-dim">Not checked: set BACKUP_COPY_DIR to the folder the off-server copy mirrors to, and Status looks there.</p>;
  }
  const n = c.newest;
  return (
    <>
      {c.error ? (
        <Line kind="bad" lead="Not readable.">
          {sentence(c.error)}.
        </Line>
      ) : n ? (
        <Line kind={copyOld(n) ? 'warn' : 'done'} lead={copyOld(n) ? 'Old.' : 'Recent.'}>
          Copy seen: the backup written {formatDateTime(n.at)}, {formatAgo(n.at)}.
        </Line>
      ) : (
        <Line kind="bad" lead="None.">
          No open-matte-*.db file there.
        </Line>
      )}
      <p className="of-mono of-faint">{n ? `${c.dir}/${n.name}` : c.dir}</p>
    </>
  );
}
