import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatAgo, formatBytes, formatClock } from '../api.js';
import FilmInfo from './FilmInfo.jsx';
import { IssueTicket, TicketTable } from './Tickets.jsx';
import { ErrorNote, MediaBadge, useAction, useLoad } from './ui.jsx';

const FIELDS = [
  ['title', 'Title'],
  ['originalTitle', 'Original title'],
  ['year', 'Year'],
  ['runtimeMinutes', 'Running time (minutes)'],
  ['directors', 'Directed by'],
  ['country', 'Country'],
];
const LONG_FIELDS = [
  ['recommendation', 'Your recommendation', 'Why should they watch it? This is the heart of the page.'],
  ['synopsis', 'Synopsis'],
  ['contentNote', 'Content note', 'Optional: warnings or age guidance.'],
];
const ALL_FIELDS = [...FIELDS, ...LONG_FIELDS].map(([k]) => k);

export default function FilmDetail() {
  const { id } = useParams();
  const { data: film, setData, error } = useLoad(() => api.get(`/api/admin/films/${id}`), [id]);
  const tickets = useLoad(() => api.get(`/api/admin/tickets?film=${id}`), [id]);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  const action = useAction();

  useEffect(() => {
    if (film) setForm(Object.fromEntries([...ALL_FIELDS, 'sortOrder'].map((k) => [k, film[k] ?? ''])));
  }, [film]);

  if (error) return <ErrorNote error={error} />;
  if (!film || !form) return null;

  const dirty = ALL_FIELDS.some((k) => String(form[k] ?? '') !== String(film[k] ?? '')) || String(form.sortOrder) !== String(film.sortOrder);
  const differs = (k) => film.importedMeta && String(film[k] ?? '') !== String(film.importedMeta[k] ?? '');
  const fromTmdb = (k) => film.metaSources?.[k] === 'tmdb';
  const anyEdited = ALL_FIELDS.some(differs);
  const badge = (k) =>
    fromTmdb(k) ? <span className="edited">from TMDB</span> : differs(k) ? <span className="edited">edited here</span> : null;
  const broken = film.mediaStatus === 'error' || film.mediaStatus === 'missing';

  async function save(e) {
    e.preventDefault();
    const body = { ...form, year: form.year === '' ? null : Number(form.year), runtimeMinutes: form.runtimeMinutes === '' ? null : Number(form.runtimeMinutes) };
    const r = await action.run(() => api.patch(`/api/admin/films/${film.id}`, body));
    if (r) {
      setData(r);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  async function setPublished(published) {
    const r = await action.run(() => api.patch(`/api/admin/films/${film.id}`, { published }));
    if (r) {
      setData(r);
      tickets.reload();
    }
  }

  async function resetMetadata() {
    if (!window.confirm('Replace your edits with the values from film.json?')) return;
    const r = await action.run(() => api.post(`/api/admin/films/${film.id}/reset-metadata`));
    if (r) setData(r);
  }

  const media = film.media || {};
  const report = film.scanReport || { errors: [], warnings: [] };

  return (
    <>
      <p style={{ margin: '0 0 0.6rem' }}>
        <Link to="/admin" className="dim">
          ← Films
        </Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{film.title}</h1>
          <div className="row" style={{ gap: '0.5rem' }}>
            <span className="faint mono">/{film.slug}</span>
            {film.published ? <span className="badge good">Published</span> : <span className="badge">Draft</span>}
            <MediaBadge status={film.mediaStatus} />
          </div>
        </div>
        <div className="row">
          <a className="btn" href={`/${film.slug}`} target="_blank" rel="noreferrer">
            Preview page
          </a>
          {film.published ? (
            <button className="btn" onClick={() => setPublished(false)} disabled={action.busy}>
              Unpublish
            </button>
          ) : (
            <button className="btn primary" onClick={() => setPublished(true)} disabled={action.busy || broken} title={broken ? 'Fix the media errors first' : ''}>
              Publish
            </button>
          )}
        </div>
      </div>
      <ErrorNote error={action.error} />

      {report.errors.length > 0 && (
        <div className="notice bad">
          <strong>This film can't be played until these are fixed in its folder:</strong>
          <ul>
            {report.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {report.warnings.length > 0 && (
        <div className="notice warn">
          <strong>Worth checking:</strong>
          <ul>
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <h2>Tickets</h2>
      {!film.published && <p className="dim">Tickets only open the film once it's published. You can issue them now and send them later.</p>}
      <IssueTicket film={film} onIssued={tickets.reload} />
      {tickets.data && tickets.data.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <TicketTable tickets={tickets.data} showFilm={false} />
        </div>
      )}

      <h2>Film information</h2>
      <FilmInfo film={film} onChange={setData} />

      <h2>Details</h2>
      <form className="card" onSubmit={save}>
        <div className="grid-2">
          {FIELDS.map(([k, label]) => (
            <label className="field" key={k}>
              <span>
                {label}
                {badge(k)}
              </span>
              <input
                type={k === 'year' || k === 'runtimeMinutes' ? 'number' : 'text'}
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                required={k === 'title'}
              />
            </label>
          ))}
        </div>
        {LONG_FIELDS.map(([k, label, hint]) => (
          <label className="field" key={k}>
            <span>
              {label}
              {badge(k)}
            </span>
            <textarea value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} rows={k === 'recommendation' ? 5 : 4} />
            {hint && <small>{hint}</small>}
          </label>
        ))}
        <label className="field" style={{ maxWidth: 200 }}>
          <span>Sort order</span>
          <input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
        </label>
        <div className="row">
          <button className="btn primary" disabled={!dirty || action.busy}>
            {saved ? 'Saved' : 'Save details'}
          </button>
          {anyEdited && (
            <button type="button" className="btn" onClick={resetMetadata} disabled={action.busy}>
              Reset to film.json
            </button>
          )}
          <span className="faint">Later scans won't overwrite what you change here.</span>
        </div>
      </form>

      <h2>Media</h2>
      <div className="card">
        <dl className="kv">
          <dt>Folder</dt>
          <dd className="mono">{film.slug}/</dd>
          <dt>Playlist</dt>
          <dd className="mono">{media.hls || '–'}</dd>
          <dt>Running time</dt>
          <dd>{media.durationSeconds ? formatClock(media.durationSeconds) : '–'}</dd>
          <dt>Size on disk</dt>
          <dd>{formatBytes(media.sizeBytes)}</dd>
          <dt>Last scanned</dt>
          <dd>{formatAgo(film.scannedAt)}</dd>
        </dl>
      </div>
      {media.variants?.length > 0 && (
        <div className="table-wrap" style={{ marginTop: '1rem' }}>
          <table className="stack">
            <thead>
              <tr>
                <th>Rendition</th>
                <th>Resolution</th>
                <th>Codecs</th>
                <th>Range</th>
                <th>Peak bitrate</th>
                <th>Segments</th>
              </tr>
            </thead>
            <tbody>
              {media.variants.map((v) => (
                <tr key={v.uri}>
                  <td className="card-title">{v.label}</td>
                  <td data-label="Resolution">{v.width && v.height ? `${v.width}×${v.height}` : '–'}</td>
                  <td className="mono" data-label="Codecs">{v.codecs.join(', ') || <span className="badge warn">missing</span>}</td>
                  <td data-label="Range">{v.videoRange}</td>
                  <td data-label="Peak bitrate">{v.bandwidth ? `${(v.bandwidth / 1e6).toFixed(1)} Mbit/s` : '–'}</td>
                  <td data-label="Segments">{v.fmp4 == null ? '–' : v.fmp4 ? 'fMP4' : 'MPEG-TS'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid-2" style={{ marginTop: '1rem' }}>
        <div className="card">
          <strong>Audio</strong>
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1em' }}>
            {(media.audio || []).map((a) => (
              <li key={a.uri || a.name}>
                {a.name} <span className="faint">({[a.language, a.channels && `${a.channels} ch`, a.default && 'default'].filter(Boolean).join(', ')})</span>
              </li>
            ))}
            {!media.audio?.length && <li className="faint">Muxed into the video renditions</li>}
          </ul>
        </div>
        <div className="card">
          <strong>Subtitles</strong>
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1em' }}>
            {(media.subtitles || []).map((s) => (
              <li key={s.file}>
                {s.label} <span className="faint mono">{s.file}</span>
              </li>
            ))}
            {!media.subtitles?.length && <li className="faint">None</li>}
          </ul>
        </div>
      </div>
    </>
  );
}
