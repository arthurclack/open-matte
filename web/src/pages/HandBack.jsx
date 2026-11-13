import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDayTime } from '../api.js';
import { Sleeve } from '../look/objects.jsx';
import { Line } from '../look/ui.jsx';
import { useSite } from '../site.jsx';
import { NarrowPage } from './tape.jsx';
import { RETURN_ERRORS, RETURN_FAILED, handBackWords, handedBackWords } from './tapeWords.js';

// The four responses, as the server knows them and as a friend reads them.
export const RESPONSES = [
  ['loved-it', 'Loved it'],
  ['still-thinking', 'Still thinking about it'],
  ['not-for-me', 'Not for me'],
  ['lets-talk', "Let's talk"],
];
const MAX = 2000;

// A padlock in whole pixels, for "Only Arthur sees this."
function Lock() {
  return (
    <svg viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      <path d="M2 0h4v1H2zM1 1h1v2H1zM6 1h1v2H6zM0 3h8v5H0z" />
    </svg>
  );
}

// The film on one line: its sleeve, small, and a line under the title.
function FilmLine({ film, sub }) {
  return (
    <div className="fl-filmline">
      <Sleeve film={film} width={56} thumb />
      <p>
        <b>{film.title}</b>
        {sub}
      </p>
    </div>
  );
}

// Hand it back: a view of the film page, not a page of its own, for a member who has
// the tape on their own link (ticket.loan.canRespond). One of four responses is
// required, a message is optional, and only the owner reads either: the screen says
// so. "Return it without a note" is the way to say nothing. Handing it back returns
// the tape, as Return it now does, and the link is spent. The words are tapeWords.js's.
// `onClose`: Not now, or the tape isn't out with them any more (returned from another
// device meanwhile): the film page reads itself again.
export default function HandBack({ film, ticket, site, onReturned, onClose }) {
  const { refresh: refreshSite } = useSite();
  const w = handBackWords(site);
  const [response, setResponse] = useState(null);
  const [message, setMessage] = useState('');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);
  const headingRef = useRef(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ids = { err: `hb-err${uid}`, msg: `hb-msg${uid}`, hint: `hb-hint${uid}` };

  // The view opens with its heading, as a page does.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [sent]);

  async function send(withResponse) {
    if (withResponse && !response) {
      setMissing(true);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = { takenAt: ticket.loan.takenAt };
      if (withResponse) {
        body.response = response;
        if (message.trim()) body.message = message;
      }
      await api.post(`/api/films/${encodeURIComponent(film.slug)}/return`, body);
      if (withResponse) {
        // The front page ("Go to your tapes") reads /api/me: it no longer has this tape.
        refreshSite();
        setSent({ response, message: message.trim() });
      } else await onReturned();
    } catch (err) {
      // Nothing to return: the form is no use now, so the page shows how things stand.
      if (err.code === 'nothing-to-return') return onClose();
      setError(RETURN_ERRORS[err.code] || RETURN_FAILED);
    } finally {
      setBusy(false);
    }
  }

  const invalid = missing && !response;

  if (sent) {
    const d = handedBackWords(film.title, site);
    return (
      <NarrowPage className="fl-handback">
        <FilmLine film={film} sub={d.sub} />
        <h1 tabIndex={-1} ref={headingRef}>
          {d.heading}
        </h1>
        <Line kind="done" lead={d.lead} role="status">
          {d.text}
        </Line>
        <dl className="fl-sent">
          <dt>{d.said}</dt>
          <dd>{RESPONSES.find(([k]) => k === sent.response)?.[1]}</dd>
          {sent.message && (
            <>
              <dt>{d.note}</dt>
              <dd>
                <blockquote>{sent.message}</blockquote>
              </dd>
            </>
          )}
        </dl>
        <p className="fl-only">
          <Lock />
          <span>{d.only}</span>
        </p>
        <div className="ui-btns">
          <Link to="/" className="ui-btn">
            {d.home}
          </Link>
          <button type="button" className="ui-btn ui-btn--quiet" onClick={onReturned}>
            {d.film}
          </button>
        </div>
      </NarrowPage>
    );
  }

  return (
    <NarrowPage className="fl-handback">
      <FilmLine film={film} sub={`Due back ${formatDayTime(ticket.dueBack)}`} />
      <h1 tabIndex={-1} ref={headingRef}>
        {w.heading}
      </h1>
      <p>{w.lede}</p>
      {invalid && (
        <Line kind="bad" lead={w.missing.lead} block role="alert">
          {w.missing.text}
        </Line>
      )}
      {error && (
        <Line kind="bad" lead={error.lead} block role="alert">
          {error.text}
        </Line>
      )}
      <form
        className="fl-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          send(true);
        }}
      >
        {/* One of the four is required: the radios say so, and say it's missing after
            a press without one (the form checks it itself: noValidate). */}
        <fieldset className="ui-fieldset" aria-describedby={invalid ? ids.err : undefined}>
          <legend>{w.legend}</legend>
          {invalid && (
            <p className="ui-field__error" id={ids.err}>
              {w.missingField}
            </p>
          )}
          {RESPONSES.map(([value, label]) => (
            <label key={value} className="ui-check">
              <input
                type="radio"
                name={`hb${uid}`}
                value={value}
                checked={response === value}
                onChange={() => setResponse(value)}
                required
                aria-invalid={invalid || undefined}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={ids.msg}>
            {w.message} <small>Optional</small>
          </label>
          <textarea
            className="ui-textarea"
            id={ids.msg}
            rows={4}
            maxLength={MAX}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            aria-describedby={ids.hint}
          />
          <p className="ui-field__hint" id={ids.hint}>
            Up to 2,000 characters.
          </p>
        </div>
        <p className="fl-only">
          <Lock />
          <span>{w.only}</span>
        </p>
        <Line kind="info">{w.returns}</Line>
        <div className="ui-btns fl-handback__go">
          <button type="submit" className="ui-btn ui-btn--primary ui-btn--big" disabled={busy}>
            {busy ? w.sending : w.send}
          </button>
        </div>
        <div className="ui-btns">
          <button type="button" className="ui-btn" onClick={() => send(false)} disabled={busy}>
            {w.without}
          </button>
          <button type="button" className="ui-btn ui-btn--quiet" onClick={onClose} disabled={busy}>
            {w.notNow}
          </button>
        </div>
      </form>
    </NarrowPage>
  );
}
