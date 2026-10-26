// A thin fetch wrapper. Errors carry the server's error code and HTTP status.
export class ApiError extends Error {
  constructor(status, code) {
    super(code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

async function request(method, url, body, { keepalive = false } = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    keepalive,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}, opts) => request('POST', url, body, opts),
  patch: (url, body = {}) => request('PATCH', url, body),
};

// ---- formatting

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const formatDate = (ms) => (ms ? dateFmt.format(new Date(ms)) : '');
export const formatDateTime = (ms) => (ms ? dateTimeFmt.format(new Date(ms)) : '');

export function formatAgo(ms, now = Date.now()) {
  if (!ms) return 'never';
  const s = Math.round((now - ms) / 1000);
  if (s < 0) return `in ${formatSpan(-s)}`;
  if (s < 45) return 'just now';
  return `${formatSpan(s)} ago`;
}

function formatSpan(s) {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

export function formatClock(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function formatRuntime(minutes) {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${m ? `${m} min` : ''}`.trim() : `${m} min`;
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1000)));
  return `${(n / 1000 ** i).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
