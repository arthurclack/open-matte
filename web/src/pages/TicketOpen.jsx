import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useSite } from '../site.jsx';

// /t/<code>: trade the ticket code for a session, then move to the film's
// clean URL so the code doesn't linger in the address bar or history.
export default function TicketOpen() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { refresh } = useSite();
  const started = useRef(false);
  // Couldn't reach the server (offline, or mid-restart): the ticket may be fine.
  const [unreachable, setUnreachable] = useState(false);

  const open = useCallback(() => {
    setUnreachable(false);
    api
      .post('/api/tickets/open', { code })
      .then(({ slug }) => {
        refresh();
        navigate(`/${slug}`, { replace: true });
      })
      .catch((err) => {
        if (!err.status || err.status >= 500) return setUnreachable(true);
        navigate(`/?notice=${encodeURIComponent(err.code || 'unknown-ticket')}`, { replace: true });
      });
  }, [code, navigate, refresh]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    open();
  }, [open]);

  return (
    <div className="narrow" style={{ paddingTop: '20vh' }}>
      {unreachable ? (
        <>
          <p>Couldn't reach the cinema just now. Check your connection, then try again: your ticket hasn't been used.</p>
          <button className="btn primary" onClick={open}>
            Try again
          </button>
        </>
      ) : (
        <p className="dim">Opening your ticket…</p>
      )}
    </div>
  );
}
