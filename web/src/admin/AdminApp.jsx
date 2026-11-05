import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useMatch } from 'react-router-dom';
import { api } from '../api.js';
import { scrollBehavior } from '../motion.js';
import Activity from './Activity.jsx';
import FilmDetail from './FilmDetail.jsx';
import Films from './Films.jsx';
import People from './People.jsx';
import PersonDetail from './PersonDetail.jsx';
import Settings from './Settings.jsx';
import Status, { AttentionStrip } from './Status.jsx';
import TicketDetail from './TicketDetail.jsx';
import Tickets from './Tickets.jsx';
import { AdminContext } from './ui.jsx';

export default function AdminApp() {
  const [state, setState] = useState('checking'); // checking | in | out
  const [signOutError, setSignOutError] = useState(null);
  // A film's own page is part of Films, so Films stays marked there. The link itself
  // keeps `end`, or it would be marked on every other section too.
  const onFilm = useMatch('/admin/films/:id');

  useEffect(() => {
    document.title = 'Admin · Open Matte';
    api
      .get('/api/admin/session')
      .then(() => setState('in'))
      .catch(() => setState('out'));
  }, []);

  const signedOut = useCallback(() => setState('out'), []);
  const ctx = useMemo(() => ({ signedOut }), [signedOut]);

  if (state === 'checking') return null;
  if (state === 'out') return <Login onSignedIn={() => setState('in')} />;

  // The admin only looks signed out once the server has ended the session. If it
  // never heard, the cookie still works: on a borrowed computer, the next person to
  // open the admin would be in.
  async function signOut() {
    setSignOutError(null);
    try {
      await api.post('/api/admin/logout');
    } catch {
      setSignOutError("Couldn't sign out. Check your connection and try again.");
      return;
    }
    setState('out');
  }

  return (
    <AdminContext.Provider value={ctx}>
      <div className="admin">
        <nav className="admin-nav">
          <div className="brand">Open Matte</div>
          <Tabs>
            <NavLink to="/admin" end className={({ isActive }) => (isActive || onFilm ? 'active' : undefined)}>
              Films
            </NavLink>
            <NavLink to="/admin/tickets">Tickets</NavLink>
            <NavLink to="/admin/people">People</NavLink>
            <NavLink to="/admin/activity">Activity</NavLink>
            <NavLink to="/admin/status">Status</NavLink>
            <NavLink to="/admin/settings">Settings</NavLink>
          </Tabs>
          <div className="bottom">
            <a href="/">View site</a>
            <button style={{ textAlign: 'left' }} onClick={signOut}>
              Sign out
            </button>
          </div>
        </nav>
        <main className="admin-main">
          {signOutError && <div className="notice bad">{signOutError}</div>}
          <Routes>
            {/* The first page starts with what needs attention, if anything does. */}
            <Route
              index
              element={
                <>
                  <AttentionStrip />
                  <Films />
                </>
              }
            />
            <Route path="films/:id" element={<FilmDetail />} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="tickets/:id" element={<TicketDetail />} />
            <Route path="people" element={<People />} />
            <Route path="people/:id" element={<PersonDetail />} />
            <Route path="activity" element={<Activity />} />
            <Route path="status" element={<Status />} />
            <Route path="settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </AdminContext.Provider>
  );
}

// Sideways only, as far as it needs, and keeping clear of the row's ends (styles.css).
const reveal = (tab, behavior) => {
  const row = tab?.parentElement;
  // Not while every tab fits: the end padding alone would move the row off the page's edge.
  if (!row || row.scrollWidth - row.clientWidth <= parseFloat(getComputedStyle(row).paddingRight)) return;
  tab.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
};

// The sections. On a phone they are one row that scrolls sideways (styles.css), so
// the current one is scrolled into view when the admin opens and whenever it
// changes, and so is any tab the keyboard reaches.
function Tabs({ children }) {
  const ref = useRef(null);
  const { pathname } = useLocation();
  const opened = useRef(false);

  // At once when the admin opens, with nothing to move from; smoothly after that,
  // unless the person has asked for less motion.
  // Before the fades are first measured, below, so they start from where it lands.
  useLayoutEffect(() => {
    reveal(ref.current.querySelector('a.active'), opened.current ? scrollBehavior() : 'auto');
    opened.current = true;
  }, [pathname]);

  // How much of the tabs is hidden past each end of the row, for its fades. Measured
  // from the tabs, not the scroll, so the row's own padding never counts.
  useLayoutEffect(() => {
    const row = ref.current;
    const measure = () => {
      const edges = row.getBoundingClientRect();
      const before = edges.left - row.firstElementChild.getBoundingClientRect().left;
      const after = row.lastElementChild.getBoundingClientRect().right - edges.right;
      row.style.setProperty('--more-before', `${Math.max(0, before)}px`);
      row.style.setProperty('--more-after', `${Math.max(0, after)}px`);
    };
    measure();
    row.addEventListener('scroll', measure, { passive: true });
    const resized = new ResizeObserver(measure);
    resized.observe(row);
    for (const tab of row.children) resized.observe(tab);
    return () => {
      row.removeEventListener('scroll', measure);
      resized.disconnect();
    };
  }, []);

  return (
    <div className="tabs" ref={ref} onFocus={(e) => reveal(e.target, scrollBehavior())}>
      {children}
    </div>
  );
}

function Login({ onSignedIn }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/admin/login', { password });
      onSignedIn();
    } catch (err) {
      // Only a 401 means the password was wrong. Anything else (no connection, or the
      // server restarting during a deploy) says nothing about the password.
      setError(
        err.status === 401
          ? 'That password is not right.'
          : err.status === 429
            ? 'Too many attempts. Wait a few minutes and try again.'
            : "Couldn't sign in just now. Check your connection and try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit} className="card">
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1.2rem' }}>Open Matte admin</h1>
        {error && <div className="notice bad">{error}</div>}
        <label className="field">
          <span>Admin password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        </label>
        <button className="btn primary" disabled={busy || !password}>
          Sign in
        </button>
      </form>
    </div>
  );
}
