import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatAgo, formatDay, formatDayTime } from '../api.js';
import { enrollLink } from '../enrollLink.js';
import { Line } from '../look/ui.jsx';
import { hostName } from '../look/words.js';
import MembershipCard from '../MembershipCard.jsx';
import { confirmSignOut, useSite } from '../site.jsx';
import { NarrowPage } from './tape.jsx';

// What kind of key each is, which the person can't see from here.
const KIND = {
  synced: "Saved to your Apple Account, Google account or password manager, so it's on every device signed in to that.",
  device: "Kept by the one phone, computer or security key that made it. If that's lost, this key goes with it.",
};

// /account: the signed-in member's membership card, the keys to it (their passkeys) and
// the browsers signed in as them, with Sign out and Sign out everywhere. Adding or taking
// back keys is for whoever runs the shop, so nothing here changes them.
export default function Account() {
  const { me, site, refresh, signOut } = useSite();
  const navigate = useNavigate();
  const [data, setData] = useState(undefined); // undefined = loading, null = not signed in
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const host = hostName(site);

  const load = useCallback(
    () =>
      api
        .get('/api/account')
        .then(setData)
        .catch((err) => (err.status === 401 ? setData(null) : setError({ lead: "Couldn't load your card.", text: 'Try again in a moment.' }))),
    [],
  );
  // Again whenever who is signed in here changes (signing out from the menu, say).
  const person = me?.person?.name;
  useEffect(() => {
    load();
  }, [load, person]);

  useEffect(() => {
    if (site?.cinemaName) document.title = `Your membership card · ${site.cinemaName}`;
  }, [site?.cinemaName]);

  async function signOutHere() {
    if (!(await confirmSignOut(refresh))) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await signOut())) setError({ lead: "Couldn't sign out.", text: 'Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  async function signOutEverywhere() {
    if (!(await confirmSignOut(refresh, { everywhere: true }))) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/account/sign-out-everywhere');
      // As signing out does (site.jsx).
      enrollLink.forget();
      await refresh();
      navigate('/');
    } catch {
      setError({ lead: "Couldn't sign out everywhere.", text: 'Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  const problem = error && (
    <Line kind="bad" lead={error.lead} role="alert">
      {error.text}
    </Line>
  );
  if (data === undefined) return error ? <NarrowPage>{problem}</NarrowPage> : null;
  if (data === null) {
    return (
      <NarrowPage>
        <h1>Your membership card</h1>
        <p>Sign in to see your card and where you're signed in.</p>
        <div className="ui-btns">
          <Link to="/signin?next=%2Faccount" className="ui-btn ui-btn--primary">
            Sign in
          </Link>
        </div>
      </NarrowPage>
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
    <div className="fl-account ui-w">
      <h1>Your membership card</h1>
      {problem}
      <div className="fl-account__grid">
        {data.membership && (
          <div className="fl-account__card">
            <MembershipCard site={site} name={data.person.name} membership={data.membership} />
          </div>
        )}
        <div className="fl-account__main">
          <h2>Keys to your card</h2>
          <p className="fl-account__intro">Your card opens with these passkeys.</p>
          <ul className="fl-list">
            {data.passkeys.map((k) => (
              <li key={k.addedAt}>
                <div className="fl-list__row">
                  <b>{k.synced ? 'Synced' : 'This device only'}</b>
                  {k.current && <span className="badge">Used to sign in here</span>}
                </div>
                <p className="fl-list__kind">{k.synced ? KIND.synced : KIND.device}</p>
                <p className="fl-list__meta">
                  Added {formatDay(k.addedAt)}
                  {k.addedFrom ? ` from ${k.addedFrom}` : ''}
                  {k.viaLink === 'recovery' ? ', with a recovery link' : k.viaLink === 'setup' ? ', with your setup link' : ''}
                  {k.lastUsedAt ? `. Last used ${formatAgo(k.lastUsedAt)}.` : '.'}
                </p>
              </li>
            ))}
          </ul>
          <p className="fl-list__meta">On a new computer, you can also sign in with the passkey on your phone: choose “Use a phone or tablet”.</p>

          <h2>Signed in on</h2>
          <ul className="fl-list">
            {data.browsers.map((b) => (
              <li key={`${b.signedInAt}-${b.device}`}>
                <div className="fl-list__row">
                  <b>{device(b)}</b>
                  {b.current && <span className="badge good">This browser</span>}
                </div>
                <p className="fl-list__meta">
                  Signed in {signedIn(b)}. Last seen {formatAgo(b.lastSeenAt)}.
                </p>
              </li>
            ))}
          </ul>

          <Line kind="info" className="fl-account__lost">
            <p>
              <b>Got a new phone?</b> If your passkey is synced, it's already on it; if not, ask {host} for a link. <b>Lost a phone, or had it stolen?</b>{' '}
              Ask {host}: they'll take back your keys and send you a link to make a new one.
            </p>
          </Line>

          <div className="ui-btns fl-account__out">
            <button type="button" className="ui-btn" onClick={signOutHere} disabled={busy}>
              Sign out
            </button>
            <button type="button" className="ui-btn" onClick={signOutEverywhere} disabled={busy}>
              Sign out everywhere
            </button>
          </div>
          <p className="fl-list__meta">
            {others
              ? `Sign out everywhere also signs out the ${others === 1 ? 'other browser' : `${others} other browsers`} above. Don't recognise one? Sign out everywhere, then tell ${host}.`
              : `Don't recognise a passkey? Tell ${host}.`}
          </p>
        </div>
      </div>
    </div>
  );
}
