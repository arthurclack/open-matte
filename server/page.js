import crypto from 'node:crypto';
import fs from 'node:fs';
import { BRANDING_FILE, brandingType } from './branding.js';
import { publicOrigin } from './config.js';
import { filmArtwork, filmMedia } from './films.js';
import { palette, themeColor } from './theme.js';

// index.html as the server sends it: the cinema's name, colours and icon are
// written in, so the page never flashes Open Matte's amber before the app has
// loaded, and link previews (which fetch the page but run no scripts) get
// Open Graph tags.

const TICKET_CODE = /^[a-z0-9]{4,64}$/;

const decoded = (segment) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A ticket link that previews its film: a ticket for anyone, whose film
// /api/tickets/open would show a stranger. A ticket for one person previews as
// the cinema, since a browser that isn't signed in as them learns neither the
// film nor the name. Over the limit every link previews as the cinema. Reading
// this writes nothing: no session, no cookie, no "opened", no event.
export function createTicketPreviews({ db, access, counter }) {
  const ticketByCode = db.prepare('SELECT * FROM tickets WHERE code = ?');
  const filmById = db.prepare('SELECT * FROM films WHERE id = ?');

  // { code, film } for /t/<code> and /t/<code>/poster, or null.
  return (req, param) => {
    const code = String(param ?? '').toLowerCase();
    if (!TICKET_CODE.test(code) || !counter(req)) return null;
    const ticket = ticketByCode.get(code);
    if (!ticket || ticket.person_id != null) return null;
    const { state } = access.ticketStatus(ticket);
    if (state === 'revoked' || state === 'unpublished') return null;
    return { code, film: filmById.get(ticket.film_id) };
  };
}

export function createPage({ indexFile, settings, previews }) {
  // Read again whenever a build replaces it.
  let template = { mtimeMs: null, html: '' };
  function read() {
    try {
      const { mtimeMs } = fs.statSync(indexFile);
      if (mtimeMs !== template.mtimeMs) template = { mtimeMs, html: fs.readFileSync(indexFile, 'utf8') };
    } catch (err) {
      // Mid-build: the last one read is better than nothing.
      if (template.mtimeMs === null) throw err;
    }
    return template.html;
  }

  function render(req) {
    const s = settings.get();
    const name = escapeHtml(s.cinemaName);
    // Only names the upload routes could have stored.
    const logo = BRANDING_FILE.test(s.logo?.file ?? '') ? s.logo.file : null;
    const iconFile = BRANDING_FILE.test(s.icon?.file ?? '') ? s.icon.file : null;
    const origin = publicOrigin(req);
    const ticket = /^\/t\/([^/]+)$/.exec(req.path);
    // Decoded, as /t/:code/poster's code is, so the page and its poster agree.
    const preview = ticket ? previews(req, decoded(ticket[1])) : null;

    const tags = [`<meta name="theme-color" content="${escapeHtml(themeColor(s))}">`];
    const theme = Object.entries(palette(s));
    // After the app's stylesheet, so it wins. Only #rrggbb values come out of palette().
    if (theme.length) tags.push(`<style id="theme">:root{${theme.map(([k, v]) => `${k}:${v}`).join(';')}}</style>`);

    // The tab icon: the cinema's own, or Open Matte's in the cinema's colours,
    // with a version so browsers notice a change.
    let icon = null;
    if (iconFile) {
      const href = `/branding/${iconFile}`;
      icon = `<link rel="icon" href="${href}" type="${brandingType(iconFile)}">`;
      tags.push(`<link rel="apple-touch-icon" href="${href}">`);
    } else if (theme.length) {
      const version = crypto.createHash('sha256').update(`${s.accentColor} ${s.backgroundColor}`).digest('hex').slice(0, 8);
      icon = `<link rel="icon" href="/favicon.svg?v=${version}" type="image/svg+xml">`;
    }

    // Link previews. Never og:url: the address may hold a ticket code, and the
    // preview has it already.
    const og = (property, content) => tags.push(`<meta property="${property}" content="${escapeHtml(content)}">`);
    og('og:site_name', s.cinemaName);
    og('og:type', 'website');
    if (preview) {
      const { film, code } = preview;
      og('og:title', film.year ? `${film.title} (${film.year})` : film.title);
      og('og:description', `A ticket from ${s.cinemaName}.`);
      // The poster /t/<code>/poster would serve: a folder's own needs the folder there.
      const poster = filmArtwork(film).poster?.file || (filmMedia(film).poster && film.media_status !== 'missing');
      if (poster) og('og:image', `${origin}/t/${code}/poster`);
      tags.push('<meta name="twitter:card" content="summary">');
    } else {
      og('og:title', s.cinemaName);
      if (logo) og('og:image', `${origin}/branding/${logo}`);
    }

    let html = read();
    const title = `<title>${name}</title>`;
    const TITLE = /<title>[\s\S]*?<\/title>/i;
    const ICON = /<link\b[^>]*\brel=["']?icon["']?[^>]*>/i;
    // Functions, not strings, as replacements: a "$&" in the cinema's name stays as it is.
    const hadTitle = TITLE.test(html);
    if (hadTitle) html = html.replace(TITLE, () => title);
    else tags.unshift(title);
    if (icon && ICON.test(html)) html = html.replace(ICON, () => icon);
    else if (icon) tags.push(icon);
    const head = tags.join('\n    ');
    if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, () => `  ${head}\n  </head>`);
    else if (hadTitle) html = html.replace(title, () => `${title}\n    ${head}`);
    else html = html.replace(/^(\s*<!doctype[^>]*>)?/i, (doctype) => `${doctype}${head}`);
    return html;
  }

  return { render };
}
