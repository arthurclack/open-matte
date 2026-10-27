import { Link, useSearchParams } from 'react-router-dom';
import { useSite } from '../site.jsx';
import { Poster, ticketSummary } from './shared.jsx';

const NOTICES = {
  'unknown-ticket': "That ticket link doesn't work. Check that you copied all of it, or ask whoever sent it.",
  'ticket-revoked': 'That ticket has been cancelled.',
  'film-unavailable': "That film isn't showing at the moment.",
  'too-many-requests': 'Too many attempts from this connection. Wait a few minutes, then open the link again.',
};

export default function Home() {
  const { me, site } = useSite();
  const [params] = useSearchParams();
  const notice = NOTICES[params.get('notice')];
  if (!me) return null;

  const signedIn = Boolean(me.person);
  // The server gives the best ticket per film, newest first, from this browser's
  // links and the person's account alike. Open screenings come first (a stable sort).
  const tickets = [...me.tickets].sort((a, b) => Boolean(b.ticket?.openScreening) - Boolean(a.ticket?.openScreening));
  // Films shown to members that none of those tickets is for. Listed, not playable.
  const memberFilms = me.memberFilms || [];

  return (
    <div className="wrap">
      <section className="home-hero">
        <h1>{site?.cinemaName}</h1>
        {notice && <div className="notice bad">{notice}</div>}
        {tickets.length === 0 && <p>{signedIn ? "No tickets yet. When someone sends you one, it'll be here." : site?.welcome}</p>}
      </section>

      {tickets.length > 0 && (
        <section>
          <h2>Your tickets</h2>
          <div className="shelf">
            {tickets.map(({ film, ticket }) => (
              <Link key={film.slug} to={`/${film.slug}`} className="shelf-item">
                <Poster film={film} />
                <div className="meta">
                  <div>{film.title}</div>
                  <div className="faint">
                    {ticketSummary(ticket)}
                    {/* A link ticket lives in this browser; an account ticket follows the person. */}
                    {signedIn && !ticket?.inAccount && ' · on this device only'}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {memberFilms.length > 0 && (
        <section>
          <h2>Showing to members</h2>
          <div className="shelf">
            {memberFilms.map((film) => (
              <Link key={film.slug} to={`/${film.slug}`} className="shelf-item">
                <Poster film={film} />
                <div className="meta">
                  <div>{film.title}</div>
                  <div className="faint">No ticket yet</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
