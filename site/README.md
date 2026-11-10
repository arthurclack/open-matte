# openmatte.dev

The project's website: one page and a 404, built by Vite into static files in
`site/dist` and served as they are. It is part of Open Matte and under the same
licence (GPL-3.0-or-later).

The site wears the app's own look from 1.1.0, the one-shelf video shop
(`web/src/look/`): the page is the shop's counter at closing time. The room is
dark (#171513); on it lie flat printed things, slightly imperfect (a shop
poster, black label tape, a till slip); the controls are the shop's quiet
computer (Matte Mono, lit blocks, square boxes, no motion). Pictures of the
app show it in 1.1.0's look and words (exceptions under "The pictures"): the
friend's film page in the hero, the back office lending a tape in How it
works, the film playing in the close. The blue screen appears only inside
those pictures, and orange only on a deadline.

It went live on 10 November 2026, ahead of 1.1.0. Until 1.1.0 is released, the
install guide it links to installs 1.0.x, which still has the cinema's look
and words (tickets, screenings, Issue, Revoke); what the friend and the owner
can do is the same.

Everything a reader reads is real text. The pictures are stills: nothing on
the page moves, and the site sends no framework, only a few lines of script
for the phone's menu.

## Layout

```text
site/
  index.html, 404.html     the two pages (Vite entries)
  vite.config.mjs          the build: two pages, no plugins
  src/
    site.css               the stylesheet; imports the two below
    tokens.css             every face and colour the pages use, and their few sizes
    base.css               the room, reading text, links, focus and selection
    main.ts                the one script: closes the phone's menu (the page works without it)
  public/                  copied into dist as is
    fonts/                 four faces cut down to Latin, WOFF2, each with its OFL text
    img/                   the pictures, WebP
    favicon.svg, og-v2.png, third-party-licenses.txt
  tools/
    serve.mjs              serves dist with the production headers
    images.mjs             turns the baked pictures into public/img/*.webp
    og.mjs                 renders public/og-v2.png
    fonts.py               cuts the app's fonts down to public/fonts/*.woff2
```

## Build and preview

From the repository's root (Vite comes from the repository's own
`node_modules`; the site adds no dependencies):

```bash
node_modules/.bin/vite build --config site/vite.config.mjs   # writes site/dist
node site/tools/serve.mjs 4173                               # http://127.0.0.1:4173/
```

`serve.mjs` has no dependencies. It answers GET and HEAD, sends `404.html` with a
404 status for unknown paths, refuses any path that climbs out of `dist`, and
sends the same headers as production (below), so a Content-Security-Policy
problem shows up here first. While working on the pages,
`node_modules/.bin/vite --config site/vite.config.mjs` serves them with hot
reload.

The 404 is served for any address, so everything it links (its stylesheet, the
favicon, the fonts, home and the licences) is a root path: at `/films/a/b` it
keeps its look.

The ink on the display print (the wordmark, the poster's headline, the label
tape) is an SVG filter, `#ink-print`, written into each page's `<body>`; the
stylesheet points at it with `url(#ink-print)`. It is markup, not a style, so
the policy allows it. Reading-size print (the poster's lead, the till slip) is
set clean on purpose: Safari draws an SVG filter on text at 1x, which washes it
out on 1x screens and blurs it on 2x ones.

**Still to check:** the label tape and the wordmark in a real Safari, on an
iPhone and a Mac. Playwright's WebKit draws them softer than Chromium on 2x
and 3x screens, with 1x steps in the letters' edges. If they read soft there,
`@media (min-resolution: 2dppx) { .mark__ink, .tape, .tape__part { filter: none; } }`
after the tape rules in `site.css` keeps their grain, gloss, glow, cut and tilt
on such screens, in every browser, and drops only the ink edge.

## The pictures

`public/img/` holds the printed objects and the stills of the app, as WebP:

| File | What it is | Where on the page |
|---|---|---|
| `app-film-page.webp` | the friend's film page in The Lantern Room, 390 wide | the hero |
| `obj-sleeve.webp` | the plain kraft sleeve with its typed label | How it works, step 1 |
| `obj-pick.webp` | the staff-pick card | step 2 |
| `app-lend.webp`, `app-lend-compact.webp` | the back office lending a tape, 600 wide, and its phone layout under 36rem | step 3 |
| `obj-dueback.webp` | the film's label tape with the Due back sticker | Due back |
| `obj-cardback.webp` | the membership card's back | What you need |
| `app-playing.webp` | the film playing, its title card in plain type | the close, and the link preview |
| `grain-paper.webp` | the paper's grain, a 128px tile | behind the poster, the tape and the slip |

They are made in two steps, both outside the page itself:

1. **Baked** from the project's design files, which are kept outside the
   repository, by a render script there (`render.cjs`, with `film.js`, the
   film's details, and `objects.html`, the printed objects). It draws the
   app's screens from the approved design mocks, set back to 1.1.0's
   behaviour, and writes PNGs: the objects and the app stills at 3x, the wide
   back office (`app-lend.png`) and the grain tile at 2x.
2. **Converted** by `tools/images.mjs`, which draws each one at twice the width
   the page shows it at (sharp on a 2x screen) and encodes it as WebP in
   Chromium, keeping transparency. The printed objects and the film page are
   encoded at quality 0.93, or their grain smooths away; the app's flat screens
   at 0.95, or pale 8px blocks show around their words; the grain tile at 0.9:

   ```bash
   node site/tools/images.mjs <folder of baked PNGs>
   ```

   If a picture changes shape, set its `width` and `height` in `index.html` to
   its size at 1x (the PNG's size divided by 3, or by 2 for `app-lend.png`) and
   check its shown width in `site.css`.

The film in every picture is Dr. Strangelove (1964, Stanley Kubrick), held by the
sample shop as "Dr. Strangelove", 1 h 35 min, on tape E-120. Nothing from the
film itself appears: a plain sleeve, and a title card in plain type (Fraunces),
not the film's own titles. The synopsis on the film page was written for the
site. The staff pick, "Peter Sellers plays three parts. Sixty years on, it's
still funny.", is Arthur's. To change it, change `film.js`, bake again, run
`images.mjs`, and change the quote in the hero picture's `alt` in `index.html`
to match; give the changed pictures new names (see "Caching").

Where the pictures differ from 1.1.0 as it runs:

- **The sleeve's label in the hero.** On a phone, 1.1.0 types this label on a
  96px sleeve, and its `objects.css` (`overflow-wrap: anywhere` in a 72px
  measure) breaks the word as "Strangelov / e". The hero still shows it whole,
  as the design mocks set it. For the picture to be true, the app's label has
  to fit an 11-letter word (for example 11px type inside its
  `@container (max-width: 140px)` rule), or `app-film-page` is re-shot from the
  running app.
- **The membership card's back** (`obj-cardback.webp`) is the design mocks'
  card. 1.1.0's card has since changed: Member since is a violet date stamp and
  the name is written in ballpoint. Re-bake it once the card is final.
- **The back office's form** has 1.1.0's words, but only the fields this tape
  uses: 1.1.0 also shows "Who is it for?", "Start by" and "How many tapes", and
  a hint under each field. It also leaves out the raster 1.1.0 draws behind the
  back office's work, which would resample into bands in a still.
- **The player's bar** is drawn as 1.1.0 lays it out on a phone for Safari's
  own player: "Picture: Auto" in plain words, then Playback help. That is from
  reading `Player.jsx` and its styles, not checked in the running app.

## The link preview

`public/og-v2.png` (1200 x 630) is what a link to the site shows in chat apps:
the wordmark, the shop poster with the headline, and the film playing
(`public/img/app-playing.webp`), on the dark room, in the page's own faces and
tokens. Its alt text is `og:image:alt` in `index.html`; change the two
together. After changing the tokens, a face or that still, render it again:

```bash
node site/tools/og.mjs
```

It has a new name (the 1.0 site's was `og.png`, now removed) because chat apps
cache a preview by its address. It uses Playwright's Chromium from the
repository (`npx playwright install chromium` once) and reads only local files.

## Publish

First merge `site/` into `main` and push it: the licences file says this site's
source is in the repository, so it must be there before the site is. Then
build, and copy `site/dist` to the server. `SITE_HOST` is the SSH name of the
server, set by whoever publishes:

```bash
node_modules/.bin/vite build --config site/vite.config.mjs
rsync -rlpt --delay-updates --delete-after site/dist/ "$SITE_HOST:/srv/openmatte-site/public/"
```

`--delay-updates --delete-after` puts every new file in place at the end and
removes old ones only after that, so a page never points at a stylesheet that
is not there yet or was just removed. `-p` copies the build's own permissions
(files 644, folders 755 with the usual umask). The rsync that comes with macOS
(openrsync) accepts `--chmod` but ignores it, so the command relies on `-p`. If
the folder on the server belongs to root, add `--rsync-path="sudo rsync"`. Try
it with `-n -i` first to see what it will change.

## Headers

The server must send these with every response (`tools/serve.mjs` has them in
`HEADERS`):

```text
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Cross-Origin-Opener-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
Cache-Control: public, max-age=300
```

With Caddy, for example. Headers set in the site's main route don't reach the
responses `handle_errors` makes, so a snippet sets them in both, or the 404
page goes out with none of them:

```caddyfile
(site_headers) {
	header {
		Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		Cross-Origin-Opener-Policy "same-origin"
		Permissions-Policy "camera=(), microphone=(), geolocation=(), interest-cohort=()"
		Cache-Control "public, max-age=300"
	}
}

openmatte.dev {
	root * /srv/openmatte-site/public
	import site_headers
	file_server
	handle_errors {
		import site_headers
		@missing expression {err.status_code} == 404
		rewrite @missing /404.html
		file_server
	}
}
```

Check them on a page and on a missing path once it is live:
`curl -sI https://openmatte.dev/` and `curl -sI https://openmatte.dev/nothing-here`.
Check a font too, `curl -sI https://openmatte.dev/fonts/Fraunces-800.woff2`:
it should say `font/woff2`.

The site uses no `data:` image, so `img-src` could be `'self'` alone; changing
it means changing the server's Caddyfile too.

The policy is why the pages have no inline script, no `<style>` element and no
`style` attribute: styles come from the built stylesheet, and the ink filter is
SVG markup in the page.

One known side effect: Safari shows a plain-text file (`/third-party-licenses.txt`,
a font's OFL text) inside a `<pre>` that it styles with a `style` attribute of
its own, which `style-src 'self'` blocks. The file still shows, in full, but
Safari logs a policy error and doesn't wrap its lines, so on a phone they
scroll sideways (at 390px the licences file is about 600px wide and a font's
OFL text about 770px). The headers stay the same for every file.

## Nothing from elsewhere

The site makes no third-party requests: no web fonts from a CDN, no analytics,
no embeds. Every script, stylesheet, image and font comes from the site's own
origin.

## Caching, and Cloudflare in front

openmatte.dev is proxied by Cloudflare, which changes what visitors get in
ways `serve.mjs` can't show:

- **Browsers keep static files for 4 hours**, not 5 minutes: Cloudflare's
  browser cache setting replaces `max-age=300` on fonts, pictures, the
  favicon and `assets/*` (pages and `.txt` files keep 300 seconds). Vite
  names `assets/*` by their content, so they are safe. Any other file that
  changes (a picture, a font, the link preview) should get a new name, as
  `og-v2.png` did, or returning visitors see the old one for up to 4 hours.
- **Purge the cache after publishing** (Cloudflare dashboard, Caching,
  Purge Everything), so the edge drops any 404 it kept for a new address.
- **Rocket Loader** was on for the zone in November 2026: Cloudflare rewrote
  the page's script tag and added its own loader from `/cdn-cgi/`. It is the
  same origin, so the policy allows it, and the page works without it, but it
  adds about 4 KB for a 440-byte script. It is a zone setting (Speed,
  Optimization).

## The fonts

Four faces, each under the SIL Open Font License 1.1 with its licence beside it
in `public/fonts/`. They start as the app's own files in `web/public/fonts`
(from 1.1.0; until it is merged, pass that folder from the 1.1.0 branch);
`tools/fonts.py` cuts each down to the Latin characters and to the
weights and settings the stylesheet asks for, as WOFF2:

| Face | File | Sets |
|---|---|---|
| Libre Franklin, variable, weights 400 to 700 | `LibreFranklin-400-700.woff2`, 27 KB | everything you read; the label tape's letters |
| Fraunces, one style: 800, `opsz` 72, `SOFT` 100, `WONK` 0 | `Fraunces-800.woff2`, 18 KB | the shop's own printing: the wordmark, the poster's headline |
| Matte Mono (IBM Plex Mono Regular, renamed) | `MatteMono-Regular.woff2`, 14 KB | the shop's computer: the bar, buttons, menu, step numbers |
| Courier Prime | `CourierPrime-Regular.woff2`, 18 KB | the till slip |

That is 77 KB for all four, where the app's files are 737 KB.

A cut-down font is a modified version under the OFL. IBM Plex Mono's licence
reserves the name "Plex", so the modified copy can't carry it: it is named Matte
Mono, in the file and in `tokens.css`, and its name table says what it was cut
from. The others reserve no name and keep theirs. Each licence file is the
original's, unchanged.

`tokens.css` declares them with `font-display: swap`. Both pages preload Libre
Franklin, Fraunces and Matte Mono, which set the first screen; Courier Prime
loads from the stylesheet when the till slip needs it. Nothing on the page uses
Plex SemiBold, Grape Nuts or VT323, so they aren't sent: Grape Nuts (the staff
pick's hand) and VT323 (the Play tile) appear only inside the pictures.

To cut them again, after the app's fonts change or the page needs a weight,
setting or character it doesn't have, from the repository's root:

```bash
python3 -m venv /tmp/fonttools && /tmp/fonttools/bin/pip install fonttools brotli
/tmp/fonttools/bin/python site/tools/fonts.py   # reads web/public/fonts
```

Pass another folder as the first argument to read the fonts from there. Two runs
give byte-identical files. If the page starts using a weight, an `opsz`, `SOFT`
or `WONK` value, or a character outside Latin, change `fonts.py` first: the
browser would otherwise fake the weight or fall back to another font.

## Licences

The site's own code is Open Matte's: GPL-3.0-or-later, with its source in this
repository. `public/third-party-licenses.txt`, linked from the footer, holds
everything else the pages send: the four fonts, with what was changed, their
copyright lines and the address of each licence. The page's script and stylesheet bundle nothing of
anyone else's. Add to the file when the pages gain a font or a package.
