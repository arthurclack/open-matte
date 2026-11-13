import { useContext, useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatAgo, formatClock, formatDateTime, formatDayTime } from '../api.js';
import { Line } from '../look/ui.jsx';
import { LinkStateMark, TakeBack, takenBackNote } from './Loans.jsx';
import { endedWords, inTime, loanNow, startByWords } from './loanWords.js';
import { KeepBox, PersonDisabledBadge, linkName, ticketKind, ticketMessage } from './Tickets.jsx';
import { AdminContext, Back, DoneNote, ErrorNote, Head, LinkBox, Mark, Progress, Table, dateInputToMs, describeEvent, msToDateInput, useAction, useLoad } from './ui.jsx';

// Giving a link answers with a code when the member can't have it (their card turned
// off in another tab since this page loaded, say), and so does anything refused
// because of where the tape is; everything else it says in words.
const HOLDER_ERRORS = {
  'tape-out': "This link has the tape out, so it can't change hands now. Take the tape back first, or wait until it's back.",
  'lent-once': 'This link has lent its tape, and a link lends once. Send a new link.',
  'would-end-loan': 'That would make the tape due before now. To end the loan, take the tape back.',
  'not-out': "That tape isn't out any more. Reload the page.",
  'person-not-found': "That member isn't here any more. Reload the page and choose again.",
  'person-disabled': 'Their card is turned off: turn it back on, on their page, before giving them a link.',
};
const actionError = (e) => (e ? HOLDER_ERRORS[e] || e : null);

// The form's values as the link has them. Due back after is the link's own days, or
// empty for the shop's: sent back as it came, it moves nothing (slice 3's review).
const formOf = (t) => ({
  label: t.label || '',
  pickNote: t.pickNote || '',
  loanDays: t.loanDays ?? '',
  startBy: msToDateInput(t.startBy),
  claimable: t.claimable,
});

export default function TicketDetail() {
  const { id } = useParams();
  const { data: t, error, reload } = useLoad(() => api.get(`/api/admin/tickets/${id}`), [id]);
  const events = useLoad(() => api.get(`/api/admin/activity?ticket=${id}&heartbeats=1&limit=300`), [id]);
  const { site, refreshFacts } = useContext(AdminContext);
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState(null);
  // The notice takes the focus when the button that led to it has gone (a take-back, a
  // give or a release, whose section is drawn anew), not after a save.
  const [noticeFocus, setNoticeFocus] = useState(false);
  const tell = (text, focus = false) => {
    setNoticeFocus(focus);
    setNotice(text);
  };
  const action = useAction();
  const fid = useId();

  useEffect(() => {
    if (t) setForm(formOf(t));
  }, [t]);

  if (error) return <ErrorNote error={error} />;
  if (!t || !form) return null;

  const refresh = () => {
    reload();
    events.reload();
    refreshFacts(false);
  };
  const post = async (path, confirmText, done) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setNotice(null);
    if (await action.run(() => api.post(`/api/admin/${path}`))) {
      // Cancel and Restore swap places: the news takes the focus from the one that went.
      if (done) tell(done, true);
      refresh();
    }
  };

  async function save(e) {
    e.preventDefault();
    setNotice(null);
    const r = await action.run(() =>
      api.patch(`/api/admin/tickets/${t.id}`, {
        label: form.label,
        pickNote: form.pickNote,
        loanDays: form.loanDays === '' ? null : Number(form.loanDays),
        // The date as it was set, unless it was changed here: its time of day stays.
        startBy: form.startBy === msToDateInput(t.startBy) ? t.startBy : dateInputToMs(form.startBy),
        ...(t.person || t.loan ? {} : { claimable: form.claimable }),
      }),
    );
    if (r) {
      tell(r.loan?.live && t.loan?.live && r.loan.dueAt !== t.loan.dueAt ? `Saved. The tape is now due back ${formatDayTime(r.loan.dueAt)}.` : 'Saved.');
      refresh();
    }
  }

  // Gives the link to a member, or (null) lets anyone with the link use it again.
  // pickNote: the note as it's to be for the new holder, or undefined to leave it.
  // `done`: what the page says once it has changed hands.
  async function setHolder(personId, pickNote, confirmText, done) {
    if (!window.confirm(confirmText)) return;
    setNotice(null);
    const body = pickNote === undefined ? { personId } : { personId, pickNote };
    if (await action.run(() => api.post(`/api/admin/tickets/${t.id}/holder`, body))) {
      tell(done, true);
      refresh();
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const cancelled = t.linkState === 'cancelled';
  const has = t.linkState === 'has';
  const loan = t.loan;
  // A link only one member can use: their browsers are whichever are signed in as them.
  const person = t.person;
  const personLink = person && <Link to={`/admin/people/${person.id}`}>{person.name}</Link>;
  const open = t.openScreening;
  const first = person ? person.name.split(' ')[0] : null;
  const shopDays = site?.loanDays;

  return (
    <>
      <Back to="/admin/tickets">Tapes</Back>
      <Head
        title={linkName(t)}
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
          cancelled ? (
            !loan && (
              <button type="button" className="ui-btn" onClick={() => post(`tickets/${t.id}/restore`, null, 'Restored. Browsers have to open the link again.')} disabled={action.busy}>
                Restore the link
              </button>
            )
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
                  onClick={() => post(`tickets/${t.id}/sign-out-browsers`, 'Forget this link in every browser that opened it? The link will still work if opened again.')}
                  disabled={action.busy || !t.browsers || has}
                  aria-describedby={has ? `${fid}-held` : undefined}
                >
                  Sign out browsers
                </button>
              )}
              {!has && (
                <button
                  type="button"
                  className="ui-btn ui-btn--danger"
                  onClick={() => post(`tickets/${t.id}/revoke`, 'Cancel this link? It stops working straight away, in every browser that opened it.', 'Cancelled.')}
                  disabled={action.busy}
                >
                  Cancel the link
                </button>
              )}
            </>
          )
        }
      >
        <div className="of-marks">
          <LinkStateMark ticket={t} note={false} />
          <PersonDisabledBadge ticket={t} />
        </div>
      </Head>
      <ErrorNote error={actionError(action.error)} />
      <DoneNote focus={noticeFocus}>{notice}</DoneNote>

      {cancelled && (
        <Line kind="info">
          {loan?.endedHow === 'taken-back' ? `You took the tape back ${formatDateTime(loan.endedAt)}, which cancelled this link.` : `Cancelled ${formatDateTime(t.revokedAt)}.`}{' '}
          {loan
            ? "It has lent its tape, and a link lends once, so it can't be restored: send a new link."
            : !person
              ? 'If you restore it, browsers have to open the link again.'
              : person.disabled
                ? `If you restore it, ${person.name} sees it again once you turn their card back on.`
                : `If you restore it, ${person.name} sees it again straight away.`}
        </Line>
      )}
      {t.linkState === 'done' && <Line kind="info">This link has lent its tape, and it's back in. A link lends once: for another loan, send a new link.</Line>}

      {has && loan && (
        <section className="of-box" aria-labelledby={`${fid}-tape`}>
          <h2 className="of-h3" id={`${fid}-tape`}>
            This link has the tape
          </h2>
          <TakeBack
            loan={loan}
            title={t.film.title}
            onTaken={(r) => {
              tell(takenBackNote(r, t.film.title), true);
              refresh();
              refreshFacts('now');
            }}
          />
        </section>
      )}

      {!cancelled && <LinkBox link={t.link} message={ticketMessage(t, t.film.title)} />}

      {!cancelled && <WhoCanUseIt ticket={t} busy={action.busy} held={has} heldId={`${fid}-held`} onSetHolder={setHolder} />}

      <div className="of-split">
        <dl className="of-kv">
          {loan ? (
            <>
              <dt>Took the tape</dt>
              <dd>{formatDayTime(loan.takenAt)}</dd>
              {loan.live ? (
                <>
                  <dt>Due back</dt>
                  <dd>
                    {formatDayTime(loan.dueAt)} <span className="of-faint">({inTime(loan.dueAt)})</span>
                  </dd>
                  <dt>Now</dt>
                  <dd>
                    {loanNow(loan)}
                    {open?.device ? ` on ${open.device}` : ''}. {first ?? 'That browser'} can carry on until it's due back.
                  </dd>
                </>
              ) : (
                <>
                  <dt>Back in</dt>
                  <dd>
                    {formatDateTime(loan.endedAt)}: {endedWords(loan)}
                  </dd>
                </>
              )}
            </>
          ) : (
            <>
              <dt>Took the tape</dt>
              <dd>Not yet: pressing Play takes it, if it's in.</dd>
            </>
          )}
          <dt>Opened</dt>
          <dd>{t.firstOpenedAt ? formatDateTime(t.firstOpenedAt) : 'Not yet'}</dd>
          <dt>Start by</dt>
          <dd>{startByWords(t)}</dd>
          <dt>Browsers</dt>
          <dd>{person ? <>Any browser signed in as {personLink}</> : t.browsers}</dd>
          <dt>Sent</dt>
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
            <input id={`${fid}-label`} className="ui-input" value={form.label} onChange={set('label')} maxLength={200} aria-describedby={`${fid}-label-h`} />
            <p className="ui-field__hint" id={`${fid}-label-h`}>
              Only you see this.
            </p>
          </div>
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`${fid}-pick`}>
              Picked for you
            </label>
            <textarea id={`${fid}-pick`} className="ui-textarea" rows={3} maxLength={2000} value={form.pickNote} onChange={set('pickNote')} aria-describedby={`${fid}-pick-h`} />
            <p className="ui-field__hint" id={`${fid}-pick-h`}>
              {t.pickNote ? '' : 'None on this link. '}
              {person
                ? `A note here is shown with ${first}'s link, apart from the staff pick.`
                : 'A note here is shown to whoever has the link, apart from the staff pick.'}
            </p>
          </div>
          <div className="of-grid2">
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${fid}-days`}>
                Due back after (days)
              </label>
              <input
                id={`${fid}-days`}
                className="ui-input ui-input--num"
                type="number"
                min="1"
                max="30"
                value={form.loanDays}
                onChange={set('loanDays')}
                placeholder={shopDays ? String(shopDays) : ''}
                disabled={Boolean(loan && !loan.live)}
                aria-describedby={`${fid}-days-h`}
              />
              <p className="ui-field__hint" id={`${fid}-days-h`}>
                {loan?.live
                  ? `Counted from when ${first ?? 'they'} took the tape. Changing it moves this loan's due-back date.`
                  : loan
                    ? 'This link has lent: its days are history.'
                    : `Counted from when they press Play.${t.loanDays == null ? ` Empty: the shop's, ${shopDays ?? 3} as it is when Play is pressed.` : ''}`}
              </p>
            </div>
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${fid}-start`}>
                Start by
              </label>
              <input id={`${fid}-start`} className="ui-input" type="date" value={form.startBy} onChange={set('startBy')} disabled={Boolean(loan)} />
            </div>
          </div>
          {!person && !loan && <KeepBox className="" checked={form.claimable} onChange={(claimable) => setForm({ ...form, claimable })} />}
          <div className="ui-btns">
            <button className="ui-btn ui-btn--primary" disabled={action.busy}>
              Save changes
            </button>
          </div>
        </form>
      </div>

      <h2 className="of-h2">{loan ? 'Plays during this loan' : 'Plays'}</h2>
      {t.screenings.length === 0 ? (
        <p className="of-p of-dim">Nobody has pressed Play yet.</p>
      ) : (
        <Table
          head={
            <>
              <th>Started</th>
              <th>Device</th>
              <th>Furthest</th>
              <th>State</th>
            </>
          }
        >
          {t.screenings.map((s) => (
            <tr key={s.id}>
              <td className="ui-title">
                <time>Started {formatDateTime(s.startedAt)}</time>
              </td>
              <td data-label="Device">{s.device || <span className="of-faint">–</span>}</td>
              <td data-label="Furthest">
                <Progress seconds={s.furthest} duration={s.duration} />
              </td>
              <td data-label="State">
                {s.voidedAt ? (
                  <Mark tone="off">Given back</Mark>
                ) : open?.id === s.id && open.playingNow ? (
                  <Mark tone="info">Playing</Mark>
                ) : open?.id === s.id ? (
                  <Mark tone="info">{s.finishedAt ? 'Finished, still out' : 'Paused'}</Mark>
                ) : s.finishedAt ? (
                  <Mark tone="done">Finished</Mark>
                ) : (
                  <Mark tone="off">Stopped</Mark>
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
          <div className="ui-btns of-btns-gap">
            <button
              type="button"
              className="ui-btn ui-btn--small"
              onClick={() =>
                post(`tickets/${t.id}/sign-out-browsers`, "Forget this link in these browsers? They won't get it back if you let anyone with the link use it, unless they open the link again.")
              }
              disabled={action.busy || has}
            >
              Forget it in these browsers
            </button>
          </div>
          <BrowserTable browsers={t.browserList} />
        </>
      )}

      {t.browsers > 0 && (
        <>
          <h2 className="of-h2">Browsers holding this link</h2>
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
          {/* The link's own record outlives its events: see Settings, Keeping records. */}
          {t.firstOpenedAt ? 'None kept: older events are cleared after a while (Settings, Keeping records).' : 'No activity yet. Opening the link and playing show up here.'}
        </p>
      )}
      {events.data?.next && (
        <p className="of-p of-gap">
          <Link to={`/admin/activity?ticket=${t.id}&heartbeats=1`}>All of this link's activity</Link>
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

// Browsers that opened the link.
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

// Who the link is for, and changing it: Give it to a member, or Let anyone with the
// link use it. Not while it has the tape (question 2): a tape never moves with its
// link, so those wait, with a line saying why. Its days and start-by stay as they
// are. A "Picked for you" note on it is shown here, with "Take the note away" ticked
// (question 18, answer c): it was written for whoever had the link before.
function WhoCanUseIt({ ticket: t, busy, held, heldId, onSetHolder }) {
  const people = useLoad(() => api.get('/api/admin/people'), []);
  const [to, setTo] = useState('');
  const [dropNote, setDropNote] = useState(true);
  const id = useId();
  const person = t.person;
  // Members whose card is off can't be given links, and the current holder already has it.
  const choices = people.data?.filter((p) => !p.disabled && p.id !== person?.id) || [];
  const chosen = choices.find((p) => String(p.id) === to);
  const note = t.pickNote;
  // The note for the new holder: taken away, or left as it is.
  const noteFor = () => (note && dropNote ? null : undefined);
  const noteWords = note ? (dropNote ? ' The “Picked for you” note is taken away.' : ' The “Picked for you” note stays: they read it.') : '';
  const noteDone = note && dropNote ? ' The “Picked for you” note was taken away.' : '';

  function give() {
    if (!chosen) return;
    const loses = person ? `${person.name} loses it from the next request` : 'Browsers that opened the link lose it from the next request';
    onSetHolder(
      chosen.id,
      noteFor(),
      `Give this link to ${chosen.name}? Only ${chosen.name}, signed in, can use it from now on. ${loses}.${noteWords}`,
      `Given to ${chosen.name}. Only they can use it now.${noteDone}`,
    );
  }
  function release() {
    onSetHolder(
      null,
      noteFor(),
      `Let anyone with the link use it again? ${person.name} loses it from the next request, and browsers that opened the link get it back.${noteWords}`,
      `Anyone with the link can use it again.${noteDone}`,
    );
  }

  return (
    <section className="of-box" aria-labelledby={`${id}-h`}>
      <h2 className="of-h3" id={`${id}-h`}>
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
        <>
          {note && !held && (
            <>
              <div className="of-msg">
                <span>Picked for you, on this link</span>
                {note}
              </div>
              <label className="ui-check">
                <input type="checkbox" checked={dropNote} onChange={(e) => setDropNote(e.target.checked)} />
                <span>
                  Take the note away
                  <small>It was written for whoever has the link now. Untick it to leave it for whoever you give it to.</small>
                </span>
              </label>
            </>
          )}
          <div className="of-inline">
            {person && (
              <button type="button" className="ui-btn" onClick={release} disabled={busy || held} aria-describedby={held ? heldId : undefined}>
                Let anyone with the link use it
              </button>
            )}
            {choices.length > 0 && (
              <>
                <select
                  className="ui-select"
                  aria-label="Give it to"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  disabled={held}
                  aria-describedby={held ? heldId : undefined}
                >
                  <option value="">{person ? 'Give it to someone else…' : 'Give it to a member…'}</option>
                  {choices.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="ui-btn" onClick={give} disabled={busy || !chosen || held} aria-describedby={held ? heldId : undefined}>
                  Give
                </button>
              </>
            )}
          </div>
        </>
      )}
      {held && (
        <p className="ui-field__hint of-gap-s" id={heldId}>
          While this link has the tape out it can't change hands{person ? '' : ', and Sign out browsers waits too'}: a tape never moves with its link. Take
          the tape back first, or wait until it's back.
        </p>
      )}
    </section>
  );
}
