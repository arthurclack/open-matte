import { useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.js';
import MembershipCard from '../MembershipCard.jsx';
import { ShopName } from '../look/objects.jsx';
import { Line } from '../look/ui.jsx';
import { AdminContext, DoneNote, ErrorNote, useAction } from './ui.jsx';

const HEX = /^#[0-9a-f]{6}$/i;
// Open Matte's own colours (server/theme.js): the accent, and the video shop's room.
const DEFAULT_COLORS = { accentColor: '#e8b04a', backgroundColor: '#171513' };

// The card in the preview: nobody's, so it says so in its caption.
const SAMPLE = { name: 'Sam Example', membership: { number: '00000000000', since: Date.UTC(2026, 0, 15) } };

// The server's own limits and words, so a wrong file is mostly refused before it's sent.
// The server decides by the bytes, so the type is only checked here when the browser
// reports one: it goes by the file's name, and has none for a name without an extension.
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_BYTES = 1048576;
const imageProblem = (file) => {
  if (!file.size || (file.type && !IMAGE_TYPES.includes(file.type))) return "That isn't a PNG, JPEG or WebP image.";
  if (file.size > MAX_IMAGE_BYTES) return 'That image is larger than 1 MB.';
  return null;
};

// Colours and the card, then the logo, the tab icon and link previews. Each part saves
// on its own, so nothing here throws away unsaved edits in another part (or in the
// shop's own settings).
export default function Branding({ settings, onSaved }) {
  const { logo, icon } = settings;
  return (
    <>
      <section className="of-box" id="s-colours" aria-labelledby="h-colours">
        <h2 className="of-h2" id="h-colours">
          Colours and the card
        </h2>
        <Colors settings={settings} onSaved={onSaved} />
      </section>

      <section className="of-box" id="s-logo" aria-labelledby="h-logo">
        <h2 className="of-h2" id="h-logo">
          Logo
        </h2>
        <BrandImage
          kind="logo"
          noun="logo"
          image={logo}
          onSaved={onSaved}
          removeText="Remove the logo? The header and the membership card show the shop's name instead."
          help="PNG, JPEG or WebP, up to 1 MB. Shown small at the top of every page, sign-in and setup included, in link previews, and printed on the membership card."
          preview={
            logo ? (
              <div className="of-strip">
                <ShopName site={settings} />
                <span className="ui-n of-faint">
                  {logo.width} × {logo.height}
                </span>
              </div>
            ) : (
              <p className="of-p of-dim">No logo: the header and the membership card show the shop's name.</p>
            )
          }
        >
          <LogoWithName settings={settings} onSaved={onSaved} />
        </BrandImage>

        <h3 className="of-h3">Tab icon</h3>
        <BrandImage
          kind="icon"
          noun="tab icon"
          image={icon}
          onSaved={onSaved}
          removeText="Remove the tab icon? The tab shows Open Matte's icon in your colours instead."
          help="Square, at least 32 × 32 pixels; 512 × 512 is best."
          preview={
            <div className="of-strip" style={{ justifyContent: 'flex-start' }}>
              {/* The query only makes the browser fetch the icon again when the colours change. */}
              <img
                src={icon ? icon.url : `/favicon.svg?v=${settings.accentColor.slice(1)}${settings.backgroundColor.slice(1)}`}
                width={32}
                height={32}
                alt=""
              />
              <span className="of-dim">{icon ? <span className="ui-n">{`${icon.width} × ${icon.height}`}</span> : "Open Matte's icon in your colours"}</span>
            </div>
          }
        />

        <h3 className="of-h3">Link previews</h3>
        <p className="of-p of-dim">
          Apps that preview links, like WhatsApp and iMessage, show a link anyone can use with its film's poster and title. Whoever fetches the preview (the
          sender's phone, or for some apps their servers) learns which film was sent. A link for one member, a link that has lent its tape, and every other link
          show the shop's name and logo.
        </p>
      </section>
    </>
  );
}

// Your colour and the background. Shown on this page as they're picked, once the
// server has checked them; a refused pair isn't shown, since it would make this page
// hard to read too. The membership card is printed in the colour as it's typed: its
// ink is darkened until it reads on the card whatever the colour (membershipCard.js).
function Colors({ settings, onSaved }) {
  const { signedOut } = useContext(AdminContext);
  const saved = { accentColor: settings.accentColor, backgroundColor: settings.backgroundColor };
  // Only the colours the admin has picked. The others follow the saved colours, so
  // colours saved elsewhere (which come back with any other part's save) never show up
  // here as an unsaved edit that Save colours would send back, even mid-edit.
  const [edit, setEdit] = useState(null);
  const colors = { ...saved, ...edit };
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
  const ink = HEX.test(accentColor) ? accentColor : settings.accentColor;
  const card = { cinemaName: settings.cinemaName, accentColor: ink, logo: settings.logo, logoWithName: settings.logoWithName };

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
    setEdit(null);
    setNotice('Colours saved.');
    onSaved(r);
  }

  const pick = (name) => (value) => {
    setNotice(null);
    setEdit((e) => ({ ...e, [name]: value }));
  };

  return (
    <form onSubmit={save}>
      <p className="of-p of-dim">This page shows the colours as you pick them. Friends see them once they're saved.</p>
      <ErrorNote error={action.error} />
      <DoneNote>{notice}</DoneNote>
      <figure className="of-cardpreview">
        <MembershipCard site={card} name={SAMPLE.name} membership={SAMPLE.membership} />
        <figcaption>A sample member's card.</figcaption>
      </figure>
      <div className="of-grid2">
        <ColorField
          label="Your colour"
          value={colors.accentColor}
          fallback={settings.accentColor}
          onChange={pick('accentColor')}
          help="Prints the membership card, colours the tab icon and tints what's selected. A pale colour prints darker, so it reads on the card."
        />
        <ColorField
          label="Background"
          value={colors.backgroundColor}
          fallback={settings.backgroundColor}
          onChange={pick('backgroundColor')}
          help="Dark, so text stays easy to read."
        />
      </div>
      {check?.problems?.length > 0 && (
        <Line kind="bad" role="alert" lead="Can't save these colours.">
          {check.problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </Line>
      )}
      <ErrorNote error={check?.error} />
      <div className="ui-btns">
        <button className="ui-btn ui-btn--primary" disabled={action.busy || !unsaved || !valid || refused}>
          Save colours
        </button>
        {unsaved && (
          <button type="button" className="ui-btn" onClick={() => setEdit(null)} disabled={action.busy}>
            Cancel
          </button>
        )}
        <button type="button" className="ui-btn" onClick={() => setEdit(DEFAULT_COLORS)} disabled={action.busy || isDefault}>
          Back to Open Matte's colours
        </button>
      </div>
    </form>
  );
}

// A colour picker and the same colour as text, for pasting one from elsewhere. The picker
// can only hold a whole colour, so while the text is half-typed it shows the saved one.
function ColorField({ label, value, fallback, onChange, help }) {
  const id = useId();
  return (
    <div className="ui-field">
      <span className="ui-field__label" id={`${id}-l`}>
        {label}
      </span>
      <div className="of-colour">
        <input
          type="color"
          className="ui-color"
          value={HEX.test(value) ? value.toLowerCase() : fallback}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
        <input
          type="text"
          className="ui-input"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-label={`${label}, as #rrggbb`}
          aria-describedby={`${id}-h`}
        />
      </div>
      <p className="ui-field__hint" id={`${id}-h`}>
        {help}
      </p>
    </div>
  );
}

// Shows colours on this page before they're saved: the theme's custom properties go on
// <html>, over the server's <style id="theme"> (the saved colours, or what adoptTheme
// has put in it since). That style is switched off meanwhile, so whatever the theme
// leaves out is Open Matte's own, as the server would write it. Leaving the page, or
// clear(), puts the saved colours back.
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

// Switches the saved colours, the server's <style id="theme">, on or off.
function savedTheme(on) {
  const sheet = document.getElementById('theme')?.sheet;
  if (sheet) sheet.disabled = !on;
}

// After a save, this page takes the new colours as the server now writes them, so they
// stay when the preview goes, on Settings and every other back office page, until a
// reload. The page's Content-Security-Policy allows only the <style> the server wrote,
// by a hash of its text, so a new <style>, or new text in that one, would be refused.
// The colours go in through the CSSOM instead, which the policy doesn't cover, as the
// rule of the server's style sheet. The server writes one into every page, empty when
// no colours are set (page.js), so there is always one to use.
function adoptTheme(theme, backgroundColor) {
  const css = Object.entries(theme)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
  const sheet = document.getElementById('theme')?.sheet;
  if (sheet) {
    while (sheet.cssRules.length) sheet.deleteRule(0);
    sheet.insertRule(`:root{${css}}`);
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
    // A file the browser has no type for goes labelled as a PNG: the server recognises
    // the image by its bytes, and the label only gets it past the rule that /api takes JSON.
    const body = file.type ? file : new Blob([file], { type: 'image/png' });
    const r = await action.run(() => api.upload(url, body));
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
      <DoneNote>{notice}</DoneNote>
      {preview}
      <div className="ui-btns">
        <label className="ui-btn">
          {uploading ? 'Uploading…' : image ? `Replace the ${noun}` : `Upload a ${noun}`}
          <input type="file" accept={IMAGE_TYPES.join(',')} onChange={upload} disabled={action.busy} />
        </label>
        {image && (
          <button type="button" className="ui-btn ui-btn--danger" onClick={remove} disabled={action.busy}>
            Remove
          </button>
        )}
      </div>
      <p className="ui-field__hint of-gap-s">{help}</p>
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
    <>
      <ErrorNote error={action.error} />
      <label className="ui-check">
        <input type="checkbox" checked={settings.logoWithName} onChange={toggle} disabled={action.busy} />
        <span>Show the shop's name next to the logo</span>
      </label>
    </>
  );
}
