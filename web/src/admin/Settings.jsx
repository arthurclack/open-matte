import { useEffect, useState } from 'react';
import { api, formatBytes, formatDateTime, plural } from '../api.js';
import { ErrorNote, useAction, useLoad } from './ui.jsx';

export default function Settings() {
  const { data: settings, setData, error } = useLoad(() => api.get('/api/admin/settings'), []);
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState(null);
  const action = useAction();

  useEffect(() => {
    if (settings) setForm({ ...settings, resumeWindowHours: String(settings.resumeWindowHours) });
  }, [settings]);

  if (error) return <ErrorNote error={error} />;
  if (!form) return null;

  async function save(e) {
    e.preventDefault();
    const r = await action.run(() => api.patch('/api/admin/settings', { ...form, resumeWindowHours: Number(form.resumeWindowHours) }));
    if (r) {
      setData(r);
      setNotice('Saved.');
    }
  }

  async function expireAll() {
    if (!window.confirm('Sign out every viewer? Everyone will need to open their ticket link again. Tickets and screenings are not affected.')) return;
    const r = await action.run(() => api.post('/api/admin/sessions/expire-all'));
    if (r) setNotice(`Signed out ${r.expired} browser session${r.expired === 1 ? '' : 's'}.`);
  }

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <ErrorNote error={action.error} />
      {notice && <div className="notice good">{notice}</div>}

      <form className="card" onSubmit={save} style={{ maxWidth: 720 }}>
        <label className="field">
          <span>Cinema name</span>
          <input value={form.cinemaName} onChange={(e) => setForm({ ...form, cinemaName: e.target.value })} maxLength={80} required />
        </label>
        <label className="field">
          <span>Front page message</span>
          <textarea value={form.welcome} onChange={(e) => setForm({ ...form, welcome: e.target.value })} rows={3} />
          <small>Shown to visitors who don't hold a ticket.</small>
        </label>
        <label className="field" style={{ maxWidth: 260 }}>
          <span>Resume window (hours)</span>
          <input type="number" min="1" max="720" value={form.resumeWindowHours} onChange={(e) => setForm({ ...form, resumeWindowHours: e.target.value })} />
          <small>How long a screening can be paused and resumed after it starts. Applies to screenings started from now on.</small>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.poweredBy} onChange={(e) => setForm({ ...form, poweredBy: e.target.checked })} />
          Show “Powered by Open Matte” in the footer
        </label>
        <button className="btn primary" disabled={action.busy}>
          Save settings
        </button>
      </form>

      <h2>Film information</h2>
      <TmdbSettings settings={settings} onSaved={setData} />

      <h2>Backups</h2>
      <Backups />

      <h2>Sessions</h2>
      <div className="card" style={{ maxWidth: 720 }}>
        <p className="dim">Signs every viewer out. Their tickets keep working: they just open their link again.</p>
        <button className="btn danger" onClick={expireAll} disabled={action.busy}>
          Sign out every viewer
        </button>
      </div>
    </>
  );
}

const LANGUAGES = [
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['fr-FR', 'French'],
  ['de-DE', 'German'],
  ['es-ES', 'Spanish'],
  ['it-IT', 'Italian'],
  ['nl-NL', 'Dutch'],
  ['sv-SE', 'Swedish'],
  ['da-DK', 'Danish'],
  ['nb-NO', 'Norwegian'],
  ['fi-FI', 'Finnish'],
  ['pt-PT', 'Portuguese'],
  ['pt-BR', 'Portuguese (Brazil)'],
  ['pl-PL', 'Polish'],
  ['ja-JP', 'Japanese'],
  ['ko-KR', 'Korean'],
];

// TMDb key and language. The key is checked with TMDb before it's saved,
// and the server only ever shows its last four characters.
function TmdbSettings({ settings, onSaved }) {
  const [key, setKey] = useState('');
  const [language, setLanguage] = useState(settings.metadataLanguage);
  const [notice, setNotice] = useState(null);
  const action = useAction();
  const t = settings.tmdb;
  const languages = LANGUAGES.some(([code]) => code === language) ? LANGUAGES : [[language, language], ...LANGUAGES];

  async function save(e) {
    e.preventDefault();
    setNotice(null);
    const body = { metadataLanguage: language };
    if (key.trim()) body.tmdbApiKey = key.trim();
    const r = await action.run(() => api.patch('/api/admin/settings', body));
    if (r) {
      setNotice(body.tmdbApiKey ? "Key works and is saved. Films that haven't been matched yet are being looked up now." : 'Saved.');
      setKey('');
      onSaved(r);
    }
  }

  async function removeKey() {
    if (!window.confirm('Remove the TMDB key? Details and artwork already fetched stay as they are.')) return;
    const r = await action.run(() => api.patch('/api/admin/settings', { tmdbApiKey: '' }));
    if (r) {
      setNotice('Key removed.');
      onSaved(r);
    }
  }

  return (
    <form className="card" onSubmit={save} style={{ maxWidth: 720 }}>
      <p>
        Open Matte can fill in film details, posters and backdrops from{' '}
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
          TMDB
        </a>
        , the database Jellyfin uses. New films are matched when the media folder is scanned, and you can pick a match by hand on any film.
      </p>
      <ErrorNote error={action.error} />
      {notice && <div className="notice good">{notice}</div>}
      <p>
        {t.configured ? (
          <span className="badge good">Connected</span>
        ) : (
          <span className="badge">Not set up</span>
        )}{' '}
        {t.source === 'env' && <span className="dim">The key comes from the server’s TMDB_API_KEY setting.</span>}
        {t.source === 'settings' && <span className="dim">Key ending {t.hint}</span>}
      </p>
      {t.source !== 'env' && (
        <label className="field">
          <span>{t.configured ? 'Replace the key' : 'TMDB API key'}</span>
          <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste the API Key or the API Read Access Token" />
          <small>
            Free for personal use: create a TMDB account, then go to Settings → API and request a developer key. Either value on that page works.
          </small>
        </label>
      )}
      <label className="field" style={{ maxWidth: 300 }}>
        <span>Language for titles and synopses</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          {languages.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button className="btn primary" disabled={action.busy}>
          {action.busy ? 'Checking…' : 'Save'}
        </button>
        {t.source === 'settings' && (
          <button type="button" className="btn danger" onClick={removeKey} disabled={action.busy}>
            Remove key
          </button>
        )}
      </div>
      <p className="faint" style={{ fontSize: '0.8rem', margin: '1rem 0 0' }}>
        This product uses the TMDB API but is not endorsed or certified by TMDB. Images are downloaded to your server, so viewers’ browsers never
        contact TMDB.
      </p>
    </form>
  );
}

// Daily database backups: when the last one ran, the newest few, and a button.
function Backups() {
  const { data, setData, error } = useLoad(() => api.get('/api/admin/backups'), []);
  const [notice, setNotice] = useState(null);
  const action = useAction();
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;

  if (!data.enabled) {
    return (
      <div className="card" style={{ maxWidth: 720 }}>
        <p style={{ margin: 0 }}>Backups are turned off on this server (BACKUP_DIR=off).</p>
      </div>
    );
  }

  async function backUpNow() {
    setNotice(null);
    const r = await action.run(() => api.post('/api/admin/backups'));
    if (r) {
      setData(r);
      setNotice(`Backed up (${formatBytes(r.backup?.size)}).`);
    }
  }

  const latest = data.backups[0];
  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <ErrorNote error={action.error} />
      {notice && <div className="notice good">{notice}</div>}
      {data.lastError && <div className="notice bad">The last backup failed: {data.lastError.message}</div>}
      <p>
        {latest ? (
          <>
            Last backup <strong>{formatDateTime(latest.at)}</strong> ({formatBytes(latest.size)}).
          </>
        ) : (
          'No backups yet.'
        )}{' '}
        The database is backed up every day at {String(data.hour).padStart(2, '0')}:00 UTC. Backups are kept for{' '}
        {plural(data.keepDays, 'day')}, plus one a month for {plural(data.keepMonths, 'month')}. Downloaded posters are copied too.
      </p>
      {data.backups.length > 0 && (
        <ul className="dim" style={{ margin: '0 0 1rem', paddingLeft: '1.1em', fontSize: '0.9rem' }}>
          {data.backups.slice(0, 5).map((b) => (
            <li key={b.name}>
              {formatDateTime(b.at)} <span className="faint">· {formatBytes(b.size)}</span>
            </li>
          ))}
          {data.backups.length > 5 && <li className="faint">and {data.backups.length - 5} older</li>}
        </ul>
      )}
      <div className="row">
        <button className="btn" onClick={backUpNow} disabled={action.busy}>
          {action.busy ? 'Backing up…' : 'Back up now'}
        </button>
        <span className="faint" style={{ fontSize: '0.85rem' }}>
          Saved in <span className="mono">{data.dir}</span> inside the app. See docs/deploying.md for where that is on the server, and how to restore.
        </span>
      </div>
    </div>
  );
}
