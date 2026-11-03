import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';

const SiteContext = createContext(null);

// The viewer-facing shell: the cinema's name, what this browser holds, and
// a header and footer around every page.
export function SiteProvider({ children }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [me, setMe] = useState(null);
  // Sign-in is never offered while the player is open: the film page says when it is.
  const [playerOpen, setPlayerOpen] = useState(false);
  const refresh = useCallback(() => api.get('/api/me').then(setMe).catch(() => setMe({ site: null, person: null, tickets: [] })), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Revokes this browser's session, so it also forgets the link tickets it opened.
  // False if the server never heard: the session is still there, so nothing may
  // look signed out (on a borrowed computer the next person would be signed in).
  // Then goes to the front page, or stays put with { to: null }.
  const signOut = useCallback(
    async ({ to = '/' } = {}) => {
      try {
        await api.post('/api/signout');
      } catch {
        return false;
      }
      await refresh();
      if (to != null) navigate(to);
      return true;
    },
    [refresh, navigate],
  );

  const site = me?.site;
  useEffect(() => {
    if (site?.cinemaName) document.title = site.cinemaName;
  }, [site?.cinemaName]);

  return (
    <SiteContext.Provider value={{ me, site, refresh, signOut, setPlayerOpen }}>
      <div className="site">
        {/* The admin cookie bypasses every ticket and person check in this browser. */}
        {me?.admin && me?.person && <div className="preview-banner">Admin preview: person rules don't apply in this browser.</div>}
        <header className="site-header">
          <Link to="/" className="site-name">
            <SiteName site={site} />
          </Link>
          <div className="row" style={{ gap: '0.6rem' }}>
            {me?.admin && (
              <a className="btn small" href="/admin">
                Admin
              </a>
            )}
            {me?.person && <PersonMenu me={me} onSignOut={signOut} />}
            {me && !me.person && !playerOpen && offersSignIn(pathname) && (
              <Link to={pathname === '/' ? '/signin' : `/signin?next=${encodeURIComponent(pathname)}`} className="site-signin">
                Sign in
              </Link>
            )}
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

// The cinema in the header: its name, or its logo with or without the name beside it.
// Also the admin's preview of the logo, so the two can't differ.
export function SiteName({ site }) {
  const logo = site?.logo;
  if (!logo) return site?.cinemaName || ' ';
  return (
    <>
      {/* Beside the name the logo is decoration; on its own it is the name. */}
      <img className="site-logo" src={logo.url} width={logo.width} height={logo.height} alt={site.logoWithName ? '' : site.cinemaName} />
      {site.logoWithName && <span>{site.cinemaName}</span>}
    </>
  );
}

// Pages that handle signing in themselves (a ticket for one person signs in on its
// own page, and keeps its code out of any other address) don't get the header link.
const offersSignIn = (pathname) => !/^\/(t\/|signin$|enroll$)/.test(pathname);

// Signing out forgets the link tickets this browser opened; the links still work.
// True to go ahead.
export function confirmSignOut(me) {
  // Every link ticket this browser holds, even one hidden behind the person's own
  // ticket for the same film.
  const fromLinks = me?.linkTickets || [];
  if (!fromLinks.length) return true;
  const n = fromLinks.length;
  const titles = fromLinks.join(', ');
  const text =
    n === 1
      ? `Sign out of this browser? It also forgets 1 ticket you opened from a link here (${titles}). The link still works if you open it again.`
      : `Sign out of this browser? It also forgets ${n} tickets you opened from links here (${titles}). The links still work if you open them again.`;
  return window.confirm(text);
}

// "Sam ▾": who is signed in here, their tickets and account, and a way out.
function PersonMenu({ me, onSignOut }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    // Escape, a click elsewhere, or tabbing out of the menu closes it.
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    document.addEventListener('focusin', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
      document.removeEventListener('focusin', close);
    };
  }, [open]);

  async function signOut() {
    setOpen(false);
    if (!confirmSignOut(me)) return;
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
          <Link role="menuitem" to="/" onClick={() => setOpen(false)}>
            Your tickets
          </Link>
          <Link role="menuitem" to="/account" onClick={() => setOpen(false)}>
            Your account
          </Link>
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
