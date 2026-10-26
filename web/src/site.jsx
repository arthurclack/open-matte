import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api.js';

const SiteContext = createContext(null);

// The viewer-facing shell: the cinema's name, what this browser holds, and
// a header and footer around every page.
export function SiteProvider({ children }) {
  const [me, setMe] = useState(null);
  const refresh = useCallback(() => api.get('/api/me').then(setMe).catch(() => setMe({ site: null, tickets: [] })), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const site = me?.site;
  useEffect(() => {
    if (site?.cinemaName) document.title = site.cinemaName;
  }, [site?.cinemaName]);

  return (
    <SiteContext.Provider value={{ me, site, refresh }}>
      <div className="site">
        <header className="site-header">
          <Link to="/" className="site-name">
            {site?.cinemaName || ' '}
          </Link>
          {me?.admin && (
            <a className="btn small" href="/admin">
              Admin
            </a>
          )}
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

export const useSite = () => useContext(SiteContext);
