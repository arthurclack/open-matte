import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { SiteName } from '../site.jsx';
import { AdminContext, ErrorNote, useAction } from './ui.jsx';

const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULT_COLORS = { accentColor: '#e8b04a', backgroundColor: '#0d0c0f' };

// The server's own limits and words, so a wrong file is refused before it's sent.
// The server still decides by the bytes, whatever the browser says the type is.
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_BYTES = 1048576;
const imageProblem = (file) => {
  if (!file.size || !IMAGE_TYPES.includes(file.type)) return "That isn't a PNG, JPEG or WebP image.";
  if (file.size > MAX_IMAGE_BYTES) return 'That image is larger than 1 MB.';
  return null;
};

// The cinema's background, as the header and link previews show the logo on it.
const strip = { background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: '0.9rem 1rem', marginBottom: '0.8rem' };

// Colours, logo and tab icon. Each part saves on its own, so nothing here throws away
// unsaved edits in another part (or in the main settings form).
export default function Branding({ settings, onSaved }) {
  const { logo, icon } = settings;
  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <h3>Colours</h3>
      <Colors settings={settings} onSaved={onSaved} />

      <h3>Logo</h3>
      <BrandImage
        kind="logo"
        noun="logo"
        image={logo}
        onSaved={onSaved}
        removeText="Remove the logo? The header shows the cinema's name instead."
        help="PNG, JPEG or WebP, up to 1 MB. Shown small at the top of every viewer page, sign-in and setup included, and in link previews."
        preview={
          logo ? (
            <div className="row" style={{ ...strip, justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <span className="site-name" style={{ minWidth: 0 }}>
                <SiteName site={settings} />
              </span>
              <span className="faint nowrap" style={{ fontSize: '0.85rem' }}>
                {logo.width} × {logo.height}
              </span>
            </div>
          ) : (
            <p className="dim">No logo: the header shows the cinema's name.</p>
          )
        }
      >
        <LogoWithName settings={settings} onSaved={onSaved} />
      </BrandImage>

      <h3>Tab icon</h3>
      <BrandImage
        kind="icon"
        noun="tab icon"
        image={icon}
        onSaved={onSaved}
        removeText="Remove the tab icon? The tab shows Open Matte's icon in your colours instead."
        help="Square, at least 32 × 32 pixels; 512 × 512 is best. Without one, the tab shows Open Matte's icon in your colours."
        preview={
          <div className="row" style={strip}>
            {/* The query only makes the browser fetch the icon again when the colours change. */}
            <img
              src={icon ? icon.url : `/favicon.svg?v=${settings.accentColor.slice(1)}${settings.backgroundColor.slice(1)}`}
              width={32}
              height={32}
              alt=""
            />
            <span className="dim" style={{ fontSize: '0.9rem' }}>
              {icon ? `${icon.width} × ${icon.height}` : "Open Matte's icon in your colours"}
            </span>
          </div>
        }
      />

      <h3>Link previews</h3>
      <p className="dim" style={{ margin: 0 }}>
        Apps that preview links, like WhatsApp and iMessage, show a ticket for anyone with its film's poster and title. Whoever fetches the preview
        (the sender's phone, or for some apps their servers) learns which film was sent. A ticket for one person, and every other link, shows the cinema's name and logo.
      </p>
    </div>
  );
}

// Accent and background. Shown on this page as they're picked, once the server has
// checked them; a refused pair isn't shown, since it would make this page hard to read too.
function Colors({ settings, onSaved }) {
  const { signedOut } = useContext(AdminContext);
  const saved = { accentColor: settings.accentColor, backgroundColor: settings.backgroundColor };
  // Set from the settings once: saving another part mustn't undo what's being picked here.
  const [colors, setColors] = useState(saved);
  // The server's answer for the colours in the fields: { key, problems, theme } or { key, error }.
  const [check, setCheck] = useState(null);
  const [notice, setNotice] = useState(null);
  const action = useAction();
  const { show, clear } = useThemePreview();

  const accentColor = colors.accentColor.toLowerCase();
  const backgroundColor = colors.backgroundColor.toLowerCase();
  const key = `${accentColor} ${backgroundColor}`;
  const valid = HEX.test(accentColor) && HEX.test(backgroundColor);
  const unsaved = accentColor !== settings.accentColor || backgroundColor !== settings.backgroundColor;
  const isDefault = accentColor === DEFAULT_COLORS.accentColor && backgroundColor === DEFAULT_COLORS.backgroundColor;
  const refused = check?.key === key && check.problems?.length > 0;

  useEffect(() => {
    // Back to the saved colours: they're what the page shows without a preview.
    if (!unsaved) {
      clear();
      setCheck(null);
      return undefined;
    }
    let current = true;
    const timer = setTimeout(async () => {
      if (!valid) {
        clear();
        setCheck({ key, problems: ['Colours are written as #rrggbb, for example #e8b04a.'] });
        return;
      }
      try {
        const r = await api.post('/api/admin/branding/check', { accentColor, backgroundColor });
        if (!current) return;
        if (r.problems.length) clear();
        else show(r.theme);
        setCheck({ key, ...r });
      } catch (err) {
        if (!current) return;
        clear();
        if (err.status === 401) signedOut();
        else setCheck({ key, error: err.message });
      }
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key, valid, unsaved, accentColor, backgroundColor, show, clear, signedOut]);

  async function save(e) {
    e.preventDefault();
    setNotice(null);
    const body = { accentColor, backgroundColor };
    const r = await action.run(() => api.patch('/api/admin/settings', body));
    if (!r) return;
    // Keep the new colours on this page once the preview goes, as a reload would show them.
    const theme = check?.key === key && check.theme ? check.theme : await api.post('/api/admin/branding/check', body).then((c) => c.theme, () => null);
    if (theme) adoptTheme(theme, r.backgroundColor);
    setColors({ accentColor: r.accentColor, backgroundColor: r.backgroundColor });
    setNotice('Colours saved.');
    onSaved(r);
  }

  const pick = (name) => (value) => {
    setNotice(null);
    setColors((c) => ({ ...c, [name]: value }));
  };

  return (
    <form onSubmit={save}>
      <p className="dim">This page shows the colours as you pick them. Viewers see them once they're saved.</p>
      <ErrorNote error={action.error} />
      {notice && <div className="notice good">{notice}</div>}
      <div className="grid-2">
        <ColorField
          label="Accent"
          value={colors.accentColor}
          fallback={settings.accentColor}
          onChange={pick('accentColor')}
          help="Buttons, links and highlights. It's used for small text, so it must stand out from the background."
        />
        <ColorField
          label="Background"
          value={colors.backgroundColor}
          fallback={settings.backgroundColor}
          onChange={pick('backgroundColor')}
          help="Dark, so text stays easy to read. Panels, fields and lines are worked out from it."
        />
      </div>
      {check?.problems?.length > 0 && (
        <div className="notice bad">
          {check.problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </div>
      )}
      <ErrorNote error={check?.error} />
      <div className="row">
        <button className="btn primary" disabled={action.busy || !unsaved || !valid || refused}>
          Save colours
        </button>
        {unsaved && (
          <button type="button" className="btn" onClick={() => setColors(saved)} disabled={action.busy}>
            Cancel
          </button>
        )}
        <button type="button" className="btn" onClick={() => setColors(DEFAULT_COLORS)} disabled={action.busy || isDefault}>
          Back to Open Matte's colours
        </button>
      </div>
    </form>
  );
}

// A colour picker and the same colour as text, for pasting one from elsewhere. The picker
// can only hold a whole colour, so while the text is half-typed it shows the saved one.
function ColorField({ label, value, fallback, onChange, help }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
        <input type="color" value={HEX.test(value) ? value.toLowerCase() : fallback} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        <input
          type="text"
          className="mono"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-label={`${label}, as #rrggbb`}
          style={{ maxWidth: '8.5em' }}
        />
      </div>
      <small>{help}</small>
    </div>
  );
}

// Shows colours on this page before they're saved: the theme's custom properties go on
// <html>, over the server's <style id="theme"> (the saved colours). That style is switched
// off meanwhile, so whatever the theme leaves out is Open Matte's own, as the server would
// write it. Leaving the page, or clear(), puts the saved colours back.
function useThemePreview() {
  const shown = useRef([]);
  const clear = useCallback(() => {
    for (const name of shown.current) document.documentElement.style.removeProperty(name);
    shown.current = [];
    savedTheme(true);
  }, []);
  const show = useCallback(
    (theme) => {
      clear();
      savedTheme(false);
      for (const [name, value] of Object.entries(theme)) document.documentElement.style.setProperty(name, value);
      shown.current = Object.keys(theme);
    },
    [clear],
  );
  useEffect(() => clear, [clear]);
  return { show, clear };
}

// Switches the server's <style id="theme"> on or off. A default install has none.
function savedTheme(on) {
  const sheet = document.getElementById('theme')?.sheet;
  if (sheet) sheet.disabled = !on;
}

// After a save, this page takes the new colours as the server now writes them, so they
// stay when the preview goes, on Settings and every other admin page, until a reload.
function adoptTheme(theme, backgroundColor) {
  const css = Object.entries(theme)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
  let style = document.getElementById('theme');
  if (!css) {
    style?.remove();
  } else {
    if (!style) {
      style = document.createElement('style');
      style.id = 'theme';
      document.head.append(style);
    }
    style.textContent = `:root{${css}}`;
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgroundColor);
}

// A logo or tab icon: what's there now, a button to upload one, and Remove.
function BrandImage({ kind, noun, image, onSaved, removeText, help, preview, children }) {
  const [notice, setNotice] = useState(null);
  const [uploading, setUploading] = useState(false);
  const action = useAction();
  const url = `/api/admin/branding/${kind}`;
  const Noun = noun[0].toUpperCase() + noun.slice(1);

  async function upload(e) {
    const file = e.target.files[0];
    e.target.value = ''; // so choosing the same file again, once it's fixed, still counts
    if (!file) return;
    setNotice(null);
    const problem = imageProblem(file);
    if (problem) return action.setError(problem);
    setUploading(true);
    const r = await action.run(() => api.upload(url, file));
    setUploading(false);
    if (r) {
      setNotice(`${Noun} saved.`);
      onSaved(r);
    }
  }

  async function remove() {
    if (!window.confirm(removeText)) return;
    setNotice(null);
    const r = await action.run(() => api.post(`${url}/remove`));
    if (r) {
      setNotice(`${Noun} removed.`);
      onSaved(r);
    }
  }

  return (
    <>
      <ErrorNote error={action.error} />
      {notice && <div className="notice good">{notice}</div>}
      {preview}
      <div className="row">
        <label className="btn">
          {uploading ? 'Uploading…' : image ? `Replace the ${noun}` : `Upload a ${noun}`}
          <input type="file" accept={IMAGE_TYPES.join(',')} className="visually-hidden" onChange={upload} disabled={action.busy} />
        </label>
        {image && (
          <button type="button" className="btn danger" onClick={remove} disabled={action.busy}>
            Remove
          </button>
        )}
      </div>
      <p className="faint" style={{ fontSize: '0.85rem', margin: '0.6rem 0 0' }}>
        {help}
      </p>
      {children}
    </>
  );
}

// Saved as soon as it's ticked: the logo above shows the difference straight away.
function LogoWithName({ settings, onSaved }) {
  const action = useAction();

  async function toggle(e) {
    const r = await action.run(() => api.patch('/api/admin/settings', { logoWithName: e.target.checked }));
    if (r) onSaved(r);
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <ErrorNote error={action.error} />
      <label className="check" style={{ margin: 0 }}>
        <input type="checkbox" checked={settings.logoWithName} onChange={toggle} disabled={action.busy} />
        Show the cinema's name next to the logo
      </label>
    </div>
  );
}
