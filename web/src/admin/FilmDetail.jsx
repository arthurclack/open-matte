import { useContext, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, formatAgo, formatBytes, formatClock, formatRuntime, plural } from '../api.js';
import { Sleeve } from '../look/objects.jsx';
import { Line, TabRow } from '../look/ui.jsx';
import { pickedBy } from '../look/words.js';
import FilmInfo from './FilmInfo.jsx';
import { editedHere, fromTmdb } from './filmEdits.js';
import { IssueTicket, TicketTable } from './Tickets.jsx';
import { AdminContext, Back, ErrorNote, Fact, Mark, MediaBadge, Table, useAction, useLoad } from './ui.jsx';

const FIELDS = [
  ['title', 'Title'],
  ['originalTitle', 'Original title'],
  ['year', 'Year'],
  ['runtimeMinutes', 'Running time (minutes)'],
  ['directors', 'Directed by'],
  ['country', 'Country'],
];
const LONG_FIELDS = ['recommendation', 'synopsis', 'contentNote'];
const ALL_FIELDS = [...FIELDS.map(([k]) => k), ...LONG_FIELDS];

// The page's three parts, one at a time. The part shown is in the address's #, so a
// reload, or a link to #details, opens on it.
const TABS = [
  ['tapes', 'Tapes'],
  ['details', 'Details'],
  ['media', 'Media'],
];

export default function FilmDetail() {
  const { id } = useParams();
  const { data: film, setData, error } = useLoad(() => api.get(`/api/admin/films/${id}`), [id]);
  const tickets = useLoad(() => api.get(`/api/admin/tickets?film=${id}`), [id]);
  const { refreshFacts } = useContext(AdminContext);
  // Counted again after lending a tape, without reloading the film (and its form).
  const [viewing, setViewing] = useState(null);
  const action = useAction();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const tab = TABS.some(([k]) => `#${k}` === hash) ? hash.slice(1) : 'tapes';

  if (error) return <ErrorNote error={error} />;
  if (!film) return null;

  const broken = film.mediaStatus === 'error' || film.mediaStatus === 'missing';

  async function setPublished(published) {
    const r = await action.run(() => api.patch(`/api/admin/films/${film.id}`, { published }));
    if (r) {
      setData(r);
      tickets.reload();
      refreshFacts();
    }
  }

  async function setMemberVisible(memberVisible) {
    const r = await action.run(() => api.patch(`/api/admin/films/${film.id}`, { memberVisible }));
    if (r) setData(r);
  }

  const report = film.scanReport || { errors: [], warnings: [] };
  const choose = (k) => navigate({ hash: k === 'tapes' ? '' : `#${k}` }, { replace: true });

  return (
    <>
      <Back to="/admin">Films</Back>
      <div className="of-head">
        <div className="of-filmhead">
          <div className="of-filmhead__sleeve">
            <Sleeve film={film} seed={`thumb:${film.id}`} width={72} thumb />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1>{film.title}</h1>
            <p className="of-facts">
              {film.year ? <span>{film.year}</span> : null}
              {film.runtimeMinutes ? <span>{formatRuntime(film.runtimeMinutes)}</span> : null}
              <span>/{film.slug}</span>
            </p>
            <div className="of-marks">
              {film.published ? <Mark tone="done">On the shelf</Mark> : <Mark tone="off">Off the shelf</Mark>}
              <MediaBadge status={film.mediaStatus} />
              {film.memberVisible && <Fact>{film.published ? 'Shown to members' : 'Shown to members once on the shelf'}</Fact>}
            </div>
          </div>
        </div>
        <div className="ui-btns">
          <a className="ui-btn" href={`/${film.slug}`} target="_blank" rel="noreferrer">
            Preview the page
          </a>
          {film.published ? (
            <button type="button" className="ui-btn" onClick={() => setPublished(false)} disabled={action.busy}>
              Take off the shelf
            </button>
          ) : (
            <button
              type="button"
              className="ui-btn ui-btn--primary"
              onClick={() => setPublished(true)}
              disabled={action.busy || broken}
              title={broken ? 'Fix the media errors first' : ''}
            >
              Put on the shelf
            </button>
          )}
        </div>
      </div>
      <ErrorNote error={action.error} />

      {report.errors.length > 0 && (
        <Line kind="bad" block lead="This film can't be played until these are fixed in its folder:">
          <ul>
            {report.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Line>
      )}
      {report.warnings.length > 0 && (
        <Line kind="warn" block lead="Worth checking:">
          <ul>
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Line>
      )}

      <Tabs tab={tab} onChoose={choose} label={film.title} counts={{ tapes: tickets.data?.length }} />

      <div role="tabpanel" id={`film-${tab}`} aria-labelledby={`film-tab-${tab}`}>
        {tab === 'tapes' && (
          <>
            {!film.published && <Line kind="info">Its tapes only open the film once it's on the shelf.</Line>}
            <h2 className="of-h2">Lend a tape</h2>
            <IssueTicket
              film={film}
              onIssued={() => {
                tickets.reload();
                api.get(`/api/admin/films/${id}`).then((f) => setViewing(f.viewing), () => {});
              }}
            />
            {tickets.data && tickets.data.length > 0 && (
              <>
                <h2 className="of-h2">Tapes lent</h2>
                <TicketTable tickets={tickets.data} showFilm={false} />
              </>
            )}
            <Viewing filmId={film.id} v={viewing ?? film.viewing} />
            <h2 className="of-h2">Members</h2>
            <label className="ui-check of-w">
              <input type="checkbox" checked={film.memberVisible} onChange={(e) => setMemberVisible(e.target.checked)} disabled={action.busy} />
              <span>
                <b>Show to members</b>
                <small>
                  Signed-in members see it on their front page and can read its page. Playing it still needs a tape.
                  {!film.published && " They'll see it once it's on the shelf."}
                </small>
              </span>
            </label>
          </>
        )}
        {tab === 'details' && (
          <>
            <Details film={film} onSaved={setData} />
            <section className="of-box" aria-labelledby="film-info">
              <h2 className="of-h2" id="film-info">
                Film information
              </h2>
              <FilmInfo film={film} onChange={setData} />
            </section>
          </>
        )}
        {tab === 'media' && <Media film={film} />}
      </div>
    </>
  );
}

// The row of tabs: arrow keys move between them, as tabs do.
function Tabs({ tab, onChoose, label, counts }) {
  const refs = useRef({});
  const focusNext = useRef(false);
  useEffect(() => {
    if (focusNext.current) refs.current[tab]?.focus();
    focusNext.current = false;
  }, [tab]);
  function onKey(e) {
    const i = TABS.findIndex(([k]) => k === tab);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    focusNext.current = true;
    onChoose(TABS[(to + TABS.length) % TABS.length][0]);
  }
  return (
    <TabRow watch={tab} className="of-tabs" role="tablist" label={label}>
      {TABS.map(([k, name]) => (
        <button
          key={k}
          ref={(el) => {
            refs.current[k] = el;
          }}
          type="button"
          role="tab"
          id={`film-tab-${k}`}
          className="ui-tab"
          aria-selected={tab === k}
          aria-controls={tab === k ? `film-${k}` : undefined}
          tabIndex={tab === k ? 0 : -1}
          onClick={() => onChoose(k)}
          onKeyDown={onKey}
          aria-label={counts[k] ? `${name}, ${plural(counts[k], 'tape')}` : undefined}
        >
          {name}
          {counts[k] ? <span className="ui-tab__n">{counts[k]}</span> : null}
        </button>
      ))}
    </TabRow>
  );
}

// The film's details, its staff pick and notes: saved together.
function Details({ film, onSaved }) {
  const { site } = useContext(AdminContext);
  const [form, setForm] = useState(() => Object.fromEntries([...ALL_FIELDS, 'sortOrder'].map((k) => [k, film[k] ?? ''])));
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const id = useId();

  useEffect(() => {
    setForm(Object.fromEntries([...ALL_FIELDS, 'sortOrder'].map((k) => [k, film[k] ?? ''])));
  }, [film]);

  const dirty = ALL_FIELDS.some((k) => String(form[k] ?? '') !== String(film[k] ?? '')) || String(form.sortOrder) !== String(film.sortOrder);
  // Reset to film.json is offered only when there is an edit to undo: what TMDB filled in isn't one.
  const anyEdited = ALL_FIELDS.some((k) => editedHere(film, k));
  const badge = (k) => (fromTmdb(film, k) ? <span className="of-src">from TMDB</span> : editedHere(film, k) ? <span className="of-src">edited here</span> : null);

  async function save(e) {
    e.preventDefault();
    const body = { ...form, year: form.year === '' ? null : Number(form.year), runtimeMinutes: form.runtimeMinutes === '' ? null : Number(form.runtimeMinutes) };
    const r = await action.run(() => api.patch(`/api/admin/films/${film.id}`, body));
    if (r) {
      onSaved(r);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  async function resetMetadata() {
    if (!window.confirm('Replace your edits with the values from film.json? What TMDB filled in stays as it is.')) return;
    const r = await action.run(() => api.post(`/api/admin/films/${film.id}/reset-metadata`));
    if (r) onSaved(r);
  }

  const area = (k, label, hint, rows) => (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={`${id}-${k}`}>
        {label}
        {badge(k)}
      </label>
      <textarea id={`${id}-${k}`} className="ui-textarea" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} rows={rows} />
      {hint && <p className="ui-field__hint">{hint}</p>}
    </div>
  );

  return (
    <form className="of-box" onSubmit={save} aria-labelledby={`${id}-h`}>
      <h2 className="of-h2" id={`${id}-h`}>
        Details
      </h2>
      <ErrorNote error={action.error} />
      <div className="of-grid3">
        {FIELDS.map(([k, label]) => (
          <div className="ui-field" key={k}>
            <label className="ui-field__label" htmlFor={`${id}-${k}`}>
              {label}
              {badge(k)}
            </label>
            <input
              id={`${id}-${k}`}
              className={k === 'year' || k === 'runtimeMinutes' ? 'ui-input ui-input--num' : 'ui-input'}
              type={k === 'year' || k === 'runtimeMinutes' ? 'number' : 'text'}
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              required={k === 'title'}
            />
          </div>
        ))}
      </div>
      {area('recommendation', 'Staff pick', `Why should they watch it? Friends see it signed “${pickedBy(site)}”.`, 5)}
      {area('synopsis', 'Synopsis', null, 4)}
      {area('contentNote', 'Content note', 'Optional: warnings or age guidance.', 3)}
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-sort`}>
          Sort order
        </label>
        <input id={`${id}-sort`} className="ui-input ui-input--num" type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
      </div>
      <div className="ui-btns">
        <button className="ui-btn ui-btn--primary" disabled={!dirty || action.busy}>
          {saved ? 'Saved' : 'Save details'}
        </button>
        {anyEdited && (
          <button type="button" className="ui-btn" onClick={resetMetadata} disabled={action.busy}>
            Reset to film.json
          </button>
        )}
        <span className="of-faint of-small">Later scans won't overwrite what you change here.</span>
      </div>
    </form>
  );
}

function Media({ film }) {
  const media = film.media || {};
  return (
    <section aria-labelledby="film-media-h">
      <h2 className="of-h2" id="film-media-h">
        Media
      </h2>
      <dl className="of-kv of-w">
        <dt>Folder</dt>
        <dd className="of-mono">{film.slug}/</dd>
        <dt>Playlist</dt>
        <dd className="of-mono">{media.hls || '–'}</dd>
        <dt>Running time</dt>
        <dd className="ui-n">{media.durationSeconds ? formatClock(media.durationSeconds) : '–'}</dd>
        <dt>Size on disk</dt>
        <dd>{formatBytes(media.sizeBytes)}</dd>
        <dt>Last scanned</dt>
        <dd>{formatAgo(film.scannedAt)}</dd>
      </dl>
      {media.variants?.length > 0 && (
        <>
          <h3 className="of-h3">Renditions</h3>
          <Table
            head={
              <>
                <th>Rendition</th>
                <th className="ui-n">Resolution</th>
                <th>Codecs</th>
                <th>Range</th>
                <th className="ui-n">Peak bitrate</th>
                <th>Segments</th>
              </>
            }
          >
            {media.variants.map((v) => (
              <tr key={v.uri}>
                <td className="ui-title">{v.label}</td>
                <td className="ui-n" data-label="Resolution">
                  {v.width && v.height ? `${v.width}×${v.height}` : '–'}
                </td>
                <td className="of-mono of-small" data-label="Codecs">
                  {v.codecs.join(', ') || <Mark tone="warn">missing</Mark>}
                </td>
                <td data-label="Range">{v.videoRange}</td>
                <td className="ui-n" data-label="Peak bitrate">
                  {v.bandwidth ? `${(v.bandwidth / 1e6).toFixed(1)} Mbit/s` : '–'}
                </td>
                <td data-label="Segments">{v.fmp4 == null ? '–' : v.fmp4 ? 'fMP4' : 'MPEG-TS'}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
      <div className="of-grid2 of-gap">
        <div>
          <h3 className="of-h3">Audio</h3>
          <ul className="ui-list">
            {(media.audio || []).map((a) => (
              <li key={a.uri || a.name}>
                <span className="ui-list__row">
                  <span className="ui-list__main">
                    <b>{a.name}</b>
                    <span className="ui-list__meta">{[a.language, a.channels && `${a.channels} ch`, a.default && 'default'].filter(Boolean).join(', ')}</span>
                  </span>
                </span>
              </li>
            ))}
            {!media.audio?.length && (
              <li>
                <span className="ui-list__row of-faint">Muxed into the video renditions</span>
              </li>
            )}
          </ul>
        </div>
        <div>
          <h3 className="of-h3">Subtitles</h3>
          <ul className="ui-list">
            {(media.subtitles || []).map((s) => (
              <li key={s.file}>
                <span className="ui-list__row">
                  <span className="ui-list__main">
                    <b>{s.label}</b>
                    <span className="ui-list__meta">{s.file}</span>
                  </span>
                </span>
              </li>
            ))}
            {!media.subtitles?.length && (
              <li>
                <span className="ui-list__row of-faint">None</span>
              </li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}

// How the film's tapes have been used. The server counts it from the tapes and their
// plays, so clearing old activity never changes it.
function Viewing({ filmId, v }) {
  if (!v?.issued) return null;
  return (
    <>
      <h2 className="of-h2">How it's been lent</h2>
      <dl className="of-kv of-w">
        <dt>Lent</dt>
        <dd>
          {plural(v.issued, 'tape')}
          {v.revoked > 0 && <span className="of-faint">, {v.revoked} since taken back</span>}
        </dd>
        <dt>Opened</dt>
        <dd>{plural(v.opened, 'tape')}</dd>
        <dt>Played</dt>
        <dd>
          {plural(v.played, 'tape')}
          <span className="of-faint">
            {' '}
            · {plural(v.screenings, 'play')} started{v.voided > 0 && `, ${v.voided} given back`}
          </span>
        </dd>
        <dt>Finished</dt>
        <dd>{plural(v.finished, 'tape')}</dd>
      </dl>
      <p className="of-p of-gap-s">
        <Link to={`/admin/activity?film=${filmId}`}>This film's ledger</Link>
      </p>
    </>
  );
}
