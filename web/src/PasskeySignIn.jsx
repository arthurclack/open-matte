import { useState } from 'react';
import { api, formatDay } from './api.js';
import { anotherBrowserMayHelp, browserProblem, serverProblem, signInWithPasskey, supportsPasskeys, useCeremonyOptions } from './passkeys.js';
import { useSite } from './site.jsx';

const fetchSignInOptions = () => api.post('/api/signin/options');

// One button that signs this browser in with a passkey. Used by the sign-in page, a
// ticket for one person and the keep panel on a film's page. onSignedIn gets the server's
// answer: { person, newPasskeys }. copyLabel names what Copy link copies: this page's
// address. Leave it out where that address is no use in another browser (a film page,
// which a link ticket's code has already left): after a refusal, people are then told
// to open the link they were sent.
export default function PasskeySignIn({ onSignedIn, copyLabel }) {
  const [supported] = useState(supportsPasskeys);
  if (!supported) return <OpenInBrowser copyLabel={copyLabel} />;
  return <SignInButton onSignedIn={onSignedIn} copyLabel={copyLabel} />;
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

function SignInButton({ onSignedIn, copyLabel }) {
  const { site } = useSite();
  const [done, setDone] = useState(false);
  const ceremony = useCeremonyOptions(fetchSignInOptions, { enabled: !done });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  // The browser itself said no: it may be an app's built-in browser that looked as if
  // it could use passkeys (see OpenInBrowser).
  const [refusedHere, setRefusedHere] = useState(false);
  const options = ceremony.data?.options;

  // Synchronous up to the browser call: Safari only offers passkeys during a tap.
  function signIn() {
    if (!options || busy) return;
    setMessage(null);
    setRefusedHere(false);
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
          setRefusedHere(anotherBrowserMayHelp(err));
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
      {refusedHere &&
        (copyLabel ? (
          <OpenInBrowser copyLabel={copyLabel} refused />
        ) : (
          <p className="dim">Inside an app? Its browser may not be able to use passkeys: open the link you were sent in Safari or Chrome, and sign in there.</p>
        ))}
    </div>
  );
}

// Where passkeys can't work (no WebAuthn, or an app's built-in browser): send
// people to a real browser with this exact address, fragment included. `link` is
// what to copy when the address no longer holds it (a setup link, once its token
// has been read); then an app's "Open in browser" wouldn't carry it either. `refused`:
// the browser looked as if it could use passkeys and then said no, which a person
// cancelling also does, so the words allow for that.
export function OpenInBrowser({ copyLabel = 'Copy link', link, refused = false }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const href = link ?? window.location.href;
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
        <strong>{refused ? 'Inside an app? Open this in Safari or Chrome' : 'Open this in Safari or Chrome'}</strong>
      </p>
      <p className="dim">
        {refused ? "The browsers built into apps often can't use passkeys." : "This browser can't use passkeys."} Copy the link, then paste it into Safari or
        Chrome.{link ? '' : ' In an app, its menu may offer “Open in browser”.'}
      </p>
      <button className="btn" onClick={copy}>
        {copied ? 'Copied' : copyLabel}
      </button>
    </div>
  );
}
