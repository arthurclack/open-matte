import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useMatch } from 'react-router-dom';
import { api, formatTime, plural } from '../api.js';
import { InkFilters, ShopName } from '../look/objects.jsx';
import { BusyButton, Line, TabRow } from '../look/ui.jsx';
import { embeddedSite } from '../site.jsx';
import Activity from './Activity.jsx';
import FilmDetail from './FilmDetail.jsx';
import Films from './Films.jsx';
import People from './People.jsx';
import PersonDetail from './PersonDetail.jsx';
import Responses from './Responses.jsx';
import Settings from './Settings.jsx';
import { serverTrouble } from './facts.js';
import { responsesTab } from './loanWords.js';
import Status, { AttentionStrip } from './Status.jsx';
import TicketDetail from './TicketDetail.jsx';
import Tickets from './Tickets.jsx';
import { AdminContext } from './ui.jsx';
// The back office's own stylesheet, after the shared ones (main.jsx).
import '../look/office.css';

// How long a reading of the booth is shown before the next screen reads it again.
const BOOTH_FRESH_MS = 60_000;

export default function AdminApp() {
  const [state, setState] = useState('checking'); // checking | in | out
  const [signOutError, setSignOutError] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  // The shop's name and logo, for the brand, as the server wrote them into the page.
  // A page that saves them (Settings) passes the new ones to setSite.
  const [site, setSite] = useState(embeddedSite);
  // The films, the responses and the booth: the status line at the foot, the attention
  // strip on Films, the Responses tab's unread count and the still 12:00 on Status read
  // them here. The films and the responses are read again on each screen; the booth's
  // checks (the media folder, free space, the backup's copy) only when the last reading
  // is a minute old, or when asked.
  const [facts, setFacts] = useState({ films: null, booth: null, responses: null });
  const boothAt = useRef(0);
  const { pathname } = useLocation();
  // A film's own page is part of Films, so Films stays lit there.
  const onShelf = useMatch('/admin');
  const onFilm = useMatch('/admin/films/:id');
  const onFilms = Boolean(onShelf || onFilm);

  useEffect(() => {
    document.title = `Back office · ${site?.cinemaName || 'Open Matte'}`;
  }, [site?.cinemaName]);

  useEffect(() => {
    api
      .get('/api/admin/session')
      .then(() => setState('in'))
      .catch(() => setState('out'));
  }, []);

  const signedOut = useCallback(() => setState('out'), []);

  // Each part on its own: a booth that can't be read leaves the films' counts showing.
  // refreshFacts() reads the films and the responses, and the booth if its reading is a
  // minute old; refreshFacts('now') reads all three; refreshFacts(false) leaves the
  // booth; and
  // refreshFacts(booth) takes a booth a page has just read itself (Status).
  const refreshFacts = useCallback(
    (booth) => {
      if (booth && typeof booth === 'object') {
        boothAt.current = Date.now();
        setFacts((f) => ({ ...f, booth }));
        return;
      }
      const read = (url, key) =>
        api.get(url).then(
          (data) => setFacts((f) => ({ ...f, [key]: data })),
          (err) => {
            if (key === 'booth') boothAt.current = 0;
            if (err.status === 401) signedOut();
          },
        );
      read('/api/admin/films', 'films');
      read('/api/admin/responses', 'responses');
      if (booth === 'now' || (booth !== false && Date.now() - boothAt.current >= BOOTH_FRESH_MS)) {
        boothAt.current = Date.now();
        read('/api/admin/booth', 'booth');
      }
    },
    [signedOut],
  );
  // On each screen. Status reads the booth itself, and hands it over.
  const onStatus = Boolean(useMatch('/admin/status'));
  useEffect(() => {
    if (state === 'in') refreshFacts(onStatus ? false : undefined);
  }, [state, pathname, onStatus, refreshFacts]);

  const ctx = useMemo(() => ({ signedOut, site, setSite, facts, refreshFacts }), [signedOut, site, facts, refreshFacts]);

  const unread = facts.responses?.unread ?? 0;

  if (state === 'checking') return null;
  if (state === 'out') return <Login site={site} onSignedIn={() => setState('in')} />;

  // The back office only looks signed out once the server has ended the session. If
  // it never heard, the cookie still works: on a borrowed computer, the next person
  // to open the back office would be in.
  // A BusyButton while it asks (question 20): a second press sends nothing.
  async function signOut() {
    setSignOutError(null);
    setSigningOut(true);
    try {
      await api.post('/api/admin/logout');
    } catch {
      setSignOutError('Check your connection and try again.');
      setSigningOut(false);
      return;
    }
    setSigningOut(false);
    setState('out');
  }

  return (
    <AdminContext.Provider value={ctx}>
      <InkFilters />
      <div className="ui-office admin">
        <nav className="ui-office__nav" aria-label="Back office">
          <Link to="/admin" className="ui-office__brand">
            <ShopName site={{ ...site, logo: null }} />
            <span className="ui-office__brand-k">Back office</span>
          </Link>
          <TabRow watch={pathname}>
            <Link to="/admin" className="ui-tab" aria-current={onFilms ? 'page' : undefined}>
              Films
            </Link>
            <NavLink to="/admin/tickets" className="ui-tab">
              Tapes
            </NavLink>
            <NavLink to="/admin/people" className="ui-tab">
              Members
            </NavLink>
            <NavLink to="/admin/responses" className="ui-tab" aria-label={unread ? responsesTab(unread) : undefined}>
              Responses
              {unread ? <span className="ui-tab__n">{unread}</span> : null}
            </NavLink>
            <NavLink to="/admin/activity" className="ui-tab">
              Ledger
            </NavLink>
            <NavLink to="/admin/status" className="ui-tab">
              Status
            </NavLink>
            <NavLink to="/admin/settings" className="ui-tab">
              Settings
            </NavLink>
          </TabRow>
          <div className="ui-office__foot">
            <a className="ui-nav__item" href="/">
              View the shop
            </a>
            <BusyButton type="button" className="ui-nav__item" onClick={signOut} busy={signingOut} busyText="Signing out…">
              Sign out
            </BusyButton>
          </div>
        </nav>
        <main className="ui-office__main ui-raster admin-main" id="main">
          <div className="ui-office__page">
            {signOutError && (
              <Line kind="bad" lead="Couldn't sign out." role="alert">
                {signOutError}
              </Line>
            )}
            <Routes>
              {/* The first page starts with what needs attention, if anything does. */}
              <Route
                index
                element={
                  <Films>
                    <AttentionStrip />
                  </Films>
                }
              />
              <Route path="films/:id" element={<FilmDetail />} />
              <Route path="tickets" element={<Tickets />} />
              <Route path="tickets/:id" element={<TicketDetail />} />
              <Route path="people" element={<People />} />
              <Route path="people/:id" element={<PersonDetail />} />
              <Route path="responses" element={<Responses />} />
              <Route path="activity" element={<Activity />} />
              <Route path="status" element={<Status />} />
              <Route path="settings" element={<Settings />} />
            </Routes>
          </div>
          <StatusLine facts={facts} />
        </main>
      </div>
    </AdminContext.Provider>
  );
}

// The foot of every screen: how many films, how many on the shelf, how many tapes out,
// and whether the server is well, as the booth last said and when.
function StatusLine({ facts: { films, booth } }) {
  if (!films && !booth) return null;
  const trouble = booth ? serverTrouble(booth.server) : 0;
  return (
    <p className="ui-status">
      {films && (
        <>
          <span>
            <b>{films.length}</b> {films.length === 1 ? 'film' : 'films'}
          </span>
          <span>
            <b>{films.filter((f) => f.published).length}</b> on the shelf
          </span>
        </>
      )}
      {booth?.attention?.tapes && (
        <span>
          <b>{booth.attention.tapes.out}</b> {booth.attention.tapes.out === 1 ? 'tape out' : 'tapes out'}
        </span>
      )}
      {booth &&
        (trouble ? (
          <span>
            {plural(trouble, 'thing')} on the server to look at: <Link to="/admin/status">Status</Link>
          </span>
        ) : (
          <span>Server well, checked {formatTime(booth.checkedAt)}</span>
        ))}
    </p>
  );
}

function Login({ site, onSignedIn }) {
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
          ? { lead: 'That password is not right.', wrong: true }
          : err.status === 429
            ? { lead: 'Too many attempts.', text: 'Wait a few minutes and try again.' }
            : { lead: "Couldn't sign in just now.", text: 'Check your connection and try again in a moment.' },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-login ui-raster">
      <InkFilters />
      <div className="admin-login__box">
        <div className="ui-office__brand admin-login__brand">
          <ShopName site={{ ...site, logo: null }} />
          <span className="ui-office__brand-k">Back office</span>
        </div>
        <h1>Sign in to the back office</h1>
        <form onSubmit={submit}>
          {error && (
            <Line kind="bad" role="alert" lead={error.lead}>
              {error.text}
            </Line>
          )}
          <div className="ui-field">
            <label className="ui-field__label" htmlFor="admin-password">
              Back office password
            </label>
            <input
              id="admin-password"
              className="ui-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              aria-invalid={error?.wrong || undefined}
            />
          </div>
          <BusyButton className="ui-btn ui-btn--primary ui-btn--wide" busy={busy} busyText="Signing in…" disabled={!password}>
            Sign in
          </BusyButton>
        </form>
      </div>
    </main>
  );
}
