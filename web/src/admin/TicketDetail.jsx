import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatAgo, formatClock, formatDate, formatDateTime } from '../api.js';
import { CopyButton, ErrorNote, Progress, TicketBadge, dateInputToMs, describeEvent, msToDateInput, useAction, useLoad } from './ui.jsx';

export default function TicketDetail() {
  const { id } = useParams();
  const { data: t, setData, error, reload } = useLoad(() => api.get(`/api/admin/tickets/${id}`), [id]);
  const events = useLoad(() => api.get(`/api/admin/activity?ticket=${id}&heartbeats=1&limit=300`), [id]);
  const [form, setForm] = useState(null);
  const action = useAction();

  useEffect(() => {
    if (t)
      setForm({
        label: t.label || '',
        screeningLimit: t.screeningLimit ?? '',
        startBy: msToDateInput(t.startBy),
        daysAfterFirstPlay: t.daysAfterFirstPlay ?? '',
      });
  }, [t]);

  if (error) return <ErrorNote error={error} />;
  if (!t || !form) return null;

  const refresh = () => {
    reload();
    events.reload();
  };
  const post = async (path, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    if (await action.run(() => api.post(`/api/admin/${path}`))) refresh();
  };

  async function save(e) {
    e.preventDefault();
    const r = await action.run(() =>
      api.patch(`/api/admin/tickets/${t.id}`, {
        label: form.label,
        screeningLimit: form.screeningLimit === '' ? null : Number(form.screeningLimit),
        startBy: dateInputToMs(form.startBy),
        daysAfterFirstPlay: form.daysAfterFirstPlay === '' ? null : Number(form.daysAfterFirstPlay),
      }),
    );
    if (r) reload();
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const revoked = t.state === 'revoked';

  return (
    <>
      <p style={{ margin: '0 0 0.6rem' }}>
        <Link to="/admin/tickets" className="dim">
          ← Tickets
        </Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{t.label || 'Unnamed ticket'}</h1>
          <div className="row" style={{ gap: '0.5rem' }}>
            <Link to={`/admin/films/${t.film.id}`}>{t.film.title}</Link>
            <TicketBadge ticket={t} />
          </div>
        </div>
        <div className="row">
          {revoked ? (
            <button className="btn" onClick={() => post(`tickets/${t.id}/restore`)} disabled={action.busy}>
              Restore ticket
            </button>
          ) : (
            <>
              <button
                className="btn"
                onClick={() => post(`tickets/${t.id}/sign-out-browsers`, 'Forget this ticket in every browser that opened it? The link will still work if opened again.')}
                disabled={action.busy || !t.browsers}
              >
                Sign out browsers
              </button>
              <button
                className="btn danger"
                onClick={() => post(`tickets/${t.id}/revoke`, 'Revoke this ticket? Playback stops on the next request and the link stops working.')}
                disabled={action.busy}
              >
                Revoke
              </button>
            </>
          )}
        </div>
      </div>
      <ErrorNote error={action.error} />

      {!revoked && (
        <div className="link-box" style={{ marginBottom: '1.5rem' }}>
          <code>{t.link}</code>
          <CopyButton text={t.link} label="Copy link" />
          <CopyButton text={`You should watch ${t.film.title}. Here's your ticket: ${t.link}`} label="Copy message" />
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <dl className="kv">
            <dt>Screenings</dt>
            <dd>
              {t.screeningsUsed} used{t.screeningLimit != null ? ` of ${t.screeningLimit}` : ', no limit'}
            </dd>
            <dt>Opened</dt>
            <dd>{t.firstOpenedAt ? formatDateTime(t.firstOpenedAt) : 'Not yet'}</dd>
            <dt>First played</dt>
            <dd>{t.firstPlayedAt ? formatDateTime(t.firstPlayedAt) : 'Not yet'}</dd>
            <dt>Expires</dt>
            <dd>
              {t.expiresAt
                ? formatDateTime(t.expiresAt)
                : t.startBy && !t.firstPlayedAt
                  ? `If not started by ${formatDate(t.startBy)}`
                  : t.daysAfterFirstPlay
                    ? `${t.daysAfterFirstPlay} days after first play`
                    : 'Never'}
            </dd>
            <dt>Browsers</dt>
            <dd>{t.browsers}</dd>
            {t.openScreening && (
              <>
                <dt>Open screening</dt>
                <dd>
                  {t.openScreening.playingNow ? 'Playing now' : 'Paused'}
                  {t.openScreening.device ? ` on ${t.openScreening.device}` : ''}, resumable until {formatDateTime(t.openScreening.resumableUntil)}
                </dd>
              </>
            )}
            <dt>Issued</dt>
            <dd>{formatDateTime(t.createdAt)}</dd>
          </dl>
        </div>
        <form className="card" onSubmit={save}>
          <label className="field">
            <span>Who is it for?</span>
            <input value={form.label} onChange={set('label')} maxLength={200} />
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Screenings</span>
              <input type="number" min="1" value={form.screeningLimit} onChange={set('screeningLimit')} placeholder="No limit" />
            </label>
            <label className="field">
              <span>Days after first play</span>
              <input type="number" min="1" value={form.daysAfterFirstPlay} onChange={set('daysAfterFirstPlay')} placeholder="No limit" />
            </label>
          </div>
          <label className="field">
            <span>Start watching by</span>
            <input type="date" value={form.startBy} onChange={set('startBy')} />
          </label>
          <button className="btn primary" disabled={action.busy}>
            Save changes
          </button>
        </form>
      </div>

      <h2>Screenings</h2>
      {t.screenings.length === 0 ? (
        <p className="dim">Nobody has pressed Play yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>Started</th>
                <th>Device</th>
                <th>Progress</th>
                <th>Resumable until</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {t.screenings.map((s) => (
                <tr key={s.id}>
                  <td className="nowrap card-title">Started {formatDateTime(s.startedAt)}</td>
                  <td data-label="Device">{s.device || <span className="faint">–</span>}</td>
                  <td data-label="Progress">
                    <Progress seconds={s.furthest} duration={s.duration} />
                  </td>
                  <td className="nowrap faint" data-label="Resumable until">{formatDateTime(s.resumableUntil)}</td>
                  <td data-label="Status">
                    {s.voidedAt ? (
                      <span className="badge">Given back</span>
                    ) : s.finishedAt ? (
                      <span className="badge good">Finished</span>
                    ) : t.openScreening?.id === s.id && t.openScreening.playingNow ? (
                      <span className="badge accent">Playing</span>
                    ) : t.openScreening?.id === s.id ? (
                      <span className="badge">Open</span>
                    ) : (
                      <span className="badge">Closed</span>
                    )}
                  </td>
                  <td>
                    {!s.voidedAt && (
                      <button
                        className="btn small"
                        onClick={() => post(`screenings/${s.id}/void`, "Give this screening back? It won't count towards the limit, and stays in the history.")}
                        disabled={action.busy}
                      >
                        Give back
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {t.browsers > 0 && (
        <>
          <h2>Browsers holding this ticket</h2>
          <div className="table-wrap">
            <table className="stack">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Opened the link</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {(t.browserList || []).map((b) => (
                  <tr key={b.ref}>
                    <td className="card-title">{b.device}</td>
                    <td data-label="Opened the link">{formatDateTime(b.addedAt)}</td>
                    <td className="faint" data-label="Last seen">{formatAgo(b.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Activity</h2>
      {events.data?.length ? (
        <div className="table-wrap">
          <table className="stack">
            <tbody>
              {events.data.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap faint" data-label="When">{formatDateTime(e.at)}</td>
                  <td className="card-title">{describeEvent(e)}</td>
                  <td className="faint" data-label="Device">{e.device}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="dim">No activity yet. Opening the link and playing show up here.</p>
      )}
      <p className="faint" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
        This shows what the browser reported: playback progress, not proof anyone was watching. Positions are rounded to the last report (every 30
        seconds while playing, logged every 5 minutes). Finished means playback reached 92% of the running time.{' '}
        {t.durationSeconds ? `For this film that's ${formatClock(t.durationSeconds * 0.92)}.` : ''}
      </p>
    </>
  );
}
