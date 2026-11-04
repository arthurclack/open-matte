import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { enrollLink } from './enrollLink.js';

const SiteContext = createContext(null);

// The cinema as the server wrote it into the page (what /api/site returns), so the
// header has its name and logo before /api/me answers. The Vite dev server's page has none.
function embeddedSite() {
  try {
    return JSON.parse(document.getElementById('site-data').textContent);
  } catch {
    return null;
  }
}

// The viewer-facing shell: the cinema's name, what this browser holds, and
// a header and footer around every page.
export function SiteProvider({ children }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [me, setMe] = useState(null);
  const [embedded] = useState(embeddedSite);
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
      // A setup link this tab was keeping goes too (enrollLink.js).
      enrollLink.forget();
      await refresh();
      if (to != null) navigate(to);
      return true;
    },
    [refresh, navigate],
  );

  // The page's copy until /api/me answers, and if it can't.
  const site = me?.site ?? embedded;
  // The cinema's name in the tab, on every page. A layout effect runs before the
  // pages' own effects, so a page that names itself (a film, Your account) still
  // does, and leaving it puts the cinema's name back.
  useLayoutEffect(() => {
    if (site?.cinemaName) document.title = site.cinemaName;
  }, [site?.cinemaName, pathname]);

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
            {/* An <a>, not a <Link>: the admin is loaded as a page of its own, since a page
                keeps the Content-Security-Policy it came with and only the admin's allows
                TMDB's thumbnails (server/app.js, sendPage). */}
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
        {/* A page that can't be drawn says so below the header, which keeps Sign out. */}
        <main className="site-main">
          <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
        </main>
        <footer className="site-footer">
          <span>{site?.cinemaName}</span>
          <span>
            {site?.tmdbCredit && (
              <>
                Film information and images from{' '}
                <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
                  TMDB
                </a>
                {' · '}
              </>
            )}
            {site?.poweredBy && 'Powered by Open Matte · '}
            {/* The licences of the code this site sends to browsers, which the build writes (vite.config.js). */}
            <a href="/third-party-licenses.txt">Licences</a>
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
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    // Escape, a click elsewhere, or tabbing out of the menu closes it.
    const close = (e) => {
      if (e.type !== 'keydown') {
        if (!ref.current?.contains(e.target)) setOpen(false);
      } else if (e.key === 'Escape') {
        // From one of its items, focus goes back to the button rather than the page.
        if (ref.current?.contains(document.activeElement)) buttonRef.current?.focus();
        setOpen(false);
      }
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
      <button ref={buttonRef} className="btn small" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} disabled={busy}>
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
