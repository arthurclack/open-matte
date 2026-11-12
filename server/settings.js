import { COLOR, DEFAULT_ACCENT, DEFAULT_BACKGROUND, LEGACY_BACKGROUND, check } from './theme.js';

// Per-installation settings, stored in the database and edited in the admin.
// Everything in DEFAULT_SETTINGS is safe to show viewers; secrets are kept
// apart and never leave the server.
export const DEFAULT_SETTINGS = {
  cinemaName: 'Open Matte',
  // The owner's own name, to sign the staff picks ("Picked by Arthur") and for
  // "No tape yet: ask Arthur". Optional: empty, the shop's name is used instead.
  ownerName: '',
  welcome: 'This is a private video shop. If someone sent you a tape, open the link they gave you.',
  poweredBy: true,
  // How many days a tape is lent for, counted from the moment Play is pressed, for a
  // link that doesn't say (tickets.loan_days). The tape is due back at the end of them.
  loanDays: 3,
  // Language for film information fetched from TMDb.
  metadataLanguage: 'en-US',
  // Branding. The colours are checked together (see theme.js).
  accentColor: DEFAULT_ACCENT,
  backgroundColor: DEFAULT_BACKGROUND,
  // Show the shop's name next to the logo.
  logoWithName: true,
  // Lock screens and media controls show the film's title and poster while it
  // plays. Off: only the shop's name, for when the title is part of the surprise.
  mediaSessionTitle: true,
  // How long records are kept, in days (retention.js). Progress reports are the
  // heartbeat events; every other event (opened, play, finished, sign-ins,
  // links) is kept for retainEventsDays. Ended browser sessions go
  // retainSessionsDays after they end, once no event names them.
  retainProgressDays: 30,
  retainEventsDays: 365,
  retainSessionsDays: 30,
  // { file, width, height } of an image in DATA_DIR/branding, or null. Only the
  // upload routes write these (setFile); viewers get a URL instead (branding.js).
  logo: null,
  icon: null,
};

// The front page message's default before 1.1.0, in the cinema's words. The admin's
// Settings saves the message with every other field there, so a shop that never wrote
// one of its own may have this stored: it reads as today's default (get()).
export const LEGACY_WELCOME = 'This is a private cinema. If someone sent you a ticket, open the link they gave you.';

const RULES = {
  cinemaName: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 80,
  ownerName: (v) => typeof v === 'string' && v.trim().length <= 80,
  welcome: (v) => typeof v === 'string' && v.length <= 2000,
  poweredBy: (v) => typeof v === 'boolean',
  loanDays: (v) => Number.isInteger(v) && v >= 1 && v <= 30,
  metadataLanguage: (v) => typeof v === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(v),
  accentColor: (v) => typeof v === 'string' && COLOR.test(v),
  backgroundColor: (v) => typeof v === 'string' && COLOR.test(v),
  logoWithName: (v) => typeof v === 'boolean',
  mediaSessionTitle: (v) => typeof v === 'boolean',
  retainProgressDays: (v) => Number.isInteger(v) && v >= 1 && v <= 365,
  retainEventsDays: (v) => Number.isInteger(v) && v >= 30 && v <= 3650,
  retainSessionsDays: (v) => Number.isInteger(v) && v >= 1 && v <= 365,
};

// Settings that are no more. 1.x's Settings page sends resumeWindowHours ("Time to
// come back") with every save, and an unknown key is refused, so these are accepted,
// whatever they hold, and never stored. A row already stored stays, and is never read.
const RETIRED = new Set(['resumeWindowHours']);

// previewKey signs the addresses of ticket links' preview posters (page.js).
// adminKeySalt goes into the admin's key, with ADMIN_PASSWORD (sessions.js).
const SECRETS = new Set(['tmdbApiKey', 'previewKey', 'adminKeySalt']);
const FILES = new Set(['logo', 'icon']);

// Colours are stored lower-case, other text without surrounding spaces.
function tidy(key, value) {
  if (typeof value !== 'string') return value;
  return key === 'accentColor' || key === 'backgroundColor' ? value.toLowerCase() : value.trim();
}

export function createSettings(db) {
  const all = db.prepare('SELECT key, value FROM settings');
  const one = db.prepare('SELECT value FROM settings WHERE key = ?');
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const insertNew = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const remove = db.prepare('DELETE FROM settings WHERE key = ?');

  // Object.hasOwn rather than `in` throughout: `in` also finds what every object
  // inherits, so names like toString or constructor would pass as settings.
  // A background still on the default from before 1.1.0 was never chosen (the admin
  // saves both colours together), so it reads as today's default: the room. A front
  // page message still word for word the old default reads as today's too.
  function get() {
    const out = { ...DEFAULT_SETTINGS };
    for (const { key, value } of all.all()) if (Object.hasOwn(DEFAULT_SETTINGS, key)) out[key] = JSON.parse(value);
    if (out.backgroundColor === LEGACY_BACKGROUND) out.backgroundColor = DEFAULT_BACKGROUND;
    if (out.welcome === LEGACY_WELCOME) out.welcome = DEFAULT_SETTINGS.welcome;
    return out;
  }

  // Throws for the first unknown key or invalid value, before anything is
  // written. A key that isn't a setting is refused rather than ignored, so a typo
  // shows up at once (a retired one is let through, and dropped by update). The
  // logo and the icon aren't in RULES: only their upload routes set them. New
  // colours are checked with the other one as it would be after the save, and the
  // message says what's wrong with them.
  function validate(patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (RETIRED.has(key)) continue;
      if (!Object.hasOwn(RULES, key)) throw Object.assign(new Error(`Not a setting you can change here: ${key.slice(0, 80)}`), { status: 400 });
      if (!RULES[key](value)) throw Object.assign(new Error(`Invalid value for ${key}`), { status: 400 });
    }
    if (Object.hasOwn(patch, 'accentColor') || Object.hasOwn(patch, 'backgroundColor')) {
      const [problem] = check({ ...get(), ...patch });
      if (problem) throw Object.assign(new Error(problem), { status: 400 });
    }
  }

  function update(patch) {
    validate(patch);
    for (const [key, value] of Object.entries(patch)) if (!RETIRED.has(key)) upsert.run(key, JSON.stringify(tidy(key, value)));
    return get();
  }

  function getSecret(name) {
    if (!SECRETS.has(name)) throw new Error(`Unknown secret ${name}`);
    const row = one.get(`secret.${name}`);
    return row ? JSON.parse(row.value) : null;
  }

  function setSecret(name, value) {
    if (!SECRETS.has(name)) throw new Error(`Unknown secret ${name}`);
    if (value) upsert.run(`secret.${name}`, JSON.stringify(value));
    else remove.run(`secret.${name}`);
  }

  // A secret the server makes for itself: the stored one, or a new one from
  // make() saved for good. Read back after the insert, so two servers starting
  // on one database at once end up with the same secret.
  function ensureSecret(name, make) {
    const existing = getSecret(name);
    if (existing) return existing;
    insertNew.run(`secret.${name}`, JSON.stringify(make()));
    return getSecret(name);
  }

  // The logo or the tab icon, for branding.js once the file is in place: { file, width, height }, or null.
  function setFile(kind, value) {
    if (!FILES.has(kind)) throw new Error(`Unknown file ${kind}`);
    if (value) upsert.run(kind, JSON.stringify(value));
    else remove.run(kind);
  }

  return { get, validate, update, getSecret, setSecret, ensureSecret, setFile };
}
