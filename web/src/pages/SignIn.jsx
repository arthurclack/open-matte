import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import PasskeySignIn, { NewPasskeys } from '../PasskeySignIn.jsx';
import { useSite } from '../site.jsx';

// Only a path on this site: one leading slash, not // or /\ (another site), and no
// control characters, which URL parsing drops (so /<tab>/evil.example would be //evil.example).
const safeNext = (next) => {
  if (typeof next !== 'string' || !/^\/(?![/\\])/.test(next) || /[\u0000-\u001f\u007f]/.test(next)) return '/';
  try {
    return new URL(next, window.location.origin).origin === window.location.origin ? next : '/';
  } catch {
    return '/';
  }
};

// The admin is loaded as a page of its own, never moved to within a viewer's page: a page
// keeps the Content-Security-Policy it came with, and only the admin's allows TMDB's
// thumbnails (server/app.js, sendPage).
const ownPage = (next) => /^\/admin(\/|$|\?|#)/i.test(next);

// /signin: one button. Nobody signs up here; accounts are made by whoever runs the cinema.
export default function SignIn() {
  const { me, site, refresh } = useSite();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const [result, setResult] = useState(null);
  const host = `whoever runs ${site?.cinemaName || 'this cinema'}`;
  const go = () => (ownPage(next) ? window.location.replace(next) : navigate(next, { replace: true }));

  async function signedIn(r) {
    setResult(r);
    await refresh();
    // Passkeys added since this one was last used are shown once before moving on.
    if (!r.newPasskeys?.length) go();
  }

  if (!me) return null;

  if (result?.newPasskeys?.length) {
    return (
      <div className="narrow" style={{ paddingTop: '15vh' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Signed in as {result.person.name}</h1>
        <NewPasskeys passkeys={result.newPasskeys} />
        <button className="btn primary" onClick={go}>
          Continue
        </button>
      </div>
    );
  }

  if (result) return null; // signed in; on the way to `next`

  if (me.person) {
    return (
      <div className="narrow" style={{ paddingTop: '15vh' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.8rem' }}>Signed in</h1>
        <p className="dim">You're signed in as {me.person.name}.</p>
        <Link to={next} reloadDocument={ownPage(next)} className="btn primary">
          Continue
        </Link>
      </div>
    );
  }

  return (
    <div className="narrow" style={{ paddingTop: '15vh' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1.2rem' }}>Sign in</h1>
      <PasskeySignIn onSignedIn={signedIn} copyLabel="Copy link" />
      <div className="dim" style={{ marginTop: '2rem', fontSize: '0.92rem' }}>
        <p>
          <strong>No account?</strong> Accounts here are set up by {host}. You don't need one to watch: open the ticket link you were sent.
        </p>
        <p>
          <strong>No passkey found?</strong> If your passkey is on another phone or computer, choose “Use a phone or tablet”. Lost it? Ask {host}.
        </p>
      </div>
    </div>
  );
}
