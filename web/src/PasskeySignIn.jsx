import { useState } from 'react';
import { api, formatDay } from './api.js';
import { browserProblem, serverProblem, signInWithPasskey, supportsPasskeys, useCeremonyOptions } from './passkeys.js';
import { useSite } from './site.jsx';

const fetchSignInOptions = () => api.post('/api/signin/options');

// One button that signs this browser in with a passkey. Used by the sign-in page and
// a ticket for one person, and later by the keep panel. onSignedIn gets the server's
// answer: { person, newPasskeys }. copyLabel names what Copy link copies.
export default function PasskeySignIn({ onSignedIn, copyLabel }) {
  const [supported] = useState(supportsPasskeys);
  if (!supported) return <OpenInBrowser copyLabel={copyLabel} />;
  return <SignInButton onSignedIn={onSignedIn} />;
}

// Passkeys added since the one that just signed in was last used. The server says
// so once, so every page that signs someone in shows them before moving on.
export function NewPasskeys({ passkeys }) {
  const { site } = useSite();
  const host = `whoever runs ${site?.cinemaName || 'this cinema'}`;
  return (passkeys || []).map((k) => (
    <div key={`${k.addedAt}-${k.device}`} className="notice warn">
      A passkey was added on {formatDay(k.addedAt)}
      {k.device ? ` from ${k.device}` : ''}. Not you? Tell {host}.
    </div>
  ));
}

function SignInButton({ onSignedIn }) {
  const { site } = useSite();
  const [done, setDone] = useState(false);
  const ceremony = useCeremonyOptions(fetchSignInOptions, { enabled: !done });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const options = ceremony.data?.options;

  // Synchronous up to the browser call: Safari only offers passkeys during a tap.
  function signIn() {
    if (!options || busy) return;
    setMessage(null);
    setBusy(true);
    let answered = false;
    signInWithPasskey(options)
      .then((credential) => {
        answered = true;
        return api.post('/api/signin/finish', { credential });
      })
      .then((result) => {
        setDone(true);
        onSignedIn(result);
      })
      .catch((err) => {
        if (answered) {
          // The server took this challenge whatever happened: the next try needs a new one.
          ceremony.reload({ spent: true });
          setMessage(serverProblem(err, site?.cinemaName));
        } else {
          setMessage(browserProblem(err));
        }
      })
      .finally(() => setBusy(false));
  }

  if (done) return null;
  const fetchError = !options && ceremony.error && serverProblem(ceremony.error, site?.cinemaName);

  return (
    <div className="passkey">
      {(message || fetchError) && <div className="notice bad">{message || fetchError}</div>}
      <div className="row">
        <button className="btn primary big" onClick={signIn} disabled={!options || busy || ceremony.spent}>
          {busy ? 'Signing in…' : 'Sign in with a passkey'}
        </button>
        {fetchError && !ceremony.loading && (
          <button className="btn" onClick={ceremony.reload}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

// Where passkeys can't work (no WebAuthn, or an app's built-in browser): send
// people to a real browser with this exact address, fragment included.
export function OpenInBrowser({ copyLabel = 'Copy link' }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const href = window.location.href;
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      window.prompt('Copy this link:', href);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="notice warn">
      <p style={{ marginBottom: '0.4em' }}>
        <strong>Open this in Safari or Chrome</strong>
      </p>
      <p className="dim">This browser can't use passkeys. Copy the link, then paste it into Safari or Chrome. In an app, its menu may offer “Open in browser”.</p>
      <button className="btn" onClick={copy}>
        {copied ? 'Copied' : copyLabel}
      </button>
    </div>
  );
}
