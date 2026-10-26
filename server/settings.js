// Per-installation settings, stored in the database and edited in the admin.
// Everything in DEFAULT_SETTINGS is safe to show viewers; secrets are kept
// apart and never leave the server.
export const DEFAULT_SETTINGS = {
  cinemaName: 'Open Matte',
  welcome: 'This is a private cinema. If someone sent you a ticket, open the link they gave you.',
  poweredBy: true,
  // How long a screening can be resumed, counted from when it started.
  resumeWindowHours: 48,
  // Language for film information fetched from TMDb.
  metadataLanguage: 'en-US',
};

const RULES = {
  cinemaName: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 80,
  welcome: (v) => typeof v === 'string' && v.length <= 2000,
  poweredBy: (v) => typeof v === 'boolean',
  resumeWindowHours: (v) => Number.isInteger(v) && v >= 1 && v <= 24 * 30,
  metadataLanguage: (v) => typeof v === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(v),
};

const SECRETS = new Set(['tmdbApiKey']);

export function createSettings(db) {
  const all = db.prepare('SELECT key, value FROM settings');
  const one = db.prepare('SELECT value FROM settings WHERE key = ?');
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const remove = db.prepare('DELETE FROM settings WHERE key = ?');

  function get() {
    const out = { ...DEFAULT_SETTINGS };
    for (const { key, value } of all.all()) if (key in DEFAULT_SETTINGS) out[key] = JSON.parse(value);
    return out;
  }

  // Throws for the first invalid value, before anything is written.
  function validate(patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (key in RULES && !RULES[key](value)) throw Object.assign(new Error(`Invalid value for ${key}`), { status: 400 });
    }
  }

  function update(patch) {
    validate(patch);
    for (const [key, value] of Object.entries(patch)) {
      if (key in RULES) upsert.run(key, JSON.stringify(typeof value === 'string' ? value.trim() : value));
    }
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

  return { get, validate, update, getSecret, setSecret };
}
