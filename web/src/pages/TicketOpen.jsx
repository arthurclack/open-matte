import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import PasskeySignIn, { NewPasskeys } from '../PasskeySignIn.jsx';
import { supportsPasskeys } from '../passkeys.js';
import { BusyButton, Line } from '../look/ui.jsx';
import { hostName } from '../look/words.js';
import { confirmSignOut, useSite } from '../site.jsx';
import { NarrowPage } from './tape.jsx';
import { UNREACHABLE } from './tapeWords.js';

// /t/<code>: trade the tape's code for a session, then move to the film's
// clean URL so the code leaves the address bar and this tab's Back and Forward.
// The browser's own history list still has the link as it was opened.
// A tape for one member is different: it needs that member signed in, and its
// code stays in the address until they are, so "Open in Safari" from an app's
// built-in browser still carries it. Anyone else learns nothing from it: not the
// film, not the name.
export default function TicketOpen() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { me, site, refresh, signOut } = useSite();
  const started = useRef(false);
  // opening | unreachable (offline, or mid-restart: the tape may be fine) |
  // sign-in (a tape for one member, not signed in) | someone-else | signed-in
  const [view, setView] = useState('opening');
  // Shown once after signing in here, as the sign-in page does.
  const [newPasskeys, setNewPasskeys] = useState(null);
  const pendingNotices = useRef(false);
  const [slug, setSlug] = useState(null);
  const [signOutError, setSignOutError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [canUsePasskeys] = useState(supportsPasskeys);

  const open = useCallback(() => {
    setView('opening');
    api
      .post('/api/tickets/open', { code })
      .then(({ slug }) => {
        refresh();
        // New passkeys are reported before moving on; the code goes with Continue.
        if (pendingNotices.current) {
          setSlug(slug);
          return setView('signed-in');
        }
        navigate(`/${slug}`, { replace: true });
      })
      .catch((err) => {
        if (!err.status || err.status >= 500) return setView('unreachable');
        if (err.code === 'sign-in-required') return setView('sign-in');
        if (err.code === 'ticket-for-someone-else') return setView('someone-else');
        navigate(`/?notice=${encodeURIComponent(err.code || 'unknown-ticket')}`, { replace: true });
      });
  }, [code, navigate, refresh]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    open();
  }, [open]);

  // Signed in with a passkey: open the tape again, now as this member.
  async function signedIn(result) {
    const added = result.newPasskeys?.length ? result.newPasskeys : null;
    pendingNotices.current = Boolean(added);
    setNewPasskeys(added);
    await refresh();
    open();
  }

  // Stay here: once signed out, the sign-in button takes over.
  async function signOutHere() {
    if (!(await confirmSignOut(refresh))) return;
    setBusy(true);
    setSignOutError(null);
    try {
      if (await signOut({ to: null })) setView('sign-in');
      else setSignOutError(true);
    } finally {
      setBusy(false);
    }
  }

  if (view === 'sign-in') {
    return (
      <div className="fl-signin ui-w">
        <div className="fl-signin__head">
          <h1>Show your card</h1>
          <p>This tape is for one member. If it's for you, sign in with your passkey to open it.</p>
        </div>
        <div className="fl-signin__card">
          <PasskeySignIn onSignedIn={signedIn} copyLabel="Copy link" card />
        </div>
        {canUsePasskeys && (
          <div className="fl-help-lines fl-signin__act">
            <p>
              <b>Your passkey is on another phone?</b> When your browser asks, choose “Use a phone or tablet”, then scan the code it shows with that phone.
            </p>
            <p>
              <b>Lost a phone, or had it stolen?</b> Ask {hostName(site)}: they'll take back your keys and send you a link to make a new one.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (view === 'someone-else') {
    return (
      <NarrowPage>
        <NewPasskeys passkeys={newPasskeys} />
        <h1>This tape is for someone else</h1>
        <p>
          {me?.person ? `You're signed in as ${me.person.name}.` : "You're signed in as someone else."} If it was sent to you, sign out, then sign in with
          your own passkey.
        </p>
        {signOutError && (
          <Line kind="bad" lead="Couldn't sign out." role="alert">
            Check your connection and try again.
          </Line>
        )}
        <div className="ui-btns">
          <BusyButton type="button" className="ui-btn ui-btn--primary" onClick={signOutHere} busy={busy} busyText="Signing out…">
            {busy ? 'Signing out…' : 'Sign out'}
          </BusyButton>
        </div>
      </NarrowPage>
    );
  }

  if (view === 'signed-in') {
    return (
      <NarrowPage>
        <h1>Signed in as {me?.person?.name}</h1>
        <NewPasskeys passkeys={newPasskeys} />
        <div className="ui-btns">
          <button type="button" className="ui-btn ui-btn--primary" onClick={() => navigate(`/${slug}`, { replace: true })}>
            Continue
          </button>
        </div>
      </NarrowPage>
    );
  }

  return (
    <NarrowPage>
      {view === 'unreachable' ? (
        <>
          <Line kind="bad" lead={UNREACHABLE.lead}>
            {UNREACHABLE.text}
          </Line>
          <div className="ui-btns">
            <button type="button" className="ui-btn ui-btn--primary" onClick={open}>
              Try again
            </button>
          </div>
        </>
      ) : (
        <p role="status">Opening your tape…</p>
      )}
    </NarrowPage>
  );
}
