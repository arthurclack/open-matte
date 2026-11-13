import { Link, useSearchParams } from 'react-router-dom';
import { api, formatDateTime } from '../api.js';
import { TapeStrip, TillSlip } from '../look/objects.jsx';
import { loanEventWords } from './loanWords.js';
import { ErrorNote, Mark, Table, describeEvent, isSecurityEvent, keptFor, useAction, useLoad } from './ui.jsx';

// How many events each page (and each Show older) brings.
const PAGE = 100;

const KINDS = [
  ['', 'All'],
  ['viewing', 'Viewing'],
  ['loans', 'Loans'],
  ['accounts', 'Cards, passkeys and links'],
];

// The filters live in the address (?film=&person=&ticket=&kind=&heartbeats=1), so a
// filtered view can be linked to and survives a reload. A tape's page links here
// with ?ticket=. Loans are the links sent, cancelled and restored, and every time a
// tape went out and came back (server/access.js LOAN_EVENTS).
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
  // Cards, passkeys and links have no progress reports to show.
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
      <div className="of-head">
        <div>
          {/* The shop's ledger, its name on a strip of label tape. */}
          <h1 className="of-ledger-head">
            <TapeStrip text="Ledger" seed="ledger" />
          </h1>
          <p className="of-lede">
            Links sent, loans, plays and finishes, and members' sign-ins, passkeys and links, newest first. This is what browsers reported, not proof
            anyone was watching.
            {s?.retainProgressDays && s?.retainEventsDays && (
              <>
                {' '}
                Progress reports are kept for {keptFor(s.retainProgressDays)}, everything else for {keptFor(s.retainEventsDays)}.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="of-filters">
        <select aria-label="Film" className={`ui-select${film ? ' is-on' : ''}`} value={film} onChange={(e) => setFilter('film', e.target.value)}>
          <option value="">Every film</option>
          {films.data?.map((f) => (
            <option key={f.id} value={String(f.id)}>
              {f.title}
            </option>
          ))}
        </select>
        <select aria-label="Member" className={`ui-select${person ? ' is-on' : ''}`} value={person} onChange={(e) => setFilter('person', e.target.value)}>
          <option value="">Everyone</option>
          {people.data?.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name}
              {p.disabled ? ' (card turned off)' : ''}
            </option>
          ))}
        </select>
        {KINDS.map(([value, label]) => (
          <button key={value} type="button" className="ui-btn ui-btn--small" aria-pressed={kind === value} onClick={() => setFilter('kind', value)}>
            {label}
          </button>
        ))}
        {ticket && <TicketChip id={ticket} onRemove={() => setFilter('ticket', '')} />}
        <label className="ui-check">
          <input type="checkbox" checked={heartbeats && kind !== 'accounts'} disabled={kind === 'accounts'} onChange={(e) => setFilter('heartbeats', e.target.checked ? '1' : '')} />
          <span>Show progress reports</span>
        </label>
      </div>

      {/* A new set of filters starts again from the newest events. */}
      <Events key={query.toString()} query={query.toString()} filtered={filtered} />
    </>
  );
}

// The link a view is filtered to, with a way to see every link again.
function TicketChip({ id, onRemove }) {
  const { data: t } = useLoad(() => api.get(`/api/admin/tickets/${encodeURIComponent(id)}`), [id]);
  const name = t ? `${t.label || t.person?.name || 'Unnamed link'} · ${t.film.title}` : `Link ${id}`;
  return (
    <button type="button" className="ui-btn ui-btn--small" aria-pressed="true" onClick={onRemove} title="Show every link">
      Link: {name} <span aria-hidden="true">×</span>
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
  if (data.events.length === 0) return <p className="of-p of-dim">{filtered ? 'Nothing like that.' : 'Nothing yet.'}</p>;

  return (
    <>
      <Table
        className="of-ledger"
        head={
          <>
            <th className="of-c-when">When</th>
            <th>Who</th>
            <th>Film</th>
            <th>What happened</th>
            <th className="of-c-device">Device</th>
          </>
        }
      >
        {data.events.map((e) => (
          <tr key={e.id}>
            <td className="ui-when" data-label="When">
              {formatDateTime(e.at)}
            </td>
            <td className="of-td-left" data-label="Who">
              <Who event={e} />
            </td>
            <td className="of-td-left" data-label="Film">
              {e.filmId ? <Link to={`/admin/films/${e.filmId}`}>{e.filmTitle}</Link> : '–'}
            </td>
            <td className="ui-title">
              {isSecurityEvent(e) ? (
                <span className="of-sec">
                  <Mark tone="bad">
                    <b>Security.</b> {describeEvent(e)}
                  </Mark>
                </span>
              ) : loanEventWords(e)?.till ? (
                // Lent and back in: printed on a strip off the till roll.
                <TillSlip lines={[{ text: describeEvent(e) }]} seed={`ledger:${e.id}`} className="of-till" label={null} />
              ) : (
                describeEvent(e)
              )}
            </td>
            <td className="of-faint" data-label="Device">
              {e.device || '–'}
            </td>
          </tr>
        ))}
      </Table>
      <ErrorNote error={older.error} />
      {data.next && (
        <div className="ui-btns of-gap">
          <button type="button" className="ui-btn" onClick={showOlder} disabled={older.busy}>
            {older.busy ? 'Loading…' : 'Show older'}
          </button>
        </div>
      )}
    </>
  );
}

// The signed-in member when there is one, otherwise the link's label.
function Who({ event: e }) {
  // A member's own link usually has no label of its own: "their link".
  const ticket = e.ticketId ? <Link to={`/admin/tickets/${e.ticketId}`}>{e.ticketLabel || (e.personId ? 'their link' : 'Unnamed link')}</Link> : null;
  if (!e.personId) return ticket || '–';
  // One element, so the narrow-screen card layout keeps it together.
  return (
    <span>
      <Link to={`/admin/people/${e.personId}`}>{e.personName}</Link>
      {ticket && <span className="of-faint"> · {ticket}</span>}
    </span>
  );
}
