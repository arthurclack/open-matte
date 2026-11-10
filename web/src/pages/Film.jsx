import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatClock, formatRuntime } from '../api.js';
import { lazyPart } from '../ErrorBoundary.jsx';
import { ComingBack, PlayScreen, PlayTile } from '../look/crt.jsx';
import { PickCard, Sleeve } from '../look/objects.jsx';
import { Line } from '../look/ui.jsx';
import { hostName, nextDeadline, noTapeYet, playsLeft, stickerText, tapeCounter } from '../look/words.js';
import { scrollBehavior } from '../motion.js';
import PasskeySignIn, { NewPasskeys } from '../PasskeySignIn.jsx';
import { supportsPasskeys } from '../passkeys.js';
import { useSite } from '../site.jsx';
import { NarrowPage, TitleTape } from './tape.jsx';
import { clockLines, goneLine, privacyLine } from './tapeWords.js';

// hls.js is large; load it when someone presses Play.
const loadPlayer = () => import('../Player.jsx');
const Player = lazyPart(loadPlayer);

// What Play can be refused with: { lead, text } for a system line. Anything else (no
// connection, a server error) gets one of its own, since nothing on the reloaded page
// would explain it.
const PLAY_ERRORS = {
  'playing-elsewhere': { lead: "It's playing on another device right now.", text: 'Pause it there, or give it a minute, then try again.' },
  'too-many-requests': { lead: 'Play was pressed too many times from this connection.', text: 'Wait a few minutes, then try again.' },
  'no-ticket': null, // the counter explains these after a reload
  used_up: null,
  expired: null,
  unavailable: null,
  'not-found': null, // and after these the page itself goes
  revoked: null,
  unpublished: null,
};
const PLAY_FAILED = { lead: "Couldn't start playback.", text: 'Try again in a moment.' };

// A film's page: the sleeve and the staff pick on the wall, the film and the counter
// beside them. On the counter, the title on label tape with the sticker for the next
// deadline, and Play (or the telly, for a paused tape). Pressing it shows the machine's
// PLAY screen in the picture's place, then the film.
export default function Film() {
  const { slug } = useParams();
  const { me, site, refresh: refreshSite, setPlayerOpen } = useSite();
  const [data, setData] = useState(undefined); // undefined = loading, null = not found, { kept } = kept by someone else
  const [screening, setScreening] = useState(null);
  // The PLAY screen has given way to the picture.
  const [picture, setPicture] = useState(false);
  const [message, setMessage] = useState(null);
  const [starting, setStarting] = useState(false);
  // Passkeys added since the one used to sign in here (Sign in and keep it). The
  // server reports them once, so they stay on the page after the offer goes.
  const [newPasskeys, setNewPasskeys] = useState(null);
  // The player stopped because this browser was signed out (Sign out everywhere, the
  // owner signing browsers out, the member turned off): the page then says so.
  const [signedOut, setSignedOut] = useState(false);
  // The player has stopped for good, for a reason the server gave (the play ended, the
  // tape went): the counter offers Play or Resume again. Stopping because another
  // device took over offers Watch here instead, in the player.
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
          setMessage({ lead: "Couldn't load this page.", text: 'Try again in a moment.' });
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
    // The player's code comes while the PLAY screen shows. A part that won't load is
    // the player's to say (the page then asks to be reloaded).
    loadPlayer().catch(() => {});
    try {
      const s = await api.post(`/api/films/${encodeURIComponent(slug)}/screenings`);
      setPicture(false);
      setScreening({ ...s, key: Date.now() });
      setStopped(false);
      requestAnimationFrame(() => theatreRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }));
      // The counter then tells of the play just opened, not the one Play would start.
      load(true);
    } catch (err) {
      if (!Object.hasOwn(PLAY_ERRORS, err.code)) setMessage(PLAY_FAILED);
      else if (PLAY_ERRORS[err.code]) setMessage(PLAY_ERRORS[err.code]);
      await load(true);
    } finally {
      setStarting(false);
    }
  }

  // Something changed on the server (the tape was kept, the player was refused): read
  // the page and the header again.
  const reload = useCallback(
    async (code) => {
      if (code === 'signed-out') setSignedOut(true);
      await load(true);
      refreshSite();
    },
    [load, refreshSite],
  );

  // The player stopped because the server refused something: find out why.
  const onHalt = useCallback(
    async (code) => {
      setStopped(true);
      await reload(code);
    },
    [reload],
  );

  if (data === undefined) {
    return message ? (
      <NarrowPage>
        <Line kind="bad" lead={message.lead} role="alert">
          {message.text}
        </Line>
      </NarrowPage>
    ) : null;
  }
  // This browser opened the tape's link, and someone has kept it on their card since.
  if (data?.kept) {
    return (
      <NarrowPage>
        <h1>This tape has been kept</h1>
        <p>It's on someone's membership card now, so it only works for them. Ask {hostName(site)}.</p>
        <div className="ui-btns">
          <Link to="/" className="ui-btn">
            Go to the front page
          </Link>
        </div>
      </NarrowPage>
    );
  }
  // The film is gone from this browser with its session: someone signed it out.
  if (data === null && signedOut) {
    return (
      <NarrowPage>
        <h1>This browser has been signed out</h1>
        <p>Sign in to carry on watching. If you opened the tape from a link, open the link again.</p>
        <div className="ui-btns">
          <Link to={`/signin?next=${encodeURIComponent(`/${slug}`)}`} className="ui-btn ui-btn--primary">
            Sign in
          </Link>
          <Link to="/" className="ui-btn">
            Go to the front page
          </Link>
        </div>
      </NarrowPage>
    );
  }
  if (data === null) return <NothingHere />;

  const { film, access } = data;
  const meta = [film.year, formatRuntime(film.runtimeMinutes), film.directors && `directed by ${film.directors}`, film.country].filter(Boolean).join(', ');

  return (
    <article className="fl-page">
      {screening && (
        <div className="theatre fl-theatre" ref={theatreRef}>
          <div className="fl-stage">
            {picture ? (
              <Suspense fallback={<div className="fl-stage__wait" />}>
                <Player
                  key={screening.key}
                  film={film}
                  screening={screening}
                  onHalt={onHalt}
                  onReclaim={play}
                  comeBackBy={access.ticket?.openScreening?.resumableUntil ?? screening.resumableUntil}
                />
              </Suspense>
            ) : (
              <PlayScreen key={screening.key} counter={tapeCounter(screening.position)} onDone={() => setPicture(true)} />
            )}
          </div>
        </div>
      )}

      <div className={`fl-film ui-w${film.recommendation ? '' : ' fl-film--nopick'}`}>
        <div className="fl-info">
          <h1>{film.title}</h1>
          {film.originalTitle && film.originalTitle !== film.title && <p className="fl-original">{film.originalTitle}</p>}
          {meta && <p className="fl-meta">{meta}</p>}
        </div>
        <div className="fl-sleeve">
          <Sleeve film={film} logo={site?.logo} />
        </div>
        {(film.synopsis || film.contentNote) && (
          <div className="fl-about">
            {film.synopsis && <p className="fl-synopsis">{film.synopsis}</p>}
            {film.contentNote && <p className="fl-note">{film.contentNote}</p>}
          </div>
        )}
        {film.recommendation && (
          <div className="fl-pickcell">
            <PickCard text={film.recommendation} site={site} seed={film.slug} />
          </div>
        )}
        <div className="fl-counter">
          {message && (
            <Line kind="warn" lead={message.lead} role="status" className="fl-message">
              {message.text}
            </Line>
          )}
          <NewPasskeys passkeys={newPasskeys} />
          <Counter
            access={access}
            film={film}
            site={site}
            name={me?.person?.name}
            onPlay={play}
            starting={starting}
            playing={Boolean(screening) && !stopped}
            onKept={reload}
            onNewPasskeys={setNewPasskeys}
          />
        </div>
      </div>
    </article>
  );
}

// No such film here: none, or off the shelf, or no tape for it in this browser (a
// tape taken back looks the same: the server says no more).
function NothingHere() {
  return (
    <NarrowPage>
      <h1>Nothing on the shelf here</h1>
      <p>If someone sent you a tape, open the link they gave you. A tape can also have gone back to the shop.</p>
      <div className="ui-btns">
        <Link to="/" className="ui-btn">
          Go to the front page
        </Link>
      </div>
    </NarrowPage>
  );
}

// The counter: what this browser's tape can do now.
function Counter({ access, film, site, name, onPlay, starting, playing, onKept, onNewPasskeys }) {
  const t = access.ticket;
  const signedIn = Boolean(name);

  // The owner's own browser: Play never uses a play here. No sticker: no tape.
  if (access.preview) {
    return (
      <>
        <TitleTape film={film} sticker={null} />
        {!access.published && <Line kind="info">This film isn't on the shelf, so friends can't see it yet.</Line>}
        {!playing && (
          <div className="fl-playrow">
            <PlayTile onClick={onPlay} disabled={starting || access.mediaStatus === 'error' || access.mediaStatus === 'missing'} label="Play" />
          </div>
        )}
        <p className="fl-clock">Playing here doesn't use a play. To try a tape as a friend would, open its link in a private window or another browser.</p>
      </>
    );
  }

  // A film on the shelf for members: the page is for reading. Nothing is recorded, so
  // there's no privacy line.
  if (access.via === 'member') {
    return (
      <>
        <TitleTape film={film} sticker={null} />
        <Line kind="info" lead="On the shelf for members.">
          {access.ticketKept ? "The tape you opened for this one is on someone's membership card now. " : ''}
          {noTapeYet(site)}.
        </Line>
      </>
    );
  }

  const gone = goneLine(t, site);
  const open = t?.openScreening;
  const sticker = gone ? null : stickerText(nextDeadline(t));
  const left = !open && playsLeft(t);
  const resumeAt = open && open.position > 15 ? formatClock(open.position) : null;
  return (
    <>
      <TitleTape film={film} sticker={sticker} forName={t?.inAccount ? name : null} />
      {gone ? (
        <Line kind={gone.kind} lead={gone.lead}>
          {gone.text}
        </Line>
      ) : (
        <>
          {!playing &&
            (open ? (
              <ComingBack counter={tapeCounter(open.position)} at={resumeAt} onResume={() => !starting && onPlay()} />
            ) : (
              <div className="fl-playrow">
                <PlayTile onClick={onPlay} disabled={starting} label="Play" />
                {left && <p className="fl-left">{left}</p>}
              </div>
            ))}
          <p className="fl-clock">{clockLines(t, { windowHours: site?.resumeWindowHours ?? 48 }).join(' ')}</p>
          {t.inAccount && <p className="fl-keep">This tape is on your card, so it's on every device you sign in on.</p>}
          {access.canKeep && !playing && <KeepOffer film={film} signedIn={signedIn} onKept={onKept} onNewPasskeys={onNewPasskeys} />}
        </>
      )}
      <p className="fl-privacy">{privacyLine(site, signedIn)}</p>
    </>
  );
}

const KEEP_ERRORS = {
  'playing-elsewhere': { lead: "It's playing on another device right now.", text: "Once it's paused there, you can keep it." },
  'cannot-keep': { lead: "This tape can't be kept any more." },
};
const KEEP_FAILED = { lead: "Couldn't keep it just now.", text: 'Try again in a moment.' };
const KEEP_CONFIRM = 'Keeping this tape puts it on your membership card. Other browsers that opened the link will lose it, and the link will only work for you.';

// A tape for anyone that the owner lets people keep. Signed in: Keep it, after a
// confirmation. Not signed in: Sign in and keep it, which signs in here (the tapes
// this browser opened from links come along) and then keeps it.
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
      setError(KEEP_ERRORS[err.code] || KEEP_FAILED);
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

  const problem = error && (
    <Line kind="bad" lead={error.lead} role="alert">
      {error.text}
    </Line>
  );

  if (signedIn) {
    return (
      <div className="fl-keepoffer">
        {problem}
        <p>Keep this tape on your membership card, so it's on every device you sign in on?</p>
        <div className="ui-btns">
          <button type="button" className="ui-btn" onClick={() => window.confirm(KEEP_CONFIRM) && keep()} disabled={busy}>
            {busy ? 'Keeping…' : 'Keep it'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fl-keepoffer">
      {problem}
      {!signingIn ? (
        <p>
          Keep this tape on your membership card?{' '}
          <button type="button" className="fl-linklike" onClick={() => setSigningIn(true)}>
            Sign in and keep it
          </button>
          . You don't need a card to watch: just press Play.
        </p>
      ) : canUsePasskeys ? (
        <>
          <p>{KEEP_CONFIRM}</p>
          <PasskeySignIn onSignedIn={signedInHere} />
          <div className="ui-btns">
            <button type="button" className="ui-btn ui-btn--quiet" onClick={() => setSigningIn(false)}>
              Not now
            </button>
          </div>
        </>
      ) : (
        <p>This browser can't use passkeys. To keep the tape, open the link you were sent in Safari or Chrome and sign in there.</p>
      )}
    </div>
  );
}
