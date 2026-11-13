import { useContext, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDay, formatDayTime } from '../api.js';
import { Sleeve, Sticker } from '../look/objects.jsx';
import { BusyButton, Line } from '../look/ui.jsx';
import { hostName } from '../look/words.js';
import { scrollBehavior } from '../motion.js';
import { borrowerLines, inTime, linkStateNote, linkStateWords, loanNow, takeBackWords } from './loanWords.js';
import { AdminContext, Mark, Table, useAction } from './ui.jsx';

// The back office's pieces for a film's one tape (version 2): the tape panel on a
// film's page, the question before a tape is taken back, a link's state, and the
// tapes out now. The words are in loanWords.js.

// The host at the start of a sentence, as the friend's pages name you.
const Host = (site) => {
  const n = hostName(site);
  return n.charAt(0).toUpperCase() + n.slice(1);
};

// A link's state, with the layer's block, and how its tape came back under it.
export function LinkStateMark({ ticket, note = true }) {
  const [tone, words] = linkStateWords(ticket);
  const under = note ? linkStateNote(ticket) : '';
  return (
    <span className="of-cell">
      <Mark tone={tone}>{words}</Mark>
      {under && <small>{under}</small>}
    </span>
  );
}

// Who has a tape, as a cell: the member (their page), or a browser with your note on
// the link and its device under it.
export function Borrower({ loan }) {
  const b = loan.borrower;
  const { who, about } = borrowerLines(b, loan.ticket?.label);
  return (
    <span className="of-cell">
      {b?.kind === 'person' ? <Link to={`/admin/people/${b.person.id}`}>{who}</Link> : <span>{who}</span>}
      {about && <small>{about}</small>}
    </span>
  );
}

// "Take the tape back", and the question it asks first, on the page. The question
// takes the focus; Keep it out gives it back to the button. `onTaken` is told when
// the tape is back in, with what the server said.
export function TakeBack({ loan, title, startAsking = false, onTaken, hint = true }) {
  const { site } = useContext(AdminContext);
  const [asking, setAsking] = useState(startAsking);
  const [alsoCancel, setAlsoCancel] = useState({});
  const action = useAction();
  const askRef = useRef(null);
  const buttonRef = useRef(null);
  const was = useRef(false);
  const id = `tb${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  useEffect(() => {
    if (asking && !was.current) {
      askRef.current?.focus({ preventScroll: true });
      askRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
    }
    if (!asking && was.current) buttonRef.current?.focus();
    was.current = asking;
  }, [asking]);

  const w = takeBackWords(loan, title, Host(site), { ticked: alsoCancel });
  const first = loan.borrower?.kind === 'person' ? loan.borrower.person.name.split(' ')[0] : null;

  async function take() {
    const r = await action.run(async () => {
      const done = await api.post(`/api/admin/loans/${loan.id}/take-back`, { ticketId: loan.ticket.id });
      // The tape is back now, whatever follows: a ticked link that can't be cancelled
      // is named in the news, never reported as the take-back failing.
      const extra = [];
      const failed = [];
      for (const other of w.held) {
        if (!alsoCancel[other.id]) continue;
        try {
          extra.push((await api.post(`/api/admin/tickets/${other.id}/revoke`)).id);
        } catch (err) {
          if (err.status === 401) throw err;
          failed.push(other.name);
        }
      }
      return { ...done, alsoCancelled: [...done.alsoCancelled, ...extra], notCancelled: failed };
    });
    if (r) {
      setAsking(false);
      onTaken?.(r);
    }
  }

  const error = action.error === 'not-out' ? "That tape isn't out any more: it came back meanwhile. Reload the page." : action.error;

  if (!asking) {
    return (
      <>
        <div className="ui-btns">
          <button type="button" ref={buttonRef} className="ui-btn ui-btn--danger" onClick={() => setAsking(true)}>
            Take the tape back
          </button>
        </div>
        {hint && <p className="ui-field__hint of-gap-s">Asks first. It's back in straight away, and {first ? `${first}'s` : 'that'} link stops working.</p>}
      </>
    );
  }
  return (
    <div className="ui-line ui-line--bad ui-line--block of-confirm" role="group" aria-labelledby={id}>
      <div>
        <p id={id} ref={askRef} tabIndex={-1}>
          <b>{w.lead}</b>
        </p>
        {w.lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
        {w.cancelledLead && (
          <>
            <p>{w.cancelledLead}</p>
            <ul>
              {w.cancelled.map((o) => (
                <li key={o.id}>
                  <Link to={`/admin/tickets/${o.id}`}>{o.name}</Link> <span className="of-faint">({o.state})</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {w.heldLead && (
          <>
            <p>{w.heldLead}</p>
            <ul className="of-plain">
              {w.held.map((o) => (
                <li key={o.id}>
                  <label className="ui-check">
                    <input type="checkbox" checked={Boolean(alsoCancel[o.id])} onChange={(e) => setAlsoCancel({ ...alsoCancel, [o.id]: e.target.checked })} />
                    <span>
                      Cancel <b>{o.name}</b> too
                      <small>{o.state}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        {error && (
          <Line kind="bad" role="alert" lead="Not taken back.">
            {error}
          </Line>
        )}
        <div className="ui-btns">
          <BusyButton type="button" className="ui-btn ui-btn--danger" onClick={take} busy={action.busy} busyText="Taking it back…">
            {action.busy ? 'Taking it back…' : w.take}
          </BusyButton>
          <BusyButton type="button" className="ui-btn" onClick={() => setAsking(false)} busy={action.busy} busyText="Taking it back…">
            {w.keep}
          </BusyButton>
        </div>
      </div>
    </div>
  );
}

// What a take-back did, in a sentence, once it's done.
export function takenBackNote(r, title) {
  const who = r?.loan?.borrower?.kind === 'person' ? r.loan.borrower.person.name : 'that browser';
  const n = r?.alsoCancelled?.length ?? 0;
  const failed = r?.notCancelled ?? [];
  const after = failed.length ? ` ${failed.join(', ')} couldn't be cancelled just now: cancel ${failed.length === 1 ? 'it' : 'them'} on ${failed.length === 1 ? 'its' : 'their'} page.` : '';
  return `${title} is back in. You took it back from ${who}, and the link it was out on is cancelled${n ? `, with ${n === 1 ? '1 other link' : `${n} other links`}` : ''}.${after}`;
}

// The film's one tape, on its page: in, or out to whom, since when, due back when,
// what they're doing now, and taking it back. `askFirst`: open with the question
// (Tapes' Take the tape back comes here).
export function TapePanel({ film, askFirst = false, onTaken }) {
  const tape = film.tape;
  const loan = tape?.loan;
  if (!loan) {
    return (
      <section className="of-tape" aria-labelledby="tape-h">
        <div>
          <p className="ui-key" id="tape-h">
            The tape
          </p>
          <p className="of-tape__state">{film.published ? 'In' : 'In, but the film is off the shelf'}</p>
          <p className="of-p of-dim">
            {film.published
              ? 'Nobody has it. Whoever presses Play first on one of its links takes it, for as long as that link says.'
              : "Links only open the film once it's on the shelf. You can send them now."}
          </p>
        </div>
      </section>
    );
  }
  const b = loan.borrower;
  const { about } = borrowerLines(b, loan.ticket?.label);
  return (
    <section className="of-tape" aria-labelledby="tape-h">
      <div>
        <p className="ui-key" id="tape-h">
          The tape
        </p>
        <p className="of-tape__state">
          Out to {b?.kind === 'person' ? <Link to={`/admin/people/${b.person.id}`}>{b.person.name}</Link> : 'a browser, from a link anyone can use'}
          {tape.state === 'off' && ', and the film is off the shelf'}
        </p>
        {about && <p className="of-faint of-small">{about}</p>}
        <dl className="of-kv">
          <dt>Took it</dt>
          <dd>
            {formatDayTime(loan.takenAt)}, pressing Play on <Link to={`/admin/tickets/${loan.ticket.id}`}>{b?.kind === 'person' ? 'their link' : 'that link'}</Link>
          </dd>
          <dt>Due back</dt>
          <dd>
            {formatDayTime(loan.dueAt)} <span className="of-faint">({inTime(loan.dueAt)})</span>
          </dd>
          <dt>Now</dt>
          <dd>{loanNow(loan)}</dd>
        </dl>
        <TakeBack key={loan.id} loan={loan} title={film.title} startAsking={askFirst} onTaken={onTaken} />
      </div>
      <div className="of-tape__sticker">
        <Sticker label="Due back" value={formatDay(loan.dueAt)} seed={`office:due:${film.id}`} />
      </div>
    </section>
  );
}

// Every tape out now, the soonest due back first, with who has it and a way to take
// each back (on the film's page, where the question is asked).
// `films`: the admin's films, for each one's sleeve.
export function OutNow({ loans, films = [], onTakeBack }) {
  if (!loans.length) return <p className="of-p of-dim">No tapes are out: every film's tape is in.</p>;
  return (
    <Table
      head={
        <>
          <th>Film</th>
          <th>Who has it</th>
          <th>Since</th>
          <th>Due back</th>
          <th>
            <span className="visually-hidden">Take back</span>
          </th>
        </>
      }
    >
      {[...loans]
        .sort((a, b) => a.dueAt - b.dueAt)
        .map((l) => (
          <tr key={l.id}>
            <td className="of-td-film">
              <div className="of-film">
                <Sleeve film={films.find((f) => f.id === l.film.id) ?? l.film} seed={`thumb:${l.film.id}`} width={44} thumb />
                <span>
                  <Link to={`/admin/films/${l.film.id}`} className="of-film__t">
                    <b>{l.film.title}</b>
                  </Link>
                  <span className="of-film__k">{loanNow(l)}</span>
                </span>
              </div>
            </td>
            <td className="of-td-left" data-label="Who has it">
              <Borrower loan={l} />
            </td>
            <td className="ui-when" data-label="Since">
              {formatDayTime(l.takenAt)}
            </td>
            <td className="ui-when" data-label="Due back">
              {formatDayTime(l.dueAt)}
            </td>
            <td className="of-td-btn">
              <button type="button" className="ui-btn ui-btn--small ui-btn--danger" onClick={() => onTakeBack(l)} aria-label={`Take the tape back: ${l.film.title}`}>
                Take the tape back
              </button>
            </td>
          </tr>
        ))}
    </Table>
  );
}
