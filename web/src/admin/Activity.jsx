import { Link, useSearchParams } from 'react-router-dom';
import { api, formatDateTime } from '../api.js';
import { ErrorNote, describeEvent, keptFor, useAction, useLoad } from './ui.jsx';

// How many events each page (and each Show older) brings.
const PAGE = 100;

const KINDS = [
  ['', 'All'],
  ['viewing', 'Viewing'],
  ['accounts', 'Accounts and links'],
];

// The filters live in the address (?film=&person=&ticket=&kind=&heartbeats=1), so a
// filtered view can be linked to and survives a reload. A ticket's page links here
// with ?ticket=.
export default function Activity() {
  const [params, setParams] = useSearchParams();
  const film = params.get('film') || '';
  const person = params.get('person') || '';
  const ticket = params.get('ticket') || '';
  const kind = params.get('kind') || '';
  const heartbeats = params.get('heartbeats') === '1';
  const films = useLoad(() => api.get('/api/admin/films'), []);
  const people = useLoad(() => api.get('/api/admin/people'), []);
  const settings = useLoad(() => api.get('/api/admin/settings'), []);

  const query = new URLSearchParams();
  if (film) query.set('film', film);
  if (person) query.set('person', person);
  if (ticket) query.set('ticket', ticket);
  if (kind) query.set('kind', kind);
  // Accounts and links have no progress reports to show.
  if (heartbeats && kind !== 'accounts') query.set('heartbeats', '1');
  query.set('limit', String(PAGE));

  function setFilter(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }

  const s = settings.data;
  const filtered = Boolean(film || person || ticket || kind);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p className="dim" style={{ margin: 0, maxWidth: '46em' }}>
            Ticket opens, plays and finishes, and people's sign-ins, passkeys and links, newest first. This is what browsers reported, not proof anyone
            was watching.
            {s?.retainProgressDays && s?.retainEventsDays && (
              <>
                {' '}
                Progress reports are kept for {keptFor(s.retainProgressDays)}, everything else for {keptFor(s.retainEventsDays)}.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="row" style={{ gap: '0.5rem', marginBottom: '1rem' }}>
        <select aria-label="Film" className={`filter-select${film ? ' on' : ''}`} value={film} onChange={(e) => setFilter('film', e.target.value)}>
          <option value="">Every film</option>
          {films.data?.map((f) => (
            <option key={f.id} value={String(f.id)}>
              {f.title}
            </option>
          ))}
        </select>
        <select aria-label="Person" className={`filter-select${person ? ' on' : ''}`} value={person} onChange={(e) => setFilter('person', e.target.value)}>
          <option value="">Everyone</option>
          {people.data?.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name}
              {p.disabled ? ' (disabled)' : ''}
            </option>
          ))}
        </select>
        {KINDS.map(([value, label]) => (
          <button key={value} type="button" className={`btn small${kind === value ? ' on' : ''}`} aria-pressed={kind === value} onClick={() => setFilter('kind', value)}>
            {label}
          </button>
        ))}
        {ticket && <TicketChip id={ticket} onRemove={() => setFilter('ticket', '')} />}
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={heartbeats && kind !== 'accounts'} disabled={kind === 'accounts'} onChange={(e) => setFilter('heartbeats', e.target.checked ? '1' : '')} />
          Show progress reports
        </label>
      </div>

      {/* A new set of filters starts again from the newest events. */}
      <Events key={query.toString()} query={query.toString()} filtered={filtered} />
    </>
  );
}

// The ticket a view is filtered to, with a way to see every ticket again.
function TicketChip({ id, onRemove }) {
  const { data: t } = useLoad(() => api.get(`/api/admin/tickets/${encodeURIComponent(id)}`), [id]);
  const name = t ? `${t.label || t.person?.name || 'Unnamed ticket'} · ${t.film.title}` : `Ticket ${id}`;
  return (
    <button type="button" className="btn small on" onClick={onRemove} title="Show every ticket">
      Ticket: {name} <span aria-hidden="true">×</span>
      <span className="visually-hidden">(remove)</span>
    </button>
  );
}

function Events({ query, filtered }) {
  const { data, setData, error } = useLoad(() => api.get(`/api/admin/activity?${query}`), [query]);
  const older = useAction();

  async function showOlder() {
    const r = await older.run(() => api.get(`/api/admin/activity?${query}&before=${encodeURIComponent(data.next)}`));
    if (r) setData((d) => ({ events: [...d.events, ...r.events], next: r.next }));
  }

  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  if (data.events.length === 0) return <p className="dim">{filtered ? 'Nothing like that.' : 'Nothing yet.'}</p>;

  return (
    <>
      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Film</th>
              <th>What happened</th>
              <th>Device</th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((e) => (
              <tr key={e.id}>
                <td className="nowrap faint" data-label="When">{formatDateTime(e.at)}</td>
                <td data-label="Who">
                  <Who event={e} />
                </td>
                <td data-label="Film">{e.filmId ? <Link to={`/admin/films/${e.filmId}`}>{e.filmTitle}</Link> : '–'}</td>
                <td className="card-title">{describeEvent(e)}</td>
                <td className="faint" data-label="Device">{e.device || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorNote error={older.error} />
      {data.next && (
        <p style={{ marginTop: '1rem' }}>
          <button className="btn" onClick={showOlder} disabled={older.busy}>
            {older.busy ? 'Loading…' : 'Show older'}
          </button>
        </p>
      )}
    </>
  );
}

// The signed-in person when there is one, otherwise the ticket's label.
function Who({ event: e }) {
  const ticket = e.ticketId ? <Link to={`/admin/tickets/${e.ticketId}`}>{e.ticketLabel || 'Unnamed ticket'}</Link> : null;
  if (!e.personId) return ticket || '–';
  // One element, so the narrow-screen card layout keeps it together.
  return (
    <span>
      <Link to={`/admin/people/${e.personId}`}>{e.personName}</Link>
      {ticket && <span className="faint"> · {ticket}</span>}
    </span>
  );
}
