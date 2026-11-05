// A thin fetch wrapper. Errors carry the server's error code and HTTP status.
export class ApiError extends Error {
  constructor(status, code) {
    super(code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

async function send(url, init) {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error);
  return data;
}

const request = (method, url, body, { keepalive = false } = {}) =>
  send(url, {
    method,
    keepalive,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}, opts) => request('POST', url, body, opts),
  patch: (url, body = {}) => request('PATCH', url, body),
  // A file as the whole body, labelled with its own type. The server goes by the bytes:
  // the type only gets the request past the rule that /api takes JSON. A file with no
  // type goes without a label, never with an empty one.
  upload: (url, file) => send(url, { method: 'POST', headers: file.type ? { 'content-type': file.type } : {}, body: file }),
};

// ---- formatting

// The hour has no leading zero on a 12-hour clock ("8:49 PM", not "08:49 PM") and keeps
// it on a 24-hour one ("08:49"). Asked for 'numeric' there, Firefox keeps the zero and
// Chromium and WebKit drop it, so '2-digit' is the only way all three agree.
const twelveHour = ['h11', 'h12'].includes(new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle);
const hour = twelveHour ? 'numeric' : '2-digit';

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour, minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour, minute: '2-digit' });
// With the year as well, for a time that may be in another year, such as a deadline that has passed.
const dateTimeYearFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour, minute: '2-digit' });

// With the weekday, for things that happen within a week or so: "Tue 29 Oct", "Tue 29 Oct, 21:00".
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const dayTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour, minute: '2-digit' });

// A space inside the time, as before the PM in "8:49 PM", becomes a no-break space,
// so a phone's narrow column can't leave the PM on a line of its own.
const timeParts = new Set(['hour', 'minute', 'dayPeriod']);
const withTime = (fmt) => (ms) =>
  fmt
    .formatToParts(new Date(ms))
    .map((p, i, all) => (p.type === 'literal' && timeParts.has(all[i - 1]?.type) && timeParts.has(all[i + 1]?.type) ? p.value.replace(/ /g, ' ') : p.value))
    .join('');
const time = withTime(timeFmt);
const dateTime = withTime(dateTimeFmt);
const dateTimeYear = withTime(dateTimeYearFmt);
const dayTime = withTime(dayTimeFmt);

export const formatDate = (ms) => (ms ? dateFmt.format(new Date(ms)) : '');
export const formatTime = (ms) => (ms ? time(ms) : '');
export const formatDateTime = (ms) => (ms ? dateTime(ms) : '');
export const formatDateTimeYear = (ms) => (ms ? dateTimeYear(ms) : '');
export const formatDay = (ms) => (ms ? dayFmt.format(new Date(ms)) : '');
export const formatDayTime = (ms) => (ms ? dayTime(ms) : '');

// "Oct 2026": a month and year, as the membership card prints Member since. The month
// names are fixed, as on a card typed in English: a browser's own short September can
// be "Sept". `long` gives "October 2026", for a screen reader. Unlike every other date
// here, in one time zone for everyone (UTC), not the browser's: it's printed on a card
// that never changes, and the admin's page and the member's card must agree, even for
// someone added near midnight at the turn of a month.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function formatMonthYear(ms, { long = false } = {}) {
  if (!ms) return '';
  const d = new Date(ms);
  const month = MONTHS[d.getUTCMonth()];
  return `${long ? month : month.slice(0, 3)} ${d.getUTCFullYear()}`;
}

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
