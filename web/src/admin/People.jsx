import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatAgo, formatDayTime } from '../api.js';
import { CopyButton, ErrorNote, useAction, useLoad } from './ui.jsx';

// The server answers these with a code; everything else it says in words.
const PEOPLE_ERRORS = {
  'name-taken': 'Someone here already has that name (capitals are ignored). Add something to tell them apart.',
  'confirm-contact': "Tick the box to confirm you're replying on a contact you already know is theirs.",
  'bad-hours': 'Choose how long the link works.',
  'bad-ticket': "That ticket can't go with the link: it has to be a ticket only for them, and not revoked.",
  'person-disabled': "Enable them first: disabled people can't be sent a link.",
  'person-not-found': 'There is nobody here with that id.',
  'passkey-not-found': 'That passkey has already been removed.',
  'passkeys-unavailable': "Passkeys aren't available on this server, so links can't be created. See Settings.",
};
export const peopleError = (e) => (e ? PEOPLE_ERRORS[e] || e : null);

export function PersonBadge({ person: p }) {
  if (p.disabled) return <span className="badge bad">Disabled</span>;
  if (!p.setUp) return p.linkWaiting ? <span className="badge warn">Setup link waiting</span> : <span className="badge">Not set up</span>;
  return (
    <>
      <span className="badge good">Active</span>
      {p.linkWaiting && <span className="badge warn">Recovery link waiting</span>}
    </>
  );
}

// Shown on People and each person's page when the server can't do passkeys at all.
export function PasskeysProblem({ settings }) {
  const problem = settings?.passkeys?.problem;
  if (!problem) return null;
  return (
    <div className="notice warn">
      <strong>Passkeys aren't available.</strong> {problem} Until it's fixed, nobody can sign in or create a passkey, and no setup links can be made.
      Tickets for anyone with the link still work.
    </div>
  );
}

// The only time a setup or recovery link is ever shown: the server keeps just its
// hash. `message` replaces the default one, e.g. for a link that opens a film.
export function CreatedLink({ created, name, cinema, message, onDone }) {
  const until = formatDayTime(created.expiresAt);
  const setup = created.purpose === 'setup';
  const text =
    message ??
    (setup
      ? `Here's your link for ${cinema}: open it on your phone or computer to create a passkey. It works once, until ${until}. ${created.link}`
      : `Here's your link to get back into ${cinema}: open it to create a new passkey. It works once, until ${until}. ${created.link}`);
  return (
    <div className="notice good">
      <p style={{ marginBottom: '0.6rem' }}>
        <strong>
          {setup ? 'Setup' : 'Recovery'} link for {name}:
        </strong>{' '}
        works once, until {until}.
      </p>
      <div className="link-box">
        <code>{created.link}</code>
        <CopyButton text={created.link} label="Copy link" />
        <CopyButton text={text} label="Copy message" />
      </div>
      <div className="row" style={{ marginTop: '0.7rem', justifyContent: 'space-between' }}>
        <span className="dim">You won't see this link again. If it goes astray, create a new one: this one then stops working.</span>
        <button className="btn small" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

export default function People() {
  const { data: people, error } = useLoad(() => api.get('/api/admin/people'), []);
  const settings = useLoad(() => api.get('/api/admin/settings'), []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p className="dim" style={{ margin: 0, maxWidth: '46em' }}>
            People who can sign in here with a passkey. Nobody can sign up on their own: you add someone, then send them a setup link. Tickets for anyone
            with the link don't need any of this.
          </p>
        </div>
      </div>
      <PasskeysProblem settings={settings.data} />
      <ErrorNote error={peopleError(error)} />

      <AddPerson />

      {people && people.length === 0 && <p className="dim">Nobody yet.</p>}
      {people && people.length > 0 && (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>Name</th>
                <th>Passkeys</th>
                <th>Tickets</th>
                <th>Last signed in</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td className="card-title">
                    <Link to={`/admin/people/${p.id}`}>{p.name}</Link>
                    {p.note && <div className="faint" style={{ fontWeight: 400, fontSize: '0.85rem' }}>{p.note}</div>}
                  </td>
                  <td data-label="Passkeys">{p.passkeys || <span className="faint">None yet</span>}</td>
                  <td data-label="Tickets">{p.tickets ? <Link to={`/admin/tickets?person=${p.id}`}>{p.tickets}</Link> : <span className="faint">None</span>}</td>
                  <td className="faint nowrap" data-label="Last signed in">{p.lastSignedInAt ? formatAgo(p.lastSignedInAt) : 'Never'}</td>
                  <td data-label="Status">
                    <span className="row" style={{ gap: '0.4rem' }}>
                      <PersonBadge person={p} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function AddPerson() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', note: '' });
  const action = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const r = await action.run(() => api.post('/api/admin/people', form));
    // Their page is where the setup link is made.
    if (r) navigate(`/admin/people/${r.id}`);
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ margin: '0 0 0.9rem', fontSize: '1.15rem' }}>Add a person</h2>
      <ErrorNote error={peopleError(action.error)} />
      <div className="grid-2">
        <label className="field">
          <span>Name</span>
          <input value={form.name} onChange={set('name')} maxLength={80} required placeholder="e.g. Sam" />
          <small>They'll see it, and their password manager stores it.</small>
        </label>
        <label className="field">
          <span>Note (optional)</span>
          <input value={form.note} onChange={set('note')} maxLength={1000} />
          <small>Only you see this.</small>
        </label>
      </div>
      <button className="btn primary" disabled={action.busy || !form.name.trim()}>
        Add person
      </button>
    </form>
  );
}
