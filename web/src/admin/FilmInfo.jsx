import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatAgo } from '../api.js';
import { ErrorNote, useAction, useLoad } from './ui.jsx';

const FIELD_LABELS = {
  title: 'Title',
  originalTitle: 'Original title',
  year: 'Year',
  runtimeMinutes: 'Running time (min)',
  directors: 'Directed by',
  country: 'Country',
  synopsis: 'Synopsis',
  contentNote: 'Content note',
};

const tmdbLink = (id) => `https://www.themoviedb.org/movie/${id}`;

// The "Film information" card on a film's admin page: what TMDb matched,
// the artwork in use, and the search-and-choose flow.
export default function FilmInfo({ film, onChange }) {
  const meta = useLoad(() => api.get('/api/admin/metadata'), []);
  const [identifying, setIdentifying] = useState(false);
  const action = useAction();

  if (!meta.data) return null;
  if (!meta.data.configured) {
    return (
      <div className="card">
        <p style={{ margin: 0 }}>
          Fill in details, posters and backdrops automatically from TMDB, as Jellyfin does. Add a free TMDB API key in{' '}
          <Link to="/admin/settings">Settings</Link> to turn it on.
        </p>
      </div>
    );
  }

  async function resetArtwork(kind) {
    const r = await action.run(() => api.post(`/api/admin/films/${film.id}/artwork/reset`, { kind }));
    if (r) onChange(r);
  }

  const s = film.tmdbStatus;
  let status;
  if (s?.state === 'matched') {
    status = (
      <>
        Matched to{' '}
        <a href={tmdbLink(film.tmdbId)} target="_blank" rel="noreferrer">
          {s.title}
          {s.year ? ` (${s.year})` : ''} on TMDB
        </a>{' '}
        <span className="faint">
          {s.how === 'auto' ? 'automatically' : 'by you'}, {formatAgo(s.at)}
        </span>
      </>
    );
  } else if (s?.state === 'needs-choice') {
    status = `Couldn't pick a match automatically: ${s.candidates} films on TMDB could be “${s.query}”. Choose the right one.`;
  } else if (s?.state === 'not-found') {
    status = `Nothing on TMDB matched “${s.query}”. Try searching another way.`;
  } else if (s?.state === 'error') {
    status = `The last lookup failed: ${s.message}`;
  } else {
    status = 'Not looked up yet. New films are matched when the media folder is scanned.';
  }

  return (
    <div className="card">
      <ErrorNote error={action.error} />
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <p style={{ margin: 0, flex: 1, minWidth: 240 }}>{status}</p>
        {!identifying && (
          <button className="btn" onClick={() => setIdentifying(true)}>
            {s?.state === 'matched' ? 'Change match…' : 'Find details…'}
          </button>
        )}
      </div>

      <div className="row" style={{ marginTop: '1rem', alignItems: 'flex-start', gap: '1.5rem' }}>
        <ArtworkTile label="Poster" url={film.posterUrl} source={film.artworkSource.poster} onReset={() => resetArtwork('poster')} tall />
        <ArtworkTile label="Backdrop" url={film.backdropUrl} source={film.artworkSource.backdrop} onReset={() => resetArtwork('backdrop')} />
      </div>

      {identifying && (
        <Identify
          film={film}
          onCancel={() => setIdentifying(false)}
          onApplied={(updated) => {
            setIdentifying(false);
            onChange(updated);
          }}
        />
      )}
    </div>
  );
}

function ArtworkTile({ label, url, source, onReset, tall = false }) {
  return (
    <div style={{ width: tall ? 110 : 220 }}>
      <div style={{ fontSize: '0.85rem' }}>{label}</div>
      <div className="faint" style={{ fontSize: '0.78rem', marginBottom: '0.35rem' }}>
        {source === 'tmdb' ? 'From TMDB' : source === 'folder' ? 'From the film folder' : 'None'}
      </div>
      {url ? (
        <img src={url} alt="" className="poster" style={{ aspectRatio: tall ? '2 / 3' : '16 / 9', boxShadow: 'none' }} />
      ) : (
        <div className="poster placeholder" style={{ aspectRatio: tall ? '2 / 3' : '16 / 9', boxShadow: 'none' }} />
      )}
      {source === 'tmdb' && (
        <button className="linklike" style={{ fontSize: '0.8rem', marginTop: '0.3rem' }} onClick={onReset}>
          Don’t use TMDB’s
        </button>
      )}
    </div>
  );
}

function Identify({ film, onCancel, onApplied }) {
  const [query, setQuery] = useState(film.lookup?.title || film.title);
  const [year, setYear] = useState(film.lookup?.year ? String(film.lookup.year) : '');
  const [results, setResults] = useState(null);
  const [chosen, setChosen] = useState(null);
  const action = useAction();

  async function search(e) {
    e?.preventDefault();
    setChosen(null);
    const r = await action.run(() => api.get(`/api/admin/films/${film.id}/metadata/search?q=${encodeURIComponent(query)}&year=${encodeURIComponent(year)}`));
    if (r) setResults(r.results);
  }

  async function choose(tmdbId) {
    const r = await action.run(() => api.get(`/api/admin/films/${film.id}/metadata/${tmdbId}`));
    if (r) setChosen(r);
  }

  return (
    <div style={{ marginTop: '1.2rem', borderTop: '1px solid var(--line)', paddingTop: '1.2rem' }}>
      <ErrorNote error={action.error} />
      {!chosen && (
        <>
          <form className="row" onSubmit={search} style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: 1, minWidth: 200, margin: 0 }}>
              <span>Title</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label className="field" style={{ width: 100, margin: 0 }}>
              <span>Year</span>
              <input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
            </label>
            <button className="btn primary" disabled={action.busy || !query.trim()}>
              Search TMDB
            </button>
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          </form>
          {results && results.length === 0 && <p className="dim" style={{ marginTop: '1rem' }}>No films found. Try without the year, or another title.</p>}
          {results && results.length > 0 && (
            <div style={{ display: 'grid', gap: '0.6rem', marginTop: '1rem' }}>
              {results.map((r) => (
                <div key={r.tmdbId} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: '0.9rem' }}>
                  {r.posterThumb ? (
                    <img src={r.posterThumb} alt="" style={{ width: 54, borderRadius: 3, flexShrink: 0 }} />
                  ) : (
                    <div className="poster placeholder" style={{ width: 54, flexShrink: 0, boxShadow: 'none' }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{r.title}</strong> {r.year && <span className="dim">({r.year})</span>}
                    {r.originalTitle && r.originalTitle !== r.title && <span className="faint"> · {r.originalTitle}</span>}
                    <div className="dim" style={{ fontSize: '0.88rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {r.overview}
                    </div>
                  </div>
                  <button className="btn small" onClick={() => choose(r.tmdbId)} disabled={action.busy}>
                    Choose
                  </button>
                </div>
              ))}
            </div>
          )}
          {!results && (
            <p className="faint" style={{ marginTop: '0.8rem', marginBottom: 0 }}>
              Search, then choose the right film to see what would change.
            </p>
          )}
        </>
      )}
      {chosen && <ApplyChoice film={film} details={chosen} onBack={() => setChosen(null)} onApplied={onApplied} />}
    </div>
  );
}

function ApplyChoice({ film, details, onBack, onApplied }) {
  const [fields, setFields] = useState(() => new Set(details.suggestedFields));
  // Keep the artwork you have, or take TMDB's if there's none.
  const [poster, setPoster] = useState(film.posterUrl ? null : details.defaultPoster);
  const [backdrop, setBackdrop] = useState(film.backdropUrl ? null : details.defaultBackdrop);
  const action = useAction();

  function toggle(k) {
    const next = new Set(fields);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setFields(next);
  }

  async function apply() {
    const r = await action.run(() =>
      api.post(`/api/admin/films/${film.id}/metadata/apply`, { tmdbId: details.tmdbId, fields: [...fields], poster, backdrop }),
    );
    if (r) onApplied(r.film);
  }

  const show = (v) => (v == null || v === '' ? <span className="faint">–</span> : String(v));

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.8rem' }}>
        <strong>
          {details.fields.title} {details.fields.year && <span className="dim">({details.fields.year})</span>}{' '}
          <a href={tmdbLink(details.tmdbId)} target="_blank" rel="noreferrer" className="faint" style={{ fontWeight: 400, fontSize: '0.85rem' }}>
            view on TMDB
          </a>
        </strong>
        <button className="btn small" onClick={onBack}>
          ← Other results
        </button>
      </div>
      <ErrorNote error={action.error} />
      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th style={{ width: 40 }}>Use</th>
              <th>Field</th>
              <th>Now</th>
              <th>From TMDB</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(FIELD_LABELS).map(([k, label]) => {
              const value = details.fields[k];
              const same = value === details.current[k];
              return (
                <tr key={k}>
                  <td data-label="Use TMDB's">
                    <input type="checkbox" checked={fields.has(k)} disabled={value == null || same} onChange={() => toggle(k)} aria-label={`Use TMDB's ${label}`} />
                  </td>
                  <td className="nowrap card-title">{label}</td>
                  <td style={{ maxWidth: 280 }} data-label="Now">{show(details.current[k])}</td>
                  <td style={{ maxWidth: 360 }} data-label="From TMDB">{value != null && same ? <span className="faint">same</span> : show(value)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="faint" style={{ fontSize: '0.85rem' }}>Your recommendation is never changed. Fields you tick replace what's there now.</p>

      <ImagePicker label="Poster" images={details.posters} value={poster} onChange={setPoster} hasCurrent={Boolean(film.posterUrl)} tall />
      <ImagePicker label="Backdrop" images={details.backdrops} value={backdrop} onChange={setBackdrop} hasCurrent={Boolean(film.backdropUrl)} />

      <div className="row" style={{ marginTop: '1.2rem' }}>
        <button className="btn primary" onClick={apply} disabled={action.busy || (!fields.size && !poster && !backdrop)}>
          {action.busy ? 'Applying…' : 'Apply'}
        </button>
        <button className="btn" onClick={onBack} disabled={action.busy}>
          Back
        </button>
      </div>
    </>
  );
}

function ImagePicker({ label, images, value, onChange, hasCurrent, tall = false }) {
  if (!images.length) return null;
  const width = tall ? 92 : 168;
  const tile = (selected) => ({
    width,
    padding: 0,
    border: `2px solid ${selected ? 'var(--accent)' : 'transparent'}`,
    borderRadius: 6,
    background: 'none',
    cursor: 'pointer',
    overflow: 'hidden',
  });
  return (
    <div style={{ marginTop: '1.2rem' }}>
      <div style={{ marginBottom: '0.5rem' }}>{label}</div>
      <div className="row" style={{ gap: '0.5rem', alignItems: 'stretch' }}>
        <button
          type="button"
          onClick={() => onChange(null)}
          style={{ ...tile(value === null), aspectRatio: tall ? '2 / 3' : '16 / 9', color: 'var(--text-dim)', fontSize: '0.8rem' }}
        >
          {hasCurrent ? 'Keep current' : 'None'}
        </button>
        {images.map((img) => (
          <button type="button" key={img.path} onClick={() => onChange(img.path)} style={tile(value === img.path)} aria-label={`Use this ${label.toLowerCase()}`}>
            <img src={img.thumb} alt="" style={{ width: '100%', aspectRatio: tall ? '2 / 3' : '16 / 9', objectFit: 'cover', display: 'block' }} />
          </button>
        ))}
      </div>
    </div>
  );
}
