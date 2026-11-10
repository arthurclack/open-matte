import { useState } from 'react';
import { api, formatDay } from './api.js';
import { Line } from './look/ui.jsx';
import { hostName } from './look/words.js';
import MembershipCard from './MembershipCard.jsx';
import { anotherBrowserMayHelp, browserProblem, serverProblem, signInWithPasskey, supportsPasskeys, useCeremonyOptions } from './passkeys.js';
import { useSite } from './site.jsx';

// A message from passkeys.js as a system line: its first sentence in bold, so the
// colour is never the only sign. -> { lead, text }
export function splitLead(message) {
  const m = /^(.+?[.?!])\s+(.+)$/s.exec(String(message ?? ''));
  return m ? { lead: m[1], text: m[2] } : { lead: String(message ?? ''), text: null };
}
export function Problem({ message, kind = 'bad' }) {
  const { lead, text } = splitLead(message);
  return (
    <Line kind={kind} lead={lead} role="alert">
      {text}
    </Line>
  );
}

// A key, drawn plain, for the button that signs in with a passkey.
export function KeyMark() {
  return (
    <svg className="fl-key" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="6.5" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10.1 10H18M15 10v3M17.6 10v2.4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}

const fetchSignInOptions = () => api.post('/api/signin/options');

// One button that signs this browser in with a passkey. Used by the sign-in page, a
// tape for one member and the keep panel on a film's page. onSignedIn gets the server's
// answer: { person, newPasskeys }. copyLabel names what Copy link copies: this page's
// address. Leave it out where that address is no use in another browser (a film page,
// which a tape link's code has already left): after a refusal, people are then told
// to open the link they were sent. `card`: the membership card's front is the button
// ("Show your card"), with the words in a lit strip under it.
export default function PasskeySignIn({ onSignedIn, copyLabel, card = false }) {
  const [supported] = useState(supportsPasskeys);
  if (!supported) return <OpenInBrowser copyLabel={copyLabel} />;
  return <SignInButton onSignedIn={onSignedIn} copyLabel={copyLabel} card={card} />;
}

// Passkeys added since the one that just signed in was last used. The server says
// so once, so every page that signs someone in shows them before moving on.
export function NewPasskeys({ passkeys }) {
  const { site } = useSite();
  return (passkeys || []).map((k) => (
    <Line key={`${k.addedAt}-${k.device}`} kind="warn" lead={`A passkey was added on ${formatDay(k.addedAt)}${k.device ? ` from ${k.device}` : ''}.`}>
      Not you? Tell {hostName(site)}.
    </Line>
  ));
}

function SignInButton({ onSignedIn, copyLabel, card }) {
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
          setMessage(serverProblem(err, hostName(site)));
        } else {
          setMessage(browserProblem(err));
          setRefusedHere(anotherBrowserMayHelp(err));
        }
      })
      .finally(() => setBusy(false));
  }

  if (done) return null;
  const fetchError = !options && ceremony.error && serverProblem(ceremony.error, hostName(site));

  return (
    <div className="fl-passkey">
      {(message || fetchError) && <Problem message={message || fetchError} />}
      <div className="ui-btns">
        {card ? (
          <button type="button" className="fl-cardbtn" onClick={signIn} disabled={!options || busy || ceremony.spent}>
            {/* A picture of what the words say: the button's name is its words. */}
            <span className="fl-cardbtn__card" aria-hidden="true">
              <MembershipCard site={site} face="front" />
            </span>
            <span className="fl-cardbtn__label">
              <KeyMark />
              {busy ? 'Signing in…' : 'Sign in with a passkey'}
            </span>
          </button>
        ) : (
          <button type="button" className="ui-btn ui-btn--primary ui-btn--big" onClick={signIn} disabled={!options || busy || ceremony.spent}>
            <KeyMark />
            {busy ? 'Signing in…' : 'Sign in with a passkey'}
          </button>
        )}
        {fetchError && !ceremony.loading && (
          <button type="button" className="ui-btn" onClick={ceremony.reload}>
            Try again
          </button>
        )}
      </div>
      {refusedHere &&
        (copyLabel ? (
          <OpenInBrowser copyLabel={copyLabel} refused />
        ) : (
          <p className="fl-passkey__note">Inside an app? Its browser may not be able to use passkeys: open the link you were sent in Safari or Chrome, and sign in there.</p>
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
    <div className="fl-openin">
      <Line kind="warn" lead={refused ? 'Inside an app? Open this in Safari or Chrome' : 'Open this in Safari or Chrome'}>
        <p>
          {refused ? "The browsers built into apps often can't use passkeys." : "This browser can't use passkeys."} Copy the link, then paste it into Safari
          or Chrome.{link ? '' : ' In an app, its menu may offer “Open in browser”.'}
        </p>
        <div className="ui-btns">
          <button type="button" className="ui-btn" onClick={copy}>
            {copied ? 'Copied' : copyLabel}
          </button>
        </div>
      </Line>
    </div>
  );
}
