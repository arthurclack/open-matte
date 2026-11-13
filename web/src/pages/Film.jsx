import { Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, formatClock, formatRuntime } from '../api.js';
import { lazyPart } from '../ErrorBoundary.jsx';
import { ComingBack, PlayScreen, PlayTile } from '../look/crt.jsx';
import { PickCard, PickNote, Sleeve, TillSlip } from '../look/objects.jsx';
import { Line } from '../look/ui.jsx';
import { hostName, nextDeadline, noTapeYet, stickerText, tapeCounter } from '../look/words.js';
import { scrollBehavior } from '../motion.js';
import PasskeySignIn, { NewPasskeys } from '../PasskeySignIn.jsx';
import { supportsPasskeys } from '../passkeys.js';
import { useSite } from '../site.jsx';
import HandBack from './HandBack.jsx';
import { NarrowPage, TitleTape } from './tape.jsx';
import {
  RETURN_ERRORS,
  RETURN_FAILED,
  SLIP_CAPTIONS,
  TAKEN_OUT,
  clockLines,
  endWords,
  goneLine,
  nothingHereWords,
  previewClock,
  previewLine,
  privacyLine,
  returnQuestion,
  signedOutWords,
  slipLines,
} from './tapeWords.js';

// hls.js is large; load it when someone presses Play.
const loadPlayer = () => import('../Player.jsx');
const Player = lazyPart(loadPlayer);

// What Play can be refused with: { lead, text } for a system line. Anything else (no
// connection, a server error) gets one of its own, since nothing on the reloaded page
// would explain it.
const PLAY_ERRORS = {
  'playing-elsewhere': { lead: "It's playing on another device right now.", text: 'Pause it there, or give it a minute, then try again.' },
  'too-many-requests': { lead: 'Play was pressed too many times from this connection.', text: 'Wait a few minutes, then try again.' },
  // The counter explains these after a reload: the tape went out on another link (or
  // in another browser) since the page was read, the link is spent, its start-by has
  // passed, or the film's files broke.
  'no-ticket': null,
  out: null,
  spent: null,
  expired: null,
  unavailable: null,
  'not-found': null, // and after these the page itself goes
  revoked: null,
  unpublished: null,
};
const PLAY_FAILED = { lead: "Couldn't start playback.", text: 'Try again in a moment.' };

// A film's page: the sleeve and the staff pick on the wall, the film and the counter
// beside them. On the counter, the title on label tape with the sticker for the next
// deadline, and Play (or the telly, for a tape that is yours). Pressing it shows the
// machine's PLAY screen in the picture's place, then the film. Handing a tape back is
// a view of this page, not a page of its own.
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
  // owner signing browsers out, the member turned off): the page then says so, and
  // whether the tape was this browser's, from a link anyone can use, which went back
  // then ({ toBrowser }), or a member's own, which signing in again carries on.
  const [signedOut, setSignedOut] = useState(null);
  // The player stopped because the owner took the tape back: the page that follows
  // has no such film (question 6), and says who took it.
  const [takenBack, setTakenBack] = useState(false);
  // The player has stopped for good, for a reason the server gave (the tape went back,
  // the film broke): the counter offers Play or Resume again. Stopping because another
  // device took over offers Watch here instead, in the player.
  const [stopped, setStopped] = useState(false);
  // The film played to its end here: the player shows STOP and the end's choices.
  const [ended, setEnded] = useState(false);
  // Return it now, asked on the page; the return under way; why it was refused.
  const [asking, setAsking] = useState(false);
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState(null);
  // Returned from this page just now: the counter's line is news, and takes the focus.
  const [justReturned, setJustReturned] = useState(false);
  // Hand it back: the view in place of the page.
  const [handingBack, setHandingBack] = useState(false);
  // Play has just taken the tape out here: the counter says so, with the till slip laid
  // out in full (the mock-up's PLAY moment), until the first pause or the end.
  const [justTook, setJustTook] = useState(false);
  const theatreRef = useRef(null);
  const counterRef = useRef(null);
  // Where the focus goes once the counter is drawn again, after a view that had it
  // closed: 'play' (Keep it until …, at the end), 'hand-back' (Hand it back's Not now).
  const focusNext = useRef(null);
  // The tape as the page last read it, for what the player's stop means for it.
  const ticketRef = useRef(null);
  ticketRef.current = data?.access?.ticket ?? null;
  // The front page's ways in to a tape that is out with you (Resume, Play from the
  // start, Return it now, Hand it back) come here with what to do, which is done once.
  const location = useLocation();
  const navigate = useNavigate();
  const goDone = useRef(null);

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
    setSignedOut(null);
    setTakenBack(false);
    setJustTook(false);
    setStopped(false);
    setEnded(false);
    setAsking(false);
    setReturnError(null);
    setJustReturned(false);
    setHandingBack(false);
    load();
  }, [load]);

  useEffect(() => {
    if (data?.film?.title && site?.cinemaName) document.title = `${data.film.title} · ${site.cinemaName}`;
  }, [data?.film?.title, site?.cinemaName]);

  // The header's Sign in link isn't offered while the player is open. Once the page
  // no longer shows the film (after a halt), there's no player.
  const playerOpen = Boolean(screening && data?.film) && !handingBack;
  useEffect(() => {
    setPlayerOpen(playerOpen);
    return () => setPlayerOpen(false);
  }, [playerOpen, setPlayerOpen]);

  // `fromStart`: the tape was watched to the end, and Play starts it again.
  async function play({ fromStart = false } = {}) {
    setMessage(null);
    setReturnError(null);
    setJustReturned(false);
    setStarting(true);
    // The player's code comes while the PLAY screen shows. A part that won't load is
    // the player's to say (the page then asks to be reloaded).
    loadPlayer().catch(() => {});
    try {
      const s = await api.post(`/api/films/${encodeURIComponent(slug)}/screenings`);
      setPicture(false);
      setScreening({ ...s, ...(fromStart && { position: 0 }), key: Date.now() });
      setJustTook(Boolean(s.took));
      setStopped(false);
      setEnded(false);
      requestAnimationFrame(() => theatreRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }));
      // The counter then tells of the tape just taken, not the one Play would take, and
      // so do the front page and the sign-out question (/api/me).
      load(true);
      if (s.took) refreshSite();
    } catch (err) {
      if (!Object.hasOwn(PLAY_ERRORS, err.code)) setMessage(PLAY_FAILED);
      else if (PLAY_ERRORS[err.code]) setMessage(PLAY_ERRORS[err.code]);
      await load(true);
    } finally {
      setStarting(false);
    }
  }

  // Close the player (the end's choices, a return): its last report goes as it unmounts.
  const closePlayer = useCallback(() => {
    setScreening(null);
    setPicture(false);
    setEnded(false);
    setJustTook(false);
  }, []);

  // Something changed on the server (the tape was kept, the player was refused): read
  // the page and the header again.
  const reload = useCallback(
    async (code) => {
      if (code === 'signed-out') setSignedOut({ toBrowser: Boolean(ticketRef.current?.loan?.toBrowser) });
      if (code === 'taken-back' || code === 'revoked') setTakenBack(true);
      await load(true);
      refreshSite();
    },
    [load, refreshSite],
  );

  // The player stopped because the server refused something: find out why.
  const onHalt = useCallback(
    async (code) => {
      setStopped(true);
      setEnded(false);
      setJustTook(false);
      await reload(code);
    },
    [reload],
  );

  // Return it now, once asked: the tape goes back, the player (if open) closes, and the
  // counter says it's back.
  async function returnNow() {
    const takenAt = data?.access?.ticket?.loan?.takenAt;
    setReturning(true);
    setReturnError(null);
    try {
      await api.post(`/api/films/${encodeURIComponent(slug)}/return`, { takenAt });
      closePlayer();
      setAsking(false);
      setJustReturned(true);
    } catch (err) {
      setReturnError(RETURN_ERRORS[err.code] || RETURN_FAILED);
    } finally {
      setReturning(false);
      await load(true);
      refreshSite();
    }
  }

  // From the front page: once the page has read itself, and only for a tape that is
  // still this browser's, do what was pressed there. The address keeps no trace of it,
  // so Back and a reload don't do it again.
  const go = location.state?.go;
  const tapeHere = data?.access?.ticket?.tape;
  useEffect(() => {
    if (!go || data === undefined || goDone.current === location.key) return;
    goDone.current = location.key;
    navigate(location.pathname, { replace: true, state: null });
    if (tapeHere !== 'yours' || data?.access?.preview) return;
    if (go === 'play') play();
    else if (go === 'play-from-start') play({ fromStart: true });
    else if (go === 'return') {
      setReturnError(null);
      setAsking(true);
    } else if (go === 'hand-back') handBack();
    // play and handBack are this render's; the effect runs once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go, data, tapeHere, location.key, location.pathname, navigate]);

  // The counter's line once it's back takes the focus, so the news is where you are.
  useEffect(() => {
    if (justReturned && data?.access?.ticket?.state === 'spent') counterRef.current?.querySelector('.fl-gone')?.focus({ preventScroll: false });
  }, [justReturned, data]);

  // Back from a view that had the focus (the end's Keep it until …, Hand it back's Not
  // now): it goes to the counter's way on, not to the page's top.
  useEffect(() => {
    const what = focusNext.current;
    if (!what || handingBack || screening || !counterRef.current) return;
    const el =
      what === 'hand-back'
        ? [...counterRef.current.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Hand it back')
        : counterRef.current.querySelector('.crt-play, .osd__btn');
    // Once, whether or not it's there (a tape handed back from another device meanwhile
    // has no Hand it back to go to): never later, on another loan.
    focusNext.current = null;
    el?.focus({ preventScroll: false });
  }, [data, handingBack, screening]);

  // From the end of the film, or the counter: the view for handing it back.
  function handBack() {
    closePlayer();
    setAsking(false);
    setHandingBack(true);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // From the end of the film: ask, on the counter.
  function askToReturn() {
    closePlayer();
    setAsking(true);
    load(true);
  }

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
    const words = signedOutWords(site, signedOut);
    return (
      <NarrowPage>
        <h1>{words.heading}</h1>
        <p>{words.text}</p>
        <div className="ui-btns">
          {words.signIn && (
            <Link to={`/signin?next=${encodeURIComponent(`/${slug}`)}`} className="ui-btn ui-btn--primary">
              Sign in
            </Link>
          )}
          <Link to="/" className="ui-btn">
            Go to the front page
          </Link>
        </div>
      </NarrowPage>
    );
  }
  if (data === null) return <NothingHere words={nothingHereWords(site, { takenBack })} />;

  const { film, access } = data;
  const t = access.ticket;
  const meta = [film.year, formatRuntime(film.runtimeMinutes), film.directors && `directed by ${film.directors}`, film.country].filter(Boolean).join(', ');

  if (handingBack && t?.tape === 'yours') {
    return (
      <HandBack
        film={film}
        ticket={t}
        site={site}
        onReturned={async () => {
          setHandingBack(false);
          setJustReturned(true);
          await load(true);
          refreshSite();
        }}
        onClose={async () => {
          focusNext.current = 'hand-back';
          setHandingBack(false);
          await load(true);
        }}
      />
    );
  }

  // The end of the film, under STOP: still theirs, and what next.
  const end = t?.tape === 'yours' && !access.preview && (
    <EndChoices
      film={film}
      ticket={t}
      onHandBack={handBack}
      onReturn={askToReturn}
      onKeep={() => {
        focusNext.current = 'play';
        closePlayer();
        load(true);
      }}
    />
  );

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
                  dueBack={t?.dueBack ?? screening.dueBack ?? null}
                  onEnded={(atEnd) => {
                    setEnded(atEnd);
                    if (atEnd) setJustTook(false);
                  }}
                  onPaused={() => setJustTook(false)}
                  end={end || null}
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
        <div className="fl-counter" ref={counterRef}>
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
            took={justTook && !stopped}
            ended={ended}
            asking={asking}
            onAsk={() => {
              setReturnError(null);
              setAsking(true);
            }}
            onCancelAsk={() => setAsking(false)}
            onReturn={returnNow}
            returning={returning}
            returnError={returnError}
            justReturned={justReturned}
            onHandBack={handBack}
            onKept={reload}
            onNewPasskeys={setNewPasskeys}
          />
        </div>
      </div>
    </article>
  );
}

// The end of the film, in plain type under the STOP strip: the tape is still theirs
// until it's due back, and three choices: hand it back with a note (a member on their
// own link), return it now (asked on the counter), or keep it, which closes the player.
// The bar under the picture, where the focus may have been, goes as this comes: the
// heading takes the focus then (which reads the end aloud), but never from somewhere
// else on the page, such as the counter.
function EndChoices({ film, ticket, onHandBack, onReturn, onKeep }) {
  const words = endWords(film.title, ticket);
  const id = `end${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const headingRef = useRef(null);
  useEffect(() => {
    const at = document.activeElement;
    if (!at || at === document.body || at.tagName === 'VIDEO' || at.closest?.('.fl-theatre')) headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section className="fl-end" aria-labelledby={id}>
      <h2 id={id} ref={headingRef} tabIndex={-1}>
        {words.heading}
      </h2>
      <p>{words.text}</p>
      <div className="ui-btns">
        {ticket.loan?.canRespond && (
          <button type="button" className="ui-btn ui-btn--primary" onClick={onHandBack}>
            Hand it back
          </button>
        )}
        <button type="button" className="ui-btn" onClick={onReturn}>
          Return it now
        </button>
        <button type="button" className="ui-btn ui-btn--quiet" onClick={onKeep}>
          {words.keep}
        </button>
      </div>
    </section>
  );
}

// No such film here: none, or off the shelf, or no tape for it in this browser. A tape
// taken back looks the same, as a cancelled link does (question 6); when the player was
// stopped by it on this page, the page also says who took it back, as the player did.
function NothingHere({ words }) {
  return (
    <NarrowPage>
      <h1>{words.heading}</h1>
      {words.takenBack && <Line kind="info" lead={words.takenBack} />}
      <p>{words.text}</p>
      <div className="ui-btns">
        <Link to="/" className="ui-btn">
          Go to the front page
        </Link>
      </div>
    </NarrowPage>
  );
}

// Whether the clock on the page should move: the date Play would make a tape due back
// is now plus its days, so it is read again each minute while the tape is in.
function useNow(ticking) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

// The counter: what this browser's tape can do now. By the tape (docs/version-2.md,
// "What a viewer sees"):
//   in      Play takes it out, on a two-line sticker with the date it would be due;
//   out     out on loan with someone else: the date it's back, the same for everyone
//           but its borrower, with no Play, no start-by and no keep offer;
//   yours   the telly to resume (or Play from the start, once watched to the end),
//           until when, Return it now asked on the page, Hand it back for a member on
//           their own link, and the receipt;
// then spent, start-by missed, and a film whose files are broken, which keeps the
// tape's date and, for its borrower, Return it now.
function Counter(props) {
  const { access, film, site, name, onPlay, starting, playing, took, ended, onKept, onNewPasskeys } = props;
  const t = access.ticket;
  const signedIn = Boolean(name);
  const now = useNow(t?.tape === 'in' && t?.state === 'ok');

  // The owner's own browser: a preview, which never takes the tape. It says who has it.
  if (access.preview) return <PreviewCounter access={access} film={film} onPlay={onPlay} starting={starting} playing={playing} />;

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
  const yours = t.tape === 'yours';
  const canPlay = t.state === 'ok';
  const finished = yours && Boolean(t.loan?.finishedAt);
  const lines = clockLines(t, { now });
  const position = t.loan?.position ?? 0;
  const resumeAt = position > 15 ? formatClock(position) : null;
  return (
    <>
      <TitleTape film={film} sticker={stickerText(nextDeadline(t, now))} forName={t.inAccount ? name : null} />
      {/* The owner's note to whoever has this link, in every state the page shows: the
          link's own, never the film's staff pick (that's the card on the wall). */}
      {t.pickNote && <PickNote text={t.pickNote} site={site} seed={film.slug} />}
      {gone && (
        <div className="fl-gone" tabIndex={-1}>
          <Line kind={gone.kind} lead={gone.lead} role={props.justReturned ? 'status' : undefined}>
            {gone.text}
          </Line>
          {gone.more && <p className="fl-clock">{gone.more}</p>}
        </div>
      )}
      {playing && took && (
        <Line kind="done" lead={TAKEN_OUT.lead} role="status">
          {TAKEN_OUT.text}
        </Line>
      )}
      {!playing &&
        canPlay &&
        (!yours ? (
          <div className="fl-playrow">
            <PlayTile onClick={() => onPlay()} disabled={starting} label="Play" />
          </div>
        ) : finished ? (
          <div className="fl-playrow">
            <PlayTile onClick={() => onPlay({ fromStart: true })} disabled={starting} label="Play from the start" />
          </div>
        ) : (
          <ComingBack counter={tapeCounter(position)} at={resumeAt} onResume={() => !starting && onPlay()} resumeLabel={resumeAt ? `Resume at ${resumeAt}` : 'Resume'} />
        ))}
      {lines.length > 0 && !(playing && (ended || took)) && (
        <p className="fl-clock">
          {finished ? (
            <>
              <b>{lines[0]}</b> {lines.slice(1).join(' ')}
            </>
          ) : (
            lines.join(' ')
          )}
        </p>
      )}
      {/* A tape for one member says so on the "For Sam only" strip above: question 11's
          table has "On your card" for what you have out, so the page doesn't say a tape
          or a link is "on your card" in 1.1.0's sense. */}
      {yours && !(playing && ended) && <ReturnControls film={film} ticket={t} {...props} />}
      {yours && <Receipt lines={slipLines(t, { name, film, site })} seed={`${film.slug}:${t.loan?.takenAt}`} fresh={playing && took} />}
      {access.canKeep && !playing && <KeepOffer film={film} signedIn={signedIn} onKept={onKept} onNewPasskeys={onNewPasskeys} />}
      <p className="fl-privacy">{privacyLine(site, signedIn)}</p>
    </>
  );
}

// Return it now, and for a member on their own link Hand it back (question 13: at any
// time while they have it). Return it now asks first, on the page: the link won't take
// the tape out again.
function ReturnControls({ film, ticket, asking, onAsk, onCancelAsk, onReturn, returning, returnError, onHandBack }) {
  const askRef = useRef(null);
  const buttonRef = useRef(null);
  // False at first, so the question opened from the end of the film takes the focus too.
  const wasAsking = useRef(false);
  const id = `ra${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // Asking moves the focus to the question; Keep it gives it back to Return it now.
  useEffect(() => {
    if (asking && !wasAsking.current) {
      askRef.current?.focus({ preventScroll: true });
      askRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
    }
    if (!asking && wasAsking.current) buttonRef.current?.focus();
    wasAsking.current = asking;
  }, [asking]);
  const q = returnQuestion(film.title);
  const problem = returnError && (
    <Line kind="bad" lead={returnError.lead} role="alert">
      {returnError.text}
    </Line>
  );
  if (asking) {
    return (
      <div className="ui-line ui-line--warn ui-line--block fl-ask" role="group" aria-labelledby={id}>
        <div>
          <p id={id} ref={askRef} tabIndex={-1}>
            <b>{q.lead}</b> {q.text}
          </p>
          {problem}
          <div className="ui-btns">
            <button type="button" className="ui-btn ui-btn--primary" onClick={onReturn} disabled={returning}>
              {returning ? 'Returning…' : 'Return it'}
            </button>
            <button type="button" className="ui-btn" onClick={onCancelAsk} disabled={returning}>
              Keep it
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
      {problem}
      <div className="ui-btns">
        {ticket.loan?.canRespond && (
          // Watched to the end, handing it back is the way on.
          <button type="button" className={`ui-btn${ticket.loan.finishedAt ? ' ui-btn--primary' : ''}`} onClick={onHandBack}>
            Hand it back
          </button>
        )}
        <button type="button" className="ui-btn" onClick={onAsk} ref={buttonRef}>
          Return it now
        </button>
      </div>
    </>
  );
}

// The receipt: the till slip printed when Play took the tape. Folded away under one
// quiet line, so the due date isn't said five times; laid out in full just after Play
// has printed it (`fresh`), as the mock-up's PLAY moment has it.
function Receipt({ lines, seed, fresh }) {
  if (!lines.length) return null;
  if (fresh) {
    return (
      <div className="fl-receipt__in fl-receipt__in--fresh">
        <TillSlip lines={lines} seed={seed} />
        <p className="fl-receipt__cap">{SLIP_CAPTIONS.fresh}</p>
      </div>
    );
  }
  return (
    <details className="fl-receipt">
      <summary>Your receipt</summary>
      <div className="fl-receipt__in">
        <TillSlip lines={lines} seed={seed} />
        <p className="fl-receipt__cap">{SLIP_CAPTIONS.kept}</p>
      </div>
    </details>
  );
}

// The owner's own browser: who has the tape, since when and until when, which friends
// never see; Play, which never takes the tape here; and how to try a link as a friend
// would, which does.
function PreviewCounter({ access, film, onPlay, starting, playing }) {
  const tape = access.tape ?? null;
  const line = previewLine(tape);
  const sticker = tape?.out ? stickerText(nextDeadline({ tape: 'out', dueBack: tape.dueAt })) : null;
  return (
    <>
      <TitleTape film={film} sticker={sticker} />
      {!access.published && <Line kind="info">This film isn't on the shelf, so friends can't see it yet.</Line>}
      <Line kind="info" lead={line.lead}>
        {line.text}
      </Line>
      {!playing && (
        <div className="fl-playrow">
          <PlayTile onClick={() => onPlay()} disabled={starting || access.mediaStatus === 'error' || access.mediaStatus === 'missing'} label="Play" />
        </div>
      )}
      <p className="fl-clock">{previewClock(tape).join(' ')}</p>
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
