import { useContext, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatAgo } from '../api.js';
import { Sleeve } from '../look/objects.jsx';
import { Line } from '../look/ui.jsx';
import { AdminContext, ErrorNote, Table, TmdbCredit, useAction, useLoad } from './ui.jsx';

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
const SOURCE = { tmdb: 'From TMDB', folder: 'From the film folder' };

// "Film information" on a film's details: what TMDB matched, the artwork in use, and
// the search-and-choose flow.
export default function FilmInfo({ film, onChange }) {
  const { site } = useContext(AdminContext);
  const meta = useLoad(() => api.get('/api/admin/metadata'), []);
  const [identifying, setIdentifying] = useState(false);
  const action = useAction();

  if (!meta.data) return null;
  if (!meta.data.configured) {
    return (
      <Line kind="info">
        Fill in details, posters and backdrops automatically from TMDB, as Jellyfin does. Add a free TMDB API key in <Link to="/admin/settings">Settings</Link>{' '}
        to turn it on.
      </Line>
    );
  }

  async function resetArtwork(kind) {
    const r = await action.run(() => api.post(`/api/admin/films/${film.id}/artwork/reset`, { kind }));
    if (r) onChange(r);
  }

  const s = film.tmdbStatus;
  let status;
  let tone = 'info';
  if (s?.state === 'matched') {
    tone = 'done';
    status = (
      <>
        Matched to{' '}
        <a href={tmdbLink(film.tmdbId)} target="_blank" rel="noreferrer">
          {s.title}
          {s.year ? ` (${s.year})` : ''} on TMDB
        </a>{' '}
        <span className="of-faint">
          {s.how === 'auto' ? 'automatically' : 'by you'}, {formatAgo(s.at)}
        </span>
      </>
    );
  } else if (s?.state === 'needs-choice') {
    tone = 'warn';
    status = `Couldn't pick a match automatically: ${s.candidates} films on TMDB could be “${s.query}”. Choose the right one.`;
  } else if (s?.state === 'not-found') {
    tone = 'warn';
    status = `Nothing on TMDB matched “${s.query}”. Try searching another way.`;
  } else if (s?.state === 'error') {
    tone = 'bad';
    status = `The last lookup failed: ${s.message}`;
  } else {
    status = 'Not looked up yet. New films are matched when the media folder is scanned.';
  }

  return (
    <>
      <ErrorNote error={action.error} />
      <Line kind={tone}>
        <p>{status}</p>
        {!identifying && (
          <div className="ui-btns">
            <button type="button" className="ui-btn" onClick={() => setIdentifying(true)}>
              {s?.state === 'matched' ? 'Change match…' : 'Find details…'}
            </button>
          </div>
        )}
      </Line>

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

      <div className="of-art">
        <div>
          <p className="ui-key">Poster</p>
          <Sleeve film={film} seed={`art:${film.id}`} width={150} logo={site?.logo} />
          <p className="of-src of-gap-s">{SOURCE[film.artworkSource.poster] || 'None'}</p>
          {film.artworkSource.poster === 'tmdb' && <DontUse onClick={() => resetArtwork('poster')} />}
        </div>
        <div>
          <p className="ui-key">Backdrop</p>
          {film.backdropUrl && <img src={film.backdropUrl} alt="" className="of-art__backdrop" />}
          <p className="of-src of-gap-s">{SOURCE[film.artworkSource.backdrop] || 'None'}</p>
          {film.artworkSource.backdrop === 'tmdb' && <DontUse onClick={() => resetArtwork('backdrop')} />}
        </div>
      </div>
      <TmdbCredit />
    </>
  );
}

function DontUse({ onClick }) {
  return (
    <button type="button" className="ui-btn ui-btn--quiet ui-btn--small" onClick={onClick}>
      Don’t use TMDB’s
    </button>
  );
}

function Identify({ film, onCancel, onApplied }) {
  const [query, setQuery] = useState(film.lookup?.title || film.title);
  const [year, setYear] = useState(film.lookup?.year ? String(film.lookup.year) : '');
  const [results, setResults] = useState(null);
  const [chosen, setChosen] = useState(null);
  const action = useAction();
  const id = useId();

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
    <div className="of-tmdb-choice">
      <ErrorNote error={action.error} />
      {!chosen && (
        <>
          <form className="of-inline" onSubmit={search}>
            <div className="ui-field" style={{ flex: '1 1 240px' }}>
              <label className="ui-field__label" htmlFor={`${id}-q`}>
                Title
              </label>
              <input id={`${id}-q`} className="ui-input" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${id}-y`}>
                Year
              </label>
              <input id={`${id}-y`} className="ui-input ui-input--num" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
            </div>
            <div className="ui-btns">
              <button className="ui-btn ui-btn--primary" disabled={action.busy || !query.trim()}>
                Search TMDB
              </button>
              <button type="button" className="ui-btn ui-btn--quiet" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </form>
          {results && results.length === 0 && <p className="of-p of-dim of-gap">No films found. Try without the year, or another title.</p>}
          {results && results.length > 0 && (
            <div className="of-results">
              {results.map((r) => (
                <div key={r.tmdbId} className="of-result">
                  {r.posterThumb ? <img src={r.posterThumb} alt="" /> : <span className="of-result__none" />}
                  <div style={{ minWidth: 0 }}>
                    <b>{r.title}</b> {r.year && <span className="of-dim">({r.year})</span>}
                    {r.originalTitle && r.originalTitle !== r.title && <span className="of-faint"> · {r.originalTitle}</span>}
                    <p className="of-result__over">{r.overview}</p>
                  </div>
                  <button type="button" className="ui-btn ui-btn--small" onClick={() => choose(r.tmdbId)} disabled={action.busy}>
                    Choose
                  </button>
                </div>
              ))}
            </div>
          )}
          {!results && <p className="ui-field__hint of-gap-s">Search, then choose the right film to see what would change.</p>}
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
    const r = await action.run(() => api.post(`/api/admin/films/${film.id}/metadata/apply`, { tmdbId: details.tmdbId, fields: [...fields], poster, backdrop }));
    if (r) onApplied(r.film);
  }

  const show = (v) => (v == null || v === '' ? <span className="of-faint">–</span> : String(v));

  return (
    <>
      <div className="of-head">
        <div>
          <h3 className="of-h3">
            {details.fields.title} {details.fields.year && <span className="of-dim">({details.fields.year})</span>}
          </h3>
          <a href={tmdbLink(details.tmdbId)} target="_blank" rel="noreferrer" className="of-small of-dim">
            View on TMDB
          </a>
        </div>
        <div className="ui-btns">
          <button type="button" className="ui-btn ui-btn--small" onClick={onBack}>
            ← Other results
          </button>
        </div>
      </div>
      <ErrorNote error={action.error} />
      <Table
        head={
          <>
            <th className="of-use">Use</th>
            <th>Field</th>
            <th>Now</th>
            <th>From TMDB</th>
          </>
        }
      >
        {Object.entries(FIELD_LABELS).map(([k, label]) => {
          const value = details.fields[k];
          const same = value === details.current[k];
          return (
            <tr key={k}>
              <td data-label="Use TMDB's">
                <span className="ui-check" style={{ padding: 0, minHeight: 0 }}>
                  <input type="checkbox" checked={fields.has(k)} disabled={value == null || same} onChange={() => toggle(k)} aria-label={`Use TMDB's ${label}`} />
                </span>
              </td>
              <td className="ui-title of-nowrap">{label}</td>
              <td data-label="Now">{show(details.current[k])}</td>
              <td data-label="From TMDB">{value != null && same ? <span className="of-faint">same</span> : show(value)}</td>
            </tr>
          );
        })}
      </Table>
      <p className="ui-field__hint of-gap-s">Your staff pick is never changed. Fields you tick replace what's there now.</p>

      <ImagePicker label="Poster" images={details.posters} value={poster} onChange={setPoster} hasCurrent={Boolean(film.posterUrl)} tall />
      <ImagePicker label="Backdrop" images={details.backdrops} value={backdrop} onChange={setBackdrop} hasCurrent={Boolean(film.backdropUrl)} />

      <div className="ui-btns of-gap">
        <button type="button" className="ui-btn ui-btn--primary" onClick={apply} disabled={action.busy || (!fields.size && !poster && !backdrop)}>
          {action.busy ? 'Applying…' : 'Apply'}
        </button>
        <button type="button" className="ui-btn" onClick={onBack} disabled={action.busy}>
          Back
        </button>
      </div>
    </>
  );
}

function ImagePicker({ label, images, value, onChange, hasCurrent, tall = false }) {
  if (!images.length) return null;
  const shape = tall ? 'of-pick of-pick--tall' : 'of-pick of-pick--wide';
  return (
    <div className="of-gap">
      <p className="ui-key">{label}</p>
      <div className="of-picker">
        <button type="button" className={shape} aria-pressed={value === null} onClick={() => onChange(null)}>
          {hasCurrent ? 'Keep current' : 'None'}
        </button>
        {images.map((img) => (
          <button type="button" key={img.path} className={shape} aria-pressed={value === img.path} onClick={() => onChange(img.path)} aria-label={`Use this ${label.toLowerCase()}`}>
            <img src={img.thumb} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}
