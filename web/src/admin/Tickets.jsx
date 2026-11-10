import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatAgo, formatDate, formatDayTime, plural } from '../api.js';
import { Line } from '../look/ui.jsx';
import { CreatedLink, peopleError } from './People.jsx';
import { CopyButton, ErrorNote, Head, LinkBox, Mark, Progress, Table, TicketBadge, dateInputToMs, useAction, useLoad } from './ui.jsx';

// Who can use a tape, in the words the back office uses everywhere.
export const ticketKind = (t) => {
  if (!t.person) return t.claimable ? 'Anyone with the link · can be kept' : 'Anyone with the link';
  return t.claimedAt ? `Only ${t.person.name} · kept from a link` : `Only ${t.person.name}, signed in`;
};

// What to send with a tape's link. A tape for one member needs their passkey.
export const ticketMessage = (t, title) =>
  t.person ? `You should watch ${title}. Here's your tape; you'll sign in with your passkey: ${t.link}` : `You should watch ${title}. Here's your tape: ${t.link}`;

export function PersonDisabledBadge({ ticket }) {
  return ticket.person?.disabled ? <Mark tone="bad">Card turned off</Mark> : null;
}

// Lending answers with a code for these; everything else it says in words.
const ISSUE_ERRORS = {
  'person-not-found': "That member isn't here any more. Reload the page and choose again.",
  'person-disabled': 'Their card is turned off: turn it back on, on their page, before lending them a tape.',
};
const issueError = (e) => (e ? ISSUE_ERRORS[e] || e : null);

export default function Tickets() {
  const [params, setParams] = useSearchParams();
  // ?person=ID shows that member's tapes and starts the form with them chosen
  // (the member's page's "Lend Sam a tape" comes here). ?kind=anyone|person.
  const person = params.get('person') || '';
  const kind = person ? '' : params.get('kind') || '';
  const query = person ? `?person=${encodeURIComponent(person)}` : kind ? `?kind=${encodeURIComponent(kind)}` : '';
  const { data: tickets, error, reload } = useLoad(() => api.get(`/api/admin/tickets${query}`), [query]);
  const films = useLoad(() => api.get('/api/admin/films'), []);
  const people = useLoad(() => api.get('/api/admin/people'), []);
  const [filmId, setFilmId] = useState('');
  const film = films.data?.find((f) => String(f.id) === String(filmId));
  const filtered = Boolean(person || kind);
  const pick = useId();

  return (
    <>
      <Head title="Tapes" />
      <ErrorNote error={error} />

      <div className="of-box">
        <div className="ui-field of-w">
          <label className="ui-field__label" htmlFor={pick}>
            Lend a tape of
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
        {film && <IssueTicket key={film.id} film={film} personId={person} onIssued={reload} bare />}
      </div>

      <TicketFilter kind={kind} person={person} people={people.data} onChange={setParams} />
      {tickets && tickets.length === 0 && <p className="of-p of-dim">{filtered ? 'No tapes like that yet.' : 'No tapes yet.'}</p>}
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

// showKind: a faint line under For saying who can use it (not needed on a member's page).
export function TicketTable({ tickets, showFilm, showKind = true }) {
  return (
    <Table
      head={
        <>
          <th>For</th>
          {showFilm && <th>Film</th>}
          <th>State</th>
          <th className="ui-n">Plays</th>
          <th>Furthest</th>
          <th>Last activity</th>
          <th>Link</th>
        </>
      }
    >
      {tickets.map((t) => (
        <tr key={t.id}>
          <td className="ui-title">
            <Link to={`/admin/tickets/${t.id}`}>{t.label || t.person?.name || 'Unnamed tape'}</Link>
            {showKind && <span className="of-kind">{ticketKind(t)}</span>}
          </td>
          {showFilm && <td data-label="Film">{t.film?.title}</td>}
          <td data-label="State">
            <span className="of-cell">
              <TicketBadge ticket={t} />
              <PersonDisabledBadge ticket={t} />
            </span>
          </td>
          <td className="ui-n" data-label="Plays">
            {t.screeningsUsed}
            {t.screeningLimit != null ? ` of ${t.screeningLimit}` : ' (no limit)'}
          </td>
          <td data-label="Furthest">
            <Progress seconds={t.furthestSeconds} duration={t.durationSeconds} />
          </td>
          <td className="ui-when" data-label="Last activity">
            {t.lastActivity ? formatAgo(t.lastActivity.at) : 'none'}
          </td>
          <td className="of-td-btn" data-label="Link">
            {t.state !== 'revoked' && <CopyButton text={t.link} label="Copy link" />}
          </td>
        </tr>
      ))}
    </Table>
  );
}

// The form for lending tapes of one film, and the links it made. personId starts it
// on "Only one member", with that member chosen, if their card is on.
export function IssueTicket({ film, personId = '', onIssued, bare = false }) {
  const people = useLoad(() => api.get('/api/admin/people'), []);
  const [form, setForm] = useState({ label: '', screeningLimit: '1', startBy: '', daysAfterFirstPlay: '', count: '1', claimable: false });
  const [who, setWho] = useState({ kind: personId ? 'person' : 'anyone', personId: personId ? String(personId) : '' });
  const [issued, setIssued] = useState(null); // { tickets, person }
  const action = useAction();
  const id = useId();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // Members whose card is turned off can't be lent tapes, so they aren't offered.
  const enabled = people.data?.filter((p) => !p.disabled);
  const noPeople = enabled?.length === 0;
  const chosen = enabled?.find((p) => String(p.id) === who.personId) || null;
  // A preselected member who turns out to be turned off or missing (once the list
  // arrives) leaves the form on Anyone with the link.
  const preselectFailed = Boolean(enabled && who.personId && !chosen);
  const forPerson = who.kind === 'person' && !noPeople && !preselectFailed;
  const count = forPerson ? 1 : Number(form.count) || 1;

  async function submit(e) {
    e.preventDefault();
    if (forPerson && !chosen) return;
    const r = await action.run(() =>
      api.post('/api/admin/tickets', {
        filmId: film.id,
        label: form.label,
        screeningLimit: form.screeningLimit === '' ? null : Number(form.screeningLimit),
        startBy: dateInputToMs(form.startBy),
        daysAfterFirstPlay: form.daysAfterFirstPlay === '' ? null : Number(form.daysAfterFirstPlay),
        count,
        ...(forPerson ? { personId: chosen.id } : { claimable: form.claimable }),
      }),
    );
    if (r) {
      setIssued({ tickets: r, person: forPerson ? chosen : null });
      setForm({ ...form, label: '' });
      onIssued?.();
      people.reload();
    }
  }

  let buttonText;
  if (!forPerson) buttonText = `Lend ${count > 1 ? `${count} tapes` : 'a tape'} for anyone with the link`;
  else if (chosen) buttonText = `Lend a tape to ${chosen.name} only`;
  else buttonText = "Choose who it's for";

  const body = (
    <form onSubmit={submit}>
      <ErrorNote error={issueError(action.error)} />
      <fieldset className="ui-fieldset of-w">
        <legend>Who can use it?</legend>
        <label className="ui-choice">
          <input type="radio" name={`${id}-who`} checked={!forPerson} onChange={() => setWho({ ...who, kind: 'anyone' })} />
          <span>
            <b>Anyone with the link</b>
            <small>Like a real tape: whoever has the link can use it, on any device, TVs included.</small>
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
          <p className="ui-field__hint">{forPerson ? 'Only you see this.' : "Only you see this. It's a label, not a check: whoever has the link can use the tape."}</p>
        </div>
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={`${id}-plays`}>
            Plays
          </label>
          <input id={`${id}-plays`} className="ui-input ui-input--num" type="number" min="1" max="1000" value={form.screeningLimit} onChange={set('screeningLimit')} placeholder="No limit" />
          <p className="ui-field__hint">Each press of Play uses one; pausing and coming back doesn't. Leave empty for no limit.</p>
        </div>
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={`${id}-start`}>
            Start by <small>(optional)</small>
          </label>
          <input id={`${id}-start`} className="ui-input" type="date" value={form.startBy} onChange={set('startBy')} />
          <p className="ui-field__hint">If they haven't pressed Play by the end of this day, the tape expires.</p>
        </div>
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={`${id}-days`}>
            Days after the first play <small>(optional)</small>
          </label>
          <input id={`${id}-days`} className="ui-input ui-input--num" type="number" min="1" max="3650" value={form.daysAfterFirstPlay} onChange={set('daysAfterFirstPlay')} placeholder="No limit" />
          <p className="ui-field__hint">Counted from when they first press Play, not when they open the link.</p>
        </div>
        {!forPerson && (
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`${id}-count`}>
              How many tapes
            </label>
            <input id={`${id}-count`} className="ui-input ui-input--num" type="number" min="1" max="50" value={form.count} onChange={set('count')} />
            <p className="ui-field__hint">Each gets its own link.</p>
          </div>
        )}
      </div>
      <div className="ui-btns">
        <button className="ui-btn ui-btn--primary" disabled={action.busy || (forPerson && !chosen)}>
          {buttonText}
        </button>
      </div>
    </form>
  );

  return (
    <>
      {bare ? body : <div className="of-box">{body}</div>}
      {issued?.person && <IssuedForPerson key={issued.tickets[0].id} ticket={issued.tickets[0]} person={issued.person} film={film} onLinkCreated={people.reload} />}
      {issued && !issued.person && (
        <Line kind="done" block role="status" className="of-ready" lead={`${plural(issued.tickets.length, 'tape')} ready.`}>
          Send each link to the person it's for.
          {issued.tickets.map((t) => (
            <div key={t.id}>
              {t.label && <p className="of-ready__for">For {t.label}</p>}
              <LinkBox link={t.link} message={ticketMessage(t, film.title)} />
            </div>
          ))}
          {film && !film.published && <p>The film is off the shelf: put it on the shelf before the links will open.</p>}
          {issued.tickets[0]?.startBy && <p className="of-dim">Start by {formatDate(issued.tickets[0].startBy)}.</p>}
        </Line>
      )}
    </>
  );
}

// "Let them keep it on their membership card", for a tape for anyone with the link.
export function KeepBox({ checked, onChange, className = 'of-under' }) {
  return (
    <label className={`ui-check ${className}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Let them keep it on their membership card
        <small>A member can keep it, so it's on every device they sign in on. Whoever keeps it first takes it from everyone else with the link.</small>
      </span>
    </label>
  );
}

// A tape for one member. If they've never set up a passkey, the tape's link alone
// would only show them a sign-in page, so offer a setup link that opens the film.
// A setup link created here cancels any link already waiting, so the members list is
// refreshed afterwards: the next tape lent then knows a link is out.
function IssuedForPerson({ ticket: t, person, film, onLinkCreated }) {
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
      <Line kind="done" block role="status" lead={`Tape for ${name} ready.`}>
        It only works when {name} is signed in.
        <LinkBox link={t.link} message={ticketMessage(t, film.title)} />
        {film && !film.published && <p>The film is off the shelf: put it on the shelf before the link will open.</p>}
        {t.startBy && <p className="of-dim">Start by {formatDate(t.startBy)}.</p>}
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
                then goes straight to {film.title}.{person.linkWaiting ? " The link that's waiting stops working." : ''}
              </p>
              <div className="ui-btns">
                <button type="button" className="ui-btn" onClick={createSetupLink} disabled={action.busy}>
                  Create a setup link that opens {film.title}
                </button>
              </div>
            </Line>
          )}
        </>
      )}
    </div>
  );
}
