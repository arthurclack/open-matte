// A tiny fixed-window limiter, keyed by client. Enough for one small server.
const MAX_CLIENTS = 10000;

// IPv6 clients are counted by their /64, which one household or one server
// usually holds in full. IPv4 addresses (including IPv4-mapped IPv6) as they are.
// `bits` counts an IPv6 client by a shorter prefix instead, a multiple of 16: 48
// for the range a whole site is given (rangeKey, below).
export function clientKey(ip = '', bits = 64) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('%')[0].split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, bits / 16).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/${bits}`;
}

// An IPv6 client's /48, or null for an IPv4 one, which a limit keyed by this
// leaves alone. A tunnel broker hands anyone a /48 for nothing, and with it 65,536
// /64s, each of them a client of its own to a limit keyed by clientKey.
export function rangeKey(ip = '') {
  const key = clientKey(ip, 48);
  return key.includes(':') ? key : null;
}

// Counts each call against its client: true while the client is within `max`
// calls per window, false once it's over. For pages, which answer differently
// over the limit rather than refusing. `scale` multiplies max, for test suites
// that sign in many times from one address. `key` names a request's client from
// its address (clientKey unless given), or null for one this limit doesn't count.
export function rateCounter({ windowMs, max, scale = 1, key: keyOf = clientKey }) {
  const limit = max * scale;
  // Insertion order is reset order: an entry moves to the end whenever its window
  // starts again, so when the map is full the first entry ends soonest.
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();

  const count = (req) => {
    const key = keyOf(req.ip);
    if (key === null) return true;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset <= now) {
      hits.delete(key);
      // Never refuse someone because the map is full: forget the window that ends soonest.
      if (hits.size >= MAX_CLIENTS) hits.delete(hits.keys().next().value);
      hits.set(key, (h = { count: 0, reset: now + windowMs }));
    }
    return ++h.count <= limit;
  };
  // Whether the client is over the limit already, without counting this call. For
  // a route that counts only some of its answers, once it knows which it gives.
  count.over = (req) => {
    const key = keyOf(req.ip);
    const h = key === null ? undefined : hits.get(key);
    return Boolean(h && h.reset > Date.now() && h.count >= limit);
  };
  // Seconds until the client's window starts again.
  count.retryAfter = (req) => {
    const h = hits.get(keyOf(req.ip));
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
