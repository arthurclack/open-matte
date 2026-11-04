import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatAgo, formatDate, formatDayTime, plural } from '../api.js';
import { CreatedLink, peopleError } from './People.jsx';
import { CopyButton, ErrorNote, Progress, TicketBadge, dateInputToMs, useAction, useLoad } from './ui.jsx';

// Who can use a ticket, in the words the admin sees everywhere.
export const ticketKind = (t) => {
  if (!t.person) return t.claimable ? 'Anyone with the link · can be kept' : 'Anyone with the link';
  return t.claimedAt ? `Only ${t.person.name} · kept from a link` : `Only ${t.person.name}, signed in`;
};

// What to send with a ticket link. A ticket for one person needs their passkey.
export const ticketMessage = (t, title) =>
  t.person ? `You should watch ${title}. Here's your ticket; you'll sign in with your passkey: ${t.link}` : `You should watch ${title}. Here's your ticket: ${t.link}`;

export function PersonDisabledBadge({ ticket }) {
  return ticket.person?.disabled ? <span className="badge bad">Person disabled</span> : null;
}

// Issuing answers with a code for these; everything else it says in words.
const ISSUE_ERRORS = {
  'person-not-found': "That person isn't here any more. Reload the page and choose again.",
  'person-disabled': "They're disabled: enable them on their page before issuing them a ticket.",
};
const issueError = (e) => (e ? ISSUE_ERRORS[e] || e : null);

export default function Tickets() {
  const [params, setParams] = useSearchParams();
  // ?person=ID shows that person's tickets and starts the form with them chosen
  // (the person page's "Issue a ticket for Sam" comes here). ?kind=anyone|person.
  const person = params.get('person') || '';
  const kind = person ? '' : params.get('kind') || '';
  const query = person ? `?person=${encodeURIComponent(person)}` : kind ? `?kind=${encodeURIComponent(kind)}` : '';
  const { data: tickets, error, reload } = useLoad(() => api.get(`/api/admin/tickets${query}`), [query]);
  const films = useLoad(() => api.get('/api/admin/films'), []);
  const people = useLoad(() => api.get('/api/admin/people'), []);
  const [filmId, setFilmId] = useState('');
  const film = films.data?.find((f) => String(f.id) === String(filmId));
  const filtered = Boolean(person || kind);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tickets</h1>
          <p className="dim" style={{ margin: 0, maxWidth: '46em' }}>
            Each ticket opens one film. A ticket for anyone with the link works for whoever has the link, so send it only to the person it's for. A
            ticket for a person only works when they're signed in with their passkey.
          </p>
        </div>
      </div>
      <ErrorNote error={error} />

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <label className="field" style={{ maxWidth: 420 }}>
          <span>Issue a ticket for</span>
          <select value={filmId} onChange={(e) => setFilmId(e.target.value)}>
            <option value="">Choose a film…</option>
            {films.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
                {f.published ? '' : ' (draft)'}
              </option>
            ))}
          </select>
        </label>
        {film && <IssueTicket key={film.id} film={film} personId={person} onIssued={reload} bare />}
      </div>

      <TicketFilter kind={kind} person={person} people={people.data} onChange={setParams} />
      {tickets && tickets.length === 0 && <p className="dim">{filtered ? 'No tickets like that yet.' : 'No tickets yet.'}</p>}
      {tickets && tickets.length > 0 && <TicketTable tickets={tickets} showFilm />}
    </>
  );
}

// All · Anyone with the link · For a person ▾
function TicketFilter({ kind, person, people, onChange }) {
  const all = !kind && !person;
  const choose = (v) => onChange(v === '' ? {} : v === 'any' ? { kind: 'person' } : { person: v });
  return (
    <div className="row" style={{ gap: '0.5rem', marginBottom: '1rem' }}>
      <button type="button" className={`btn small${all ? ' on' : ''}`} aria-pressed={all} onClick={() => onChange({})}>
        All
      </button>
      <button type="button" className={`btn small${kind === 'anyone' ? ' on' : ''}`} aria-pressed={kind === 'anyone'} onClick={() => onChange({ kind: 'anyone' })}>
        Anyone with the link
      </button>
      <select
        aria-label="For a person"
        className={`filter-select${kind === 'person' || person ? ' on' : ''}`}
        value={person || (kind === 'person' ? 'any' : '')}
        onChange={(e) => choose(e.target.value)}
      >
        <option value="">For a person…</option>
        <option value="any">For any person</option>
        {people?.map((p) => (
          <option key={p.id} value={String(p.id)}>
            For {p.name}
            {p.disabled ? ' (disabled)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

// showKind: a faint line under For saying who can use it (not needed on a person's page).
export function TicketTable({ tickets, showFilm, showKind = true }) {
  return (
    <div className="table-wrap">
      <table className="stack">
        <thead>
          <tr>
            <th>For</th>
            {showFilm && <th>Film</th>}
            <th>Status</th>
            <th>Screenings</th>
            <th>Furthest</th>
            <th>Last activity</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id}>
              <td className="card-title">
                <Link to={`/admin/tickets/${t.id}`}>{t.label || t.person?.name || <span className="dim">Unnamed ticket</span>}</Link>
                {showKind && <div className="faint" style={{ fontWeight: 400, fontSize: '0.85rem' }}>{ticketKind(t)}</div>}
              </td>
              {showFilm && <td data-label="Film">{t.film?.title}</td>}
              <td data-label="Status">
                <span className="row" style={{ gap: '0.4rem' }}>
                  <TicketBadge ticket={t} />
                  <PersonDisabledBadge ticket={t} />
                </span>
              </td>
              <td className="nowrap" data-label="Screenings">
                {t.screeningsUsed}
                {t.screeningLimit != null ? ` of ${t.screeningLimit}` : ' (no limit)'}
              </td>
              <td data-label="Furthest">
                <Progress seconds={t.furthestSeconds} duration={t.durationSeconds} />
              </td>
              <td className="faint nowrap" data-label="Last activity">{t.lastActivity ? formatAgo(t.lastActivity.at) : 'none'}</td>
              <td data-label="Link">{t.state !== 'revoked' && <CopyButton text={t.link} label="Copy link" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The form for issuing tickets to one film, and the links it produced. personId
// starts it on "Only a person", with that person chosen, if they're enabled.
export function IssueTicket({ film, personId = '', onIssued, bare = false }) {
  const people = useLoad(() => api.get('/api/admin/people'), []);
  const [form, setForm] = useState({ label: '', screeningLimit: '1', startBy: '', daysAfterFirstPlay: '', count: '1', claimable: false });
  const [who, setWho] = useState({ kind: personId ? 'person' : 'anyone', personId: personId ? String(personId) : '' });
  const [issued, setIssued] = useState(null); // { tickets, person }
  const action = useAction();
  const radio = useId();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // Disabled people can't be issued tickets, so they aren't offered.
  const enabled = people.data?.filter((p) => !p.disabled);
  const noPeople = enabled?.length === 0;
  const chosen = enabled?.find((p) => String(p.id) === who.personId) || null;
  // A preselected person who turns out to be disabled or missing (once the list
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
  if (!forPerson) buttonText = `Issue ${count > 1 ? `${count} tickets` : 'ticket'} for anyone with the link`;
  else if (chosen) buttonText = `Issue ticket for ${chosen.name} only`;
  else buttonText = "Choose who it's for";

  const body = (
    <form onSubmit={submit}>
      <ErrorNote error={issueError(action.error)} />
      <div className="field" style={{ maxWidth: 720 }}>
        <span>Who can use it?</span>
        <label className="choice">
          <input type="radio" name={radio} checked={!forPerson} onChange={() => setWho({ ...who, kind: 'anyone' })} />
          <span>
            <strong>Anyone with the link</strong>
            <small>Like a paper ticket: whoever has the link can use it, on any device, TVs included. The name is only a note for you.</small>
          </span>
        </label>
        {!forPerson && <KeepBox checked={form.claimable} onChange={(claimable) => setForm({ ...form, claimable })} />}
        <label className="choice">
          <input
            type="radio"
            name={radio}
            checked={forPerson}
            disabled={noPeople}
            onChange={() => setWho({ kind: 'person', personId: chosen ? who.personId : '' })}
          />
          <span>
            <strong>Only a person, signed in</strong>
            {!noPeople && (
              <select
                className="inline"
                aria-label="Which person"
                value={who.personId}
                onChange={(e) => setWho({ kind: 'person', personId: e.target.value })}
              >
                <option value="">Choose…</option>
                {enabled?.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <small>
              {noPeople ? (
                people.data.length ? (
                  <>
                    Everyone under <Link to="/admin/people">People</Link> is disabled.
                  </>
                ) : (
                  <>
                    Add people under <Link to="/admin/people">People</Link> first.
                  </>
                )
              ) : (
                "The link only works for that person, signed in with their passkey. Forwarding it does nothing. TV browsers usually can't sign in."
              )}
            </small>
          </span>
        </label>
      </div>
      <div className="grid-2">
        <label className="field">
          <span>{forPerson ? 'Note (optional)' : 'Who is it for?'}</span>
          <input value={form.label} onChange={set('label')} placeholder={forPerson ? '' : 'e.g. Sam'} maxLength={200} />
          <small>{forPerson ? 'Only you see this.' : "Only you see this. It's a label, not a check: whoever has the link can use the ticket."}</small>
        </label>
        <label className="field">
          <span>Screenings</span>
          <input type="number" min="1" max="1000" value={form.screeningLimit} onChange={set('screeningLimit')} placeholder="No limit" />
          <small>Each press of Play starts a screening that can be paused and resumed for a while. Leave empty for no limit.</small>
        </label>
        <label className="field">
          <span>Start watching by (optional)</span>
          <input type="date" value={form.startBy} onChange={set('startBy')} />
          <small>If the first screening hasn't started by the end of this day, the ticket expires.</small>
        </label>
        <label className="field">
          <span>Days valid after first play (optional)</span>
          <input type="number" min="1" max="3650" value={form.daysAfterFirstPlay} onChange={set('daysAfterFirstPlay')} placeholder="No limit" />
          <small>Counted from when they first press Play, not when they open the link.</small>
        </label>
        {!forPerson && (
          <label className="field">
            <span>How many tickets</span>
            <input type="number" min="1" max="50" value={form.count} onChange={set('count')} />
            <small>Each gets its own link.</small>
          </label>
        )}
      </div>
      <button className="btn primary" disabled={action.busy || (forPerson && !chosen)}>
        {buttonText}
      </button>
    </form>
  );

  return (
    <>
      {bare ? body : <div className="card">{body}</div>}
      {issued?.person && <IssuedForPerson key={issued.tickets[0].id} ticket={issued.tickets[0]} person={issued.person} film={film} onLinkCreated={people.reload} />}
      {issued && !issued.person && (
        <div className="notice good" style={{ marginTop: '1rem' }}>
          <strong>{plural(issued.tickets.length, 'ticket')} ready.</strong> Send each link to the person it's for.
          {issued.tickets.map((t) => (
            <div key={t.id} style={{ marginTop: '0.7rem' }}>
              {t.label && <div className="dim" style={{ marginBottom: '0.3rem' }}>For {t.label}</div>}
              <div className="link-box">
                <code>{t.link}</code>
                <CopyButton text={t.link} label="Copy link" />
                <CopyButton text={ticketMessage(t, film.title)} label="Copy message" />
              </div>
            </div>
          ))}
          {film && !film.published && <p style={{ margin: '0.7rem 0 0' }}>The film is still a draft: publish it before the links will open.</p>}
          {issued.tickets[0]?.startBy && <p className="dim" style={{ margin: '0.7rem 0 0' }}>Start by {formatDate(issued.tickets[0].startBy)}.</p>}
        </div>
      )}
    </>
  );
}

// "Let them keep it in their account", for a ticket for anyone with the link.
export function KeepBox({ checked, onChange, style }) {
  return (
    <label className="check top keep-box" style={style}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Let them keep it in their account
        <small>
          Someone you've added under People can keep it, so it's on every device they sign in on. Whoever keeps it first takes it from everyone else
          with the link.
        </small>
      </span>
    </label>
  );
}

// A ticket for one person. If they've never set up a passkey, the ticket link alone
// would only show them a sign-in page, so offer a setup link that opens the film.
// A setup link created here cancels any link already waiting, so the people list is
// refreshed afterwards: the next ticket issued then knows a link is out.
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
    <div className="notice good" style={{ marginTop: '1rem' }}>
      <p style={{ marginBottom: '0.6rem' }}>
        <strong>Ticket for {name} ready.</strong> It only works when {name} is signed in.
      </p>
      <div className="link-box">
        <code>{t.link}</code>
        <CopyButton text={t.link} label="Copy link" />
        <CopyButton text={ticketMessage(t, film.title)} label="Copy message" />
      </div>
      {film && !film.published && <p style={{ margin: '0.7rem 0 0' }}>The film is still a draft: publish it before the link will open.</p>}
      {t.startBy && <p className="dim" style={{ margin: '0.7rem 0 0' }}>Start by {formatDate(t.startBy)}.</p>}

      {!person.setUp && (
        <div style={{ marginTop: '1rem' }}>
          <ErrorNote error={peopleError(action.error)} />
          {created === 'done' ? (
            <p className="dim" style={{ margin: 0 }}>
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
            <>
              <p className="dim" style={{ marginBottom: '0.6rem' }}>
                {name} hasn't set up a passkey yet, so this link would only ask them to sign in. Send a setup link instead: {name} creates a passkey with
                it, then goes straight to {film.title}.
                {person.linkWaiting ? " The link that's waiting stops working." : ''}
              </p>
              <button className="btn" onClick={createSetupLink} disabled={action.busy}>
                Create a setup link that opens {film.title}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
