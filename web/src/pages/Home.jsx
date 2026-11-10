import { Link, useSearchParams } from 'react-router-dom';
import { Sleeve, Sticker } from '../look/objects.jsx';
import { Line } from '../look/ui.jsx';
import { hostName, nextDeadline, noTapeYet, stickerText } from '../look/words.js';
import { useSite } from '../site.jsx';
import { Host, shelfLines } from './tapeWords.js';

// What a tape's link can bring someone back here with (TicketOpen.jsx), and nothing
// else: a link's ?notice= could name anything, __proto__ included.
const NOTICES = {
  'unknown-ticket': (site) => ({ kind: 'bad', lead: "That link doesn't work.", text: `Check that you copied all of it, or ask ${hostName(site)}.` }),
  'ticket-revoked': (site) => ({ kind: 'info', lead: `${Host(site)} has taken that tape back.` }),
  'ticket-kept': (site) => ({ kind: 'info', lead: "That tape has been kept on someone's membership card.", text: `It only works for them now. Ask ${hostName(site)}.` }),
  'film-unavailable': () => ({ kind: 'info', lead: "That film isn't available at the moment." }),
  'too-many-requests': () => ({ kind: 'warn', lead: 'Too many attempts from this connection.', text: 'Wait a few minutes, then open the link again.' }),
};

// The front page. Signed in: your tapes, and the films on the shelf for members.
// Signed out: the shop's name and its welcome (the owner's own words), or the tapes
// this browser opened from links.
export default function Home() {
  const { me, site } = useSite();
  const [params] = useSearchParams();
  const key = params.get('notice');
  const notice = Object.hasOwn(NOTICES, key) ? NOTICES[key](site) : null;
  if (!me) return null;

  const signedIn = Boolean(me.person);
  // The server gives the best tape per film, newest first, from this browser's links and
  // the person's card alike. A paused one comes first (a stable sort).
  const tapes = [...me.tickets].sort((a, b) => Boolean(b.ticket?.openScreening) - Boolean(a.ticket?.openScreening));
  // Films on the shelf for members that none of those tapes is for. Listed, not playable.
  const memberFilms = me.memberFilms || [];
  const shelf = tapes.length > 0 && (
    <ul className="fl-shelf">
      {tapes.map(({ film, ticket }) => (
        <Facing key={film.slug} film={film} level={signedIn ? 2 : 3} sticker={stickerText(nextDeadline(ticket))} lines={shelfLines(ticket, { signedIn })} />
      ))}
    </ul>
  );

  return (
    <div className="fl-home ui-w">
      <h1>{signedIn ? 'Your tapes' : site?.cinemaName}</h1>
      {notice && (
        <Line kind={notice.kind} lead={notice.lead} className="fl-notice">
          {notice.text}
        </Line>
      )}

      {tapes.length === 0 &&
        (signedIn ? (
          <p className="fl-lede">
            <b>No tapes yet.</b> When {hostName(site)} sends you a tape, it'll be here.
          </p>
        ) : (
          <p className="fl-lede">{site?.welcome}</p>
        ))}

      {signedIn
        ? shelf
        : shelf && (
            <section className="fl-sec" aria-labelledby="fl-yours">
              <h2 id="fl-yours">Your tapes</h2>
              {shelf}
            </section>
          )}

      {memberFilms.length > 0 && (
        <section className="fl-sec" aria-labelledby="fl-members">
          <h2 id="fl-members">On the shelf for members</h2>
          <ul className="fl-shelf">
            {memberFilms.map((film) => (
              <Facing key={film.slug} film={film} level={3} lines={[noTapeYet(site)]} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// A sleeve face out on the shelf, with the next deadline's sticker on it, then the
// title and a line or two. The sleeve is a picture of what the lines say, so it's
// hidden from screen readers and left out of the tab order: the title is the link.
function Facing({ film, sticker, lines, level }) {
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
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </li>
  );
}
