import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatClock, formatDateTime, plural } from '../api.js';
import { Line } from '../look/ui.jsx';

// signedOut: back to the sign-in. site: the shop's name and logo for the brand, and
// setSite to change them there once Settings has saved new ones. facts: the films
// and the booth as the back office last read them (the status line, the attention
// strip and the still 12:00), and refreshFacts to read them again.
export const AdminContext = createContext({ signedOut: () => {}, site: null, setSite: () => {}, facts: {}, refreshFacts: () => {} });

// Loads data for a page; a 401 anywhere sends the admin back to sign-in.
export function useLoad(fn, deps) {
  const { signedOut } = useContext(AdminContext);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);
  const reload = useCallback(
    () =>
      load()
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((err) => (err.status === 401 ? signedOut() : setError(err.message))),
    [load, signedOut],
  );
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, setData, error, reload };
}

// Runs an admin action, reporting errors in place rather than throwing.
export function useAction() {
  const { signedOut } = useContext(AdminContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(
    async (fn) => {
      setBusy(true);
      setError(null);
      try {
        return await fn();
      } catch (err) {
        if (err.status === 401) signedOut();
        else setError(err.message);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [signedOut],
  );
  return { run, busy, error, setError };
}

// ------------------------------------------------------------ the office's pieces

// An error, as a system line (look/ui.jsx Line): the words are the server's or the
// page's own sentence, which says what went wrong.
export function ErrorNote({ error }) {
  return error ? (
    <Line kind="bad" role="alert">
      {error}
    </Line>
  ) : null;
}

// Something just done ("Saved."), as a system line with the solid block.
export function DoneNote({ children }) {
  return children ? (
    <Line kind="done" role="status">
      {children}
    </Line>
  ) : null;
}

// A state in words, with the interface's 8px block before it: solid for done or on,
// a half block for under way, amber for a warning, warm red for an error, a short
// dash for off. The words always say it; the block only helps the eye down a column.
export function Mark({ tone = 'done', children }) {
  return (
    <span className={`of-mark of-mark--${tone}`}>
      <span>{children}</span>
    </span>
  );
}

// A plain fact beside a title ("Shown to members"): no block, it isn't a state.
export function Fact({ children }) {
  return <span className="of-fact">{children}</span>;
}

// The way back to the list a page came from: "← Films", named "Back to Films" (the
// menu has a link named Films).
export function Back({ to, children }) {
  return (
    <Link to={to} className="of-back" aria-label={`Back to ${children}`}>
      <span aria-hidden="true">←</span>
      {children}
    </Link>
  );
}

// A screen's heading: the title, a line or two under it, and its buttons on the right.
export function Head({ title, lede, actions, children }) {
  return (
    <div className="of-head">
      <div>
        <h1>{title}</h1>
        {lede && <p className="of-lede">{lede}</p>}
        {children}
      </div>
      {actions && <div className="ui-btns">{actions}</div>}
    </div>
  );
}

// A table in the interface's rules: a ruled table, cards on a phone.
export function Table({ head, children, className = '' }) {
  return (
    <div className="ui-table-wrap">
      <table className={`ui-table ui-table--stack${className ? ` ${className}` : ''}`}>
        {head && (
          <thead>
            <tr>{head}</tr>
          </thead>
        )}
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function MediaBadge({ status }) {
  const map = { ok: ['done', 'Media OK'], warning: ['warn', 'Media warnings'], error: ['bad', 'Media errors'], missing: ['bad', 'Folder missing'] };
  const [tone, label] = map[status] || ['off', status];
  return <Mark tone={tone}>{label}</Mark>;
}

// Where a tape is, as the back office sees it (the friend's side has its own words).
export function TicketBadge({ ticket }) {
  const t = ticket;
  if (t.state === 'revoked') return <Mark tone="bad">Taken back</Mark>;
  if (t.state === 'expired') return <Mark tone="off">Expired</Mark>;
  if (t.state === 'used_up') return <Mark tone="off">Used up</Mark>;
  if (t.state === 'unpublished') return <Mark tone="warn">Film off the shelf</Mark>;
  if (t.state === 'unavailable') return <Mark tone="bad">Film unavailable</Mark>;
  if (t.openScreening?.playingNow) return <Mark tone="info">Playing now</Mark>;
  if (t.firstPlayedAt) return <Mark tone="done">Active</Mark>;
  if (t.firstOpenedAt) return <Mark tone="info">Opened</Mark>;
  return <Mark tone="off">Not opened yet</Mark>;
}

export function CopyButton({ text, label = 'Copy', className = 'ui-btn ui-btn--small' }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt('Copy this:', text);
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  }
  return (
    <button type="button" className={className} onClick={copy}>
      {done ? 'Copied' : label}
    </button>
  );
}

// A link to copy: the address in the machine's face, and its two buttons.
export function LinkBox({ link, message }) {
  return (
    <div className="of-linkbox">
      <code>{link}</code>
      <CopyButton text={link} label="Copy link" />
      {message && <CopyButton text={message} label="Copy message" />}
    </div>
  );
}

// How far playback got: a bar of whole pixels and the share in figures.
export function Progress({ seconds, duration }) {
  if (!duration || seconds == null) return <span className="of-faint">–</span>;
  const pct = Math.min(100, Math.round((seconds / duration) * 100));
  return (
    <span className="of-progress" title={`${formatClock(seconds)} of ${formatClock(duration)}`}>
      <span className="of-progress__bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="ui-n">{pct}%</span>
    </span>
  );
}

// Date inputs give YYYY-MM-DD; a deadline means the end of that day, locally.
export const dateInputToMs = (v) => {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
};
export const msToDateInput = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// How long a setup or recovery link works, in words.
export const linkLifetime = (hours) => (!hours ? '' : hours % 24 === 0 ? plural(hours / 24, 'day') : plural(hours, 'hour'));

// How long records are kept, in words: "30 days", "12 months", "2 years".
export const keptFor = (days) => (days === 365 ? '12 months' : days % 365 === 0 ? plural(days / 365, 'year') : plural(days, 'day'));

// What a clean-up deleted, or would: "120 progress reports, 4 events and 2 browsers".
export const clearedCounts = (c, browsers = 'browser') =>
  `${plural(c.progressReports ?? 0, 'progress report')}, ${plural(c.events ?? 0, 'event')} and ${plural(c.sessions ?? 0, browsers)}`;

// The clean-up's last run since the server started, in a sentence.
export function lastClearedText(lastRun) {
  if (!lastRun) return 'Not run yet since the server started.';
  const d = lastRun.deleted;
  if (!d.progressReports && !d.events && !d.sessions) return `Last run ${formatDateTime(lastRun.at)}: nothing was old enough to clear.`;
  return `Cleared ${clearedCounts(d)} at ${formatDateTime(lastRun.at)}.`;
}

const signedOutOf = (n) => (n ? `signed out of ${plural(n, 'browser')}` : 'no browsers were signed in');

// A sign-in refused because the passkey's counter went backwards: the one event the
// ledger marks as a security matter (a copied passkey, perhaps).
export const isSecurityEvent = (e) => e.type === 'sign-in-refused' && e.detail?.reason !== 'disabled';

export function describeEvent(e) {
  const at = e.position != null ? ` at ${formatClock(e.position)}` : '';
  const d = e.detail || {};
  switch (e.type) {
    case 'opened':
      return 'Opened the film page';
    case 'play':
      return e.detail?.resumed ? `Resumed${at}` : 'Started a new play';
    case 'heartbeat':
      return `Watching${at}`;
    case 'finished':
      return 'Reached the end';
    // Members and passkeys. Events you caused say "you".
    case 'signed-in':
      return 'Signed in with a passkey';
    case 'signed-out':
      return 'Signed out';
    case 'signed-out-everywhere':
      return `${d.by === 'admin' ? 'You signed them out everywhere' : 'Signed out everywhere'}: ${signedOutOf(d.signedOut)}`;
    case 'passkey-added':
      return d.via === 'recovery' ? 'Used a recovery link to add a passkey' : 'Used the setup link to add a passkey';
    case 'passkey-removed':
      return `You removed the passkey added${d.device ? ` from ${d.device}` : ''}: ${d.signedOut ? signedOutOf(d.signedOut) : 'no browser was signed in with it'}`;
    case 'link-created':
      if (d.purpose !== 'recovery') return `You created a setup link (works ${linkLifetime(d.hours)})`;
      if (d.reset) {
        return `You took back their keys and created a recovery link (works ${linkLifetime(d.hours)}): removed ${plural(d.passkeysRemoved ?? 0, 'passkey')}, ${signedOutOf(d.browsersSignedOut)}`;
      }
      return `You created a recovery link to add a passkey (works ${linkLifetime(d.hours)})`;
    case 'link-cancelled':
      return 'You cancelled the waiting link';
    case 'person-disabled':
      return `You turned their card off: ${signedOutOf(d.signedOut)}`;
    case 'person-enabled':
      return 'You turned their card back on';
    // Keeping, giving and releasing tapes: the event names the member whose card it went onto or left.
    case 'ticket-kept':
      return 'Kept a tape from a link on their card';
    case 'ticket-given':
      return d.from === 'person' ? "You gave them a tape that was someone else's" : 'You gave them a tape that was for anyone with the link';
    case 'ticket-released':
      return d.to === 'person' ? 'You gave their tape to someone else' : 'You let anyone with the link use their tape again';
    case 'sign-in-refused': {
      const key = d.device ? ` (the passkey added from ${d.device})` : '';
      return d.reason === 'disabled'
        ? `Sign-in refused: their card is turned off${key}`
        : `Sign-in refused: the passkey's counter went backwards, which can mean it was copied${key}`;
    }
    default:
      return e.type;
  }
}

// TMDB's logo and its notice, as one credit, wherever the back office shows TMDB's
// details: word for word as TMDB's terms give it, with "product" for "website" as the
// back office has always said (docs/metadata.md). The logo is TMDB's own file, at its
// own shape: only its height is set.
export function TmdbCredit({ children }) {
  return (
    <p className="tmdb-credit">
      <img src="/tmdb.svg" width="92" height="12" alt="TMDB" />
      <span>
        This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.{children ? <> {children}</> : null}
      </span>
    </p>
  );
}
