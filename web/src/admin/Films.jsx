import { useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatAgo, plural } from '../api.js';
import { Sleeve } from '../look/objects.jsx';
import { Line } from '../look/ui.jsx';
import { AdminContext, ErrorNote, Fact, Head, Mark, MediaBadge, Table, useAction, useLoad } from './ui.jsx';

// The shelf: every film, on it or off it, its media and the scan. `children` comes
// under the heading (the attention strip, on the back office's first page).
export default function Films({ children }) {
  const { data: films, error, reload } = useLoad(() => api.get('/api/admin/films'), []);
  const { refreshFacts } = useContext(AdminContext);
  const [report, setReport] = useState(null);
  const action = useAction();

  async function scan() {
    const r = await action.run(() => api.post('/api/admin/scan'));
    if (r) {
      setReport(r);
      reload();
      refreshFacts('now');
    }
  }

  return (
    <>
      <Head
        title="Films"
        lede="Each folder in the media directory with a film.json is a film. New films start off the shelf."
        actions={
          <button type="button" className="ui-btn ui-btn--primary" onClick={scan} disabled={action.busy}>
            {action.busy ? 'Scanning…' : 'Scan media folder'}
          </button>
        }
      />
      {children}
      <ErrorNote error={error || action.error} />
      {report && <ScanReport report={report} onClose={() => setReport(null)} />}
      {report?.matching && report.films.some((f) => f.added) && (
        <Line kind="info">
          Looking up the new films on TMDB in the background. Refresh in a moment to see their details and posters.
          <div className="ui-btns">
            <button type="button" className="ui-btn ui-btn--small" onClick={reload}>
              Refresh
            </button>
          </div>
        </Line>
      )}

      {films && films.length === 0 && (
        <div className="of-box of-w">
          <h2 className="of-h2">No films yet</h2>
          <p className="of-p of-dim">Copy a prepared film folder into the media directory (see docs/import-format.md), then press Scan media folder.</p>
        </div>
      )}

      {films && films.length > 0 && (
        <Table
          head={
            <>
              <th>Film</th>
              <th>Shelf</th>
              <th>Media</th>
              <th className="ui-n">Active tapes</th>
              <th className="of-desk-only">Scanned</th>
            </>
          }
        >
          {films.map((f) => (
            <tr key={f.id}>
              <td className="of-td-film">
                <FilmCell film={f} />
              </td>
              <td data-label="Shelf">{f.published ? <Mark tone="done">On the shelf</Mark> : <Mark tone="off">Off the shelf</Mark>}</td>
              <td data-label="Media">
                <span className="of-cell">
                  <MediaBadge status={f.mediaStatus} />
                  <small className="of-phone-only">Scanned {formatAgo(f.scannedAt)}</small>
                </span>
              </td>
              <td className="ui-n" data-label="Active tapes">
                {f.tickets.active || <span className="of-faint">none</span>}
              </td>
              <td className="ui-when of-desk-only" data-label="Scanned">
                {formatAgo(f.scannedAt)}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

// A film in a list: its sleeve, its title (the way to its page), year and folder, and
// what to know at a glance.
function FilmCell({ film: f }) {
  const needsMatch = f.tmdbStatus?.state === 'needs-choice' || f.tmdbStatus?.state === 'not-found';
  return (
    <div className="of-film">
      <Sleeve film={f} seed={`thumb:${f.id}`} width={44} thumb />
      <span>
        <Link to={`/admin/films/${f.id}`} className="of-film__t">
          <b>{f.title}</b>
        </Link>
        <span className="of-film__k">
          {f.year ? `${f.year} · ` : ''}/{f.slug}
        </span>
        {(needsMatch || f.memberVisible) && (
          <span className="of-marks">
            {needsMatch && <Mark tone="warn">Choose a TMDB match</Mark>}
            {f.memberVisible && <Fact>{f.published ? 'Shown to members' : 'Shown to members once on the shelf'}</Fact>}
          </span>
        )}
      </span>
    </div>
  );
}

function ScanReport({ report, onClose }) {
  const close = (
    <div className="ui-btns">
      <button type="button" className="ui-btn ui-btn--small" onClick={onClose}>
        Close
      </button>
    </div>
  );
  if (report.unavailable) {
    return (
      <Line kind="bad" block lead="The scan couldn't use the media folder.">
        <p>{report.unavailable}</p>
        {close}
      </Line>
    );
  }
  const problems = report.films.filter((f) => f.status !== 'ok' || f.conflicts.length);
  const tone = report.films.some((f) => f.status === 'error') ? 'bad' : problems.length || report.skipped.length ? 'warn' : 'done';
  const added = report.films.filter((f) => f.added).length;
  const errors = report.films.filter((f) => f.status === 'error').length;
  const shown = report.films.filter((f) => !(f.status === 'ok' && !f.conflicts.length && !f.updated.length && !f.added));
  return (
    <Line kind={tone} block role="status" lead={`Scanned ${plural(report.films.length, 'folder')}: ${added} new, ${errors} with errors.`}>
      {(shown.length > 0 || report.removed.length > 0 || report.skipped.length > 0) && (
        <ul>
          {shown.map((f) => (
            <li key={f.slug}>
              <b>{f.title || f.slug}</b> <span className="of-mono of-faint">/{f.slug}</span> <MediaBadge status={f.status} />
              {f.added && (
                <>
                  {' '}
                  <Fact>New</Fact>
                </>
              )}
              {(f.errors.length > 0 || f.warnings.length > 0 || f.updated.length > 0 || f.conflicts.length > 0) && (
                <ul>
                  {f.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                  {f.warnings.map((w) => (
                    <li key={w} className="of-dim">
                      {w}
                    </li>
                  ))}
                  {f.updated.length > 0 && <li className="of-dim">Updated from film.json: {f.updated.join(', ')}</li>}
                  {f.conflicts.map((c) => (
                    <li key={c.field}>
                      film.json changed <b>{c.field}</b>, but you'd edited it here, so your version was kept. Use “Reset to film.json” on the film to take
                      the file's version.
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {report.removed.map((r) => (
            <li key={r.slug}>
              <b>{r.title}</b> <span className="of-mono of-faint">/{r.slug}</span>: the folder is gone.
              {r.published && ' Anyone with a tape for it sees it as unavailable.'}
            </li>
          ))}
          {report.skipped.map((s) => (
            <li key={s.name}>
              Skipped <span className="of-mono">{s.name}</span>: {s.reason}
            </li>
          ))}
        </ul>
      )}
      {close}
    </Line>
  );
}
