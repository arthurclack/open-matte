// A tiny fixed-window limiter, keyed by client. Enough for one small server.
const MAX_CLIENTS = 10000;

// IPv6 clients are counted by their /64, which one household or one server
// usually holds in full. IPv4 addresses (including IPv4-mapped IPv6) as they are.
export function clientKey(ip = '') {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('%')[0].split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

// Counts each call against its client: true while the client is within `max`
// calls per window, false once it's over. For pages, which answer differently
// over the limit rather than refusing. `scale` multiplies max, for test suites
// that sign in many times from one address.
export function rateCounter({ windowMs, max, scale = 1 }) {
  const limit = max * scale;
  // Insertion order is reset order: an entry moves to the end whenever its window
  // starts again, so when the map is full the first entry ends soonest.
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();

  const count = (req) => {
    const now = Date.now();
    const key = clientKey(req.ip);
    let h = hits.get(key);
    if (!h || h.reset <= now) {
      hits.delete(key);
      // Never refuse someone because the map is full: forget the window that ends soonest.
      if (hits.size >= MAX_CLIENTS) hits.delete(hits.keys().next().value);
      hits.set(key, (h = { count: 0, reset: now + windowMs }));
    }
    return ++h.count <= limit;
  };
  // Seconds until the client's window starts again.
  count.retryAfter = (req) => {
    const h = hits.get(clientKey(req.ip));
    return h ? Math.max(0, Math.ceil((h.reset - Date.now()) / 1000)) : 0;
  };
  return count;
}

// The same, as middleware for API calls: over the limit is a 429.
export function rateLimit(opts) {
  const count = rateCounter(opts);
  return (req, res, next) => {
    if (count(req)) return next();
    res.set('Retry-After', String(count.retryAfter(req)));
    res.status(429).json({ error: 'too-many-requests' });
  };
}
