import { useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatAgo, formatDateTime, formatDayTime, formatMonthYear, plural } from '../api.js';
import { Line } from '../look/ui.jsx';
import { groupNumber } from '../membershipCard.js';
import { CreatedLink, PasskeysProblem, PersonBadge, peopleError } from './People.jsx';
import { RESPONSE_WORDS, browsersTapesWords, cardOffWords, endedWords } from './loanWords.js';
import { TicketTable } from './Tickets.jsx';
import { Back, DoneNote, ErrorNote, Head, Mark, Table, describeEvent, linkLifetime, useAction, useLoad } from './ui.jsx';

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
  const fid = useId();

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
  const shop = settings.data?.cinemaName || 'the shop';

  // Actions answer with the member as they now are, or with a count or a link (then
  // the member is fetched again). Either way there is new activity.
  async function act(fn, done) {
    setNotice(null);
    const r = await action.run(fn);
    if (r === undefined) return;
    if (r?.id) setData(r);
    else reload();
    done?.(r);
    events.reload();
    tickets.reload(); // turning a card off or on changes how their links show
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
    if (
      !window.confirm(
        `Sign ${name} out of every browser? Playback stops on them. ${name}'s passkeys still work, so they can sign in again. ${browsersTapesWords(name)}`,
      )
    )
      return;
    act(
      () => api.post(`/api/admin/people/${p.id}/sign-out`),
      (r) => setNotice(`Signed ${name} out of ${plural(r.signedOut, 'browser')}.`),
    );
  }

  function disable() {
    if (!window.confirm(cardOffWords(name))) return;
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
      <Back to="/admin/people">Members</Back>
      <Head
        title={name}
        actions={
          <>
            {!p.disabled &&
              (p.setUp ? (
                <button type="button" className="ui-btn ui-btn--primary" onClick={() => setPanel(panel === 'help' ? null : 'help')} disabled={action.busy}>
                  Help {name} sign in again
                </button>
              ) : (
                <button type="button" className="ui-btn ui-btn--primary" onClick={() => setPanel(panel === 'setup' ? null : 'setup')} disabled={action.busy}>
                  Create a setup link
                </button>
              ))}
            {!p.disabled && (
              <Link className="ui-btn" to={`/admin/tickets?person=${p.id}`}>
                Send {name} a link
              </Link>
            )}
            <button type="button" className="ui-btn" onClick={signOutEverywhere} disabled={action.busy || !p.browsers.length}>
              Sign out everywhere
            </button>
            {p.disabled ? (
              <button type="button" className="ui-btn" onClick={enable} disabled={action.busy}>
                Turn the card back on
              </button>
            ) : (
              <button type="button" className="ui-btn ui-btn--danger" onClick={disable} disabled={action.busy}>
                Turn the card off
              </button>
            )}
          </>
        }
      >
        <div className="of-marks">
          <PersonBadge person={p} />
          {p.note && <span className="of-fact">{p.note}</span>}
        </div>
      </Head>

      <PasskeysProblem settings={settings.data} />
      <ErrorNote error={peopleError(action.error)} />
      {error && <ErrorNote error={peopleError(error)} />}
      <DoneNote>{notice}</DoneNote>
      {p.disabled && (
        <Line kind="info">
          Card turned off {formatDateTime(p.disabledAt)}. {name} can't sign in, and no links can be made until you turn it back on.
        </Line>
      )}

      {created && <CreatedLink created={created} name={name} cinema={shop} onDone={() => setCreated(null)} />}

      {panel === 'setup' && <SetupLinkPanel person={p} busy={action.busy} onCreate={(hours) => createLink({ hours })} onClose={() => setPanel(null)} />}
      {panel === 'help' && (
        <HelpSignInPanel person={p} busy={action.busy} onCreate={(body) => createLink({ ...body, confirmedContact: true })} onClose={() => setPanel(null)} />
      )}

      {p.linkWaiting && (
        <Line kind="warn">
          A {p.linkWaiting.purpose} link is waiting: created {formatAgo(p.linkWaiting.createdAt)},{' '}
          {p.linkWaiting.openedAt ? (
            <>
              opened {formatAgo(p.linkWaiting.openedAt)} <span className="of-faint">(perhaps a link scanner)</span>
            </>
          ) : (
            'not opened yet'
          )}
          , works until {formatDayTime(p.linkWaiting.expiresAt)}.
          <div className="ui-btns">
            <button type="button" className="ui-btn ui-btn--small" onClick={cancelLink} disabled={action.busy}>
              Cancel it
            </button>
          </div>
        </Line>
      )}

      <div className="of-split">
        <dl className="of-kv">
          <dt>Added</dt>
          <dd>{formatDateTime(p.createdAt)}</dd>
          {/* What their membership card says. Printed on a card, not a key: nothing accepts it. */}
          {p.membership && (
            <>
              <dt>Membership number</dt>
              <dd className="ui-n of-nowrap">{groupNumber(p.membership.number)}</dd>
              <dt>Member since</dt>
              <dd>{formatMonthYear(p.membership.since)}</dd>
            </>
          )}
          <dt>Passkeys</dt>
          <dd>{p.passkeys.length || (p.setUp ? 'None' : 'None yet')}</dd>
          <dt>Signed in on</dt>
          <dd>{plural(p.browsers.length, 'browser')}</dd>
          <dt>Last signed in</dt>
          <dd>{p.lastSignedInAt ? formatDateTime(p.lastSignedInAt) : 'Never'}</dd>
        </dl>
        <form className="of-box" onSubmit={save}>
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`${fid}-name`}>
              Name
            </label>
            <input id={`${fid}-name`} className="ui-input" value={form.name} onChange={set('name')} maxLength={80} required />
            <p className="ui-field__hint">They'll see it, and their password manager stores it. Changing it here doesn't change passkeys already saved.</p>
          </div>
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`${fid}-note`}>
              Note
            </label>
            <input id={`${fid}-note`} className="ui-input" value={form.note} onChange={set('note')} maxLength={1000} />
            <p className="ui-field__hint">Only you see this.</p>
          </div>
          <div className="ui-btns">
            <button className="ui-btn ui-btn--primary" disabled={action.busy || !form.name.trim()}>
              Save changes
            </button>
          </div>
        </form>
      </div>

      <h2 className="of-h2">Passkeys</h2>
      {p.passkeys.length === 0 ? (
        <p className="of-p of-dim">{p.setUp ? 'No passkeys at the moment.' : 'None yet. They create one with a setup link.'}</p>
      ) : (
        <Table
          head={
            <>
              <th>Added from</th>
              <th>Kind</th>
              <th>Added</th>
              <th>Last used</th>
              <th>
                <span className="visually-hidden">Remove</span>
              </th>
            </>
          }
        >
          {p.passkeys.map((k) => (
            <tr key={k.id}>
              <td className="ui-title">{k.addedDevice || 'Unknown device'}</td>
              <td data-label="Kind">{k.synced ? <Mark tone="done">Synced</Mark> : <Mark tone="off">This device only</Mark>}</td>
              <td data-label="Added">
                <span className="of-cell">
                  <time>{formatDateTime(k.addedAt)}</time>
                  {k.viaLink && <small>{k.viaLink === 'recovery' ? 'with a recovery link' : 'with the setup link'}</small>}
                </span>
              </td>
              <td className="ui-when" data-label="Last used">
                {k.lastUsedAt ? formatAgo(k.lastUsedAt) : 'Never'}
              </td>
              <td className="of-td-btn">
                <button type="button" className="ui-btn ui-btn--small ui-btn--danger" onClick={() => removePasskey(k)} disabled={action.busy}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="of-h2">Signed in on</h2>
      {p.browsers.length === 0 ? (
        <p className="of-p of-dim">Not signed in anywhere.</p>
      ) : (
        <Table
          head={
            <>
              <th>Device</th>
              <th>Signed in</th>
              <th>Last seen</th>
              <th>With the passkey from</th>
            </>
          }
        >
          {p.browsers.map((b, i) => (
            <tr key={`${b.signedInAt}-${i}`}>
              <td className="ui-title">{b.device || 'Unknown device'}</td>
              <td className="ui-when" data-label="Signed in">
                {formatDateTime(b.signedInAt)}
              </td>
              <td className="ui-when" data-label="Last seen">
                {formatAgo(b.lastSeenAt)}
              </td>
              <td className="of-faint" data-label="With the passkey from">
                {passkeyFrom(b.passkeyId) || '–'}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {p.viewing?.length > 0 && (
        <>
          <h2 className="of-h2">Films</h2>
          <FilmsWatched person={p} />
        </>
      )}

      <h2 className="of-h2">Tapes</h2>
      <PersonLoans person={p} />

      <h2 className="of-h2">Links sent to {name}</h2>
      <ErrorNote error={tickets.error} />
      {tickets.data?.length > 0 && <TicketTable tickets={tickets.data} showFilm showKind={false} />}
      {tickets.data?.length === 0 && <p className="of-p of-dim">No links only for {name} yet. Links anyone can use aren't listed here.</p>}

      <h2 className="of-h2">Setup and recovery links</h2>
      {p.links.length === 0 ? (
        <p className="of-p of-dim">No setup or recovery links yet.</p>
      ) : (
        <Table
          head={
            <>
              <th>Link</th>
              <th>Created</th>
              <th>Opened</th>
              <th>What happened</th>
            </>
          }
        >
          {p.links.map((l) => (
            <tr key={l.id}>
              <td className="ui-title">{l.purpose === 'setup' ? 'Setup link' : l.reset ? 'Recovery link, keys taken back' : 'Recovery link'}</td>
              <td className="ui-when" data-label="Created">
                {formatDateTime(l.createdAt)}
              </td>
              <td className="ui-when" data-label="Opened">
                {l.openedAt ? formatDateTime(l.openedAt) : 'Not opened'}
              </td>
              <td data-label="What happened">
                <LinkOutcome link={l} />
              </td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="of-h2">Activity</h2>
      {events.data?.events.length ? (
        <Table>
          {events.data.events.map((e) => (
            <tr key={e.id}>
              <td className="ui-when" data-label="When">
                {formatDateTime(e.at)}
              </td>
              <td className="ui-title">{describeEvent(e)}</td>
              <td data-label="Film">{e.filmId ? <Link to={`/admin/films/${e.filmId}`}>{e.filmTitle}</Link> : ''}</td>
              <td className="of-faint" data-label="Device">
                {e.device}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="of-p of-dim">
          {p.lastSignedInAt || p.viewing?.length
            ? 'None kept: older events are cleared after a while (Settings, Keeping records).'
            : 'Nothing yet. Links, sign-ins and passkeys show up here.'}
        </p>
      )}
      {events.data?.next && (
        <p className="of-p of-gap">
          <Link to={`/admin/activity?person=${p.id}`}>All of {name}'s activity</Link>
        </p>
      )}
    </>
  );
}

// Each film they have a link of their own for, newest first. The server works it out
// from those links and their plays, so clearing old activity never changes it.
function FilmsWatched({ person: p }) {
  const when = (ms) => (ms ? formatDateTime(ms) : <span className="of-faint">Not yet</span>);
  return (
    <Table
      head={
        <>
          <th>Film</th>
          <th>Opened</th>
          <th>First played</th>
          <th>Finished</th>
        </>
      }
    >
      {p.viewing.map((v) => (
        <tr key={v.film.id}>
          <td className="ui-title">
            <Link to={`/admin/films/${v.film.id}`}>{v.film.title}</Link>
            {v.tickets > 1 && <span className="of-kind">{plural(v.tickets, 'link')}</span>}
          </td>
          <td className="ui-when" data-label="Opened">
            {when(v.openedAt)}
          </td>
          <td data-label="First played">
            {v.playedAt ? (
              <span className="of-cell">
                <time>{formatDateTime(v.playedAt)}</time>
                <Link to={`/admin/activity?person=${p.id}&film=${v.film.id}&kind=viewing`}>{plural(v.screenings, 'play')}</Link>
              </span>
            ) : (
              when(null)
            )}
          </td>
          <td className="ui-when" data-label="Finished">
            {when(v.finishedAt)}
          </td>
        </tr>
      ))}
    </Table>
  );
}

// The tapes they have borrowed on their own links, newest first: out now with its
// due-back date, or back in and how. A tape taken on a link anyone can use while
// signed in is a browser's, and is under Tapes, not here.
function PersonLoans({ person: p }) {
  if (!p.loans?.length) return <p className="of-p of-dim">No tapes borrowed on links for {p.name} yet.</p>;
  return (
    <Table
      head={
        <>
          <th>Film</th>
          <th>Took it</th>
          <th>Due back, or back in</th>
          <th>Response</th>
        </>
      }
    >
      {p.loans.map((l) => (
        <tr key={l.id}>
          <td className="ui-title">
            <Link to={`/admin/films/${l.film.id}`}>{l.film.title}</Link>
          </td>
          <td className="ui-when" data-label="Took it">
            {formatDateTime(l.takenAt)}
          </td>
          <td data-label="Due back, or back in">
            {l.live ? (
              <Mark tone="info">Out, due back {formatDayTime(l.dueAt)}</Mark>
            ) : (
              <span className="of-cell">
                <Mark tone="off">Back in {formatDateTime(l.endedAt)}</Mark>
                <small>{endedWords(l)}</small>
              </span>
            )}
          </td>
          <td data-label="Response">{l.response ? <Link to="/admin/responses">{RESPONSE_WORDS[l.response.kind]}</Link> : <span className="of-faint">–</span>}</td>
        </tr>
      ))}
    </Table>
  );
}

function LinkOutcome({ link: l }) {
  // Where a link was used matters most: it's who now has a passkey.
  if (l.usedAt) {
    return (
      <Mark tone="done">
        <b>
          Used {formatDayTime(l.usedAt)}
          {l.usedDevice ? ` from ${l.usedDevice}` : ''}
        </b>
      </Mark>
    );
  }
  if (l.cancelledAt) return <Mark tone="off">Cancelled {formatDateTime(l.cancelledAt)}</Mark>;
  if (l.expiresAt <= Date.now()) return <Mark tone="off">Expired {formatDateTime(l.expiresAt)}</Mark>;
  return <Mark tone="warn">Waiting: works until {formatDayTime(l.expiresAt)}</Mark>;
}

function SetupLinkPanel({ person: p, busy, onCreate, onClose }) {
  const [hours, setHours] = useState(72);
  const id = useId();
  return (
    <section className="of-box of-w" aria-labelledby={`${id}-h`}>
      <h2 className="of-h2" id={`${id}-h`}>
        Create a setup link for {p.name}
      </h2>
      <p className="of-p of-dim">{p.name} opens it on their phone or computer and creates a passkey. It works once. Send it on a contact you know is theirs.</p>
      <div className="ui-field" style={{ maxWidth: 240 }}>
        <label className="ui-field__label" htmlFor={`${id}-for`}>
          Works for
        </label>
        <select id={`${id}-for`} className="ui-select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          {SETUP_HOURS.map((h) => (
            <option key={h} value={h}>
              {linkLifetime(h)}
            </option>
          ))}
        </select>
      </div>
      {p.linkWaiting && <p className="of-p of-dim">The link that's waiting stops working.</p>}
      <div className="ui-btns">
        <button type="button" className="ui-btn ui-btn--primary" onClick={() => onCreate(hours)} disabled={busy}>
          Create link
        </button>
        <button type="button" className="ui-btn ui-btn--quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
    </section>
  );
}

// Recovery: either another passkey for a new device, or taking back the keys after a
// loss, which cuts the old passkeys and browsers off now rather than when the link is used.
function HelpSignInPanel({ person: p, busy, onCreate, onClose }) {
  const [confirmed, setConfirmed] = useState(false);
  const [hours, setHours] = useState(1);
  const [reset, setReset] = useState(false);
  const id = useId();
  const name = p.name;
  const keys = p.passkeys.length;
  const browsers = p.browsers.length;

  const addText = keys ? `${theirPasskeys(name, keys)} ${keys === 1 ? 'keeps' : 'keep'} working: for a new device.` : `${name} has no passkeys now: this adds one.`;
  let resetText;
  if (keys && browsers) resetText = `Removes ${theirPasskeys(name, keys)} and signs ${name} out of ${plural(browsers, 'browser')} now, before the link is used.`;
  else if (keys) resetText = `Removes ${theirPasskeys(name, keys)} now, before the link is used. ${name} isn't signed in anywhere.`;
  else if (browsers) resetText = `Signs ${name} out of ${plural(browsers, 'browser')} now, before the link is used.`;
  else resetText = `${name} has no passkeys and isn't signed in anywhere, so there's nothing to take back.`;

  function create() {
    if (reset && (keys || browsers)) {
      const what = [keys && `take back ${theirPasskeys(name, keys)}`, browsers && `sign ${name} out of ${plural(browsers, 'browser')}`].filter(Boolean).join(' and ');
      // Signing their browsers out sends back a tape one took out on a link anyone can use.
      if (!window.confirm(`This will ${what} straight away.${browsers ? ` ${browsersTapesWords(name)}` : ''} Continue?`)) return;
    }
    onCreate({ hours, reset });
  }

  return (
    <section className="of-box of-w" aria-labelledby={`${id}-h`}>
      <h2 className="of-h2" id={`${id}-h`}>
        Help {name} sign in again
      </h2>
      <label className="ui-check">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} aria-describedby={`${id}-check`} />
        <span>
          I'm replying on a contact I already know is {name}'s: not a new number or account
          <small id={`${id}-check`}>If someone says they've lost their phone, a quick call is the surest check.</small>
        </span>
      </label>

      <fieldset className="ui-fieldset">
        <legend>Works for</legend>
        <div className="ui-btns">
          {RECOVERY_HOURS.map((h) => (
            <label key={h} className="ui-check">
              <input type="radio" name={`${id}-hours`} checked={hours === h} onChange={() => setHours(h)} />
              <span>{linkLifetime(h)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="ui-fieldset">
        <legend>What the link is for</legend>
        <label className="ui-choice">
          <input type="radio" name={`${id}-kind`} checked={!reset} onChange={() => setReset(false)} />
          <span>
            <b>Add a passkey</b>
            <small>{addText}</small>
          </span>
        </label>
        <label className="ui-choice">
          <input type="radio" name={`${id}-kind`} checked={reset} onChange={() => setReset(true)} />
          <span>
            <b>Lost phone: take back the keys</b>
            <small>
              {resetText} If the device was stolen, ask {name} to remove it from their Apple Account, Google account or password manager first, or
              change that password: a passkey saved there reaches every device still signed in to it.
            </small>
          </span>
        </label>
      </fieldset>

      {p.linkWaiting && <p className="of-p of-dim">The link that's waiting stops working.</p>}
      <div className="ui-btns">
        <button type="button" className={reset ? 'ui-btn ui-btn--danger' : 'ui-btn ui-btn--primary'} onClick={create} disabled={busy || !confirmed}>
          {reset ? 'Take back the keys and create a recovery link' : 'Create a recovery link'}
        </button>
        <button type="button" className="ui-btn ui-btn--quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
    </section>
  );
}
