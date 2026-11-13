import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, formatDayTime } from '../api.js';
import { enrollLink } from '../enrollLink.js';
import { BusyButton, Line } from '../look/ui.jsx';
import { hostName } from '../look/words.js';
import MembershipCard, { loadCardFonts } from '../MembershipCard.jsx';
import { KeyMark, OpenInBrowser, Problem } from '../PasskeySignIn.jsx';
import { anotherBrowserMayHelp, browserProblem, createPasskey, serverProblem, supportsPasskeys, useCeremonyOptions } from '../passkeys.js';
import { useSite } from '../site.jsx';
import { NarrowPage } from './tape.jsx';

// Links that will never work again: the copy kept for this tab goes.
// host: whom to ask (look/words.js hostName): only the owner sends these links.
const DEAD_LINKS = {
  'link-unknown': (host) => ["This link doesn't work", `Check that you copied all of it, or ask ${host} for a new one.`],
  'link-used': (host) => ['This link has been used', `This link has already been used. If that wasn't you, tell ${host} straight away.`],
  'link-expired': (host) => ['This link has expired', `Ask ${host} for a new one.`],
  'link-cancelled': (host) => ['This link no longer works', `It was cancelled, perhaps because a newer link was sent. Ask ${host} if you need one.`],
};

const Page = NarrowPage;
const Title = ({ children, ...attrs }) => <h1 {...attrs}>{children}</h1>;

// /enroll#<token>: create a passkey from a setup or recovery link. The token is in the
// fragment, which never reaches the server; once read, this tab keeps it (enrollLink.js).
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
      enrollLink.set(fromHash);
      navigate({ hash: '' }, { replace: true });
    }
    setLink((l) => ({ token: fromHash || enrollLink.get() || null, opened: l.opened + 1, unsupported: false }));
  }, [hash, navigate]);

  if (link.unsupported) {
    return (
      <Page>
        <Title>Set up your membership card</Title>
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
  // The browser itself said no: it may be an app's built-in browser that looked as if
  // it could use passkeys (see OpenInBrowser).
  const [refusedHere, setRefusedHere] = useState(false);
  const doneRef = useRef(null);

  // The membership card's fonts, asked for now, so they have come by the time the
  // card appears with the name being written on it: a new member never has them yet.
  useEffect(() => {
    loadCardFonts();
  }, []);
  // The button that was pressed has gone: the heading saying it worked takes the focus,
  // so a screen reader says so.
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const fetchOptions = useCallback(() => api.post('/api/enroll/options', { token }), [token]);
  const ceremony = useCeremonyOptions(fetchOptions, { enabled: Boolean(token) && !deadCode && !done });
  const info = ceremony.data;
  const dead = deadCode || (DEAD_LINKS[ceremony.error?.code] ? ceremony.error.code : null);

  // Nobody here needs the link any more: it's dead, or this device has a passkey already.
  useEffect(() => {
    if (dead || already) enrollLink.forget();
  }, [dead, already]);

  // Synchronous up to the browser call: Safari only creates passkeys during a tap.
  function create() {
    if (!info?.options || busy) return;
    setMessage(null);
    setRefusedHere(false);
    setBusy(true);
    let answered = false;
    createPasskey(info.options)
      .then((credential) => {
        answered = true;
        return api.post('/api/enroll/finish', { token, credential });
      })
      .then((r) => {
        enrollLink.forget();
        // The link may carry a ticket: then it ends on that film.
        setDone({ ...r, film: r.slug ? info.film : null, again: info.purpose !== 'setup' });
        refresh();
      })
      .catch((err) => {
        if (!answered) {
          // This device already holds one of their passkeys; the link stays unused.
          if (err?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return setAlready('device');
          setRefusedHere(anotherBrowserMayHelp(err));
          return setMessage(browserProblem(err, { creating: true }));
        }
        if (DEAD_LINKS[err.code]) return setDeadCode(err.code);
        // The server took this challenge whatever happened: the next try needs a new one.
        ceremony.reload({ spent: true });
        if (err.code === 'passkey-exists') return setAlready('passkey');
        setMessage(serverProblem(err, hostName(site)));
      })
      .finally(() => setBusy(false));
  }

  if (done) {
    // The card, back up. New: their name is written on it as it appears. A recovery
    // link (a new phone, a lost one): the same card as before, name and all.
    return (
      <div className="fl-cardpage ui-w">
        <div className="fl-cardpage__head">
          <Title ref={doneRef} tabIndex={-1} className="focus-target">
            {done.again ? 'Your new passkey is ready' : 'Your membership card is ready'}
          </Title>
          <p>{done.again ? 'Your membership card is the same as before. Next time, sign in with the new passkey.' : 'Next time, show your card: sign in with your passkey.'}</p>
        </div>
        {done.membership && (
          <div className="fl-cardpage__card">
            <MembershipCard site={site} name={done.person.name} membership={done.membership} start="back" writeOn={!done.again} />
          </div>
        )}
        <div className="fl-cardpage__act ui-btns">
          <button type="button" className="ui-btn ui-btn--primary ui-btn--big" onClick={() => navigate(done.slug ? `/${done.slug}` : '/', { replace: true })}>
            {done.film ? `Continue to ${done.film.title}` : 'Continue'}
          </button>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <Page>
        <Title>Open your link again</Title>
        <p>Open the link you were sent again: it works until a passkey has been created with it.</p>
      </Page>
    );
  }

  if (dead) {
    const [title, text] = DEAD_LINKS[dead](hostName(site));
    return (
      <Page>
        <Title>{title}</Title>
        <p>{text}</p>
        {dead === 'link-used' && (
          <p>
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
        <p>
          {already === 'device'
            ? "This phone or computer already has your passkey, so you don't need this link: sign in instead."
            : "That passkey is already set up here, so you don't need this link: sign in instead."}
        </p>
        <div className="ui-btns">
          <Link to="/signin" className="ui-btn ui-btn--primary">
            Sign in
          </Link>
        </div>
      </Page>
    );
  }

  if (!info) {
    return (
      <Page>
        {ceremony.error ? (
          <>
            <Problem message={serverProblem(ceremony.error, hostName(site))} />
            <div className="ui-btns">
              <BusyButton type="button" className="ui-btn ui-btn--primary" onClick={() => ceremony.reload()} busy={ceremony.loading}>
                Try again
              </BusyButton>
            </div>
          </>
        ) : (
          <p role="status">Opening your link…</p>
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
        Create a passkey to open your membership card at {site?.cinemaName || 'this video shop'}
        {info.film ? `, then go on to ${info.film.title}` : ''}. Your phone or computer keeps it and unlocks it with Face ID, a fingerprint or your
        screen lock. No password, no email address.
      </p>
      {info.reset && (
        <Line kind="warn" lead="Before you continue:">
          if your old phone or computer was lost or stolen, remove it from your Apple Account, Google account or password manager first. A new passkey
          would otherwise reach it too.
        </Line>
      )}
      {message && <Problem message={message} />}
      <div className="ui-btns">
        {/* Spent: the server took that challenge, and a new one is on its way. */}
        <BusyButton type="button" className="ui-btn ui-btn--primary ui-btn--big" onClick={create} busy={busy || ceremony.spent} busyText={busy ? 'Creating…' : undefined}>
          <KeyMark />
          {busy ? 'Creating…' : 'Create a passkey'}
        </BusyButton>
      </div>
      {/* The fragment has gone from the address, so Copy link puts the whole link back together. */}
      {refusedHere && <OpenInBrowser refused link={`${window.location.origin}/enroll#${token}`} />}
      <p className="fl-small">
        This link works once, until {formatDayTime(info.expiresAt)}. Not {name}? Stop here and let {hostName(site)} know.
      </p>
    </Page>
  );
}
