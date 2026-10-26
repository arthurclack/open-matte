import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api } from '../api.js';
import Activity from './Activity.jsx';
import FilmDetail from './FilmDetail.jsx';
import Films from './Films.jsx';
import Settings from './Settings.jsx';
import TicketDetail from './TicketDetail.jsx';
import Tickets from './Tickets.jsx';
import { AdminContext } from './ui.jsx';

export default function AdminApp() {
  const [state, setState] = useState('checking'); // checking | in | out

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

  async function signOut() {
    await api.post('/api/admin/logout').catch(() => {});
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
            <NavLink to="/admin/activity">Activity</NavLink>
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
          <Routes>
            <Route index element={<Films />} />
            <Route path="films/:id" element={<FilmDetail />} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="tickets/:id" element={<TicketDetail />} />
            <Route path="activity" element={<Activity />} />
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
      setError(err.status === 429 ? 'Too many attempts. Wait a few minutes and try again.' : 'That password is not right.');
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
