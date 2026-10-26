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

  return (
    <div className="wrap">
      <section className="home-hero">
        <h1>{site?.cinemaName}</h1>
        {notice && <div className="notice bad">{notice}</div>}
        {me.tickets.length === 0 && <p>{site?.welcome}</p>}
      </section>

      {me.tickets.length > 0 && (
        <section>
          <h2>Your tickets</h2>
          <div className="shelf">
            {me.tickets.map(({ film, ticket }) => (
              <Link key={film.slug} to={`/${film.slug}`} className="shelf-item">
                <Poster film={film} />
                <div className="meta">
                  <div>{film.title}</div>
                  <div className="faint">{ticketSummary(ticket)}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
