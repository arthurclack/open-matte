import { useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatAgo, formatClock, formatDate, formatDateTime } from '../api.js';
import { Line } from '../look/ui.jsx';
import { KeepBox, PersonDisabledBadge, ticketKind, ticketMessage } from './Tickets.jsx';
import { Back, ErrorNote, Head, LinkBox, Mark, Progress, Table, TicketBadge, dateInputToMs, describeEvent, msToDateInput, useAction, useLoad } from './ui.jsx';

// Giving a tape answers with a code when the member can't have it (their card turned
// off in another tab since this page loaded, say), and so does anything refused
// because of where the tape is; everything else it says in words.
const HOLDER_ERRORS = {
  'tape-out': "This link has the tape out, so that can't be done now. Take the tape back first, or wait until it's back.",
  'lent-once': 'This link has lent its tape, and a link lends once. Send a new link.',
  'would-end-loan': "That would make the tape due before now. To end the loan, take the tape back.",
  'not-out': "That tape isn't out any more. Reload the page.",
  'person-not-found': "That member isn't here any more. Reload the page and choose again.",
  'person-disabled': 'Their card is turned off: turn it back on, on their page, before giving them a tape.',
};
const actionError = (e) => (e ? HOLDER_ERRORS[e] || e : null);

export default function TicketDetail() {
  const { id } = useParams();
  const { data: t, error, reload } = useLoad(() => api.get(`/api/admin/tickets/${id}`), [id]);
  const events = useLoad(() => api.get(`/api/admin/activity?ticket=${id}&heartbeats=1&limit=300`), [id]);
  const [form, setForm] = useState(null);
  const action = useAction();
  const fid = useId();

  useEffect(() => {
    if (t)
      setForm({
        label: t.label || '',
        screeningLimit: t.screeningLimit ?? '',
        startBy: msToDateInput(t.startBy),
        daysAfterFirstPlay: t.daysAfterFirstPlay ?? '',
        claimable: t.claimable,
      });
  }, [t]);

  if (error) return <ErrorNote error={error} />;
  if (!t || !form) return null;

  const refresh = () => {
    reload();
    events.reload();
  };
  const post = async (path, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    if (await action.run(() => api.post(`/api/admin/${path}`))) refresh();
  };

  async function save(e) {
    e.preventDefault();
    const r = await action.run(() =>
      api.patch(`/api/admin/tickets/${t.id}`, {
        label: form.label,
        screeningLimit: form.screeningLimit === '' ? null : Number(form.screeningLimit),
        startBy: dateInputToMs(form.startBy),
        daysAfterFirstPlay: form.daysAfterFirstPlay === '' ? null : Number(form.daysAfterFirstPlay),
        ...(t.person ? {} : { claimable: form.claimable }),
      }),
    );
    if (r) reload();
  }

  // Gives the tape to a member, or (null) lets anyone with the link use it again.
  async function setHolder(personId, confirmText) {
    if (!window.confirm(confirmText)) return;
    if (await action.run(() => api.post(`/api/admin/tickets/${t.id}/holder`, { personId }))) refresh();
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const revoked = t.state === 'revoked';
  // A tape only one member can use: their browsers are whichever are signed in as them.
  const person = t.person;
  const personLink = person && <Link to={`/admin/people/${person.id}`}>{person.name}</Link>;
  const open = t.openScreening;

  return (
    <>
      <Back to="/admin/tickets">Tapes</Back>
      <Head
        title={t.label || person?.name || 'Unnamed tape'}
        lede={
          <>
            {person ? (
              <>
                Only {personLink}
                {t.claimedAt ? ` · kept from a link ${formatDateTime(t.claimedAt)}` : ', signed in'}
              </>
            ) : (
              ticketKind(t)
            )}{' '}
            · <Link to={`/admin/films/${t.film.id}`}>{t.film.title}</Link>
          </>
        }
        actions={
          revoked ? (
            <button type="button" className="ui-btn" onClick={() => post(`tickets/${t.id}/restore`)} disabled={action.busy}>
              Restore the tape
            </button>
          ) : (
            <>
              {/* Signing a member's browsers out is Sign out everywhere, on their page. */}
              {person ? (
                <Link className="ui-btn" to={`/admin/people/${person.id}`}>
                  {person.name}'s page
                </Link>
              ) : (
                <button
                  type="button"
                  className="ui-btn"
                  onClick={() => post(`tickets/${t.id}/sign-out-browsers`, 'Forget this tape in every browser that opened it? The link will still work if opened again.')}
                  disabled={action.busy || !t.browsers}
                >
                  Sign out browsers
                </button>
              )}
              <button
                type="button"
                className="ui-btn ui-btn--danger"
                onClick={() => post(`tickets/${t.id}/revoke`, 'Take this tape back? Playback stops on the next request and the link stops working.')}
                disabled={action.busy}
              >
                Take the tape back
              </button>
            </>
          )
        }
      >
        <div className="of-marks">
          <TicketBadge ticket={t} />
          <PersonDisabledBadge ticket={t} />
        </div>
      </Head>
      <ErrorNote error={actionError(action.error)} />

      {revoked && (
        <Line kind="info">
          Taken back {formatDateTime(t.revokedAt)}.{' '}
          {!person
            ? 'If you restore it, browsers have to open the link again.'
            : person.disabled
              ? `If you restore it, ${person.name} sees it again once you turn their card back on.`
              : `If you restore it, ${person.name} sees it again straight away.`}
        </Line>
      )}

      {!revoked && <LinkBox link={t.link} message={ticketMessage(t, t.film.title)} />}

      <WhoCanUseIt ticket={t} busy={action.busy} onSetHolder={setHolder} />

      <div className="of-split">
        <dl className="of-kv">
          <dt>Plays</dt>
          <dd>
            {t.screeningsUsed} used{t.screeningLimit != null ? ` of ${t.screeningLimit}` : ', no limit'}
          </dd>
          <dt>Opened</dt>
          <dd>{t.firstOpenedAt ? formatDateTime(t.firstOpenedAt) : 'Not yet'}</dd>
          <dt>First played</dt>
          <dd>{t.firstPlayedAt ? formatDateTime(t.firstPlayedAt) : 'Not yet'}</dd>
          <dt>Expires</dt>
          <dd>
            {t.expiresAt
              ? formatDateTime(t.expiresAt)
              : t.startBy && !t.firstPlayedAt
                ? `If not started by ${formatDate(t.effectiveStartBy ?? t.startBy)}`
                : t.daysAfterFirstPlay
                  ? `${t.daysAfterFirstPlay} days after the first play`
                  : 'Never'}
          </dd>
          <dt>Browsers</dt>
          <dd>{person ? <>Any browser signed in as {personLink}</> : t.browsers}</dd>
          {open && (
            <>
              <dt>Now</dt>
              <dd>
                {open.playingNow ? 'Playing now' : 'Paused'}
                {open.device ? ` on ${open.device}` : ''}; they can come back to it until{' '}
                {/* The server's, never later than the tape's own expiry. */}
                {formatDateTime(open.resumableUntil)}
              </dd>
            </>
          )}
          <dt>Lent</dt>
          <dd>{formatDateTime(t.createdAt)}</dd>
        </dl>
        <form className="of-box" onSubmit={save}>
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`${fid}-label`}>
              {person ? (
                <>
                  Note <small>(optional)</small>
                </>
              ) : (
                'Who is it for?'
              )}
            </label>
            <input id={`${fid}-label`} className="ui-input" value={form.label} onChange={set('label')} maxLength={200} />
          </div>
          <div className="of-grid2">
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${fid}-plays`}>
                Plays
              </label>
              <input id={`${fid}-plays`} className="ui-input ui-input--num" type="number" min="1" value={form.screeningLimit} onChange={set('screeningLimit')} placeholder="No limit" />
            </div>
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${fid}-days`}>
                Days after the first play
              </label>
              <input id={`${fid}-days`} className="ui-input ui-input--num" type="number" min="1" value={form.daysAfterFirstPlay} onChange={set('daysAfterFirstPlay')} placeholder="No limit" />
            </div>
          </div>
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`${fid}-start`}>
              Start by
            </label>
            <input id={`${fid}-start`} className="ui-input" type="date" value={form.startBy} onChange={set('startBy')} />
          </div>
          {!person && <KeepBox className="" checked={form.claimable} onChange={(claimable) => setForm({ ...form, claimable })} />}
          <div className="ui-btns">
            <button className="ui-btn ui-btn--primary" disabled={action.busy}>
              Save changes
            </button>
          </div>
        </form>
      </div>

      <h2 className="of-h2">Plays</h2>
      {t.screenings.length === 0 ? (
        <p className="of-p of-dim">Nobody has pressed Play yet.</p>
      ) : (
        <Table
          head={
            <>
              <th>Started</th>
              <th>Device</th>
              <th>Progress</th>
              <th>Can come back until</th>
              <th>State</th>
              <th>
                <span className="visually-hidden">Give back</span>
              </th>
            </>
          }
        >
          {t.screenings.map((s) => (
            <tr key={s.id}>
              <td className="ui-title">
                <time>Started {formatDateTime(s.startedAt)}</time>
              </td>
              <td data-label="Device">{s.device || <span className="of-faint">–</span>}</td>
              <td data-label="Progress">
                <Progress seconds={s.furthest} duration={s.duration} />
              </td>
              <td className="ui-when" data-label="Can come back until">
                {formatDateTime(s.resumableUntil)}
              </td>
              <td data-label="State">
                {s.voidedAt ? (
                  <Mark tone="off">Given back</Mark>
                ) : s.finishedAt ? (
                  <Mark tone="done">Finished</Mark>
                ) : open?.id === s.id && open.playingNow ? (
                  <Mark tone="info">Playing</Mark>
                ) : open?.id === s.id ? (
                  <Mark tone="info">Open</Mark>
                ) : (
                  <Mark tone="off">Closed</Mark>
                )}
              </td>
              <td className="of-td-btn">
                {!s.voidedAt && (
                  <button
                    type="button"
                    className="ui-btn ui-btn--small"
                    onClick={() =>
                      post(
                        `screenings/${s.id}/void`,
                        "Give this play back? It won't count towards the limit, and stays in the history. If it's playing, playback stops. The tape's expiry clock keeps running.",
                      )
                    }
                    disabled={action.busy}
                  >
                    Give back
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {t.waitingBrowsers > 0 && (
        <>
          <h2 className="of-h2">Opened the link before it was {t.claimedAt ? 'kept' : `given to ${person.name}`}</h2>
          <p className="of-p of-dim">
            These browsers opened the link while it was for anyone. Unless they're signed in as {person.name}, they can't use it now: they're told someone
            has kept it. They get it back if you let anyone with the link use it.
          </p>
          <div className="ui-btns" style={{ marginBottom: 16 }}>
            <button
              type="button"
              className="ui-btn ui-btn--small"
              onClick={() =>
                post(`tickets/${t.id}/sign-out-browsers`, "Forget this tape in these browsers? They won't get it back if you let anyone with the link use it, unless they open the link again.")
              }
              disabled={action.busy}
            >
              Forget it in these browsers
            </button>
          </div>
          <BrowserTable browsers={t.browserList} />
        </>
      )}

      {t.browsers > 0 && (
        <>
          <h2 className="of-h2">Browsers holding this tape</h2>
          <BrowserTable browsers={t.browserList} />
        </>
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
              <td className="of-faint" data-label="Device">
                {e.device}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="of-p of-dim">
          {/* The tape's own record outlives its events: see Settings, Keeping records. */}
          {t.firstOpenedAt ? 'None kept: older events are cleared after a while (Settings, Keeping records).' : 'No activity yet. Opening the link and playing show up here.'}
        </p>
      )}
      {events.data?.next && (
        <p className="of-p of-gap">
          <Link to={`/admin/activity?ticket=${t.id}&heartbeats=1`}>All of this tape's activity</Link>
        </p>
      )}
      <p className="of-foot">
        This shows what the browser reported: playback progress, not proof anyone was watching. Positions are rounded to the last report (every 30
        seconds while playing, logged every 5 minutes). Finished means playback reached 92% of the running time.{' '}
        {t.durationSeconds ? `For this film that's ${formatClock(t.durationSeconds * 0.92)}.` : ''}
      </p>
    </>
  );
}

// Browsers that opened the tape's link.
function BrowserTable({ browsers }) {
  return (
    <Table
      head={
        <>
          <th>Device</th>
          <th>Opened the link</th>
          <th>Last seen</th>
        </>
      }
    >
      {(browsers || []).map((b) => (
        <tr key={b.ref}>
          <td className="ui-title">{b.device}</td>
          <td className="ui-when" data-label="Opened the link">
            {formatDateTime(b.addedAt)}
          </td>
          <td className="ui-when" data-label="Last seen">
            {formatAgo(b.lastSeenAt)}
          </td>
        </tr>
      ))}
    </Table>
  );
}

// Who the tape is for, and changing it: Give it to a member, or Let anyone with the
// link use it. Either way its limits, clocks and plays stay as they are.
function WhoCanUseIt({ ticket: t, busy, onSetHolder }) {
  const people = useLoad(() => api.get('/api/admin/people'), []);
  const [to, setTo] = useState('');
  const person = t.person;
  // Members whose card is off can't be given tapes, and the current holder already has it.
  const choices = people.data?.filter((p) => !p.disabled && p.id !== person?.id) || [];
  const chosen = choices.find((p) => String(p.id) === to);

  function give() {
    if (!chosen) return;
    const loses = person ? `${person.name} loses it from the next request` : 'Browsers that opened the link lose it from the next request';
    onSetHolder(chosen.id, `Give this tape to ${chosen.name}? Only ${chosen.name}, signed in, can use it from now on. ${loses}.`);
  }
  function release() {
    onSetHolder(null, `Let anyone with the link use this tape again? ${person.name} loses it from the next request, and browsers that opened the link get it back.`);
  }

  return (
    <section className="of-box" aria-labelledby="who-can-use-it">
      <h2 className="of-h3" id="who-can-use-it">
        Who can use it
      </h2>
      <p className="of-p of-dim">
        {person
          ? `Only ${person.name}, signed in, on every device they sign in on.`
          : t.claimable
            ? 'Anyone with the link. A member can keep it on their membership card, and whoever keeps it first takes it from everyone else.'
            : 'Anyone with the link.'}
      </p>
      {(person || choices.length > 0) && (
        <div className="of-inline">
          {person && (
            <button type="button" className="ui-btn" onClick={release} disabled={busy}>
              Let anyone with the link use it
            </button>
          )}
          {choices.length > 0 && (
            <>
              <select className="ui-select" aria-label="Give it to" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">{person ? 'Give it to someone else…' : 'Give it to a member…'}</option>
                {choices.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button type="button" className="ui-btn" onClick={give} disabled={busy || !chosen}>
                Give
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
