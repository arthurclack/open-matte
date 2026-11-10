import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { hostName } from '../look/words.js';
import PasskeySignIn, { NewPasskeys } from '../PasskeySignIn.jsx';
import { useSite } from '../site.jsx';
import { NarrowPage } from './tape.jsx';

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

// /signin: "Show your card", one button. Nobody signs up here: cards are given out by
// whoever runs the shop.
export default function SignIn() {
  const { me, site, refresh } = useSite();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const [result, setResult] = useState(null);
  const host = hostName(site);
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
      <NarrowPage>
        <h1>Signed in as {result.person.name}</h1>
        <NewPasskeys passkeys={result.newPasskeys} />
        <div className="ui-btns">
          <button type="button" className="ui-btn ui-btn--primary" onClick={go}>
            Continue
          </button>
        </div>
      </NarrowPage>
    );
  }

  if (result) return null; // signed in; on the way to `next`

  if (me.person) {
    return (
      <NarrowPage>
        <h1>Signed in</h1>
        <p>You're signed in as {me.person.name}.</p>
        <div className="ui-btns">
          <Link to={next} reloadDocument={ownPage(next)} className="ui-btn ui-btn--primary">
            Continue
          </Link>
        </div>
      </NarrowPage>
    );
  }

  return (
    <div className="fl-signin ui-w">
      <div className="fl-signin__head">
        <h1>Show your card</h1>
      </div>
      <div className="fl-signin__card">
        <PasskeySignIn onSignedIn={signedIn} copyLabel="Copy link" card />
      </div>
      <div className="fl-help-lines fl-signin__act">
        <p>
          <b>No membership card?</b> Cards here are given out by {host}. You don't need one to watch: open the tape link you were sent.
        </p>
        <p>
          <b>Your passkey is on another phone?</b> When your browser asks, choose “Use a phone or tablet”, then scan the code it shows with that phone.
        </p>
        <p>
          <b>Lost a phone, or had it stolen?</b> Ask {host}: they'll take back your keys and send you a link to make a new one.
        </p>
      </div>
    </div>
  );
}
