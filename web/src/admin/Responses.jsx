import { useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDateTime, formatDayTime } from '../api.js';
import { Sleeve } from '../look/objects.jsx';
import { Line } from '../look/ui.jsx';
import { hostName } from '../look/words.js';
import { RESPONSE_WORDS, handedBackWhen } from './loanWords.js';
import { AdminContext, DoneNote, ErrorNote, Head, Mark, useAction, useLoad } from './ui.jsx';

// What members said when they handed a tape back (version 2): newest first, kept until
// you delete one, and for you alone. Each can be marked as read; the tab counts the
// ones that aren't.
export default function Responses() {
  const { data, setData, error } = useLoad(() => api.get('/api/admin/responses'), []);
  const { site, facts, refreshFacts } = useContext(AdminContext);
  const action = useAction();
  // What was just done, said in the status line; and where the focus goes once the
  // list is drawn again, since the button pressed has gone: { id } for that response's
  // first button, or 'notice' when none is left.
  const [notice, setNotice] = useState(null);
  const [focusTo, setFocusTo] = useState(null);
  const listRef = useRef(null);
  useEffect(() => {
    if (!focusTo || focusTo === 'notice') return;
    listRef.current?.querySelector(`[data-response="${focusTo.id}"] button`)?.focus();
    setFocusTo(null);
  }, [focusTo, data]);

  // Mark as read and delete answer with the unread count: the tab is read again.
  async function markRead(r) {
    setNotice(null);
    const done = await action.run(() => api.post(`/api/admin/responses/${r.id}/read`));
    if (done) {
      setData((d) => ({ responses: d.responses.map((x) => (x.id === r.id ? done.response : x)), unread: done.unread }));
      refreshFacts(false);
      setNotice('Marked as read.');
      // Its Delete button is the one left.
      setFocusTo({ id: r.id });
    }
  }
  async function remove(r) {
    if (!window.confirm(`Delete ${r.person.name}'s response to ${r.film.title}? It's gone for good. The loan stays as it was, without what was said.`)) return;
    setNotice(null);
    const list = data.responses;
    const at = list.findIndex((x) => x.id === r.id);
    const next = list[at + 1] ?? list[at - 1] ?? null;
    const done = await action.run(() => api.delete(`/api/admin/responses/${r.id}`));
    if (done) {
      setData((d) => ({ responses: d.responses.filter((x) => x.id !== done.deleted), unread: done.unread }));
      refreshFacts(false);
      setNotice('Deleted.');
      setFocusTo(next ? { id: next.id } : 'notice');
    }
  }

  const films = facts.films ?? [];
  return (
    <>
      <Head
        title="Responses"
        lede={`What members said when they handed a tape back, newest first. Only you see these, and the page they write on tells them so: “Only ${hostName(site)} sees this.”`}
      />
      <Line kind="info">
        Only from members signed in with their card, on a link for them alone, while the tape is theirs. A tape that comes back on its own, because it
        was due, brings no response. A link anyone can use doesn't ask: whoever it was forwarded to could write one.
      </Line>
      <ErrorNote error={error || action.error} />
      <DoneNote focus={focusTo === 'notice'}>{notice}</DoneNote>
      {data && data.responses.length === 0 && <p className="of-p of-dim">No responses yet.</p>}
      {data && data.responses.length > 0 && (
        <ul className="of-resps" ref={listRef}>
          {data.responses.map((r) => (
            <li key={r.id} className="of-resp" data-response={r.id}>
              <Sleeve film={films.find((f) => f.id === r.film.id) ?? r.film} seed={`thumb:${r.film.id}`} width={44} thumb />
              <div>
                {!r.readAt && (
                  <div className="of-marks">
                    <Mark tone="warn">Not read yet</Mark>
                  </div>
                )}
                <p className="of-resp__word">{RESPONSE_WORDS[r.kind] ?? r.kind}</p>
                <p className="of-resp__who">
                  <Link to={`/admin/people/${r.person.id}`}>{r.person.name}</Link> · <Link to={`/admin/films/${r.film.id}`}>{r.film.title}</Link>
                </p>
                {r.message ? <p className="of-resp__msg">{r.message}</p> : <p className="of-resp__none">No message.</p>}
                <div className="ui-btns">
                  {!r.readAt && (
                    // Each name starts with the button's own words, then whose response.
                    <button
                      type="button"
                      className="ui-btn ui-btn--small"
                      onClick={() => markRead(r)}
                      disabled={action.busy}
                      aria-label={`Mark as read: ${r.person.name}'s response to ${r.film.title}`}
                    >
                      Mark as read
                    </button>
                  )}
                  <button
                    type="button"
                    className="ui-btn ui-btn--small"
                    onClick={() => remove(r)}
                    disabled={action.busy}
                    aria-label={`Delete: ${r.person.name}'s response to ${r.film.title}`}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className="of-resp__when">
                Handed back {formatDayTime(r.createdAt)}
                {handedBackWhen(r.createdAt, r.loan.dueAt) && <span>{handedBackWhen(r.createdAt, r.loan.dueAt)}</span>}
                {r.readAt && <span>Read {formatDateTime(r.readAt)}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="of-foot">A response is never a rating, and nobody else ever sees it: not other members, not the film's page.</p>
    </>
  );
}
