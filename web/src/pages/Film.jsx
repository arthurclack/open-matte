import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatClock, formatDate, formatDateTime, formatRuntime, plural } from '../api.js';
import { useSite } from '../site.jsx';
import { Poster } from './shared.jsx';

// hls.js is large; load it when someone presses Play.
const Player = lazy(() => import('../Player.jsx'));

const PLAY_ERRORS = {
  'playing-elsewhere': 'This screening is playing on another device right now. Pause it there, or give it a minute, then try again.',
  'no-ticket': null, // the ticket panel explains these after a reload
  used_up: null,
  expired: null,
  unavailable: null,
};

export default function Film() {
  const { slug } = useParams();
  const { me, site, refresh: refreshSite, setPlayerOpen } = useSite();
  const [data, setData] = useState(undefined); // undefined = loading, null = not found
  const [screening, setScreening] = useState(null);
  const [message, setMessage] = useState(null);
  const [starting, setStarting] = useState(false);
  const theatreRef = useRef(null);

  const load = useCallback(
    () =>
      api
        .get(`/api/films/${slug}`)
        .then(setData)
        .catch((err) => (err.status === 404 ? setData(null) : setMessage("Couldn't load this page. Try again in a moment."))),
    [slug],
  );

  useEffect(() => {
    setData(undefined);
    setScreening(null);
    setMessage(null);
    load();
  }, [load]);

  useEffect(() => {
    if (data?.film?.title && site?.cinemaName) document.title = `${data.film.title} · ${site.cinemaName}`;
  }, [data?.film?.title, site?.cinemaName]);

  // The header's Sign in link isn't offered while the player is open.
  const playerOpen = Boolean(screening);
  useEffect(() => {
    setPlayerOpen(playerOpen);
    return () => setPlayerOpen(false);
  }, [playerOpen, setPlayerOpen]);

  async function play() {
    setMessage(null);
    setStarting(true);
    try {
      const s = await api.post(`/api/films/${slug}/screenings`);
      setScreening({ ...s, key: Date.now() });
      requestAnimationFrame(() => theatreRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (err) {
      if (err.code in PLAY_ERRORS && PLAY_ERRORS[err.code]) setMessage(PLAY_ERRORS[err.code]);
      await load();
    } finally {
      setStarting(false);
    }
  }

  // The player stopped because the server refused something: find out why.
  const onHalt = useCallback(async () => {
    await load();
    refreshSite();
  }, [load, refreshSite]);

  if (data === undefined) return message ? <div className="narrow notice bad">{message}</div> : null;
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
          <TicketPanel
            access={access}
            film={film}
            site={site}
            signedIn={Boolean(me?.person)}
            onPlay={play}
            starting={starting}
            playing={Boolean(screening)}
          />

          {film.synopsis && <p className="synopsis">{film.synopsis}</p>}
          {film.contentNote && <p className="faint">{film.contentNote}</p>}
        </div>
      </div>
    </article>
  );
}

function TicketPanel({ access, film, site, signedIn, onPlay, starting, playing }) {
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
            ▶ Preview
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
          You don't have a ticket for this one. If you'd like to see it, ask whoever runs {site?.cinemaName || 'this cinema'}.
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
      lines.push(`Pressing Play starts a screening. You can pause and come back to it for ${plural(windowHours, 'hour')}.`);
      if (t.startBy) lines.push(`Start watching by ${formatDate(t.startBy)}.`);
      if (t.daysAfterFirstPlay && !t.firstPlayedAt) lines.push(`Once you start, the ticket lasts ${plural(t.daysAfterFirstPlay, 'day')}.`);
    }
    if (t.expiresAt) lines.push(`The ticket is valid until ${formatDateTime(t.expiresAt)}.`);
    if (t.inAccount) lines.push("This ticket is in your account, so it's on every device you sign in on.");
    const resumeAt = open && open.position > 15 ? ` at ${formatClock(open.position)}` : '';
    button = !playing && (
      <button className="btn primary big" onClick={onPlay} disabled={starting}>
        ▶ {open ? `Resume${resumeAt}` : 'Play'}
      </button>
    );
  } else if (t?.state === 'used_up') {
    lines.push(`You've used ${t.screeningLimit === 1 ? 'the screening' : `all ${t.screeningLimit} screenings`} on this ticket. If you'd like another, ask whoever sent it.`);
  } else if (t?.state === 'expired') {
    lines.push(t.expiresAt ? `This ticket expired on ${formatDate(t.expiresAt)}.` : `This ticket needed to be used by ${formatDate(t.startBy)}.`);
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
      <p className="privacy">
        {site?.cinemaName || 'The host'} can see when this ticket is opened and played, the kind of device (such as “Safari on iPhone”),{' '}
        {signedIn ? "roughly how far playback gets and, because you're signed in, that it was you." : 'and roughly how far playback gets.'}
      </p>
    </div>
  );
}
