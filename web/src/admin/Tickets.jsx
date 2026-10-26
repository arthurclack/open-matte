import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatAgo, formatDate, plural } from '../api.js';
import { CopyButton, ErrorNote, Progress, TicketBadge, dateInputToMs, useAction, useLoad } from './ui.jsx';

export default function Tickets() {
  const { data: tickets, error, reload } = useLoad(() => api.get('/api/admin/tickets'), []);
  const films = useLoad(() => api.get('/api/admin/films'), []);
  const [filmId, setFilmId] = useState('');
  const film = films.data?.find((f) => String(f.id) === String(filmId));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tickets</h1>
          <p className="dim" style={{ margin: 0 }}>
            Each ticket opens one film. Anyone who has the link can use it, so send it only to the person it's for.
          </p>
        </div>
      </div>
      <ErrorNote error={error} />

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <label className="field" style={{ maxWidth: 420 }}>
          <span>Issue a ticket for</span>
          <select value={filmId} onChange={(e) => setFilmId(e.target.value)}>
            <option value="">Choose a film…</option>
            {films.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
                {f.published ? '' : ' (draft)'}
              </option>
            ))}
          </select>
        </label>
        {film && <IssueTicket key={film.id} film={film} onIssued={reload} bare />}
      </div>

      {tickets && tickets.length === 0 && <p className="dim">No tickets yet.</p>}
      {tickets && tickets.length > 0 && <TicketTable tickets={tickets} showFilm />}
    </>
  );
}

export function TicketTable({ tickets, showFilm }) {
  return (
    <div className="table-wrap">
      <table className="stack">
        <thead>
          <tr>
            <th>For</th>
            {showFilm && <th>Film</th>}
            <th>Status</th>
            <th>Screenings</th>
            <th>Furthest</th>
            <th>Last activity</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id}>
              <td className="card-title">
                <Link to={`/admin/tickets/${t.id}`}>{t.label || <span className="dim">Unnamed ticket</span>}</Link>
              </td>
              {showFilm && <td data-label="Film">{t.film?.title}</td>}
              <td data-label="Status">
                <TicketBadge ticket={t} />
              </td>
              <td className="nowrap" data-label="Screenings">
                {t.screeningsUsed}
                {t.screeningLimit != null ? ` of ${t.screeningLimit}` : ' (no limit)'}
              </td>
              <td data-label="Furthest">
                <Progress seconds={t.furthestSeconds} duration={t.durationSeconds} />
              </td>
              <td className="faint nowrap" data-label="Last activity">{t.lastActivity ? formatAgo(t.lastActivity.at) : 'none'}</td>
              <td data-label="Link">{t.state !== 'revoked' && <CopyButton text={t.link} label="Copy link" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The form for issuing tickets to one film, and the links it produced.
export function IssueTicket({ film, onIssued, bare = false }) {
  const [form, setForm] = useState({ label: '', screeningLimit: '1', startBy: '', daysAfterFirstPlay: '', count: '1' });
  const [issued, setIssued] = useState(null);
  const action = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const r = await action.run(() =>
      api.post('/api/admin/tickets', {
        filmId: film.id,
        label: form.label,
        screeningLimit: form.screeningLimit === '' ? null : Number(form.screeningLimit),
        startBy: dateInputToMs(form.startBy),
        daysAfterFirstPlay: form.daysAfterFirstPlay === '' ? null : Number(form.daysAfterFirstPlay),
        count: Number(form.count) || 1,
      }),
    );
    if (r) {
      setIssued(r);
      setForm({ ...form, label: '' });
      onIssued?.();
    }
  }

  const body = (
    <form onSubmit={submit}>
      <ErrorNote error={action.error} />
      <div className="grid-2">
        <label className="field">
          <span>Who is it for?</span>
          <input value={form.label} onChange={set('label')} placeholder="e.g. Sam" maxLength={200} />
          <small>Only you see this. It's a label, not a check: whoever has the link can use the ticket.</small>
        </label>
        <label className="field">
          <span>Screenings</span>
          <input type="number" min="1" max="1000" value={form.screeningLimit} onChange={set('screeningLimit')} placeholder="No limit" />
          <small>Each press of Play starts a screening that can be paused and resumed for a while. Leave empty for no limit.</small>
        </label>
        <label className="field">
          <span>Start watching by (optional)</span>
          <input type="date" value={form.startBy} onChange={set('startBy')} />
          <small>If the first screening hasn't started by the end of this day, the ticket expires.</small>
        </label>
        <label className="field">
          <span>Days valid after first play (optional)</span>
          <input type="number" min="1" max="3650" value={form.daysAfterFirstPlay} onChange={set('daysAfterFirstPlay')} placeholder="No limit" />
          <small>Counted from when they first press Play, not when they open the link.</small>
        </label>
        <label className="field">
          <span>How many tickets</span>
          <input type="number" min="1" max="50" value={form.count} onChange={set('count')} />
          <small>Each gets its own link.</small>
        </label>
      </div>
      <button className="btn primary" disabled={action.busy}>
        Issue {Number(form.count) > 1 ? `${form.count} tickets` : 'ticket'}
      </button>
    </form>
  );

  return (
    <>
      {bare ? body : <div className="card">{body}</div>}
      {issued && (
        <div className="notice good" style={{ marginTop: '1rem' }}>
          <strong>{plural(issued.length, 'ticket')} ready.</strong> Send each link to the person it's for.
          {issued.map((t) => {
            const message = `You should watch ${film.title}. Here's your ticket: ${t.link}`;
            return (
              <div key={t.id} style={{ marginTop: '0.7rem' }}>
                {t.label && <div className="dim" style={{ marginBottom: '0.3rem' }}>For {t.label}</div>}
                <div className="link-box">
                  <code>{t.link}</code>
                  <CopyButton text={t.link} label="Copy link" />
                  <CopyButton text={message} label="Copy message" />
                </div>
              </div>
            );
          })}
          {film && !film.published && <p style={{ margin: '0.7rem 0 0' }}>The film is still a draft: publish it before the links will open.</p>}
          {issued[0]?.startBy && <p className="dim" style={{ margin: '0.7rem 0 0' }}>Start by {formatDate(issued[0].startBy)}.</p>}
        </div>
      )}
    </>
  );
}
