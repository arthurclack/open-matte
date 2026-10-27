import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, formatDayTime } from '../api.js';
import { OpenInBrowser } from '../PasskeySignIn.jsx';
import { browserProblem, createPasskey, serverProblem, supportsPasskeys, useCeremonyOptions } from '../passkeys.js';
import { useSite } from '../site.jsx';

// The token lives in the address fragment, which never reaches the server. Once read,
// it is kept for this tab only, so a reload carries on after the fragment is cleared.
const KEY = 'om_enroll';
const stored = {
  get: () => {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set: (v) => {
    try {
      sessionStorage.setItem(KEY, v);
    } catch {
      // Private browsing: a reload will need the link again.
    }
  },
  clear: () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // Nothing was kept.
    }
  },
};

// Links that will never work again: the copy kept for this tab goes.
const DEAD_LINKS = {
  'link-unknown': ["This link doesn't work", 'Check that you copied all of it, or ask whoever sent it for a new one.'],
  'link-used': ['This link has been used', "This link has already been used. If that wasn't you, tell whoever sent it straight away."],
  'link-expired': ['This link has expired', 'Ask whoever sent it for a new one.'],
  'link-cancelled': ['This link no longer works', 'It was cancelled, perhaps because a newer link was sent. Ask whoever sent it if you need one.'],
};

const Page = ({ children }) => (
  <div className="narrow" style={{ paddingTop: '15vh' }}>
    {children}
  </div>
);
const Title = ({ children }) => <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>{children}</h1>;

// /enroll#<token>: create a passkey from a setup or recovery link.
export default function Enroll() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const started = useRef(false);
  const [link, setLink] = useState({ token: undefined, opened: 0, unsupported: false });

  // Read the fragment once, then clear it. StrictMode runs this twice, and the second
  // run mustn't take the cleared fragment for "no link"; a link opened again in this
  // tab arrives as a new fragment and starts afresh.
  useEffect(() => {
    const fromHash = hash.replace(/^#/, '');
    if (started.current && !fromHash) return;
    started.current = true;
    // An app's built-in browser: touch nothing, so Copy link copies the whole link.
    if (!supportsPasskeys()) {
      setLink((l) => ({ ...l, unsupported: true }));
      return;
    }
    if (fromHash) {
      stored.set(fromHash);
      navigate({ hash: '' }, { replace: true });
    }
    setLink((l) => ({ token: fromHash || stored.get() || null, opened: l.opened + 1, unsupported: false }));
  }, [hash, navigate]);

  if (link.unsupported) {
    return (
      <Page>
        <Title>Create a passkey</Title>
        <OpenInBrowser />
      </Page>
    );
  }
  if (link.token === undefined) return null;
  return <EnrollLink key={link.opened} token={link.token} />;
}

function EnrollLink({ token }) {
  const navigate = useNavigate();
  const { site, refresh } = useSite();
  const [deadCode, setDeadCode] = useState(null);
  const [already, setAlready] = useState(null); // 'device' | 'passkey': sign in instead
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const fetchOptions = useCallback(() => api.post('/api/enroll/options', { token }), [token]);
  const ceremony = useCeremonyOptions(fetchOptions, { enabled: Boolean(token) && !deadCode && !done });
  const info = ceremony.data;
  const dead = deadCode || (DEAD_LINKS[ceremony.error?.code] ? ceremony.error.code : null);

  useEffect(() => {
    if (dead) stored.clear();
  }, [dead]);

  // Synchronous up to the browser call: Safari only creates passkeys during a tap.
  function create() {
    if (!info?.options || busy) return;
    setMessage(null);
    setBusy(true);
    let answered = false;
    createPasskey(info.options)
      .then((credential) => {
        answered = true;
        return api.post('/api/enroll/finish', { token, credential });
      })
      .then((r) => {
        stored.clear();
        // The link may carry a ticket: then it ends on that film.
        setDone({ ...r, film: r.slug ? info.film : null });
        refresh();
      })
      .catch((err) => {
        if (!answered) {
          // This device already holds one of their passkeys; the link stays unused.
          if (err?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return setAlready('device');
          return setMessage(browserProblem(err, { creating: true }));
        }
        if (DEAD_LINKS[err.code]) return setDeadCode(err.code);
        // The server took this challenge whatever happened: the next try needs a new one.
        ceremony.reload({ spent: true });
        if (err.code === 'passkey-exists') return setAlready('passkey');
        setMessage(serverProblem(err, site?.cinemaName));
      })
      .finally(() => setBusy(false));
  }

  if (done) {
    return (
      <Page>
        <Title>You're in, {done.person.name}</Title>
        <p className="dim">Your passkey is ready. Next time, use it to sign in.</p>
        <button className="btn primary" onClick={() => navigate(done.slug ? `/${done.slug}` : '/', { replace: true })}>
          {done.film ? `Continue to ${done.film.title}` : 'Continue'}
        </button>
      </Page>
    );
  }

  if (!token) {
    return (
      <Page>
        <Title>Open your link again</Title>
        <p className="dim">Open the link you were sent again: it works until a passkey has been created with it.</p>
      </Page>
    );
  }

  if (dead) {
    const [title, text] = DEAD_LINKS[dead];
    return (
      <Page>
        <Title>{title}</Title>
        <p className="dim">{text}</p>
        {dead === 'link-used' && (
          <p className="dim">
            If it was you, <Link to="/signin">sign in</Link> with your passkey.
          </p>
        )}
      </Page>
    );
  }

  if (already) {
    return (
      <Page>
        <Title>You already have a passkey</Title>
        <p className="dim">
          {already === 'device'
            ? "This phone or computer already has your passkey, so you don't need this link: sign in instead."
            : "That passkey is already set up here, so you don't need this link: sign in instead."}
        </p>
        <Link to="/signin" className="btn primary">
          Sign in
        </Link>
      </Page>
    );
  }

  if (!info) {
    return (
      <Page>
        {ceremony.error ? (
          <>
            <div className="notice bad">{serverProblem(ceremony.error, site?.cinemaName)}</div>
            <button className="btn primary" onClick={ceremony.reload} disabled={ceremony.loading}>
              Try again
            </button>
          </>
        ) : (
          <p className="dim">Opening your link…</p>
        )}
      </Page>
    );
  }

  const name = info.person.name;
  return (
    <Page>
      <Title>
        {info.purpose === 'setup' ? 'Welcome' : 'Welcome back'}, {name}
      </Title>
      <p>
        Create a passkey to sign in to {site?.cinemaName || 'this cinema'}
        {info.film ? `, then go on to ${info.film.title}` : ''}. Your phone or computer keeps it and unlocks it with Face ID, a fingerprint or
        your screen lock. No password, no email address.
      </p>
      {info.reset && (
        <div className="notice warn">
          Before you continue: if your old phone or computer was lost or stolen, remove it from your Apple ID, Google account or password manager first. A new
          passkey would otherwise reach it too.
        </div>
      )}
      {message && <div className="notice bad">{message}</div>}
      <button className="btn primary big" onClick={create} disabled={busy || ceremony.spent}>
        {busy ? 'Creating…' : 'Create a passkey'}
      </button>
      <p className="dim" style={{ marginTop: '1.2rem' }}>
        This link works once, until {formatDayTime(info.expiresAt)}. Not {name}? Stop here and let whoever sent it know.
      </p>
    </Page>
  );
}
