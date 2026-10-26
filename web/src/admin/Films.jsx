import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatAgo } from '../api.js';
import { Poster } from '../pages/shared.jsx';
import { ErrorNote, MediaBadge, useAction, useLoad } from './ui.jsx';

export default function Films() {
  const { data: films, error, reload } = useLoad(() => api.get('/api/admin/films'), []);
  const [report, setReport] = useState(null);
  const action = useAction();

  async function scan() {
    const r = await action.run(() => api.post('/api/admin/scan'));
    if (r) {
      setReport(r);
      reload();
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Films</h1>
          <p className="dim" style={{ margin: 0 }}>
            Each folder in the media directory with a film.json is a film. New films start unpublished.
          </p>
        </div>
        <button className="btn primary" onClick={scan} disabled={action.busy}>
          {action.busy ? 'Scanning…' : 'Scan media folder'}
        </button>
      </div>
      <ErrorNote error={error || action.error} />
      {report && <ScanReport report={report} onClose={() => setReport(null)} />}
      {report?.matching && report.films.some((f) => f.added) && (
        <div className="notice">
          Looking up the new films on TMDB in the background.{' '}
          <button className="linklike" onClick={reload}>
            Refresh
          </button>{' '}
          in a moment to see their details and posters.
        </div>
      )}

      {films && films.length === 0 && (
        <div className="card">
          <p>No films yet.</p>
          <p className="dim" style={{ margin: 0 }}>
            Copy a prepared film folder into the media directory (see docs/import-format.md), then press Scan media folder.
          </p>
        </div>
      )}

      {films && films.length > 0 && (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>Film</th>
                <th>Status</th>
                <th>Media</th>
                <th>Tickets</th>
                <th>Scanned</th>
              </tr>
            </thead>
            <tbody>
              {films.map((f) => (
                <tr key={f.id}>
                  <td className="card-title">
                    <Link to={`/admin/films/${f.id}`} className="film-row">
                      <Poster film={f} />
                      <span>
                        <strong>{f.title}</strong> {f.year && <span className="dim">({f.year})</span>}
                        <br />
                        <span className="faint mono">/{f.slug}</span>
                        {(f.tmdbStatus?.state === 'needs-choice' || f.tmdbStatus?.state === 'not-found') && (
                          <span className="badge warn" style={{ marginLeft: 8 }}>
                            Choose a TMDB match
                          </span>
                        )}
                      </span>
                    </Link>
                  </td>
                  <td data-label="Status">{f.published ? <span className="badge good">Published</span> : <span className="badge">Draft</span>}</td>
                  <td data-label="Media">
                    <MediaBadge status={f.mediaStatus} />
                  </td>
                  <td data-label="Active tickets">{f.tickets.active}</td>
                  <td className="faint nowrap" data-label="Scanned">{formatAgo(f.scannedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ScanReport({ report, onClose }) {
  if (report.unavailable) {
    return (
      <div className="notice bad">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>The scan couldn't use the media folder.</strong>
          <button className="btn small" onClick={onClose}>
            Close
          </button>
        </div>
        <p style={{ margin: '0.5rem 0 0' }}>{report.unavailable}</p>
      </div>
    );
  }
  const problems = report.films.filter((f) => f.status !== 'ok' || f.conflicts.length);
  const tone = report.films.some((f) => f.status === 'error') ? 'bad' : problems.length || report.skipped.length ? 'warn' : 'good';
  return (
    <div className={`notice ${tone}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>
          Scanned {report.films.length} folder{report.films.length === 1 ? '' : 's'}: {report.films.filter((f) => f.added).length} new,{' '}
          {report.films.filter((f) => f.status === 'error').length} with errors.
        </strong>
        <button className="btn small" onClick={onClose}>
          Close
        </button>
      </div>
      {report.films.map((f) =>
        f.status === 'ok' && !f.conflicts.length && !f.updated.length && !f.added ? null : (
          <div key={f.slug} style={{ marginTop: '0.8rem' }}>
            <strong>{f.title || f.slug}</strong> <span className="faint mono">/{f.slug}</span> <MediaBadge status={f.status} />
            {f.added && <span className="badge" style={{ marginLeft: 6 }}>New</span>}
            <ul>
              {f.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
              {f.warnings.map((w) => (
                <li key={w} className="dim">
                  {w}
                </li>
              ))}
              {f.updated.length > 0 && <li className="dim">Updated from film.json: {f.updated.join(', ')}</li>}
              {f.conflicts.map((c) => (
                <li key={c.field}>
                  film.json changed <strong>{c.field}</strong>, but you'd edited it here, so your version was kept. Use “Reset to film.json” on the
                  film to take the file's version.
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
      {report.removed.map((r) => (
        <div key={r.slug} style={{ marginTop: '0.8rem' }}>
          <strong>{r.title}</strong> <span className="faint mono">/{r.slug}</span>: the folder is gone. {r.published && 'Ticket holders see it as unavailable.'}
        </div>
      ))}
      {report.skipped.map((s) => (
        <div key={s.name} style={{ marginTop: '0.8rem' }}>
          Skipped <span className="mono">{s.name}</span>: {s.reason}
        </div>
      ))}
    </div>
  );
}
