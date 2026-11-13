import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { enrollLink } from './enrollLink.js';
import { InkFilters, ShopName } from './look/objects.jsx';
import { Line, Menu, MenuSep, Tri } from './look/ui.jsx';
import { PREVIEW_BANNER, signOutWords } from './pages/tapeWords.js';

const SiteContext = createContext(null);

// The shop as the server wrote it into the page (what /api/site returns), so the
// header has its name and logo before /api/me answers. The Vite dev server's page has none.
export function embeddedSite() {
  try {
    return JSON.parse(document.getElementById('site-data').textContent);
  } catch {
    return null;
  }
}

// The friend's side's shell: the shop's name in its own printing, what this browser
// holds, the menu bar and the footer around every page.
export function SiteProvider({ children }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [me, setMe] = useState(null);
  const [embedded] = useState(embeddedSite);
  // Sign-in is never offered while the player is open: the film page says when it is.
  const [playerOpen, setPlayerOpen] = useState(false);
  // Resolves to what it set, so a question asked from it (signing out) is asked from
  // what the server says now, not from whenever the page last read it.
  const refresh = useCallback(
    () =>
      api
        .get('/api/me')
        .catch(() => ({ site: null, person: null, tickets: [] }))
        .then((m) => {
          setMe(m);
          return m;
        }),
    [],
  );
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Revokes this browser's session, so it also forgets the tapes it opened from links.
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
  // The shop's name in the tab, on every page. A layout effect runs before the
  // pages' own effects, so a page that names itself (a film, Your membership card)
  // still does, and leaving it puts the shop's name back.
  useLayoutEffect(() => {
    if (site?.cinemaName) document.title = site.cinemaName;
  }, [site?.cinemaName, pathname]);

  return (
    <SiteContext.Provider value={{ me, site, refresh, signOut, setPlayerOpen }}>
      <div className="site">
        <InkFilters />
        {/* The back office's cookie bypasses every tape and member rule in this browser. */}
        {me?.admin && me?.person && (
          <div className="site-preview">
            <Line kind="warn" wide lead={PREVIEW_BANNER.lead} className="ui-w">
              {PREVIEW_BANNER.text}
            </Line>
          </div>
        )}
        <header className="site-bar">
          <div className="ui-bar ui-w">
            <Link to="/" className="ui-bar__name site-home">
              <ShopName site={site} />
            </Link>
            <nav className="ui-bar__items" aria-label={me?.person ? 'Your membership' : 'Sign in'}>
              {/* An <a>, not a <Link>: the back office is loaded as a page of its own, since
                  a page keeps the Content-Security-Policy it came with and only the back
                  office's allows TMDB's thumbnails (server/app.js, sendPage). On a phone it
                  moves into the name menu. */}
              {me?.admin && (
                <a className={`ui-item${me?.person ? ' ui-wide' : ''}`} href="/admin">
                  Back office
                </a>
              )}
              {me?.person && <PersonMenu me={me} onSignOut={signOut} refresh={refresh} />}
              {me && !me.person && !playerOpen && offersSignIn(pathname) && (
                <Link to={pathname === '/' ? '/signin' : `/signin?next=${encodeURIComponent(pathname)}`} className="ui-item">
                  Sign in
                </Link>
              )}
            </nav>
          </div>
        </header>
        {/* A page that can't be drawn says so below the header, which keeps Sign out. */}
        <main className="site-main">
          <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
        </main>
        {/* TMDB's credit, the rights reminder, then Powered by and Licences. The shop's
            name isn't here: the header and the tab have it. */}
        <footer className="site-footer">
          <div className="ui-w">
            {/* TMDB's terms ask for its logo, less prominent than the shop's own name
                and logo, and its notice, shown prominently, wherever its film information
                is used: together, as one credit. The logo is an <img> from this site, not
                inline SVG: the page's Content-Security-Policy would block the SVG's own <style>. */}
            {site?.tmdbCredit && (
              <p className="tmdb-credit">
                <a href="https://www.themoviedb.org/" rel="noreferrer">
                  <img className="tmdb-logo" src="/tmdb.svg" width="92" height="12" alt="TMDB" />
                </a>{' '}
                {/* Word for word as TMDB's terms give it. */}
                <span className="tmdb-notice">This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.</span>
              </p>
            )}
            <p>Only share films you have the right to share.</p>
            <p className="site-footer__row">
              {site?.poweredBy && <span>Powered by Open Matte</span>}
              {/* The licences of the code and fonts this site sends to browsers, which the build writes (vite.config.js). */}
              <a href="/third-party-licenses.txt">Licences</a>
            </p>
          </div>
        </footer>
      </div>
    </SiteContext.Provider>
  );
}

// The shop in the header: its logo, its name in its own printing, or both. Also the
// admin's preview of the logo, so the two can't differ.
export function SiteName({ site }) {
  return <ShopName site={site} />;
}

// Pages that handle signing in themselves (a tape for one member signs in on its own
// page, and keeps its code out of any other address) don't get the header link.
const offersSignIn = (pathname) => !/^\/(t\/|signin$|enroll$)/.test(pathname);

// Signing out sends back any tape out to this browser from a link, whose link won't
// take it out again (question 5: /api/me's browserLoans names them), and forgets the
// other tapes this browser opened from links, whose links still work (linkTickets:
// every one it holds, even one hidden behind the person's own for the same film).
// Asked first only then, from /api/me read afresh: a tape taken out since the page last
// read it (Play doesn't reload the page) must be named. Resolves true to go ahead.
// `everywhere`: Sign out everywhere, which is always asked.
export async function confirmSignOut(refresh, { everywhere = false } = {}) {
  const text = signOutWords(await refresh(), { everywhere });
  return text ? window.confirm(text) : true;
}

// "Sam ▾": who is signed in here, their tapes and membership card, the back office on
// a phone (it is in the bar on a wider screen), and a way out.
function PersonMenu({ me, onSignOut, refresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function signOut() {
    if (!(await confirmSignOut(refresh))) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await onSignOut())) setError('Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Menu
      disabled={busy}
      label={
        <>
          <PersonName name={me.person.name} />
          <Tri />
        </>
      }
      items={
        <>
          <Link role="menuitem" className="ui-menu__item" to="/">
            Your tapes
          </Link>
          <Link role="menuitem" className="ui-menu__item" to="/account">
            Your membership card
          </Link>
          {me.admin && (
            <a role="menuitem" className="ui-menu__item ui-narrow" href="/admin">
              Back office
            </a>
          )}
          <MenuSep />
          <button type="button" role="menuitem" className="ui-menu__item" onClick={signOut}>
            Sign out
          </button>
        </>
      }
      after={
        error && (
          <div className="ui-menu__error ui-line ui-line--bad" role="alert">
            <p>
              <b>Couldn't sign out.</b> {error}
            </p>
          </div>
        )
      }
    />
  );
}

// The name on the menu's button: in full, ending in an ellipsis if it must, and only
// the first name under 360px (ui.css .ui-item__rest).
function PersonName({ name }) {
  const at = name.indexOf(' ');
  if (at < 1) return <span className="ui-item__t">{name}</span>;
  return (
    <span className="ui-item__t">
      {name.slice(0, at)}
      <span className="ui-item__rest">{name.slice(at)}</span>
    </span>
  );
}

export const useSite = () => useContext(SiteContext);
