import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatClock, formatDate, formatDateTime, formatDateTimeYear, formatRuntime, plural } from '../api.js';
import { lazyPart } from '../ErrorBoundary.jsx';
import { PlayIcon } from '../icons.jsx';
import { scrollBehavior } from '../motion.js';
import PasskeySignIn, { NewPasskeys } from '../PasskeySignIn.jsx';
import { supportsPasskeys } from '../passkeys.js';
import { useSite } from '../site.jsx';
import { Poster } from './shared.jsx';

// hls.js is large; load it when someone presses Play.
const Player = lazyPart(() => import('../Player.jsx'));

// What Play can be refused with. Anything else (no connection, a server error) gets
// a message of its own, since nothing on the reloaded page would explain it.
const PLAY_ERRORS = {
  'playing-elsewhere': 'This screening is playing on another device right now. Pause it there, or give it a minute, then try again.',
  'too-many-requests': 'Play was pressed too many times from this connection. Wait a few minutes, then try again.',
  'no-ticket': null, // the ticket panel explains these after a reload
  used_up: null,
  expired: null,
  unavailable: null,
  'not-found': null, // and after these the page itself goes
  revoked: null,
  unpublished: null,
};

export default function Film() {
  const { slug } = useParams();
  const { me, site, refresh: refreshSite, setPlayerOpen } = useSite();
  const [data, setData] = useState(undefined); // undefined = loading, null = not found, { kept } = kept by someone else
  const [screening, setScreening] = useState(null);
  const [message, setMessage] = useState(null);
  const [starting, setStarting] = useState(false);
  // Passkeys added since the one used to sign in here (Sign in and keep it). The
  // server reports them once, so they stay on the page after the offer goes.
  const [newPasskeys, setNewPasskeys] = useState(null);
  // The player stopped because this browser was signed out (Sign out everywhere, the
  // admin signing browsers out, the person disabled): the page then says so.
  const [signedOut, setSignedOut] = useState(false);
  // The player has stopped for good, for a reason the server gave (the screening
  // ended, the ticket went): the ticket panel offers Play or Resume again. Stopping
  // because another device took over offers Watch here instead, in the player.
  const [stopped, setStopped] = useState(false);
  const theatreRef = useRef(null);

  // `again`: the page reading itself again, after Play or once the player stops,
  // which isn't someone opening it, so the server doesn't log it as opened.
  const load = useCallback(
    (again = false) =>
      api
        // The route gives the slug decoded: encoded again, a link like /..%2Fme
        // asks for a film called '../me' rather than for /api/me.
        .get(`/api/films/${encodeURIComponent(slug)}${again ? '?again=1' : ''}`)
        .then(setData)
        .catch((err) => {
          if (err.status === 404) return setData(null);
          if (err.code === 'ticket-kept') return setData({ kept: true });
          setMessage("Couldn't load this page. Try again in a moment.");
        }),
    [slug],
  );

  useEffect(() => {
    setData(undefined);
    setScreening(null);
    setMessage(null);
    setSignedOut(false);
    setStopped(false);
    load();
  }, [load]);

  useEffect(() => {
    if (data?.film?.title && site?.cinemaName) document.title = `${data.film.title} · ${site.cinemaName}`;
  }, [data?.film?.title, site?.cinemaName]);

  // The header's Sign in link isn't offered while the player is open. Once the page
  // no longer shows the film (after a halt), there's no player.
  const playerOpen = Boolean(screening && data?.film);
  useEffect(() => {
    setPlayerOpen(playerOpen);
    return () => setPlayerOpen(false);
  }, [playerOpen, setPlayerOpen]);

  async function play() {
    setMessage(null);
    setStarting(true);
    try {
      const s = await api.post(`/api/films/${encodeURIComponent(slug)}/screenings`);
      setScreening({ ...s, key: Date.now() });
      setStopped(false);
      requestAnimationFrame(() => theatreRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }));
      // The ticket panel then tells of the screening just opened, not the one Play would start.
      load(true);
    } catch (err) {
      if (!Object.hasOwn(PLAY_ERRORS, err.code)) setMessage("Couldn't start playback. Try again in a moment.");
      else if (PLAY_ERRORS[err.code]) setMessage(PLAY_ERRORS[err.code]);
      await load(true);
    } finally {
      setStarting(false);
    }
  }

  // Something changed on the server (the ticket was kept, the player was
  // refused): read the page and the header again.
  const reload = useCallback(async (code) => {
    if (code === 'signed-out') setSignedOut(true);
    await load(true);
    refreshSite();
  }, [load, refreshSite]);

  // The player stopped because the server refused something: find out why.
  const onHalt = useCallback(async (code) => {
    setStopped(true);
    await reload(code);
  }, [reload]);

  if (data === undefined) return message ? <div className="narrow notice bad">{message}</div> : null;
  // This browser opened the ticket's link, and someone has kept it in their account since.
  if (data?.kept) {
    return (
      <div className="narrow" style={{ paddingTop: '15vh' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.8rem' }}>This ticket has been kept</h1>
        <p className="dim">It's in someone's account now, so it only works for them. Ask whoever sent it.</p>
        <Link to="/" className="btn">
          Go to the front page
        </Link>
      </div>
    );
  }
  // The film is gone from this browser with its session: someone signed it out.
  if (data === null && signedOut) {
    return (
      <div className="narrow" style={{ paddingTop: '15vh' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.8rem' }}>This browser has been signed out</h1>
        <p className="dim">Sign in to carry on watching. If you opened the ticket from a link, open the link again.</p>
        <div className="row" style={{ gap: '0.6rem' }}>
          <Link to={`/signin?next=${encodeURIComponent(`/${slug}`)}`} className="btn primary">
            Sign in
          </Link>
          <Link to="/" className="btn">
            Go to the front page
          </Link>
        </div>
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="narrow" style={{ paddingTop: '15vh' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.8rem' }}>Nothing showing here</h1>
        <p className="dim">If someone sent you a ticket, open the link they gave you. Tickets can also be cancelled or run out.</p>
        <Link to="/" className="btn">
          Go to the front page
        </Link>
      </div>
    );
  }

  const { film, access } = data;
  const meta = [film.year, formatRuntime(film.runtimeMinutes), film.directors && `Directed by ${film.directors}`, film.country].filter(Boolean);

  return (
    <article className="film">
      {film.backdropUrl && (
        <div className="film-backdrop">
          <img src={film.backdropUrl} alt="" />
        </div>
      )}

      {screening && (
        <div className="theatre" ref={theatreRef}>
          <Suspense fallback={<div style={{ aspectRatio: '16 / 9' }} />}>
            <Player key={screening.key} film={film} screening={screening} onHalt={onHalt} onReclaim={play} />
          </Suspense>
        </div>
      )}

      <div className="wrap film-body">
        <Poster film={film} />
        <div>
          <h1 className="film-title">{film.title}</h1>
          {film.originalTitle && film.originalTitle !== film.title && <div className="dim" style={{ marginBottom: '0.4rem' }}>{film.originalTitle}</div>}
          <div className="film-meta">
            {meta.map((m) => (
              <span key={m}>{m}</span>
            ))}
          </div>

          {film.recommendation && (
            <blockquote className="recommendation">
              <span className="recommendation-label">Why you should watch it</span>
              {film.recommendation}
            </blockquote>
          )}

          {message && <div className="notice warn">{message}</div>}
          <NewPasskeys passkeys={newPasskeys} />
          <TicketPanel
            access={access}
            film={film}
            site={site}
            signedIn={Boolean(me?.person)}
            onPlay={play}
            starting={starting}
            playing={Boolean(screening) && !stopped}
            onKept={reload}
            onNewPasskeys={setNewPasskeys}
          />

          {film.synopsis && <p className="synopsis">{film.synopsis}</p>}
          {film.contentNote && <p className="faint">{film.contentNote}</p>}
        </div>
      </div>
    </article>
  );
}

const HOUR = 60 * 60 * 1000;

function TicketPanel({ access, film, site, signedIn, onPlay, starting, playing, onKept, onNewPasskeys }) {
  const t = access.ticket;
  const windowHours = site?.resumeWindowHours ?? 48;

  if (access.preview) {
    return (
      <div className="ticket-panel">
        <div className="admit">Admin preview</div>
        <p>Playing here doesn't use a screening. To try a ticket as a guest, open its link in a private window or another browser.</p>
        {!access.published && <p>This film isn't published, so ticket holders can't see it yet.</p>}
        {!playing && (
          <button className="btn primary big" onClick={onPlay} disabled={starting || access.mediaStatus === 'error' || access.mediaStatus === 'missing'}>
            <PlayIcon />
            Preview
          </button>
        )}
      </div>
    );
  }

  // A film shown to members: the page is for reading. Nothing is recorded, so
  // there's no privacy line.
  if (access.via === 'member') {
    return (
      <div className="ticket-panel">
        <div className="admit">Showing to members</div>
        <p>
          {access.ticketKept ? "The ticket you opened for this one has been kept in someone's account." : "You don't have a ticket for this one."} If
          you'd like to see it, ask whoever runs {site?.cinemaName || 'this cinema'}.
        </p>
      </div>
    );
  }

  const lines = [];
  let button = null;
  if (access.canPlay) {
    const open = t.openScreening;
    if (open) {
      lines.push(`Your screening is open until ${formatDateTime(open.resumableUntil)}. Pick up where you left off, on this device or another.`);
    } else {
      if (t.screeningLimit != null) lines.push(`${plural(t.screeningsLeft, 'screening')} left on this ticket.`);
      // The ticket's expiry wins over the resume window: what it has left, or once
      // played the days it lasts, may be the shorter.
      const ticketLeft = t.expiresAt ? t.expiresAt - Date.now() : (t.daysAfterFirstPlay ?? Infinity) * 24 * HOUR;
      lines.push(
        ticketLeft < windowHours * HOUR
          ? 'Pressing Play starts a screening. You can pause and come back to it until the ticket expires.'
          : `Pressing Play starts a screening. You can pause and come back to it for ${plural(windowHours, 'hour')}.`,
      );
      // With its time: the deadline is the end of a day where the admin is, which
      // may be another day, or another time of day, here.
      if (t.startBy) lines.push(`Start watching by ${formatDateTime(t.startBy)}.`);
      if (t.daysAfterFirstPlay && !t.firstPlayedAt) lines.push(`Once you start, the ticket lasts ${plural(t.daysAfterFirstPlay, 'day')}.`);
    }
    if (t.expiresAt) lines.push(`The ticket is valid until ${formatDateTime(t.expiresAt)}.`);
    if (t.inAccount) lines.push("This ticket is in your account, so it's on every device you sign in on.");
    const resumeAt = open && open.position > 15 ? ` at ${formatClock(open.position)}` : '';
    button = !playing && (
      <button className="btn primary big" onClick={onPlay} disabled={starting}>
        <PlayIcon />
        {open ? `Resume${resumeAt}` : 'Play'}
      </button>
    );
  } else if (t?.state === 'used_up') {
    lines.push(`You've used ${t.screeningLimit === 1 ? 'the screening' : `all ${t.screeningLimit} screenings`} on this ticket. If you'd like another, ask whoever sent it.`);
  } else if (t?.state === 'expired') {
    // With the year: a deadline that has passed may be last year's.
    lines.push(t.expiresAt ? `This ticket expired on ${formatDate(t.expiresAt)}.` : `This ticket needed to be used by ${formatDateTimeYear(t.startBy)}.`);
  } else {
    lines.push("This film isn't available right now. Try again later.");
  }

  return (
    <div className="ticket-panel">
      <div className="admit">Admit one · {film.title}</div>
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
      {button}
      {access.canKeep && !playing && <KeepOffer film={film} signedIn={signedIn} onKept={onKept} onNewPasskeys={onNewPasskeys} />}
      <p className="privacy">
        {site?.cinemaName || 'The host'} can see when this ticket is opened and played, the kind of device (such as “Safari on iPhone”),{' '}
        {signedIn ? "roughly how far playback gets and, because you're signed in, that it was you." : 'and roughly how far playback gets.'}
      </p>
    </div>
  );
}

const KEEP_ERRORS = {
  'playing-elsewhere': "It's playing on another device right now. Once it's paused there, you can keep it.",
  'cannot-keep': "This ticket can't be kept any more.",
};
const KEEP_CONFIRM =
  'Keeping this ticket links it to your account. Other browsers that opened the link will lose it, and the link will only work for you.';

// A ticket for anyone that you've let them keep. Signed in: Keep it, after a
// confirmation. Not signed in: Sign in and keep it, which signs in here (the
// link tickets opened in this browser come along) and then keeps it.
function KeepOffer({ film, signedIn, onKept, onNewPasskeys }) {
  const { refresh } = useSite();
  const [signingIn, setSigningIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [canUsePasskeys] = useState(supportsPasskeys);

  async function keep() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/films/${film.slug}/keep`);
      await onKept();
    } catch (err) {
      setError(KEEP_ERRORS[err.code] || "Couldn't keep it just now. Try again in a moment.");
      // The page may have changed underneath (kept by someone else, signed out).
      if (err.code === 'cannot-keep' || err.status === 401) await onKept();
    } finally {
      setBusy(false);
    }
  }

  async function signedInHere(result) {
    onNewPasskeys(result.newPasskeys?.length ? result.newPasskeys : null);
    setSigningIn(false);
    await refresh();
    await keep();
  }

  if (signedIn) {
    return (
      <div className="keep-offer">
        {error && <div className="notice warn">{error}</div>}
        <p>Keep this ticket in your account, so it's on every device you sign in on?</p>
        <button className="btn" onClick={() => window.confirm(KEEP_CONFIRM) && keep()} disabled={busy}>
          {busy ? 'Keeping…' : 'Keep it'}
        </button>
      </div>
    );
  }

  return (
    <div className="keep-offer">
      {error && <div className="notice warn">{error}</div>}
      {!signingIn ? (
        <p>
          Keep this ticket in your account?{' '}
          <button className="linklike" onClick={() => setSigningIn(true)}>
            Sign in and keep it
          </button>
          . You don't need an account to watch: just press Play.
        </p>
      ) : canUsePasskeys ? (
        <>
          <p>{KEEP_CONFIRM}</p>
          <PasskeySignIn onSignedIn={signedInHere} />
          <button className="linklike" style={{ marginTop: '0.6rem' }} onClick={() => setSigningIn(false)}>
            Not now
          </button>
        </>
      ) : (
        <p>This browser can't use passkeys. To keep the ticket, open the link you were sent in Safari or Chrome and sign in there.</p>
      )}
    </div>
  );
}
