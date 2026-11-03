import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatAgo, formatClock, formatDate, formatDateTime } from '../api.js';
import { KeepBox, PersonDisabledBadge, ticketKind, ticketMessage } from './Tickets.jsx';
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
        claimable: t.claimable,
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
        ...(t.person ? {} : { claimable: form.claimable }),
      }),
    );
    if (r) reload();
  }

  // Gives the ticket to a person, or (null) lets anyone with the link use it again.
  async function setHolder(personId, confirmText) {
    if (!window.confirm(confirmText)) return;
    if (await action.run(() => api.post(`/api/admin/tickets/${t.id}/holder`, { personId }))) refresh();
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const revoked = t.state === 'revoked';
  // A ticket only one person can use: their browsers are whichever are signed in as them.
  const person = t.person;
  const personLink = person && <Link to={`/admin/people/${person.id}`}>{person.name}</Link>;

  return (
    <>
      <p style={{ margin: '0 0 0.6rem' }}>
        <Link to="/admin/tickets" className="dim">
          ← Tickets
        </Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{t.label || person?.name || 'Unnamed ticket'}</h1>
          <p className="dim" style={{ margin: '0 0 0.4rem' }}>
            {person ? (
              <>
                Only {personLink}
                {t.claimedAt ? ` · kept from a link ${formatDateTime(t.claimedAt)}` : ', signed in'}
              </>
            ) : (
              ticketKind(t)
            )}
          </p>
          <div className="row" style={{ gap: '0.5rem' }}>
            <Link to={`/admin/films/${t.film.id}`}>{t.film.title}</Link>
            <TicketBadge ticket={t} />
            <PersonDisabledBadge ticket={t} />
          </div>
        </div>
        <div className="row">
          {revoked ? (
            <button className="btn" onClick={() => post(`tickets/${t.id}/restore`)} disabled={action.busy}>
              Restore ticket
            </button>
          ) : (
            <>
              {/* Signing a person's browsers out is Sign out everywhere, on their page. */}
              {person ? (
                <Link className="btn" to={`/admin/people/${person.id}`}>
                  {person.name}'s page
                </Link>
              ) : (
                <button
                  className="btn"
                  onClick={() => post(`tickets/${t.id}/sign-out-browsers`, 'Forget this ticket in every browser that opened it? The link will still work if opened again.')}
                  disabled={action.busy || !t.browsers}
                >
                  Sign out browsers
                </button>
              )}
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

      {revoked && (
        <div className="notice">
          Revoked {formatDateTime(t.revokedAt)}.{' '}
          {!person
            ? 'If you restore it, browsers have to open the link again.'
            : person.disabled
              ? `If you restore it, ${person.name} sees it again once you enable them.`
              : `If you restore it, ${person.name} sees it again straight away.`}
        </div>
      )}

      {!revoked && (
        <div className="link-box" style={{ marginBottom: '1.5rem' }}>
          <code>{t.link}</code>
          <CopyButton text={t.link} label="Copy link" />
          <CopyButton text={ticketMessage(t, t.film.title)} label="Copy message" />
        </div>
      )}

      <WhoCanUseIt ticket={t} busy={action.busy} onSetHolder={setHolder} />

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
            <dd>{person ? <>Any browser signed in as {personLink}</> : t.browsers}</dd>
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
            <span>{person ? 'Note (optional)' : 'Who is it for?'}</span>
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
          {!person && <KeepBox checked={form.claimable} onChange={(claimable) => setForm({ ...form, claimable })} style={{ marginLeft: 0 }} />}
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

      {t.waitingBrowsers > 0 && (
        <>
          <h2>Opened the link before it was {t.claimedAt ? 'kept' : 'given to ' + person.name}</h2>
          <p className="dim">
            These browsers opened the link while it was for anyone. Unless they're signed in as {person.name}, they can't use it now: they're told it has
            been kept in someone's account. They get it back if you let anyone with the link use it.{' '}
            <button
              className="linklike"
              onClick={() => post(`tickets/${t.id}/sign-out-browsers`, "Forget this ticket in these browsers? They won't get it back if you let anyone with the link use it, unless they open the link again.")}
              disabled={action.busy}
            >
              Forget it in these browsers
            </button>
          </p>
          <BrowserTable browsers={t.browserList} />
        </>
      )}

      {t.browsers > 0 && (
        <>
          <h2>Browsers holding this ticket</h2>
          <BrowserTable browsers={t.browserList} />
        </>
      )}

      <h2>Activity</h2>
      {events.data?.events.length ? (
        <div className="table-wrap">
          <table className="stack">
            <tbody>
              {events.data.events.map((e) => (
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
        <p className="dim">
          {/* The ticket's own record outlives its events: see Settings, Keeping records. */}
          {t.firstOpenedAt ? 'None kept: older events are cleared after a while (Settings, Keeping records).' : 'No activity yet. Opening the link and playing show up here.'}
        </p>
      )}
      {events.data?.next && (
        <p style={{ marginTop: '1rem' }}>
          <Link to={`/admin/activity?ticket=${t.id}&heartbeats=1`}>All of this ticket's activity</Link>
        </p>
      )}
      <p className="faint" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
        This shows what the browser reported: playback progress, not proof anyone was watching. Positions are rounded to the last report (every 30
        seconds while playing, logged every 5 minutes). Finished means playback reached 92% of the running time.{' '}
        {t.durationSeconds ? `For this film that's ${formatClock(t.durationSeconds * 0.92)}.` : ''}
      </p>
    </>
  );
}

// Browsers that opened the ticket's link.
function BrowserTable({ browsers }) {
  return (
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
          {(browsers || []).map((b) => (
            <tr key={b.ref}>
              <td className="card-title">{b.device}</td>
              <td data-label="Opened the link">{formatDateTime(b.addedAt)}</td>
              <td className="faint" data-label="Last seen">{formatAgo(b.lastSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Who the ticket is for, and changing it: Give it to a person, or Let anyone with
// the link use it. Either way its limits, clocks and screenings stay as they are.
function WhoCanUseIt({ ticket: t, busy, onSetHolder }) {
  const people = useLoad(() => api.get('/api/admin/people'), []);
  const [to, setTo] = useState('');
  const person = t.person;
  // Disabled people can't be given tickets, and the current holder already has it.
  const choices = people.data?.filter((p) => !p.disabled && p.id !== person?.id) || [];
  const chosen = choices.find((p) => String(p.id) === to);

  function give() {
    if (!chosen) return;
    const loses = person ? `${person.name} loses it from the next request` : 'Browsers that opened the link lose it from the next request';
    onSetHolder(chosen.id, `Give this ticket to ${chosen.name}? Only ${chosen.name}, signed in, can use it from now on. ${loses}.`);
  }
  function release() {
    onSetHolder(
      null,
      `Let anyone with the link use this ticket again? ${person.name} loses it from the next request, and browsers that opened the link get it back.`,
    );
  }

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: '0.8rem' }}>
        <div>
          <strong>Who can use it</strong>
          <div className="dim">
            {person
              ? `Only ${person.name}, signed in, on every device they sign in on.`
              : t.claimable
                ? 'Anyone with the link. Someone you\'ve added can keep it in their account, and whoever keeps it first takes it from everyone else.'
                : 'Anyone with the link.'}
          </div>
        </div>
        <div className="row" style={{ gap: '0.5rem' }}>
          {person && (
            <button className="btn" onClick={release} disabled={busy}>
              Let anyone with the link use it
            </button>
          )}
          {choices.length > 0 && (
            <>
              <select aria-label="Give it to" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }}>
                <option value="">{person ? 'Give it to someone else…' : 'Give it to a person…'}</option>
                {choices.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={give} disabled={busy || !chosen}>
                Give
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
