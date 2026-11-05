import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatAgo, formatDay, formatDayTime } from '../api.js';
import { enrollLink } from '../enrollLink.js';
import MembershipCard from '../MembershipCard.jsx';
import { confirmSignOut, useSite } from '../site.jsx';

const Page = ({ children }) => <div className="narrow account">{children}</div>;

// /account: the signed-in person's membership card, their passkeys and the browsers
// signed in as them, with Sign out and Sign out everywhere. Adding or removing passkeys is for
// whoever runs the cinema, so nothing here changes them.
export default function Account() {
  const { me, site, refresh, signOut } = useSite();
  const navigate = useNavigate();
  const [data, setData] = useState(undefined); // undefined = loading, null = not signed in
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const host = `whoever runs ${site?.cinemaName || 'this cinema'}`;

  const load = useCallback(
    () =>
      api
        .get('/api/account')
        .then(setData)
        .catch((err) => (err.status === 401 ? setData(null) : setError("Couldn't load your account. Try again in a moment."))),
    [],
  );
  // Again whenever who is signed in here changes (signing out from the menu, say).
  const person = me?.person?.name;
  useEffect(() => {
    load();
  }, [load, person]);

  useEffect(() => {
    if (site?.cinemaName) document.title = `Your account · ${site.cinemaName}`;
  }, [site?.cinemaName]);

  async function signOutHere() {
    if (!confirmSignOut(me)) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await signOut())) setError("Couldn't sign out. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signOutEverywhere() {
    const forgets = me?.linkTickets?.length ? ' This browser also forgets the tickets you opened from links here; the links still work.' : '';
    if (!window.confirm(`Every browser signed in as you is signed out, this one included, and playback stops on them. Your passkeys still work.${forgets}`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/account/sign-out-everywhere');
      // As signing out does (site.jsx).
      enrollLink.forget();
      await refresh();
      navigate('/');
    } catch {
      setError("Couldn't sign out everywhere. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (data === undefined) return error ? <Page><div className="notice bad">{error}</div></Page> : null;
  if (data === null) {
    return (
      <Page>
        <h1>Your account</h1>
        <p className="dim">Sign in to see your passkeys and where you're signed in.</p>
        <Link to="/signin?next=%2Faccount" className="btn primary">
          Sign in
        </Link>
      </Page>
    );
  }

  const others = data.browsers.filter((b) => !b.current).length;
  // The server lists this browser first, then the rest from the most recently seen.
  // Two that would read the same, such as two Safaris on one Mac signed in on the
  // same day, also say what time each signed in.
  const device = (b) => b.device || 'A browser';
  const sameDay = (a, b) => device(a) === device(b) && formatDay(a.signedInAt) === formatDay(b.signedInAt);
  const signedIn = (b) => (data.browsers.some((o) => o !== b && sameDay(o, b)) ? formatDayTime(b.signedInAt) : formatDay(b.signedInAt));

  return (
    <Page>
      <h1>{data.person.name}</h1>
      <p className="dim">Your account at {site?.cinemaName || 'this cinema'}. Your tickets are on the front page.</p>
      {error && <div className="notice bad">{error}</div>}

      {data.membership && (
        <section className="account-card" aria-labelledby="your-card">
          <h2 id="your-card">Your membership card</h2>
          <MembershipCard site={site} name={data.person.name} membership={data.membership} />
        </section>
      )}

      <h2>Passkeys</h2>
      <p className="dim">
        You sign in with these. Your phone, computer or password manager keeps each one and unlocks it with Face ID, a fingerprint or your screen lock.
      </p>
      <ul className="account-list">
        {data.passkeys.map((k) => (
          <li key={k.addedAt}>
            <div>
              <strong>{k.synced ? 'Synced' : 'This device only'}</strong>
              {k.current && <span className="badge" style={{ marginLeft: 8 }}>Signed in here with this</span>}
            </div>
            <div className="dim">
              Added {formatDay(k.addedAt)}
              {k.addedFrom ? ` from ${k.addedFrom}` : ''}
              {k.viaLink === 'recovery' ? ', with a recovery link' : k.viaLink === 'setup' ? ', with your setup link' : ''}
              {k.lastUsedAt ? `. Last used ${formatAgo(k.lastUsedAt)}.` : '.'}
            </div>
          </li>
        ))}
      </ul>
      <p className="dim" style={{ fontSize: '0.875rem' }}>
        Synced passkeys are on every device signed in to the same Apple ID, Google account or password manager. On a new computer, you can also sign in
        with the passkey on your phone: choose “Use a phone or tablet”. To add a passkey or remove a lost one, ask {host}.
      </p>

      <h2>Signed in on</h2>
      <ul className="account-list">
        {data.browsers.map((b) => (
          <li key={`${b.signedInAt}-${b.device}`}>
            <div>
              <strong>{device(b)}</strong>
              {b.current && <span className="badge good" style={{ marginLeft: 8 }}>This browser</span>}
            </div>
            <div className="dim">
              Signed in {signedIn(b)}. Last seen {formatAgo(b.lastSeenAt)}.
            </div>
          </li>
        ))}
      </ul>

      <div className="row" style={{ marginTop: '1.5rem' }}>
        <button className="btn" onClick={signOutHere} disabled={busy}>
          Sign out
        </button>
        <button className="btn" onClick={signOutEverywhere} disabled={busy}>
          Sign out everywhere
        </button>
      </div>
      <p className="dim" style={{ fontSize: '0.875rem', marginTop: '0.8rem' }}>
        {others
          ? `Sign out everywhere also signs out the ${others === 1 ? 'other browser' : `${others} other browsers`} above. Don't recognise one? Sign out everywhere, then tell ${host}.`
          : `Don't recognise a passkey? Tell ${host}.`}
      </p>
    </Page>
  );
}
