import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from './api.js';

const SiteContext = createContext(null);

// The viewer-facing shell: the cinema's name, what this browser holds, and
// a header and footer around every page.
export function SiteProvider({ children }) {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const refresh = useCallback(() => api.get('/api/me').then(setMe).catch(() => setMe({ site: null, person: null, tickets: [] })), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Revokes this browser's session, so it also forgets the link tickets it opened.
  // False if the server never heard: the session is still there, so nothing may
  // look signed out (on a borrowed computer the next person would be signed in).
  const signOut = useCallback(async () => {
    try {
      await api.post('/api/signout');
    } catch {
      return false;
    }
    await refresh();
    navigate('/');
    return true;
  }, [refresh, navigate]);

  const site = me?.site;
  useEffect(() => {
    if (site?.cinemaName) document.title = site.cinemaName;
  }, [site?.cinemaName]);

  return (
    <SiteContext.Provider value={{ me, site, refresh, signOut }}>
      <div className="site">
        {/* The admin cookie bypasses every ticket and person check in this browser. */}
        {me?.admin && me?.person && <div className="preview-banner">Admin preview: person rules don't apply in this browser.</div>}
        <header className="site-header">
          <Link to="/" className="site-name">
            {site?.cinemaName || ' '}
          </Link>
          <div className="row" style={{ gap: '0.6rem' }}>
            {me?.admin && (
              <a className="btn small" href="/admin">
                Admin
              </a>
            )}
            {me?.person && <PersonMenu me={me} onSignOut={signOut} />}
          </div>
        </header>
        <main className="site-main">{children}</main>
        <footer className="site-footer">
          <span>{site?.cinemaName}</span>
          <span>
            {site?.tmdbCredit && (
              <>
                Film information and images from{' '}
                <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
                  TMDB
                </a>
                {site?.poweredBy && ' · '}
              </>
            )}
            {site?.poweredBy && 'Powered by Open Matte'}
          </span>
        </footer>
      </div>
    </SiteContext.Provider>
  );
}

// "Sam ▾": who is signed in here, and a way out.
function PersonMenu({ me, onSignOut }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  async function signOut() {
    setOpen(false);
    // Signing out forgets the link tickets this browser opened; the links still work.
    const fromLinks = me.tickets.filter((t) => !t.ticket?.inAccount);
    if (fromLinks.length) {
      const n = fromLinks.length;
      const titles = fromLinks.map((t) => t.film.title).join(', ');
      const text =
        n === 1
          ? `Sign out of this browser? It also forgets 1 ticket you opened from a link here (${titles}). The link still works if you open it again.`
          : `Sign out of this browser? It also forgets ${n} tickets you opened from links here (${titles}). The links still work if you open them again.`;
      if (!window.confirm(text)) return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!(await onSignOut())) setError("Couldn't sign out. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="menu" ref={ref}>
      <button className="btn small" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} disabled={busy}>
        {me.person.name} ▾
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <button role="menuitem" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
      {error && <div className="notice bad menu-error">{error}</div>}
    </div>
  );
}

export const useSite = () => useContext(SiteContext);
