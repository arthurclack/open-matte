import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatClock, formatRuntime } from '../api.js';
import { ComingBack, PlayTile } from '../look/crt.jsx';
import { Sleeve, Sticker, TillSlip } from '../look/objects.jsx';
import { Line } from '../look/ui.jsx';
import { nextDeadline, stickerText, tapeCounter } from '../look/words.js';
import { useSite } from '../site.jsx';
import { TitleTape } from './tape.jsx';
import { clockLines, memberShelfLines, noTapesYet, noticeFor, sectionWords, shelfLines, shelfSections, slipLines } from './tapeWords.js';

// The front page, in sections (docs/version-2.md, slice 8). Signed in, "Your tapes":
//   On your card         what you have out on your own links, when it's due back, and
//                        the way back in (Resume, Return it now, the receipt);
//   Out to this browser  what this browser took out from a link anyone can use;
//   Picked for you       the other tapes the owner sent you;
//   On this device       the other tapes this browser opened from links;
//   On the shelf for members  in the shop, or out on loan until a day, never who.
// Signed out: the shop's name, what is out to this browser, then its other tapes, or
// the shop's welcome (the owner's own words) when it holds none.
export default function Home() {
  const { me, site, refresh } = useSite();
  const [params] = useSearchParams();
  const notice = noticeFor(params.get('notice'), site);
  // Read /api/me again on every arrival, as the film page reads itself: a tape taken
  // out, handed back or returned on another page or device since is shown as it is now.
  // (Reading never clears `me`, so the page doesn't blank meanwhile.)
  useEffect(() => {
    refresh();
  }, [refresh]);
  if (!me) return null;

  const signedIn = Boolean(me.person);
  // The server gives the best tape per film, from this browser's links and the person's
  // card alike, in its order: what is out with you first, the soonest due back first.
  const s = shelfSections(me.tickets);
  const words = sectionWords(site, { signedIn });
  const memberFilms = me.memberFilms || [];
  const nothing = me.tickets.length === 0;

  return (
    <div className="fl-home ui-w">
      <h1>{signedIn ? 'Your tapes' : site?.cinemaName}</h1>
      {notice && (
        <Line kind={notice.kind} lead={notice.lead} className="fl-notice">
          {notice.text}
        </Line>
      )}

      {nothing &&
        (signedIn ? (
          <p className="fl-lede">
            <b>{noTapesYet(site).lead}</b> {noTapesYet(site).text}
          </p>
        ) : (
          <p className="fl-lede">{site?.welcome}</p>
        ))}

      <OutSection id="fl-card" words={words.card} items={s.card} name={me.person?.name} />
      <OutSection id="fl-browser" words={words.browser} items={s.browser} name={null} />
      <ShelfSection id="fl-picked" words={words.picked} items={s.picked} />
      <ShelfSection id="fl-links" words={words.links} items={s.links} />

      {memberFilms.length > 0 && (
        <section className="fl-sec" aria-labelledby="fl-members">
          <SectionHead id="fl-members" words={words.members} />
          <ul className="fl-shelf">
            {memberFilms.map((film) => (
              <Facing key={film.slug} film={film} level={3} sticker={film.tape === 'out' ? shelfSticker({ tape: 'out', dueBack: film.dueBack }) : null} lines={memberShelfLines(film, site)} ask />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SectionHead({ id, words }) {
  return (
    <>
      <h2 id={id}>{words.heading}</h2>
      {words.sub && <p className="fl-sub">{words.sub}</p>}
    </>
  );
}

// A shelf of sleeves face out: the tapes sent, waiting, or done with.
function ShelfSection({ id, words, items }) {
  const { site } = useSite();
  if (!items.length) return null;
  return (
    <section className="fl-sec" aria-labelledby={id}>
      <SectionHead id={id} words={words} />
      <ul className="fl-shelf">
        {items.map(({ film, ticket }) => (
          <Facing key={film.slug} film={film} level={3} sticker={shelfSticker(ticket)} lines={shelfLines(ticket, { site })} />
        ))}
      </ul>
    </section>
  );
}

// What you have out: one row each, as the film page's counter has it.
function OutSection({ id, words, items, name }) {
  if (!items.length) return null;
  return (
    <section className="fl-sec" aria-labelledby={id}>
      <SectionHead id={id} words={words} />
      <div className="fl-out">
        {items.map(({ film, ticket }) => (
          <OutRow key={film.slug} film={film} ticket={ticket} name={name} />
        ))}
      </div>
    </section>
  );
}

// A tape out with you: the sleeve, the film, its label tape with the due date on the
// sticker, the telly to go on (Resume, or Play from the start once watched to the end),
// until when, Hand it back (a member on their own link) and Return it now, and the
// receipt printed when Play took it. Each way in goes to the film's page, which does it
// there: the player is on that page, and so is the question Return it now asks.
function OutRow({ film, ticket: t, name }) {
  const { site } = useSite();
  const navigate = useNavigate();
  const go = (what) => navigate(`/${film.slug}`, { state: { go: what } });
  const meta = [film.year, formatRuntime(film.runtimeMinutes), film.directors && `directed by ${film.directors}`].filter(Boolean).join(', ');
  const lines = clockLines(t);
  const finished = Boolean(t.loan?.finishedAt);
  const canPlay = t.state === 'ok';
  const position = t.loan?.position ?? 0;
  const resumeAt = position > 15 ? formatClock(position) : null;
  return (
    <div className="fl-oc">
      <Link className="fl-oc__sleeve" to={`/${film.slug}`} tabIndex={-1} aria-hidden="true">
        <Sleeve film={film} logo={site?.logo} />
      </Link>
      <div className="fl-oc__head">
        <h3>
          <Link to={`/${film.slug}`}>{film.title}</Link>
        </h3>
        {meta && <p>{meta}</p>}
      </div>
      <div className="fl-oc__tape">
        <TitleTape film={film} sticker={stickerText(nextDeadline(t))} />
      </div>
      {canPlay && (
        <div className="fl-oc__telly">
          {finished ? (
            // Each name starts with the words on the button, then the film (a voice
            // user says what they see), as do Hand it back and Return it now below.
            <PlayTile onClick={() => go('play-from-start')} label={`Play from the start: ${film.title}`} />
          ) : (
            <ComingBack counter={tapeCounter(position)} at={resumeAt} onResume={() => go('play')} resumeLabel={resumeAt ? `Resume at ${resumeAt}: ${film.title}` : `Resume: ${film.title}`} />
          )}
        </div>
      )}
      <div className="fl-oc__body">
        {lines.length > 0 && (
          <p>
            {finished ? (
              <>
                <b>{lines[0]}</b> {lines.slice(1).join(' ')}
              </>
            ) : (
              lines.join(' ')
            )}
          </p>
        )}
        <div className="ui-btns">
          {t.loan?.canRespond && (
            <button type="button" className={`ui-btn${finished ? ' ui-btn--primary' : ''}`} onClick={() => go('hand-back')} aria-label={`Hand it back: ${film.title}`}>
              Hand it back
            </button>
          )}
          <button type="button" className="ui-btn" onClick={() => go('return')} aria-label={`Return it now: ${film.title}`}>
            Return it now
          </button>
        </div>
      </div>
      <div className="fl-oc__slip">
        <TillSlip lines={slipLines(t, { name, film, site })} seed={`${film.slug}:${t.loan?.takenAt}`} />
      </div>
    </div>
  );
}

// The sticker on a sleeve face out: the tape's one date, on one line. Before Play the
// date it would be due back isn't a deadline, so a tape that is in shows only a start-by.
function shelfSticker(ticket) {
  const d = nextDeadline(ticket);
  if (!d || (d.top && ticket.tape === 'in')) return null;
  return stickerText({ ...d, top: null });
}

// A sleeve face out on the shelf, with the next deadline's sticker on it, then the
// title and a line or two. The sleeve is a picture of what the lines say, so it's
// hidden from screen readers and left out of the tab order: the title is the link.
// `ask`: the last line is whom to ask for a tape, which stands out a little.
function Facing({ film, sticker, lines, level, ask = false }) {
  const { site } = useSite();
  const Heading = `h${level}`;
  return (
    <li className="fl-facing">
      <Link className="fl-facing__sleeve" to={`/${film.slug}`} tabIndex={-1} aria-hidden="true">
        <Sleeve film={film} logo={site?.logo} />
        {sticker && (
          <span className="fl-facing__stk">
            <Sticker label={sticker.label} value={sticker.value} seed={`face:${film.slug}`} />
          </span>
        )}
      </Link>
      <Heading className="fl-facing__t">
        <Link to={`/${film.slug}`}>{film.title}</Link>
      </Heading>
      {lines.map((line, i) => (
        <p key={line} className={ask && i === lines.length - 1 ? 'fl-ask' : undefined}>
          {line}
        </p>
      ))}
    </li>
  );
}
