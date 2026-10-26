import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { formatClock } from '../api.js';

export const AdminContext = createContext({ signedOut: () => {} });

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

export function ErrorNote({ error }) {
  return error ? <div className="notice bad">{error}</div> : null;
}

export function MediaBadge({ status }) {
  const map = { ok: ['good', 'Media OK'], warning: ['warn', 'Media warnings'], error: ['bad', 'Media errors'], missing: ['bad', 'Folder missing'] };
  const [tone, label] = map[status] || ['', status];
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function TicketBadge({ ticket }) {
  const t = ticket;
  if (t.state === 'revoked') return <span className="badge bad">Revoked</span>;
  if (t.state === 'expired') return <span className="badge">Expired</span>;
  if (t.state === 'used_up') return <span className="badge">Used up</span>;
  if (t.state === 'unpublished') return <span className="badge warn">Film unpublished</span>;
  if (t.state === 'unavailable') return <span className="badge bad">Film unavailable</span>;
  if (t.openScreening?.playingNow) return <span className="badge accent">Playing now</span>;
  if (t.firstPlayedAt) return <span className="badge good">Active</span>;
  if (t.firstOpenedAt) return <span className="badge good">Opened</span>;
  return <span className="badge">Not opened yet</span>;
}

export function CopyButton({ text, label = 'Copy', className = 'btn small' }) {
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

export function Progress({ seconds, duration }) {
  if (!duration || seconds == null) return <span className="faint">–</span>;
  const pct = Math.min(100, Math.round((seconds / duration) * 100));
  return (
    <span className="row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }} title={`${formatClock(seconds)} of ${formatClock(duration)}`}>
      <span className="progress" style={{ width: 70 }}>
        <div style={{ width: `${pct}%` }} />
      </span>
      <span className="faint nowrap">{pct}%</span>
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

export function describeEvent(e) {
  const at = e.position != null ? ` at ${formatClock(e.position)}` : '';
  switch (e.type) {
    case 'opened':
      return 'Opened the film page';
    case 'play':
      return e.detail?.resumed ? `Resumed the screening${at}` : 'Started a new screening';
    case 'heartbeat':
      return `Watching${at}`;
    case 'finished':
      return 'Reached the end';
    default:
      return e.type;
  }
}
