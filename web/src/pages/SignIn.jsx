import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatDay } from '../api.js';
import PasskeySignIn from '../PasskeySignIn.jsx';
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

// /signin: one button. Nobody signs up here; accounts are made by whoever runs the cinema.
export default function SignIn() {
  const { me, site, refresh } = useSite();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const [result, setResult] = useState(null);
  const host = `whoever runs ${site?.cinemaName || 'this cinema'}`;

  async function signedIn(r) {
    setResult(r);
    await refresh();
    // Passkeys added since this one was last used are shown once before moving on.
    if (!r.newPasskeys?.length) navigate(next, { replace: true });
  }

  if (!me) return null;

  if (result?.newPasskeys?.length) {
    return (
      <div className="narrow" style={{ paddingTop: '15vh' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Signed in as {result.person.name}</h1>
        {result.newPasskeys.map((k) => (
          <div key={`${k.addedAt}-${k.device}`} className="notice warn">
            A passkey was added on {formatDay(k.addedAt)}
            {k.device ? ` from ${k.device}` : ''}. Not you? Tell {host}.
          </div>
        ))}
        <button className="btn primary" onClick={() => navigate(next, { replace: true })}>
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
        <Link to={next} className="btn primary">
          Continue
        </Link>
      </div>
    );
  }

  return (
    <div className="narrow" style={{ paddingTop: '15vh' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1.2rem' }}>Sign in</h1>
      <PasskeySignIn onSignedIn={signedIn} />
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
