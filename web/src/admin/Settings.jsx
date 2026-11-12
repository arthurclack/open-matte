import { useContext, useEffect, useId, useState } from 'react';
import { api, formatBytes, formatDateTime, plural } from '../api.js';
import { Line } from '../look/ui.jsx';
import { askHost, pickedBy } from '../look/words.js';
import Branding from './Branding.jsx';
import { AdminContext, DoneNote, ErrorNote, Head, Mark, TmdbCredit, clearedCounts, lastClearedText, useAction, useLoad } from './ui.jsx';

// The page's own index: each part is a box with this id.
const PARTS = [
  ['s-shop', 'The shop'],
  ['s-colours', 'Colours and the card'],
  ['s-logo', 'Logo'],
  ['s-tmdb', 'Film information'],
  ['s-passkeys', 'Members and passkeys'],
  ['s-backups', 'Backups'],
  ['s-records', 'Keeping records'],
  ['s-everyone', 'Sign out everyone'],
];

// The main form holds only its own fields. The other parts (colours, logo, Film
// information...) save theirs separately: saving one of them leaves unsaved edits here
// alone, and saving here can't send back an old copy of their values.
const mainForm = (s) => ({
  cinemaName: s.cinemaName,
  ownerName: s.ownerName ?? '',
  welcome: s.welcome,
  loanDays: String(s.loanDays),
  poweredBy: s.poweredBy,
  mediaSessionTitle: s.mediaSessionTitle,
});

export default function Settings() {
  const { data: settings, setData, error } = useLoad(() => api.get('/api/admin/settings'), []);
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState(null);
  const action = useAction();
  const everyone = useAction();
  const [everyoneNotice, setEveryoneNotice] = useState(null);
  const { setSite } = useContext(AdminContext);
  const id = useId();

  useEffect(() => {
    if (settings) setForm((f) => f ?? mainForm(settings));
  }, [settings]);

  if (error) return <ErrorNote error={error} />;
  if (!form) return null;

  async function save(e) {
    e.preventDefault();
    setNotice(null);
    const r = await action.run(() => api.patch('/api/admin/settings', { ...form, loanDays: Number(form.loanDays) }));
    if (r) {
      setData(r);
      setForm(mainForm(r));
      // The back office's brand shows the shop's name; a staff pick's hint, your name.
      setSite((site) => ({ ...site, cinemaName: r.cinemaName, ownerName: r.ownerName }));
      setNotice('Saved.');
    }
  }

  async function expireAll() {
    if (!window.confirm('Sign out every friend and member? They\'ll need to open their tape link or sign in again. Tapes and plays are not affected.')) return;
    setEveryoneNotice(null);
    const r = await everyone.run(() => api.post('/api/admin/sessions/expire-all'));
    // The server counts only browsers that were still signed in.
    if (r) setEveryoneNotice(r.expired ? `Signed out ${plural(r.expired, 'browser')}.` : 'No browsers were signed in.');
  }

  const field = (k) => `${id}-${k}`;

  return (
    <>
      <Head title="Settings" />
      <ul className="of-toc">
        {PARTS.map(([part, name]) => (
          <li key={part}>
            <a href={`#${part}`}>{name}</a>
          </li>
        ))}
      </ul>

      <form className="of-box of-w" id="s-shop" onSubmit={save} aria-labelledby={field('h')}>
        <h2 className="of-h2" id={field('h')}>
          The shop
        </h2>
        <ErrorNote error={action.error} />
        <DoneNote>{notice}</DoneNote>
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={field('name')}>
            Shop name
          </label>
          <input id={field('name')} className="ui-input" value={form.cinemaName} onChange={(e) => setForm({ ...form, cinemaName: e.target.value })} maxLength={80} required />
        </div>
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={field('owner')}>
            Your name <small>(optional)</small>
          </label>
          <input
            id={field('owner')}
            className="ui-input"
            value={form.ownerName}
            onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
            maxLength={80}
            autoComplete="given-name"
            aria-describedby={field('owner-h')}
          />
          <p className="ui-field__hint" id={field('owner-h')}>
            On your staff picks and wherever the pages say whom to ask: “{pickedBy(form)}”, “{askHost(form)}”. Like the shop’s name, anyone who opens the shop’s address can see it.
          </p>
        </div>
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={field('welcome')}>
            Front page message
          </label>
          <textarea
            id={field('welcome')}
            className="ui-textarea"
            value={form.welcome}
            onChange={(e) => setForm({ ...form, welcome: e.target.value })}
            rows={3}
            aria-describedby={field('welcome-h')}
          />
          <p className="ui-field__hint" id={field('welcome-h')}>
            Shown to visitors who don't have a tape.
          </p>
        </div>
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={field('loan')}>
            Due back after, for new links (days)
          </label>
          <input
            id={field('loan')}
            className="ui-input ui-input--num"
            type="number"
            min="1"
            max="30"
            value={form.loanDays}
            onChange={(e) => setForm({ ...form, loanDays: e.target.value })}
            aria-describedby={field('loan-h')}
          />
          <p className="ui-field__hint" id={field('loan-h')}>
            How many days a friend has a tape, counted from the moment they press Play. A tape that is already out keeps its date.
          </p>
        </div>
        <label className="ui-check">
          <input type="checkbox" checked={form.poweredBy} onChange={(e) => setForm({ ...form, poweredBy: e.target.checked })} />
          <span>Show “Powered by Open Matte” in the footer</span>
        </label>
        <label className="ui-check">
          <input type="checkbox" checked={form.mediaSessionTitle} onChange={(e) => setForm({ ...form, mediaSessionTitle: e.target.checked })} />
          <span>
            Show the film's title and poster on lock screens and media controls
            <small>Off: they show the shop's name only.</small>
          </span>
        </label>
        <div className="ui-btns of-gap-s">
          <button className="ui-btn ui-btn--primary" disabled={action.busy}>
            Save settings
          </button>
        </div>
      </form>

      <Branding settings={settings} onSaved={setData} />

      <TmdbSettings settings={settings} onSaved={setData} />

      <Passkeys passkeys={settings.passkeys} />

      <Backups />

      <Retention settings={settings} onSaved={setData} />

      <section className="of-box of-w" id="s-everyone" aria-labelledby={field('everyone')}>
        <h2 className="of-h2" id={field('everyone')}>
          Sign out everyone
        </h2>
        <ErrorNote error={everyone.error} />
        <DoneNote>{everyoneNotice}</DoneNote>
        <p className="of-p of-dim">Tapes keep working: people open their link or sign in again.</p>
        <div className="ui-btns">
          <button type="button" className="ui-btn ui-btn--danger" onClick={expireAll} disabled={everyone.busy}>
            Sign out every friend and member
          </button>
        </div>
      </section>

      {/* Which Open Matte this is, and the licences of the code the site sends to browsers (the build writes them). */}
      <p className="of-foot">
        Open Matte {settings.version} · <a href="/third-party-licenses.txt">Licences</a>
      </p>
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

// TMDB's key and language. The key is checked with TMDB before it's saved,
// and the server only ever shows its last four characters.
function TmdbSettings({ settings, onSaved }) {
  const [key, setKey] = useState('');
  const [language, setLanguage] = useState(settings.metadataLanguage);
  const [notice, setNotice] = useState(null);
  const action = useAction();
  const id = useId();
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
    <form className="of-box of-w" id="s-tmdb" onSubmit={save} aria-labelledby={`${id}-h`}>
      <h2 className="of-h2" id={`${id}-h`}>
        Film information
      </h2>
      <p className="of-p">
        Open Matte can fill in film details, posters and backdrops from{' '}
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
          TMDB
        </a>
        , the database Jellyfin uses. New films are matched when the media folder is scanned, and you can pick a match by hand on any film.
      </p>
      <ErrorNote error={action.error} />
      <DoneNote>{notice}</DoneNote>
      <p className="of-p">
        {t.configured ? <Mark tone="done">Connected</Mark> : <Mark tone="off">Not set up</Mark>}{' '}
        {t.source === 'env' && <span className="of-dim">The key comes from the server’s TMDB_API_KEY setting.</span>}
        {t.source === 'settings' && <span className="of-dim">Key ending {t.hint}</span>}
      </p>
      {t.source !== 'env' && (
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={`${id}-key`}>
            {t.configured ? 'Replace the key' : 'TMDB API key'}
          </label>
          <input
            id={`${id}-key`}
            className="ui-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste the API Key or the API Read Access Token"
            aria-describedby={`${id}-key-h`}
          />
          <p className="ui-field__hint" id={`${id}-key-h`}>
            Free for personal use: create a TMDB account, then go to Settings → API and request a developer key. Either value on that page works.
          </p>
        </div>
      )}
      <div className="ui-field" style={{ maxWidth: 300 }}>
        <label className="ui-field__label" htmlFor={`${id}-lang`}>
          Language for titles and synopses
        </label>
        <select id={`${id}-lang`} className="ui-select" value={language} onChange={(e) => setLanguage(e.target.value)}>
          {languages.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="ui-btns">
        <button className="ui-btn ui-btn--primary" disabled={action.busy}>
          {action.busy ? 'Checking…' : 'Save'}
        </button>
        {t.source === 'settings' && (
          <button type="button" className="ui-btn ui-btn--danger" onClick={removeKey} disabled={action.busy}>
            Remove key
          </button>
        )}
      </div>
      {/* TMDB's logo and notice, as on the site's footer (site.jsx), since the back office
          shows TMDB's details and thumbnails too. */}
      <TmdbCredit>Images are downloaded to your server, so friends’ browsers never contact TMDB.</TmdbCredit>
    </form>
  );
}

// Where passkeys belong. Read-only: WEBAUTHN_RP_ID and PUBLIC_URL are set on the server.
function Passkeys({ passkeys }) {
  if (!passkeys) return null;
  return (
    <section className="of-box of-w" id="s-passkeys" aria-labelledby="h-passkeys">
      <h2 className="of-h2" id="h-passkeys">
        Members and passkeys
      </h2>
      {passkeys.problem && (
        <Line kind="warn" lead="Passkeys aren't available.">
          {passkeys.problem}
        </Line>
      )}
      {passkeys.rpId && (
        <p className="of-p">
          Passkeys here belong to <b className="of-mono">{passkeys.rpId}</b>. If the shop ever moves to another domain, every member will need a new
          passkey.
        </p>
      )}
      <p className="of-p of-dim of-small">
        {passkeys.origin ? (
          <>
            They work on <span className="of-mono">{passkeys.origin}</span> only.{' '}
          </>
        ) : (
          !passkeys.problem && <>In development they work on localhost at any port, but not on 127.0.0.1. </>
        )}
        Set by WEBAUTHN_RP_ID and DOMAIN in deploy/.env: see docs/installing.md.
      </p>
    </section>
  );
}

// Daily database backups: when the last one ran, the newest few, and a button.
function Backups() {
  const { data, setData, error } = useLoad(() => api.get('/api/admin/backups'), []);
  const [notice, setNotice] = useState(null);
  const action = useAction();

  const box = (children) => (
    <section className="of-box of-w" id="s-backups" aria-labelledby="h-backups">
      <h2 className="of-h2" id="h-backups">
        Backups
      </h2>
      {children}
    </section>
  );

  if (error) return box(<ErrorNote error={error} />);
  if (!data) return box(null);
  if (!data.enabled) return box(<p className="of-p">Backups are turned off on this server (BACKUP_DIR=off).</p>);

  async function backUpNow() {
    setNotice(null);
    const r = await action.run(() => api.post('/api/admin/backups'));
    if (r) {
      setData(r);
      setNotice(`Backed up (${formatBytes(r.backup?.size)}).`);
    }
  }

  const latest = data.backups[0];
  return box(
    <>
      <ErrorNote error={action.error} />
      <DoneNote>{notice}</DoneNote>
      {data.lastError && <ErrorNote error={`The last backup failed: ${data.lastError.message}`} />}
      <p className="of-p">
        {latest ? (
          <>
            Last backup <b>{formatDateTime(latest.at)}</b> ({formatBytes(latest.size)}).
          </>
        ) : (
          'No backups yet.'
        )}{' '}
        The database is backed up every day at {String(data.hour).padStart(2, '0')}:00 UTC. Backups are kept for {plural(data.keepDays, 'day')}, plus one a
        month for {plural(data.keepMonths, 'month')}. Downloaded posters are copied too.
      </p>
      {data.backups.length > 0 && (
        <ul className="ui-list of-backups">
          {data.backups.slice(0, 5).map((b) => (
            <li key={b.name}>
              <span className="ui-list__row">
                <span className="ui-list__main ui-n">{formatDateTime(b.at)}</span>
                <span className="ui-list__aside">{formatBytes(b.size)}</span>
              </span>
            </li>
          ))}
          {data.backups.length > 5 && (
            <li>
              <span className="ui-list__row of-faint">and {data.backups.length - 5} older</span>
            </li>
          )}
        </ul>
      )}
      <div className="ui-btns">
        <button type="button" className="ui-btn" onClick={backUpNow} disabled={action.busy}>
          {action.busy ? 'Backing up…' : 'Back up now'}
        </button>
      </div>
      <p className="ui-field__hint of-gap-s">
        Saved in <span className="of-mono">{data.dir}</span> inside the app. See docs/deploying.md for where that is on the server, and how to restore.
      </p>
    </>,
  );
}

const RETENTION = [
  ['retainProgressDays', 'Progress reports', 1, 365, 'Where a film had got to, every 5 minutes while playing.'],
  ['retainEventsDays', 'Other events', 30, 3650, 'Opened, played, finished, sign-ins, links.'],
  ['retainSessionsDays', 'Signed-out browsers', 1, 365, 'Counted from when they signed out or expired, and kept while any event still names them.'],
];
const retentionForm = (s) => Object.fromEntries(RETENTION.map(([k]) => [k, String(s[k] ?? '')]));
const errorText = (e) => (typeof e === 'string' ? e : e?.message);

// How long old activity and signed-out browsers are kept, and clearing them now. It
// saves only its own three settings, like the parts above.
function Retention({ settings, onSaved }) {
  const { data, setData, error, reload } = useLoad(() => api.get('/api/admin/retention'), []);
  const [form, setForm] = useState(() => retentionForm(settings));
  const [notice, setNotice] = useState(null);
  const action = useAction();
  const id = useId();

  const box = (children, props = {}) => (
    <form className="of-box of-w" id="s-records" aria-labelledby={`${id}-h`} {...props}>
      <h2 className="of-h2" id={`${id}-h`}>
        Keeping records
      </h2>
      {children}
    </form>
  );

  if (error) return box(<ErrorNote error={error} />);
  if (!data) return box(null);

  const dirty = RETENTION.some(([k]) => form[k] !== String(settings[k] ?? ''));
  const p = data.preview;
  const nothing = !p.progressReports && !p.events && !p.sessions;

  async function save(e) {
    e.preventDefault();
    setNotice(null);
    const r = await action.run(() => api.patch('/api/admin/settings', Object.fromEntries(RETENTION.map(([k]) => [k, Number(form[k])]))));
    if (r) {
      onSaved(r);
      setForm(retentionForm(r));
      setNotice('Saved.');
      reload(); // what clearing would delete depends on these
    }
  }

  async function clearNow() {
    if (!window.confirm(`Clear old records now? By the saved settings that's ${clearedCounts(p, 'signed-out browser')}. Tapes and plays don't change.`)) return;
    setNotice(null);
    const r = await action.run(() => api.post('/api/admin/retention/run'));
    if (r) {
      setData(r);
      setNotice(`Cleared ${clearedCounts(r.lastRun.deleted, 'signed-out browser')}.`);
    }
  }

  return box(
    <>
      <p className="of-p of-dim">
        Old activity is cleared every day, and a minute after the server starts. Clearing never changes a tape: its plays, limits, “finished”, resume
        positions and deadlines are kept with it. Backups keep what they had until they expire.
      </p>
      <ErrorNote error={action.error} />
      <DoneNote>{notice}</DoneNote>
      {data.lastError && <ErrorNote error={`The last clean-up failed: ${errorText(data.lastError)}`} />}
      <div className="of-grid3">
        {RETENTION.map(([k, label, min, max, hint]) => (
          <div className="ui-field" key={k}>
            <label className="ui-field__label" htmlFor={`${id}-${k}`}>
              {label} (days)
            </label>
            <input
              id={`${id}-${k}`}
              className="ui-input ui-input--num"
              type="number"
              min={min}
              max={max}
              required
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              aria-describedby={`${id}-${k}-h`}
            />
            <p className="ui-field__hint" id={`${id}-${k}-h`}>
              {hint}
            </p>
          </div>
        ))}
      </div>
      <p className="of-p">
        {nothing ? 'Nothing is old enough to clear right now.' : `Clearing now would delete ${clearedCounts(p, 'signed-out browser')}.`}
        {dirty && <span className="of-dim"> That's by the saved settings: save to see what yours would clear.</span>}
      </p>
      <p className="of-p of-dim of-small">{lastClearedText(data.lastRun)}</p>
      <div className="ui-btns">
        <button className="ui-btn ui-btn--primary" disabled={!dirty || action.busy}>
          Save
        </button>
        <button type="button" className="ui-btn" onClick={clearNow} disabled={action.busy || nothing}>
          Clear now
        </button>
      </div>
    </>,
    { onSubmit: save },
  );
}
