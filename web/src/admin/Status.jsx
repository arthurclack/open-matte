import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatAgo, formatBytes, formatDateTime, formatDay, formatDayTime, plural } from '../api.js';
import { ErrorNote, keptFor, lastClearedText, useLoad } from './ui.jsx';

const HOUR = 3600 * 1000;

// Every value in the booth is worked out when it's asked for.
const loadBooth = () => api.get('/api/admin/booth');

const errorText = (e) => (typeof e === 'string' ? e : e?.message);
const sentence = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const linkName = (purpose) => (purpose === 'recovery' ? 'recovery link' : 'setup link');
const ticketName = (t) => t.label || t.person?.name || 'Unnamed ticket';

// "14:02" today, "2 Nov, 14:02" before then.
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const when = (ms) => (new Date(ms).toDateString() === new Date().toDateString() ? timeFmt.format(new Date(ms)) : formatDateTime(ms));

// The attention list in a few words each, for the strip at the top of the admin.
// Empty when all is quiet.
function attentionLine(a) {
  const out = [];
  const waiting = a.links.waiting;
  if (waiting.length) {
    const kind = waiting.every((l) => l.purpose === 'setup') ? 'setup link' : waiting.every((l) => l.purpose === 'recovery') ? 'recovery link' : 'link';
    out.push(`${plural(waiting.length, kind)} waiting`);
  }
  if (a.links.expired.length) out.push(`${plural(a.links.expired.length, 'link')} expired unused`);
  const n = a.tickets.length;
  if (n) out.push(n === 1 ? "1 ticket's start-by date is close" : `${n} tickets' start-by dates are close`);
  if (a.refusals.total) out.push(`${plural(a.refusals.total, 'media request')} refused since ${when(a.refusals.since)}`);
  return out;
}

// The one-line strip at the top of Films. Says nothing when all is quiet, or when the
// booth can't be read (the booth page itself shows why).
export function AttentionStrip() {
  const { data } = useLoad(loadBooth, []);
  const items = data ? attentionLine(data.attention) : [];
  if (!items.length) return null;
  return (
    <div className="notice">
      {items.join(' · ')} — <Link to="/admin/status">Projection booth</Link>
    </div>
  );
}

export default function Status() {
  const { data: b, error, reload } = useLoad(loadBooth, []);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    await reload();
    setBusy(false);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projection booth</h1>
          <p className="dim" style={{ margin: 0, maxWidth: '46em' }}>
            What needs attention, and whether the server is well. Each line says what was checked; nothing here tests a restore. Reading this page
            records nothing.
          </p>
        </div>
        <button className="btn" onClick={refresh} disabled={busy}>
          {busy ? 'Checking…' : 'Refresh'}
        </button>
      </div>
      <ErrorNote error={error} />
      {b && (
        <>
          <p className="faint" style={{ fontSize: '0.85rem' }}>
            Checked {formatDateTime(b.checkedAt)}.
          </p>
          <h2>Needs attention</h2>
          <Attention a={b.attention} />
          <h2>The server</h2>
          <Server s={b.server} />
        </>
      )}
    </>
  );
}

function Attention({ a }) {
  const { links, tickets, refusals } = a;
  const reasons = Object.entries(refusals.byReason || {}).sort((x, y) => y[1] - x[1]);
  return (
    <div className="card">
      <h3>Setup and recovery links</h3>
      <p className={links.waiting.length || links.expired.length ? '' : 'dim'}>
        {links.waiting.length ? `${plural(links.waiting.length, 'link')} waiting to be used` : 'No links waiting to be used'}
        {links.expired.length ? `, and ${plural(links.expired.length, 'link')} expired unused in the last 7 days.` : '; none expired unused in the last 7 days.'}
      </p>
      {(links.waiting.length > 0 || links.expired.length > 0) && (
        <div className="table-wrap" style={{ marginBottom: '1rem' }}>
          <table className="stack">
            <thead>
              <tr>
                <th>For</th>
                <th>Link</th>
                <th>Created</th>
                <th>Opened</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {[...links.waiting.map((l) => ({ ...l, expired: false })), ...links.expired.map((l) => ({ ...l, expired: true }))].map((l) => (
                <tr key={`${l.expired}-${l.personId}-${l.createdAt}`}>
                  <td className="card-title">
                    <Link to={`/admin/people/${l.personId}`}>{l.personName}</Link>
                  </td>
                  <td data-label="Link">{sentence(linkName(l.purpose))}</td>
                  <td className="nowrap" data-label="Created">{formatDateTime(l.createdAt)}</td>
                  <td className="faint" data-label="Opened">{l.openedAt ? formatDateTime(l.openedAt) : 'Not opened'}</td>
                  <td data-label="Status">
                    {l.expired ? (
                      <span className="badge">Expired {formatDateTime(l.expiresAt)}</span>
                    ) : (
                      <span className="badge warn">Works until {formatDayTime(l.expiresAt)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Start-by dates</h3>
      <p className={tickets.length ? '' : 'dim'}>
        {tickets.length
          ? `${plural(tickets.length, 'ticket')} never played, with a start-by date in the next 3 days or the last 3.`
          : 'No ticket that has never been played has a start-by date in the next 3 days or the last 3.'}
      </p>
      {tickets.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: '1rem' }}>
          <table className="stack">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Film</th>
                <th>For</th>
                <th>Start by</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td className="card-title">
                    <Link to={`/admin/tickets/${t.id}`}>{ticketName(t)}</Link>
                  </td>
                  <td data-label="Film">
                    <Link to={`/admin/films/${t.film.id}`}>{t.film.title}</Link>
                  </td>
                  <td data-label="For">{t.person ? <Link to={`/admin/people/${t.person.id}`}>{t.person.name}</Link> : <span className="dim">Anyone with the link</span>}</td>
                  <td className="nowrap" data-label="Start by">
                    {formatDay(t.startBy)}{' '}
                    {t.startBy < Date.now() ? <span className="badge bad">Passed</span> : <span className="faint">({formatAgo(t.startBy)})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Refused media requests</h3>
      <p className={refusals.total ? '' : 'dim'} style={{ margin: refusals.total ? undefined : 0 }}>
        {refusals.total
          ? `${plural(refusals.total, 'media request')} refused since the server started, ${when(refusals.since)}.`
          : `No media requests refused since the server started, ${when(refusals.since)}.`}{' '}
        <span className="faint">
          Kept in memory only, with no addresses, and forgotten on restart. The server's log has every one. Repeats share a row, with the time
          of the last. Requests with no session (no cookie, or one that has expired or was made up) can come from anyone, so they keep to a few rows.
        </span>
      </p>
      {reasons.length > 0 && (
        <dl className="kv" style={{ marginBottom: '1rem' }}>
          {reasons.map(([reason, n]) => (
            <Fragment key={reason}>
              <dt>{n}</dt>
              <dd>{sentence(reason)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {refusals.recent.length > 0 && (
        <>
          <p className="dim" style={{ fontSize: '0.9rem' }}>
            {refusals.recent.length === 1 ? 'The last one:' : `The last ${refusals.recent.length}, newest first:`}
          </p>
          <div className="table-wrap">
            <table className="stack">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Count</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Kind</th>
                  <th>Film</th>
                  <th>Client</th>
                </tr>
              </thead>
              <tbody>
                {refusals.recent.map((r, i) => (
                  <tr key={`${r.at}-${i}`}>
                    <td className="nowrap faint" data-label="Time">{formatDateTime(r.at)}</td>
                    <td data-label="Count">{r.count ?? 1}</td>
                    <td data-label="Status">{r.status}</td>
                    <td className="card-title">{sentence(r.reason)}</td>
                    <td className="nowrap" data-label="Kind">{r.kind}</td>
                    <td className="mono nowrap" data-label="Film">{r.film ? `/${r.film}` : '–'}</td>
                    <td className="faint" data-label="Client">{r.client || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Server({ s }) {
  const { media, disk, backups, retention, version } = s;
  return (
    <div className="card booth">
      <dl className="kv">
        <dt>Media folder</dt>
        <dd>
          <div>
            {media.readable ? (
              <>
                <span className="badge good">Readable</span> {plural(media.folders, 'folder')} in it now.
              </>
            ) : (
              <>
                <span className="badge bad">Not readable</span> {sentence(media.error)}.
              </>
            )}
          </div>
          <div>
            {media.lastScan.at ? (
              <>
                The last scan, {formatDateTime(media.lastScan.at)}, found {plural(media.lastScan.films, 'film')}
                {media.lastScan.missing ? `, and ${plural(media.lastScan.missing, "film's folder", "films' folders")} missing` : ''}.
              </>
            ) : (
              'No scan yet.'
            )}
          </div>
          <div className="faint mono">{media.dir}</div>
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

        <dt>Clean-up</dt>
        <dd>
          {retention.lastError && (
            <div>
              <span className="badge bad">Failed</span> The last clean-up failed: {errorText(retention.lastError)}
            </div>
          )}
          <div>
            {lastClearedText(retention.lastRun)}
            {!retention.lastRun && ' It runs a minute after the server starts, then every day.'}
          </div>
          {retention.settings && (
            <div className="faint">
              Progress reports are kept for {keptFor(retention.settings.retainProgressDays)}, other events for {keptFor(retention.settings.retainEventsDays)},
              signed-out browsers for {keptFor(retention.settings.retainSessionsDays)}. <Link to="/admin/settings">Settings</Link>
            </div>
          )}
        </dd>

        <dt>Version</dt>
        <dd>
          Open Matte {version.app} · Node {version.node} · SQLite {version.sqlite} · database schema {version.schema}
          <div className="faint">
            Running since {formatDateTime(version.startedAt)} ({formatAgo(version.startedAt)})
          </div>
        </dd>
      </dl>
    </div>
  );
}

// Free space where the data or the media live. A tenth or less left is worth a look.
function Disk({ label, d }) {
  if (d.error) {
    return (
      <div title={d.dir}>
        <span className="badge bad">Unknown</span> {label}: {d.error}.
      </div>
    );
  }
  const low = d.total && d.free / d.total < 0.1;
  return (
    <div title={d.dir}>
      {low && (
        <>
          <span className="badge warn">Low</span>{' '}
        </>
      )}
      {label}: {formatBytes(d.free)} free of {formatBytes(d.total)}
      {d.total ? <span className="faint"> ({Math.round((d.free / d.total) * 100)}% free)</span> : null}
    </div>
  );
}

// The newest backup file is the one written by the daily run (or Back up now). A day
// and a bit old is late: they're made every day.
function Backup({ b }) {
  if (!b.enabled) return <span className="dim">Backups are turned off on this server (BACKUP_DIR=off).</span>;
  const n = b.newest;
  const late = n && Date.now() - n.at > 26 * HOUR;
  return (
    <>
      {b.running && <div className="dim">A backup is being written now.</div>}
      {b.lastError && (
        <div>
          <span className="badge bad">Failed</span> The last backup failed: {errorText(b.lastError)}
        </div>
      )}
      {n ? (
        <div>
          <span className={`badge ${late ? 'warn' : 'good'}`}>{late ? 'Late' : 'Recent'}</span> Backup file written at {formatDateTime(n.at)},{' '}
          {formatAgo(n.at)}.
          <div className="faint">
            <span className="mono">{n.name}</span>
            {b.count > 1 && `, the newest of ${b.count}`}
          </div>
        </div>
      ) : (
        <div>
          <span className="badge warn">None</span> No backup file written yet.
        </div>
      )}
    </>
  );
}

// The off-server copy is made by a timer outside the app; all the app can do is
// look for the newest file where that copy lands.
function Copy({ c }) {
  if (!c?.configured) {
    return <span className="dim">Not checked: set BACKUP_COPY_DIR to the folder the off-server copy mirrors to, and the booth looks there.</span>;
  }
  const n = c.newest;
  const late = n && Date.now() - n.at > 2 * 24 * HOUR;
  return (
    <>
      {c.error ? (
        <div>
          <span className="badge bad">Not readable</span> {sentence(c.error)}.
        </div>
      ) : n ? (
        <div>
          <span className={`badge ${late ? 'warn' : 'good'}`}>{late ? 'Old' : 'Recent'}</span> Copy seen: the backup written {formatDateTime(n.at)},{' '}
          {formatAgo(n.at)}.
        </div>
      ) : (
        <div>
          <span className="badge bad">None</span> No open-matte-*.db file there.
        </div>
      )}
      <div className="faint mono">{n ? `${c.dir}/${n.name}` : c.dir}</div>
    </>
  );
}
