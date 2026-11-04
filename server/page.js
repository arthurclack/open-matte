import crypto from 'node:crypto';
import fs from 'node:fs';
import { BRANDING_FILE, brandingType } from './branding.js';
import { publicOrigin } from './config.js';
import { styleHash } from './csp.js';
import { filmArtwork, filmMedia } from './films.js';
import { palette, themeColor } from './theme.js';

// index.html as the server sends it: the cinema's name, colours and icon, and
// what the header shows, are written in, so the page never flashes Open Matte's
// amber or an empty header before the app has loaded, and link previews (which
// fetch the page but run no scripts) get Open Graph tags. Each page comes with
// the hashes of the <style> elements written into it, for its
// Content-Security-Policy (csp.js), which allows those and no others.

const TICKET_CODE = /^[a-z0-9]{4,64}$/;
// The poster's address: /poster/<ticket id>.<mac>.
const POSTER_REF = /^(\d{1,12})\.([A-Za-z0-9_-]{22})$/;

const decoded = (segment) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// JSON inside <script>: nothing in it can end the element or start a comment.
const scriptJson = (value) => JSON.stringify(value).replace(/[<>&]/g, (c) => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' })[c]);

// A ticket link that previews its film: a ticket for anyone, whose film
// /api/tickets/open would show a stranger. A ticket for one person previews as
// the cinema, since a browser that isn't signed in as them learns neither the
// film nor the name. Over the limit every link previews as the cinema. Reading
// this writes nothing: no session, no cookie, no "opened", no event.
//
// The preview's poster has an address of its own, made for the preview: the
// ticket's id and a signature only this server can make (with `key`, a secret
// that never leaves it). It can fetch the poster and nothing else, and it holds
// neither the ticket's code nor anything that opens the ticket, so chat apps'
// image proxies and copied image addresses can pass it on without harm.
export function createTicketPreviews({ db, access, counter, key }) {
  const ticketByCode = db.prepare('SELECT * FROM tickets WHERE code = ?');
  const ticketById = db.prepare('SELECT * FROM tickets WHERE id = ?');
  const filmById = db.prepare('SELECT * FROM films WHERE id = ?');

  // Signs the code too, so an address only ever fits the ticket it was made for,
  // even if a restore from an older backup hands its id to a new ticket.
  const mac = (ticket) => crypto.createHmac('sha256', key).update(`poster:${ticket.id}:${ticket.code}`).digest('base64url').slice(0, 22);

  // The film the ticket previews, or null.
  function filmOf(ticket) {
    if (!ticket || ticket.person_id != null) return null;
    const { state } = access.ticketStatus(ticket);
    if (state === 'revoked' || state === 'unpublished') return null;
    return filmById.get(ticket.film_id);
  }

  return {
    // For /t/<code>: { film, poster } (the poster's path), or null.
    page(req, param) {
      const code = String(param ?? '').toLowerCase();
      if (!TICKET_CODE.test(code) || !counter(req)) return null;
      const ticket = ticketByCode.get(code);
      const film = filmOf(ticket);
      return film ? { film, poster: `/poster/${ticket.id}.${mac(ticket)}` } : null;
    },
    // For /poster/<id>.<mac>: the film, or null. The page and its poster count
    // against the same limit.
    poster(req, ref) {
      const m = POSTER_REF.exec(String(ref ?? ''));
      if (!m || !counter(req)) return null;
      const [, id, given] = m;
      const ticket = ticketById.get(Number(id));
      // The id as written: 07.<mac of 7> fits no ticket.
      if (!ticket || String(ticket.id) !== id || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(mac(ticket)))) return null;
      return filmOf(ticket);
    },
  };
}

export function createPage({ indexFile, settings, previews, site }) {
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
    // Decoded, as the app decodes it before opening the ticket.
    const preview = ticket ? previews.page(req, decoded(ticket[1])) : null;

    const tags = [`<meta name="theme-color" content="${escapeHtml(themeColor(s))}">`];
    const theme = Object.entries(palette(s));
    const styleHashes = [];
    // After the app's stylesheet, so it wins. Only #rrggbb values and "r, g, b"
    // triples come out of palette(). The hash is of exactly the text between the tags.
    // Written even with no colours set (an empty :root{}), so the admin always has a
    // style sheet the policy allows to put newly saved colours in (Branding.jsx).
    const css = `:root{${theme.map(([k, v]) => `${k}:${v}`).join(';')}}`;
    tags.push(`<style id="theme">${css}</style>`);
    styleHashes.push(styleHash(css));

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

    // Link previews. Never og:url, and never the ticket code anywhere in the
    // page: the preview has the address already, and the poster has its own.
    const og = (property, content) => tags.push(`<meta property="${property}" content="${escapeHtml(content)}">`);
    og('og:site_name', s.cinemaName);
    og('og:type', 'website');
    if (preview) {
      const { film } = preview;
      og('og:title', film.year ? `${film.title} (${film.year})` : film.title);
      og('og:description', `A ticket from ${s.cinemaName}.`);
      // Only when /poster/<id>.<mac> would serve one: a folder's own needs the folder there.
      const poster = filmArtwork(film).poster?.file || (filmMedia(film).poster && film.media_status !== 'missing');
      if (poster) og('og:image', `${origin}${preview.poster}`);
      tags.push('<meta name="twitter:card" content="summary">');
    } else {
      og('og:title', s.cinemaName);
      if (logo) og('og:image', `${origin}/branding/${logo}`);
    }

    // The site as /api/site has it, so the app can draw the header (the name,
    // the logo) from the first paint rather than once /api/me has answered. The
    // logo is requested along with the page.
    // The admin draws no logo, so it isn't asked for there.
    if (logo && !/^\/admin(\/|$)/.test(req.path)) tags.push(`<link rel="preload" as="image" href="/branding/${logo}">`);
    tags.push(`<script type="application/json" id="site-data">${scriptJson(site(s))}</script>`);

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
    return { html, styleHashes };
  }

  return { render };
}
