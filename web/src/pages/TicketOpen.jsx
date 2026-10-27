import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import PasskeySignIn, { NewPasskeys } from '../PasskeySignIn.jsx';
import { supportsPasskeys } from '../passkeys.js';
import { confirmSignOut, useSite } from '../site.jsx';

const Page = ({ children }) => (
  <div className="narrow" style={{ paddingTop: '15vh' }}>
    {children}
  </div>
);
const Title = ({ children }) => <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>{children}</h1>;

// /t/<code>: trade the ticket code for a session, then move to the film's
// clean URL so the code doesn't linger in the address bar or history.
// A ticket for one person is different: it needs that person signed in, and its
// code stays in the address until they are, so "Open in Safari" from an app's
// built-in browser still carries it. Anyone else learns nothing from it.
export default function TicketOpen() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { me, site, refresh, signOut } = useSite();
  const started = useRef(false);
  // opening | unreachable (offline, or mid-restart: the ticket may be fine) |
  // sign-in (a ticket for one person, not signed in) | someone-else | signed-in
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

  // Signed in with a passkey: open the ticket again, now as this person.
  async function signedIn(result) {
    const added = result.newPasskeys?.length ? result.newPasskeys : null;
    pendingNotices.current = Boolean(added);
    setNewPasskeys(added);
    await refresh();
    open();
  }

  // Stay here: once signed out, the sign-in button takes over.
  async function signOutHere() {
    if (!confirmSignOut(me)) return;
    setBusy(true);
    setSignOutError(null);
    try {
      if (await signOut({ to: null })) setView('sign-in');
      else setSignOutError("Couldn't sign out. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (view === 'sign-in') {
    return (
      <Page>
        <Title>Sign in</Title>
        <p className="dim">This ticket is for one person, and works once they sign in with their passkey.</p>
        <PasskeySignIn onSignedIn={signedIn} copyLabel="Copy ticket link" />
        {canUsePasskeys && (
          <p className="dim" style={{ marginTop: '2rem', fontSize: '0.92rem' }}>
            <strong>No passkey found?</strong> If your passkey is on another phone or computer, choose “Use a phone or tablet”. Lost it? Ask whoever runs{' '}
            {site?.cinemaName || 'this cinema'}.
          </p>
        )}
      </Page>
    );
  }

  if (view === 'someone-else') {
    return (
      <Page>
        <NewPasskeys passkeys={newPasskeys} />
        <Title>This ticket is for someone else</Title>
        <p className="dim">
          {me?.person ? `You're signed in as ${me.person.name}.` : "You're signed in as someone else."} If it was sent to you, sign out, then sign in
          with your own passkey.
        </p>
        {signOutError && <div className="notice bad">{signOutError}</div>}
        <button className="btn primary" onClick={signOutHere} disabled={busy}>
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </Page>
    );
  }

  if (view === 'signed-in') {
    return (
      <Page>
        <Title>Signed in as {me?.person?.name}</Title>
        <NewPasskeys passkeys={newPasskeys} />
        <button className="btn primary" onClick={() => navigate(`/${slug}`, { replace: true })}>
          Continue
        </button>
      </Page>
    );
  }

  return (
    <div className="narrow" style={{ paddingTop: '20vh' }}>
      {view === 'unreachable' ? (
        <>
          <p>Couldn't reach the cinema just now. Check your connection, then try again: your ticket hasn't been used.</p>
          <button className="btn primary" onClick={open}>
            Try again
          </button>
        </>
      ) : (
        <p className="dim">Opening your ticket…</p>
      )}
    </div>
  );
}
