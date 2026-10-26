import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDateTime } from '../api.js';
import { ErrorNote, describeEvent, useLoad } from './ui.jsx';

export default function Activity() {
  const [heartbeats, setHeartbeats] = useState(false);
  const { data: events, error } = useLoad(() => api.get(`/api/admin/activity?limit=300${heartbeats ? '&heartbeats=1' : ''}`), [heartbeats]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p className="dim" style={{ margin: 0 }}>
            Ticket opens, plays and finishes, newest first. This is what browsers reported, not proof anyone was watching.
          </p>
        </div>
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={heartbeats} onChange={(e) => setHeartbeats(e.target.checked)} />
          Show progress reports
        </label>
      </div>
      <ErrorNote error={error} />
      {events && events.length === 0 && <p className="dim">Nothing yet.</p>}
      {events && events.length > 0 && (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>When</th>
                <th>Ticket</th>
                <th>Film</th>
                <th>What happened</th>
                <th>Device</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap faint" data-label="When">{formatDateTime(e.at)}</td>
                  <td data-label="Ticket">{e.ticketId ? <Link to={`/admin/tickets/${e.ticketId}`}>{e.ticketLabel || 'Unnamed ticket'}</Link> : '–'}</td>
                  <td data-label="Film">{e.filmId ? <Link to={`/admin/films/${e.filmId}`}>{e.filmTitle}</Link> : '–'}</td>
                  <td className="card-title">{describeEvent(e)}</td>
                  <td className="faint" data-label="Device">{e.device || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
