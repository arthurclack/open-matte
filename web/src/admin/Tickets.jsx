import { useContext, useId, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, formatAgo, formatDayTime, plural } from '../api.js';
import { BusyButton, Line } from '../look/ui.jsx';
import { LinkStateMark, OutNow } from './Loans.jsx';
import { loanDaysWords, pickHint, readyLines, sendWarnings } from './loanWords.js';
import { CreatedLink, peopleError } from './People.jsx';
import { AdminContext, CopyButton, ErrorNote, Head, LinkBox, Mark, Table, dateInputToMs, useAction, useLoad } from './ui.jsx';

// Who can use a link, in the words the back office uses everywhere.
export const ticketKind = (t) => {
  if (!t.person) return t.claimable ? 'Anyone with the link · can be kept' : 'Anyone with the link';
  return t.claimedAt ? `Only ${t.person.name} · kept from a link` : `Only ${t.person.name}, signed in`;
};

// What to send with a link. What a friend is sent is still "a tape" (question 11,
// answer a): this message stays as 1.1.0 had it. A link for one member needs their passkey.
export const ticketMessage = (t, title) =>
  t.person ? `You should watch ${title}. Here's your tape; you'll sign in with your passkey: ${t.link}` : `You should watch ${title}. Here's your tape: ${t.link}`;

// A link's name in a list: your label, the member's name, or none.
export const linkName = (t) => t.label || t.person?.name || 'Unnamed link';

export function PersonDisabledBadge({ ticket }) {
  return ticket.person?.disabled ? <Mark tone="bad">Card turned off</Mark> : null;
}

// Sending answers with a code for these; everything else it says in words.
const ISSUE_ERRORS = {
  'person-not-found': "That member isn't here any more. Reload the page and choose again.",
  'person-disabled': 'Their card is turned off: turn it back on, on their page, before sending them a link.',
};
const issueError = (e) => (e ? ISSUE_ERRORS[e] || e : null);

export default function Tickets() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  // ?person=ID shows that member's links and starts the form with them chosen
  // (the member's page's "Send Sam a link" comes here). ?kind=anyone|person.
  const person = params.get('person') || '';
  const kind = person ? '' : params.get('kind') || '';
  const query = person ? `?person=${encodeURIComponent(person)}` : kind ? `?kind=${encodeURIComponent(kind)}` : '';
  // Read again on every visit, not only when the page is first drawn: pressing the
  // Tapes tab while already here (from a member's "Send Sam a link", say) keeps this
  // page, and Out now, the links and the send form's warnings must be as they are now.
  const { key: visit } = useLocation();
  const { data: tickets, error, reload } = useLoad(() => api.get(`/api/admin/tickets${query}`), [query, visit]);
  const loans = useLoad(() => api.get('/api/admin/loans?live=1'), [visit]);
  const films = useLoad(() => api.get('/api/admin/films'), [visit]);
  const people = useLoad(() => api.get('/api/admin/people'), [visit]);
  const [filmId, setFilmId] = useState('');
  const film = films.data?.find((f) => String(f.id) === String(filmId));
  const filtered = Boolean(person || kind);
  const pick = useId();
  const out = loans.data?.loans;

  return (
    <>
      <Head
        title="Tapes"
        lede={
          <>
            Each film is one tape. Pressing Play on a link takes it out until it's due back. It comes back then, when they return it early, or when you
            take it back.
          </>
        }
      >
        <p className="of-lede">Friends never see who has a tape: only you do.</p>
      </Head>
      <ErrorNote error={error || loans.error} />

      <div className="of-box">
        <div className="ui-field of-w">
          <label className="ui-field__label" htmlFor={pick}>
            Send a link for
          </label>
          <select id={pick} className="ui-select" value={filmId} onChange={(e) => setFilmId(e.target.value)}>
            <option value="">Choose a film…</option>
            {films.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
                {f.published ? '' : ' (off the shelf)'}
              </option>
            ))}
          </select>
        </div>
        {film && (
          <IssueTicket
            key={film.id}
            film={film}
            personId={person}
            onIssued={() => {
              reload();
              films.reload();
            }}
            bare
          />
        )}
      </div>

      <h2 className="of-h2">
        Out now {out && <span className="of-faint ui-n of-count">{out.length}</span>}
      </h2>
      {out && <OutNow loans={out} films={films.data ?? []} onTakeBack={(l) => navigate(`/admin/films/${l.film.id}`, { state: { takeBack: l.id } })} />}

      <h2 className="of-h2">Links sent</h2>
      <TicketFilter kind={kind} person={person} people={people.data} onChange={setParams} />
      {tickets && tickets.length === 0 && <p className="of-p of-dim">{filtered ? 'No links like that yet.' : 'No links sent yet.'}</p>}
      {tickets && tickets.length > 0 && <TicketTable tickets={tickets} showFilm />}
    </>
  );
}

// All · Anyone with the link · For a member ▾
function TicketFilter({ kind, person, people, onChange }) {
  const all = !kind && !person;
  const choose = (v) => onChange(v === '' ? {} : v === 'any' ? { kind: 'person' } : { person: v });
  return (
    <div className="of-filters">
      <button type="button" className="ui-btn ui-btn--small" aria-pressed={all} onClick={() => onChange({})}>
        All
      </button>
      <button type="button" className="ui-btn ui-btn--small" aria-pressed={kind === 'anyone'} onClick={() => onChange({ kind: 'anyone' })}>
        Anyone with the link
      </button>
      <select
        aria-label="For a member"
        className={`ui-select${kind === 'person' || person ? ' is-on' : ''}`}
        value={person || (kind === 'person' ? 'any' : '')}
        onChange={(e) => choose(e.target.value)}
      >
        <option value="">For a member…</option>
        <option value="any">For any member</option>
        {people?.map((p) => (
          <option key={p.id} value={String(p.id)}>
            For {p.name}
            {p.disabled ? ' (card turned off)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

// Links in a list. showKind: a faint line under For saying who can use it (not needed
// on a member's page). showFilm: the film's column (not on a film's own page), which
// shows when each was sent instead.
export function TicketTable({ tickets, showFilm, showKind = true }) {
  const { site } = useContext(AdminContext);
  return (
    <Table
      head={
        <>
          <th>For</th>
          {showFilm && <th>Film</th>}
          <th>State</th>
          <th className="ui-n">Due back after</th>
          {showFilm ? <th>Last activity</th> : <th>Sent</th>}
          <th>Link</th>
        </>
      }
    >
      {tickets.map((t) => (
        <tr key={t.id}>
          <td className="ui-title">
            <Link to={`/admin/tickets/${t.id}`}>{linkName(t)}</Link>
            {showKind && <span className="of-kind">{ticketKind(t)}</span>}
          </td>
          {showFilm && (
            <td data-label="Film">
              <Link to={`/admin/films/${t.film?.id}`}>{t.film?.title}</Link>
            </td>
          )}
          <td data-label="State">
            <span className="of-cell">
              <LinkStateMark ticket={t} />
              <PersonDisabledBadge ticket={t} />
            </span>
          </td>
          <td className="ui-n" data-label="Due back after">
            {loanDaysWords(t.loanDays, site?.loanDays)}
          </td>
          {showFilm ? (
            <td className="ui-when" data-label="Last activity">
              {t.lastActivity ? formatAgo(t.lastActivity.at) : 'none'}
            </td>
          ) : (
            <td className="ui-when" data-label="Sent">
              {formatDayTime(t.createdAt)}
            </td>
          )}
          <td className="of-td-btn" data-label="Link">
            {t.linkState !== 'cancelled' && t.linkState !== 'done' && <CopyButton text={t.link} label="Copy link" />}
          </td>
        </tr>
      ))}
    </Table>
  );
}

// The form for sending links for one film, and the links it made. personId starts it
// on "Only one member", with that member chosen, if their card is on. `film` as the
// admin's films give it, with its tape: the form warns when the tape is out or the film
// has links waiting for it, and when the member chosen already has one (question 9).
// Sending a link never takes the tape: pressing Play does.
// `links`: the film's links, when the page has them already (a film's page), so the
// warnings follow its list; otherwise the form reads them itself.
export function IssueTicket({ film, links: given = null, personId = '', onIssued, bare = false }) {
  const { site } = useContext(AdminContext);
  const people = useLoad(() => api.get('/api/admin/people'), []);
  // The film's links, for who has one waiting.
  const links = useLoad(() => (given ? Promise.resolve(given) : api.get(`/api/admin/tickets?film=${film.id}`)), [film.id, given]);
  const [form, setForm] = useState({ label: '', startBy: '', loanDays: String(site?.loanDays ?? 3), pickNote: '', count: '1', claimable: false });
  const [who, setWho] = useState({ kind: personId ? 'person' : 'anyone', personId: personId ? String(personId) : '' });
  const [issued, setIssued] = useState(null); // { tickets, person, loanDays, startBy }
  const action = useAction();
  const id = useId();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // Members whose card is turned off can't be sent links, so they aren't offered.
  const enabled = people.data?.filter((p) => !p.disabled);
  const noPeople = enabled?.length === 0;
  const chosen = enabled?.find((p) => String(p.id) === who.personId) || null;
  // A preselected member who turns out to be turned off or missing (once the list
  // arrives) leaves the form on Anyone with the link.
  const preselectFailed = Boolean(enabled && who.personId && !chosen);
  const forPerson = who.kind === 'person' && !noPeople && !preselectFailed;
  const count = forPerson ? 1 : Number(form.count) || 1;
  // Links that haven't lent and could: waiting for the tape, or for Play.
  const waiting = (links.data ?? []).filter((t) => ['unopened', 'opened', 'waiting'].includes(t.linkState));
  const warnings = sendWarnings(film, { waiting, person: forPerson ? chosen : null });

  async function submit(e) {
    e.preventDefault();
    if (forPerson && !chosen) return;
    const loanDays = form.loanDays === '' ? null : Number(form.loanDays);
    const startBy = dateInputToMs(form.startBy);
    const r = await action.run(() =>
      api.post('/api/admin/tickets', {
        filmId: film.id,
        label: form.label,
        startBy,
        loanDays,
        pickNote: form.pickNote,
        count,
        ...(forPerson ? { personId: chosen.id } : { claimable: form.claimable }),
      }),
    );
    if (r) {
      setIssued({ tickets: r, person: forPerson ? chosen : null, loanDays: r[0]?.loanDays ?? loanDays, startBy });
      setForm({ ...form, label: '', pickNote: '' });
      onIssued?.();
      people.reload();
      links.reload();
    }
  }

  let buttonText;
  if (!forPerson) buttonText = `Send ${count > 1 ? `${count} links` : 'a link'} for anyone with the link`;
  else if (chosen) buttonText = `Send a link to ${chosen.name} only`;
  else buttonText = "Choose who it's for";

  const body = (
    <form onSubmit={submit}>
      {warnings.map((w) => (
        <Line key={w.text} kind={w.kind} lead={w.lead}>
          {w.text}
        </Line>
      ))}
      <ErrorNote error={issueError(action.error)} />
      <fieldset className="ui-fieldset of-w">
        <legend>Who can use it?</legend>
        <label className="ui-choice">
          <input type="radio" name={`${id}-who`} checked={!forPerson} onChange={() => setWho({ ...who, kind: 'anyone' })} />
          <span>
            <b>Anyone with the link</b>
            <small>Whoever has the link can use it, on any device, TVs included. If they press Play and take the tape, the borrower is that browser.</small>
          </span>
        </label>
        {!forPerson && <KeepBox checked={form.claimable} onChange={(claimable) => setForm({ ...form, claimable })} />}
        <label className="ui-choice">
          <input
            type="radio"
            name={`${id}-who`}
            checked={forPerson}
            disabled={noPeople}
            onChange={() => setWho({ kind: 'person', personId: chosen ? who.personId : '' })}
          />
          <span>
            <b>Only one member, signed in</b>
            <small>
              {noPeople ? (
                people.data.length ? (
                  <>
                    Every member's card is turned off (<Link to="/admin/people">Members</Link>).
                  </>
                ) : (
                  <>
                    Make someone a membership card under <Link to="/admin/people">Members</Link> first.
                  </>
                )
              ) : (
                'The link only works for that member, signed in with their passkey. Forwarding it does nothing. TVs usually can’t sign in.'
              )}
            </small>
          </span>
        </label>
        {forPerson && (
          <div className="ui-field of-under">
            <label className="ui-field__label" htmlFor={`${id}-person`}>
              Which member
            </label>
            <select id={`${id}-person`} className="ui-select" value={who.personId} onChange={(e) => setWho({ kind: 'person', personId: e.target.value })}>
              <option value="">Choose…</option>
              {enabled?.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>
      <div className="of-grid2 of-w">
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={`${id}-label`}>
            {forPerson ? (
              <>
                Note <small>(optional)</small>
              </>
            ) : (
              'Who is it for?'
            )}
          </label>
          <input id={`${id}-label`} className="ui-input" value={form.label} onChange={set('label')} placeholder={forPerson ? '' : 'e.g. Sam'} maxLength={200} />
          <p className="ui-field__hint">{forPerson ? 'Only you see this.' : "Only you see this. It's a label, not a check: whoever has the link can use it."}</p>
        </div>
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={`${id}-days`}>
            Due back after (days)
          </label>
          <input id={`${id}-days`} className="ui-input ui-input--num" type="number" min="1" max="30" required value={form.loanDays} onChange={set('loanDays')} aria-describedby={`${id}-days-h`} />
          <p className="ui-field__hint" id={`${id}-days-h`}>
            Counted from when they press Play and take the tape. They can pause and come back until then, on one device at a time. From 1 to 30.
          </p>
        </div>
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={`${id}-start`}>
            Start by <small>(optional)</small>
          </label>
          <input id={`${id}-start`} className="ui-input" type="date" value={form.startBy} onChange={set('startBy')} aria-describedby={`${id}-start-h`} />
          <p className="ui-field__hint" id={`${id}-start-h`}>
            If they haven't taken the tape by the end of this day, the link stops working. These days don't count down while the tape is out with someone else.
          </p>
        </div>
        {!forPerson && (
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`${id}-count`}>
              How many links
            </label>
            <input id={`${id}-count`} className="ui-input ui-input--num" type="number" min="1" max="50" value={form.count} onChange={set('count')} />
            <p className="ui-field__hint">Each gets its own link. A film is one tape: the first of them to press Play takes it.</p>
          </div>
        )}
      </div>
      <div className="ui-field of-w">
        <label className="ui-field__label" htmlFor={`${id}-pick`}>
          Picked for you <small>(optional)</small>
        </label>
        <textarea id={`${id}-pick`} className="ui-textarea" rows={3} maxLength={2000} value={form.pickNote} onChange={set('pickNote')} aria-describedby={`${id}-pick-h`} />
        <p className="ui-field__hint" id={`${id}-pick-h`}>
          {pickHint(forPerson ? chosen : null)}
        </p>
      </div>
      <div className="ui-btns">
        <BusyButton className="ui-btn ui-btn--primary" busy={action.busy} disabled={forPerson && !chosen}>
          {buttonText}
        </BusyButton>
      </div>
    </form>
  );

  const ready = issued && readyLines(film, { days: issued.loanDays, startBy: issued.startBy });
  return (
    <>
      {bare ? body : <div className="of-box">{body}</div>}
      {issued?.person && (
        <IssuedForPerson key={issued.tickets[0].id} ticket={issued.tickets[0]} person={issued.person} film={film} ready={ready} onLinkCreated={people.reload} />
      )}
      {issued && !issued.person && (
        <Line kind="done" block role="status" className="of-ready" lead={`${plural(issued.tickets.length, 'link')} ready.`}>
          Open Matte doesn't send {issued.tickets.length === 1 ? 'it' : 'them'}: copy each link into a message to the person it's for.
          {issued.tickets.map((t) => (
            <div key={t.id}>
              {t.label && <p className="of-ready__for">For {t.label}</p>}
              <LinkBox link={t.link} message={ticketMessage(t, film.title)} />
            </div>
          ))}
          {film && !film.published && <p>The film is off the shelf: put it on the shelf before the links will open.</p>}
          {ready.map((l) => (
            <p key={l} className="of-dim">
              {l}
            </p>
          ))}
        </Line>
      )}
    </>
  );
}

// "Let them keep it on their membership card", for a link anyone can use. Only before
// Play, and while the tape is in (question 2): a tape never moves with its link.
export function KeepBox({ checked, onChange, className = 'of-under' }) {
  return (
    <label className={`ui-check ${className}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Let them keep it on their membership card
        <small>
          A member can keep it, so it's on every device they sign in on, until it has taken the tape out. Whoever keeps it first takes it from everyone
          else with the link.
        </small>
      </span>
    </label>
  );
}

// A link for one member. If they've never set up a passkey, the link alone would only
// show them a sign-in page, so offer a setup link that opens the film. A setup link
// created here cancels any link already waiting, so the members list is refreshed
// afterwards: the next link sent then knows a setup link is out.
function IssuedForPerson({ ticket: t, person, film, ready, onLinkCreated }) {
  const name = person.name;
  const [created, setCreated] = useState(null); // the setup link, shown this once; 'done' once dismissed
  const action = useAction();

  async function createSetupLink() {
    const r = await action.run(() => api.post(`/api/admin/people/${person.id}/links`, { ticketId: t.id }));
    if (r) {
      setCreated(r);
      onLinkCreated?.();
    }
  }

  return (
    <div className="of-ready">
      <Line kind="done" block role="status" lead={`Link for ${name} ready.`}>
        It only works when {name} is signed in. Open Matte doesn't send it: copy it into a message to {name}.
        <LinkBox link={t.link} message={ticketMessage(t, film.title)} />
        {film && !film.published && <p>The film is off the shelf: put it on the shelf before the link will open.</p>}
        {ready.map((l) => (
          <p key={l} className="of-dim">
            {l}
          </p>
        ))}
      </Line>

      {!person.setUp && (
        <>
          <ErrorNote error={peopleError(action.error)} />
          {created === 'done' ? (
            <p className="of-p of-dim">
              Setup link created. <Link to={`/admin/people/${person.id}`}>{name}'s page</Link> shows when it's opened and used.
            </p>
          ) : created ? (
            <CreatedLink
              created={created}
              name={name}
              message={`You should watch ${film.title}. Here's your link: open it on your phone or computer to create a passkey, then the film opens. It works once, until ${formatDayTime(created.expiresAt)}. ${created.link}`}
              onDone={() => setCreated('done')}
            />
          ) : (
            <Line kind="info">
              <p>
                {name} hasn't set up a passkey yet, so this link would only ask them to sign in. Send a setup link instead: {name} creates a passkey with it,
                then goes straight to {film.title}.{person.linkWaiting ? " The setup link that's waiting stops working." : ''}
              </p>
              <div className="ui-btns">
                <BusyButton type="button" className="ui-btn" onClick={createSetupLink} busy={action.busy}>
                  Create a setup link that opens {film.title}
                </BusyButton>
              </div>
            </Line>
          )}
        </>
      )}
    </div>
  );
}
