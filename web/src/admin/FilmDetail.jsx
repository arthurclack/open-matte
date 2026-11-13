import { useContext, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, formatAgo, formatBytes, formatClock, formatRuntime, plural } from '../api.js';
import { Sleeve } from '../look/objects.jsx';
import { BusyButton, Line, TabRow } from '../look/ui.jsx';
import { pickedBy } from '../look/words.js';
import FilmInfo from './FilmInfo.jsx';
import { editedHere, fromTmdb } from './filmEdits.js';
import { TapePanel, takenBackNote } from './Loans.jsx';
import { IssueTicket, TicketTable } from './Tickets.jsx';
import { AdminContext, Back, DoneNote, ErrorNote, Fact, Mark, MediaBadge, Table, useAction, useLoad } from './ui.jsx';

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
  ['tapes', 'Tape and links'],
  ['details', 'Details'],
  ['media', 'Media'],
];

export default function FilmDetail() {
  const { id } = useParams();
  const { data: film, setData, error } = useLoad(() => api.get(`/api/admin/films/${id}`), [id]);
  const tickets = useLoad(() => api.get(`/api/admin/tickets?film=${id}`), [id]);
  const { refreshFacts } = useContext(AdminContext);
  // The tape and how it's been lent, read again after a link is sent or the tape is
  // taken back, without reloading the film (and its form).
  const [fresh, setFresh] = useState(null);
  const [notice, setNotice] = useState(null);
  const action = useAction();
  const { hash, state: navState, pathname } = useLocation();
  const navigate = useNavigate();
  const tab = TABS.some(([k]) => `#${k}` === hash) ? hash.slice(1) : 'tapes';
  // Tapes' "Take the tape back" comes here to ask (its loan id in the history's state),
  // once: the state is cleared, so Back and a reload don't ask again.
  const [askFor] = useState(() => navState?.takeBack ?? null);
  useEffect(() => {
    if (navState?.takeBack) navigate({ pathname, hash }, { replace: true, state: null });
  }, [navState, navigate, pathname, hash]);

  if (error) return <ErrorNote error={error} />;
  if (!film) return null;

  const broken = film.mediaStatus === 'error' || film.mediaStatus === 'missing';

  async function setPublished(published) {
    const r = await action.run(() => api.patch(`/api/admin/films/${film.id}`, { published }));
    if (r) {
      setData(r);
      setFresh(null);
      tickets.reload();
      refreshFacts();
    }
  }

  async function setMemberVisible(memberVisible) {
    const r = await action.run(() => api.patch(`/api/admin/films/${film.id}`, { memberVisible }));
    if (r) {
      setData(r);
      setFresh(null);
    }
  }

  const report = film.scanReport || { errors: [], warnings: [] };
  const current = fresh && fresh.id === film.id ? fresh : film;
  // In or out, beside On the shelf: off the shelf, only a tape that is out is said.
  const tapeOut = Boolean(current.tape?.loan);
  const tapeMark = (tapeOut || film.published) && <Mark tone={tapeOut ? 'info' : 'done'}>{tapeOut ? 'Tape out' : 'Tape in'}</Mark>;
  const saved = (f) => {
    setData(f);
    setFresh(null);
  };
  const reread = () =>
    api.get(`/api/admin/films/${id}`).then(
      (f) => setFresh(f),
      () => {},
    );
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
              {tapeMark}
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
            <BusyButton type="button" className="ui-btn" onClick={() => setPublished(false)} busy={action.busy}>
              Take off the shelf
            </BusyButton>
          ) : (
            <BusyButton
              type="button"
              className="ui-btn ui-btn--primary"
              onClick={() => setPublished(true)}
              busy={action.busy} disabled={broken}
              title={broken ? 'Fix the media errors first' : ''}
            >
              Put on the shelf
            </BusyButton>
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
            {/* The take-back's news: its button and question have gone, so it takes the focus. */}
            <DoneNote focus>{notice}</DoneNote>
            <TapePanel
              film={current}
              askFirst={askFor != null && askFor === current.tape?.loan?.id}
              onTaken={(r) => {
                setNotice(takenBackNote(r, film.title));
                reread();
                tickets.reload();
                // The status line's tapes out, at once.
                refreshFacts('now');
              }}
            />
            {current.tape?.loan && (
              <Line kind="info">
                Anyone else with a link sees <b>Out on loan</b> and the date it's due back, never who has it, and can't press Play.
              </Line>
            )}
            <Line kind="info">Your previews never take the tape. Signed in to the back office, Play in your browser plays without a link, so it never counts as a loan.</Line>
            <h2 className="of-h2">Send a link</h2>
            {!film.published && <Line kind="info">Links only open the film once it's on the shelf. You can send them now and they'll work then.</Line>}
            <IssueTicket
              film={current}
              links={tickets.data}
              onIssued={() => {
                tickets.reload();
                reread();
              }}
            />
            {tickets.data && tickets.data.length > 0 && (
              <>
                <h2 className="of-h2">Links sent for it</h2>
                <TicketTable tickets={tickets.data} showFilm={false} />
              </>
            )}
            <Lending filmId={film.id} l={current.lending} />
            <h2 className="of-h2">Members</h2>
            <label className="ui-check of-w">
              {/* Busy as a BusyButton is (look/busy.js): it keeps the focus while it saves,
                  and a press meanwhile changes nothing (the box is drawn as it was). */}
              <input
                type="checkbox"
                checked={film.memberVisible}
                onChange={(e) => !action.busy && setMemberVisible(e.target.checked)}
                aria-disabled={action.busy || undefined}
              />
              <span>
                <b>Show to members</b>
                <small>
                  Signed-in members see it on their front page, whether its tape is in or out (never who has it), and can read its page. Borrowing it
                  still needs a link.
                  {!film.published && " They'll see it once it's on the shelf."}
                </small>
              </span>
            </label>
          </>
        )}
        {tab === 'details' && (
          <>
            <Details film={film} onSaved={saved} />
            <section className="of-box" aria-labelledby="film-info">
              <h2 className="of-h2" id="film-info">
                Film information
              </h2>
              <FilmInfo film={film} onChange={saved} />
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
          aria-label={counts[k] ? `${name}, ${plural(counts[k], 'link')}` : undefined}
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
        <BusyButton className="ui-btn ui-btn--primary" busy={action.busy} disabled={!dirty}>
          {saved ? 'Saved' : 'Save details'}
        </BusyButton>
        {anyEdited && (
          <BusyButton type="button" className="ui-btn" onClick={resetMetadata} busy={action.busy}>
            Reset to film.json
          </BusyButton>
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

// How the film has been lent, counted by the server from its links, loans and
// responses, so clearing old activity never changes it. A link lends once, so it is
// never lent more often than links were sent.
function Lending({ filmId, l }) {
  if (!l?.sent) return null;
  return (
    <>
      <h2 className="of-h2">How it's been lent</h2>
      <dl className="of-kv of-w">
        <dt>Links sent</dt>
        <dd>
          {plural(l.sent, 'link')}
          {l.cancelled > 0 && <span className="of-faint">, {l.cancelled} since cancelled</span>}
        </dd>
        <dt>Opened</dt>
        <dd>{plural(l.opened, 'link')}</dd>
        <dt>Lent</dt>
        <dd>{plural(l.lent, 'time')}</dd>
        <dt>Finished</dt>
        <dd>{plural(l.finished, 'time')}</dd>
        {l.responses > 0 && (
          <>
            <dt>Responses</dt>
            <dd>
              <Link to="/admin/responses">{plural(l.responses, 'response')}</Link>
            </dd>
          </>
        )}
      </dl>
      <p className="of-p of-gap-s">
        <Link to={`/admin/activity?film=${filmId}`}>This film's ledger</Link>
      </p>
    </>
  );
}
