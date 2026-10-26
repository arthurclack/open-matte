import { formatDate, plural } from '../api.js';

export function Poster({ film, className = '' }) {
  if (film.posterUrl) return <img className={`poster ${className}`} src={film.posterUrl} alt="" />;
  return <div className={`poster placeholder ${className}`}>{film.title}</div>;
}

// One line about a ticket for the shelf on the home page.
export function ticketSummary(ticket) {
  if (!ticket) return '';
  switch (ticket.state) {
    case 'used_up':
      return 'All screenings used';
    case 'expired':
      return 'Expired';
    case 'unavailable':
      return 'Not showing right now';
    default:
      if (ticket.openScreening) return `Resume until ${formatDate(ticket.openScreening.resumableUntil)}`;
      if (ticket.screeningsLeft != null) return plural(ticket.screeningsLeft, 'screening') + ' left';
      return 'Ready to watch';
  }
}
