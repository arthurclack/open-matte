import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api } from '../api.js';
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
          <div className="tabs">
            <NavLink to="/admin" end>
              Films
            </NavLink>
            <NavLink to="/admin/tickets">Tickets</NavLink>
            <NavLink to="/admin/people">People</NavLink>
            <NavLink to="/admin/activity">Activity</NavLink>
            <NavLink to="/admin/status">Status</NavLink>
            <NavLink to="/admin/settings">Settings</NavLink>
          </div>
          <div className="bottom">
            <a href="/">View site</a>
            <button className="linklike" style={{ textAlign: 'left' }} onClick={signOut}>
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
