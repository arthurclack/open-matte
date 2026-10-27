import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatAgo, formatDateTime, formatDayTime, plural } from '../api.js';
import { CreatedLink, PasskeysProblem, PersonBadge, peopleError } from './People.jsx';
import { TicketTable } from './Tickets.jsx';
import { ErrorNote, describeEvent, linkLifetime, useAction, useLoad } from './ui.jsx';

const SETUP_HOURS = [1, 24, 72, 168];
const RECOVERY_HOURS = [1, 24];

// "Sam's passkey" / "Sam's 2 passkeys".
const theirPasskeys = (name, n) => (n === 1 ? `${name}'s passkey` : `${name}'s ${n} passkeys`);

export default function PersonDetail() {
  const { id } = useParams();
  const { data: p, setData, error, reload } = useLoad(() => api.get(`/api/admin/people/${id}`), [id]);
  const events = useLoad(() => api.get(`/api/admin/activity?person=${id}&limit=300`), [id]);
  const tickets = useLoad(() => api.get(`/api/admin/tickets?person=${id}`), [id]);
  const settings = useLoad(() => api.get('/api/admin/settings'), []);
  const [panel, setPanel] = useState(null); // 'setup' | 'help'
  const [created, setCreated] = useState(null); // the link, shown this once
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState(null);
  const action = useAction();

  useEffect(() => {
    setPanel(null);
    setCreated(null);
    setNotice(null);
  }, [id]);

  // Only when the saved values change, so another action doesn't wipe an edit in progress.
  const savedName = p?.name;
  const savedNote = p?.note;
  useEffect(() => {
    if (savedName !== undefined) setForm({ name: savedName, note: savedNote || '' });
  }, [savedName, savedNote]);

  // Only take over the page when there is nothing to show: a failed reload must
  // never hide the copy-once link.
  if (error && !p) return <ErrorNote error={peopleError(error)} />;
  if (!p || !form) return null;

  const name = p.name;
  const cinema = settings.data?.cinemaName || 'the cinema';

  // Actions answer with the person as it now is, or with a count or a link (then
  // the person is fetched again). Either way there is new activity.
  async function act(fn, done) {
    setNotice(null);
    const r = await action.run(fn);
    if (r === undefined) return;
    if (r?.id) setData(r);
    else reload();
    done?.(r);
    events.reload();
    tickets.reload(); // disabling or enabling changes how their tickets show
  }

  const createLink = (body) =>
    act(
      () => api.post(`/api/admin/people/${p.id}/links`, body),
      (r) => {
        setCreated(r);
        setPanel(null);
      },
    );

  function cancelLink() {
    if (!window.confirm('Cancel the waiting link? It stops working straight away.')) return;
    act(() => api.post(`/api/admin/people/${p.id}/links/cancel`));
  }

  function signOutEverywhere() {
    if (!window.confirm(`Sign ${name} out of every browser? Playback stops on them. ${name}'s passkeys still work, so they can sign in again.`)) return;
    act(
      () => api.post(`/api/admin/people/${p.id}/sign-out`),
      (r) => setNotice(`Signed ${name} out of ${plural(r.signedOut, 'browser')}.`),
    );
  }

  function disable() {
    const text =
      `Disable ${name}? ${name} is signed out everywhere and can't sign in, and tickets only for ${name} stop working from the next request. ` +
      "Tickets for anyone with the link aren't affected. Disabling doesn't remove passkeys: for a lost or stolen device, use Reset after loss.";
    if (!window.confirm(text)) return;
    act(() => api.post(`/api/admin/people/${p.id}/disable`));
  }

  const enable = () => act(() => api.post(`/api/admin/people/${p.id}/enable`));

  function removePasskey(k) {
    const n = p.browsers.filter((b) => b.passkeyId === k.id).length;
    const after =
      n === 0 ? 'No browser is signed in with it now.' : n === 1 ? 'The browser it signed in is signed out.' : `The ${n} browsers it signed in are signed out.`;
    if (!window.confirm(`Remove this passkey? It stops working straight away. ${after}`)) return;
    act(
      () => api.post(`/api/admin/passkeys/${k.id}/remove`),
      (r) => setNotice(`Passkey removed${r.signedOut ? `, and ${plural(r.signedOut, 'browser')} signed out` : ''}.`),
    );
  }

  async function save(e) {
    e.preventDefault();
    const r = await action.run(() => api.patch(`/api/admin/people/${p.id}`, { name: form.name, note: form.note }));
    if (r) {
      setData(r);
      setNotice('Saved.');
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const passkeyFrom = (passkeyId) => p.passkeys.find((k) => k.id === passkeyId)?.addedDevice;

  return (
    <>
      <p style={{ margin: '0 0 0.6rem' }}>
        <Link to="/admin/people" className="dim">
          ← People
        </Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{name}</h1>
          <div className="row" style={{ gap: '0.5rem' }}>
            <PersonBadge person={p} />
            {p.note && <span className="dim">{p.note}</span>}
          </div>
        </div>
        <div className="row">
          {!p.disabled &&
            (p.setUp ? (
              <button className="btn primary" onClick={() => setPanel(panel === 'help' ? null : 'help')} disabled={action.busy}>
                Help {name} sign in again
              </button>
            ) : (
              <button className="btn primary" onClick={() => setPanel(panel === 'setup' ? null : 'setup')} disabled={action.busy}>
                Create a setup link
              </button>
            ))}
          {!p.disabled && (
            <Link className="btn" to={`/admin/tickets?person=${p.id}`}>
              Issue a ticket for {name}
            </Link>
          )}
          <button className="btn" onClick={signOutEverywhere} disabled={action.busy || !p.browsers.length}>
            Sign out everywhere
          </button>
          {p.disabled ? (
            <button className="btn" onClick={enable} disabled={action.busy}>
              Enable
            </button>
          ) : (
            <button className="btn danger" onClick={disable} disabled={action.busy}>
              Disable
            </button>
          )}
        </div>
      </div>

      <PasskeysProblem settings={settings.data} />
      <ErrorNote error={peopleError(action.error)} />
      {error && <ErrorNote error={peopleError(error)} />}
      {notice && <div className="notice good">{notice}</div>}
      {p.disabled && (
        <div className="notice">
          Disabled {formatDateTime(p.disabledAt)}. {name} can't sign in, and no links can be made until you enable them again.
        </div>
      )}

      {created && <CreatedLink created={created} name={name} cinema={cinema} onDone={() => setCreated(null)} />}

      {panel === 'setup' && (
        <SetupLinkPanel person={p} busy={action.busy} onCreate={(hours) => createLink({ hours })} onClose={() => setPanel(null)} />
      )}
      {panel === 'help' && (
        <HelpSignInPanel
          person={p}
          busy={action.busy}
          onCreate={(body) => createLink({ ...body, confirmedContact: true })}
          onClose={() => setPanel(null)}
        />
      )}

      {p.linkWaiting && (
        <div className="notice">
          A {p.linkWaiting.purpose} link is waiting: created {formatAgo(p.linkWaiting.createdAt)},{' '}
          {p.linkWaiting.openedAt ? (
            <>
              opened {formatAgo(p.linkWaiting.openedAt)} <span className="faint">(perhaps a link scanner)</span>
            </>
          ) : (
            'not opened yet'
          )}
          , works until {formatDayTime(p.linkWaiting.expiresAt)}.{' '}
          <button className="linklike" onClick={cancelLink} disabled={action.busy}>
            Cancel it
          </button>
        </div>
      )}

      <div className="grid-2" style={{ marginTop: '1.5rem' }}>
        <div className="card">
          <dl className="kv">
            <dt>Added</dt>
            <dd>{formatDateTime(p.createdAt)}</dd>
            <dt>Passkeys</dt>
            <dd>{p.passkeys.length || (p.setUp ? 'None' : 'None yet')}</dd>
            <dt>Signed in on</dt>
            <dd>{plural(p.browsers.length, 'browser')}</dd>
            <dt>Last signed in</dt>
            <dd>{p.lastSignedInAt ? formatDateTime(p.lastSignedInAt) : 'Never'}</dd>
          </dl>
        </div>
        <form className="card" onSubmit={save}>
          <label className="field">
            <span>Name</span>
            <input value={form.name} onChange={set('name')} maxLength={80} required />
            <small>They'll see it, and their password manager stores it. Changing it here doesn't change passkeys already saved.</small>
          </label>
          <label className="field">
            <span>Note</span>
            <input value={form.note} onChange={set('note')} maxLength={1000} />
            <small>Only you see this.</small>
          </label>
          <button className="btn primary" disabled={action.busy || !form.name.trim()}>
            Save changes
          </button>
        </form>
      </div>

      <h2>Passkeys</h2>
      {p.passkeys.length === 0 ? (
        <p className="dim">{p.setUp ? 'No passkeys at the moment.' : 'None yet. They create one with a setup link.'}</p>
      ) : (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>Added from</th>
                <th>Kind</th>
                <th>Added</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {p.passkeys.map((k) => (
                <tr key={k.id}>
                  <td className="card-title">{k.addedDevice || 'Unknown device'}</td>
                  <td data-label="Kind">{k.synced ? <span className="badge good">Synced</span> : <span className="badge">This device only</span>}</td>
                  <td data-label="Added">
                    <span>
                      {formatDateTime(k.addedAt)}
                      {k.viaLink && <span className="faint"> · {k.viaLink === 'recovery' ? 'with a recovery link' : 'with the setup link'}</span>}
                    </span>
                  </td>
                  <td className="faint nowrap" data-label="Last used">{k.lastUsedAt ? formatAgo(k.lastUsedAt) : 'Never'}</td>
                  <td>
                    <button className="btn small danger" onClick={() => removePasskey(k)} disabled={action.busy}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Signed in on</h2>
      {p.browsers.length === 0 ? (
        <p className="dim">Not signed in anywhere.</p>
      ) : (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>Device</th>
                <th>Signed in</th>
                <th>Last seen</th>
                <th>With the passkey from</th>
              </tr>
            </thead>
            <tbody>
              {p.browsers.map((b, i) => (
                <tr key={`${b.signedInAt}-${i}`}>
                  <td className="card-title">{b.device || 'Unknown device'}</td>
                  <td data-label="Signed in">{formatDateTime(b.signedInAt)}</td>
                  <td className="faint" data-label="Last seen">{formatAgo(b.lastSeenAt)}</td>
                  <td className="faint" data-label="With the passkey from">{passkeyFrom(b.passkeyId) || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Tickets</h2>
      <ErrorNote error={tickets.error} />
      {tickets.data?.length > 0 && <TicketTable tickets={tickets.data} showFilm showKind={false} />}
      {tickets.data?.length === 0 && <p className="dim">No tickets only for {name} yet. Tickets for anyone with the link aren't listed here.</p>}

      <h2>Links</h2>
      {p.links.length === 0 ? (
        <p className="dim">No setup or recovery links yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>Link</th>
                <th>Created</th>
                <th>Opened</th>
                <th>What happened</th>
              </tr>
            </thead>
            <tbody>
              {p.links.map((l) => (
                <tr key={l.id}>
                  <td className="card-title">{l.purpose === 'setup' ? 'Setup link' : l.reset ? 'Recovery link, after a loss' : 'Recovery link'}</td>
                  <td className="nowrap" data-label="Created">{formatDateTime(l.createdAt)}</td>
                  <td className="faint" data-label="Opened">{l.openedAt ? formatDateTime(l.openedAt) : 'Not opened'}</td>
                  <td data-label="What happened">
                    <LinkOutcome link={l} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Activity</h2>
      {events.data?.length ? (
        <div className="table-wrap">
          <table className="stack">
            <tbody>
              {events.data.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap faint" data-label="When">{formatDateTime(e.at)}</td>
                  <td className="card-title">{describeEvent(e)}</td>
                  <td data-label="Film">{e.filmId ? <Link to={`/admin/films/${e.filmId}`}>{e.filmTitle}</Link> : ''}</td>
                  <td className="faint" data-label="Device">{e.device}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="dim">Nothing yet. Links, sign-ins and passkeys show up here.</p>
      )}
    </>
  );
}

function LinkOutcome({ link: l }) {
  // Where a link was used matters most: it's who now has a passkey.
  if (l.usedAt) {
    return (
      <strong>
        Used {formatDayTime(l.usedAt)}
        {l.usedDevice ? ` from ${l.usedDevice}` : ''}
      </strong>
    );
  }
  if (l.cancelledAt) return <span className="faint">Cancelled {formatDateTime(l.cancelledAt)}</span>;
  if (l.expiresAt <= Date.now()) return <span className="faint">Expired {formatDateTime(l.expiresAt)}</span>;
  return <span>Waiting: works until {formatDayTime(l.expiresAt)}</span>;
}

function SetupLinkPanel({ person: p, busy, onCreate, onClose }) {
  const [hours, setHours] = useState(72);
  return (
    <div className="card" style={{ maxWidth: 720, marginBottom: '1rem' }}>
      <h2 style={{ margin: '0 0 0.6rem', fontSize: '1.15rem' }}>Create a setup link for {p.name}</h2>
      <p className="dim">
        {p.name} opens it on their phone or computer and creates a passkey. It works once. Send it on a contact you know is theirs.
      </p>
      <label className="field" style={{ maxWidth: 240 }}>
        <span>Works for</span>
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          {SETUP_HOURS.map((h) => (
            <option key={h} value={h}>
              {linkLifetime(h)}
            </option>
          ))}
        </select>
      </label>
      {p.linkWaiting && <p className="dim">The link that's waiting stops working.</p>}
      <div className="row">
        <button className="btn primary" onClick={() => onCreate(hours)} disabled={busy}>
          Create link
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// Recovery: either another passkey for a new device, or a reset after a loss,
// which cuts the old passkeys and browsers off now rather than when the link is used.
function HelpSignInPanel({ person: p, busy, onCreate, onClose }) {
  const [confirmed, setConfirmed] = useState(false);
  const [hours, setHours] = useState(1);
  const [reset, setReset] = useState(false);
  const name = p.name;
  const keys = p.passkeys.length;
  const browsers = p.browsers.length;

  const addText = keys ? `${theirPasskeys(name, keys)} ${keys === 1 ? 'keeps' : 'keep'} working: for a new device.` : `${name} has no passkeys now: this adds one.`;
  let resetText;
  if (keys && browsers) resetText = `Removes ${theirPasskeys(name, keys)} and signs ${name} out of ${plural(browsers, 'browser')} now, before the link is used.`;
  else if (keys) resetText = `Removes ${theirPasskeys(name, keys)} now, before the link is used. ${name} isn't signed in anywhere.`;
  else if (browsers) resetText = `Signs ${name} out of ${plural(browsers, 'browser')} now, before the link is used.`;
  else resetText = `${name} has no passkeys and isn't signed in anywhere, so there's nothing to remove.`;

  function create() {
    if (reset && (keys || browsers)) {
      const what = [keys && `remove ${theirPasskeys(name, keys)}`, browsers && `sign ${name} out of ${plural(browsers, 'browser')}`].filter(Boolean).join(' and ');
      if (!window.confirm(`This will ${what} straight away. Continue?`)) return;
    }
    onCreate({ hours, reset });
  }

  return (
    <div className="card" style={{ maxWidth: 720, marginBottom: '1rem' }}>
      <h2 style={{ margin: '0 0 0.9rem', fontSize: '1.15rem' }}>Help {name} sign in again</h2>
      <label className="check top">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>
          I'm replying on a contact I already know is {name}'s: not a new number or account
          <small className="faint" style={{ display: 'block', fontSize: '0.85rem' }}>
            If someone says they've lost their phone, a quick call is the surest check.
          </small>
        </span>
      </label>

      <div className="field">
        <span>Works for</span>
        <div className="row">
          {RECOVERY_HOURS.map((h) => (
            <label key={h} className="check" style={{ margin: 0 }}>
              <input type="radio" name="hours" checked={hours === h} onChange={() => setHours(h)} />
              {linkLifetime(h)}
            </label>
          ))}
        </div>
      </div>

      <label className="choice">
        <input type="radio" name="kind" checked={!reset} onChange={() => setReset(false)} />
        <span>
          <strong>Add a sign-in method</strong>
          <small>{addText}</small>
        </span>
      </label>
      <label className="choice">
        <input type="radio" name="kind" checked={reset} onChange={() => setReset(true)} />
        <span>
          <strong>Reset after loss</strong>
          <small>
            {resetText} If the device was stolen, ask {name} to remove it from their Apple ID, Google account or password manager first, or change that
            password: a passkey saved there reaches every device still signed in to it.
          </small>
        </span>
      </label>

      {p.linkWaiting && <p className="dim">The link that's waiting stops working.</p>}
      <div className="row">
        <button className={reset ? 'btn danger' : 'btn primary'} onClick={create} disabled={busy || !confirmed}>
          {reset ? 'Reset and create a recovery link' : 'Create a recovery link'}
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
