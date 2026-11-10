import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatAgo, formatDayTime, formatMonthYear } from '../api.js';
import { Line } from '../look/ui.jsx';
import { ErrorNote, Head, LinkBox, Mark, Table, useAction, useLoad } from './ui.jsx';

// The server answers these with a code; everything else it says in words.
const PEOPLE_ERRORS = {
  'name-taken': 'A member here already has that name (capitals are ignored). Add something to tell them apart.',
  'confirm-contact': "Tick the box to confirm you're replying on a contact you already know is theirs.",
  'bad-hours': 'Choose how long the link works.',
  'bad-ticket': "That tape can't go with the link: it has to be a tape only for them, and not taken back.",
  'person-disabled': "Turn their card back on first: a member whose card is off can't be sent a link.",
  'person-not-found': "That member isn't here any more. Reload the page.",
  'passkey-not-found': 'That passkey has already been removed.',
  'passkeys-unavailable': "Passkeys aren't available on this server, so links can't be created. See Settings.",
};
export const peopleError = (e) => (e ? PEOPLE_ERRORS[e] || e : null);

export function PersonBadge({ person: p }) {
  if (p.disabled) return <Mark tone="bad">Card turned off</Mark>;
  if (!p.setUp) return p.linkWaiting ? <Mark tone="warn">Setup link waiting</Mark> : <Mark tone="off">Not set up</Mark>;
  return (
    <>
      <Mark tone="done">Active</Mark>
      {p.linkWaiting && <Mark tone="warn">Recovery link waiting</Mark>}
    </>
  );
}

// Shown on Members and each member's page when the server can't do passkeys at all.
export function PasskeysProblem({ settings }) {
  const problem = settings?.passkeys?.problem;
  if (!problem) return null;
  return (
    <Line kind="warn" lead="Passkeys aren't available.">
      {problem} Until it's fixed, nobody can sign in or create a passkey, and no setup links can be made. Tapes for anyone with the link still work.
    </Line>
  );
}

// The only time a setup or recovery link is ever shown: the server keeps just its
// hash. `message` replaces the default one, e.g. for a link that opens a film.
export function CreatedLink({ created, name, cinema, message, onDone }) {
  const until = formatDayTime(created.expiresAt);
  const setup = created.purpose === 'setup';
  const shop = cinema || 'the shop';
  const text =
    message ??
    (setup
      ? `Here's your link for ${shop}: open it on your phone or computer to create a passkey. It works once, until ${until}. ${created.link}`
      : `Here's your link to get back into ${shop}: open it to create a new passkey. It works once, until ${until}. ${created.link}`);
  return (
    <Line kind="done" block role="status" className="of-ready" lead={`${setup ? 'Setup' : 'Recovery'} link for ${name}:`}>
      works once, until {until}.
      <LinkBox link={created.link} message={text} />
      <p className="of-dim">You won't see this link again. If it goes astray, create a new one: this one then stops working.</p>
      <div className="ui-btns">
        <button type="button" className="ui-btn ui-btn--small" onClick={onDone}>
          Done
        </button>
      </div>
    </Line>
  );
}

export default function People() {
  const { data: people, error } = useLoad(() => api.get('/api/admin/people'), []);
  const settings = useLoad(() => api.get('/api/admin/settings'), []);

  return (
    <>
      <Head
        title="Members"
        lede="Members sign in here with a passkey. Nobody can sign up on their own: you make someone a membership card, then send them a setup link. Tapes for anyone with the link don't need any of this."
      />
      <PasskeysProblem settings={settings.data} />
      <ErrorNote error={peopleError(error)} />

      <AddPerson />

      {people && people.length === 0 && <p className="of-p of-dim">No members yet.</p>}
      {people && people.length > 0 && (
        <Table
          head={
            <>
              <th>Name</th>
              <th>Member since</th>
              <th className="ui-n">Passkeys</th>
              <th className="ui-n">Tapes</th>
              <th>Last signed in</th>
              <th>Status</th>
            </>
          }
        >
          {people.map((p) => (
            <tr key={p.id}>
              <td className="ui-title">
                <Link to={`/admin/people/${p.id}`}>{p.name}</Link>
                {p.note && <span className="of-kind">{p.note}</span>}
              </td>
              <td className="ui-when" data-label="Member since">
                {formatMonthYear(p.createdAt)}
              </td>
              <td className="ui-n" data-label="Passkeys">
                {p.passkeys || <span className="of-faint">None yet</span>}
              </td>
              <td className="ui-n" data-label="Tapes">
                {p.tickets ? <Link to={`/admin/tickets?person=${p.id}`}>{p.tickets}</Link> : <span className="of-faint">None</span>}
              </td>
              <td className="ui-when" data-label="Last signed in">
                {p.lastSignedInAt ? formatAgo(p.lastSignedInAt) : 'Never'}
              </td>
              <td data-label="Status">
                <span className="of-cell">
                  <PersonBadge person={p} />
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

function AddPerson() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', note: '' });
  const action = useAction();
  const id = useId();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const r = await action.run(() => api.post('/api/admin/people', form));
    // Their page is where the setup link is made.
    if (r) navigate(`/admin/people/${r.id}`);
  }

  return (
    <form className="of-box" onSubmit={submit}>
      <h2 className="of-h2">Make a membership card</h2>
      <ErrorNote error={peopleError(action.error)} />
      <div className="of-grid2 of-w">
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={`${id}-name`}>
            Name
          </label>
          <input id={`${id}-name`} className="ui-input" value={form.name} onChange={set('name')} maxLength={80} required placeholder="e.g. Sam" />
          <p className="ui-field__hint">They'll see it, and their password manager stores it.</p>
        </div>
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={`${id}-note`}>
            Note <small>(optional)</small>
          </label>
          <input id={`${id}-note`} className="ui-input" value={form.note} onChange={set('note')} maxLength={1000} />
          <p className="ui-field__hint">Only you see this.</p>
        </div>
      </div>
      <div className="ui-btns">
        <button className="ui-btn ui-btn--primary" disabled={action.busy || !form.name.trim()}>
          Make the card
        </button>
      </div>
    </form>
  );
}
