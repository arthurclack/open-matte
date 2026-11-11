# openmatte.dev

The project's website: one page and a 404, built by Vite into static files in
`site/dist` and served as they are. It is part of Open Matte and under the same
licence (GPL-3.0-or-later).

The site wears the app's own look from 1.1.0, the one-shelf video shop
(`web/src/look/`): the page is the shop's counter at closing time. The room is
dark (#171513); on it lie flat printed things, slightly imperfect (a shop
poster, black label tape, a till slip); the controls are the shop's quiet
computer (Matte Mono, lit blocks, square boxes, no motion). Pictures of the
app show it in 1.1.0's look and words (exceptions under "Where the pictures
differ from 1.1.0"): in the hero, a friend's phone getting the tape's link,
opening the film's page and pressing Play; in How it works, the back office
lending the tape; in the close, the film playing on that phone. The blue
screen appears only inside those pictures, and orange only on a deadline.

It went live on 10 November 2026, the day 1.1.0 was released, so the install
guide it links to installs the release the page shows.

Everything a reader reads is real text. Two pictures of the app move: the
friend's phone in the hero and the back office in How it works are scenes,
built with React and the Stageshow kit (see "The scenes"). They load only as
they come near the screen, after the page itself; under reduced motion and
with no script, their stills stand in, and the page is whole before any
script runs. Every other picture is a still; the close's is a frame of the
hero's scene.

## Layout

```text
site/
  index.html, 404.html     the two pages (Vite entries)
  stage.html               development only: the scenes at their sizes, for filming and the stills
  vite.config.mjs          the build: two pages, the React plugin, lucide-react aliased to the kit's shim
  src/
    site.css               the stylesheet; imports the two below and the scenes' places
    tokens.css             every face and colour the pages use, and their few sizes
    base.css               the room, reading text, links, focus and selection
    main.ts                the one script: the scenes (stage/mount.ts) and the phone's menu
    stage/                 the two scenes, their places, their look, how they mount,
                           the preview behind stage.html, and each scene's REHEARSAL notes
    stageshow-kit/         the Stageshow kit (MIT), copied in, with its LICENSE and NOTICE
  public/                  copied into dist as is
    fonts/                 six faces cut down to Latin, WOFF2, each with its OFL text
    img/                   the printed objects and the paper's grain, WebP (and the link preview's still)
    stage/                 the scenes' stills, exported from stage.html, and the printed
                           things the hero's scene shows, baked from 1.1.0, WebP
    favicon.svg, og-v2.png, third-party-licenses.txt
  tools/
    serve.mjs              serves dist with the production headers
    images.mjs             turns the baked pictures into public/img/*.webp
    stills.mjs             exports the scenes' stills into public/stage/*.webp
    prints.mjs             bakes the hero scene's printed things from 1.1.0 into public/stage/
    og.mjs                 renders public/og-v2.png
    fonts.py               cuts the app's fonts down to public/fonts/*.woff2
```

## Build and preview

From the repository's root (Vite, and React and its Vite plugin for the
scenes, come from the repository's own `node_modules`; the site adds no
dependencies):

```bash
node_modules/.bin/vite build --config site/vite.config.mjs   # writes site/dist
node site/tools/serve.mjs 4173                               # http://127.0.0.1:4173/
```

`serve.mjs` has no dependencies. It answers GET and HEAD, sends `404.html` with a
404 status for unknown paths, refuses any path that climbs out of `dist`, and
sends the same headers as production (below), so a Content-Security-Policy
problem shows up here first: check the scenes there too, not only in
development, where Vite injects the styles itself.

While working on the pages and the scenes, Vite's development server serves
them with hot reload:

```bash
node_modules/.bin/vite --config site/vite.config.mjs --port 5199   # http://127.0.0.1:5199/
```

On it, `/stage.html` shows each scene on the page's own ground and
stylesheet, at its wide and compact design widths, for filming and for the
stills: `?only=tape-wide`, `tape-compact`, `lend-wide` or `lend-compact` for
one cut, `?only=tape` or `?only=lend` for both of a scene. Under reduced
motion a scene draws its story's still; `&still=start` draws its opening
frame instead, and `&still=playing` the tape scene's film playing. Film the
compact cuts in a 390px window. `stage.html` is never built.

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

The film in every picture is Dr. Strangelove (1964, Stanley Kubrick), held by
the sample shop, The Lantern Room, as "Dr. Strangelove", 1 h 35 min, on tape
E-120, lent to a friend for one play, to start by Sat 14 Nov, with 7 days
after the first play. Nothing from the film itself appears: a plain sleeve,
and a title card in plain type (Fraunces), not the film's own titles. The
staff pick, "Peter Sellers plays three parts. Sixty years on, it's still
funny.", is Arthur's. The shop's address is made up (`lanternroom.example`),
and so is the tape's link.

### The printed objects

`public/img/` holds the shop's printed things that lie on the page, as WebP:

| File | What it is | Where on the page |
|---|---|---|
| `obj-sleeve.webp` | the plain kraft sleeve with its typed label | How it works, step 1 (and the back office's thumbnail) |
| `obj-pick.webp` | the staff-pick card | step 2 |
| `obj-dueback.webp` | the film's label tape with the Due back sticker | Due back |
| `obj-cardback.webp` | the membership card's back | What you need |
| `grain-paper.webp` | the paper's grain, a 128px tile | behind the poster, the tape and the slip |
| `app-playing.webp` | the film playing, a flat crop of the film's page | only the link preview (`og.mjs`); not on the page |

They are made in two steps, both outside the page itself:

1. **Baked** from the project's design files, which are kept outside the
   repository, by a render script there (`render.cjs`, with `film.js`, the
   film's details, and `objects.html`, the printed objects). It draws them
   from the approved design mocks, set back to 1.1.0's behaviour, and writes
   PNGs: the objects and the app still at 3x, the grain tile at 2x.
2. **Converted** by `tools/images.mjs`, which draws each one at twice the width
   the page shows it at (sharp on a 2x screen) and encodes it as WebP in
   Chromium, keeping transparency. The printed objects are encoded at quality
   0.93, or their grain smooths away; the app still at 0.95, or pale 8px
   blocks show around its words; the grain tile at 0.9:

   ```bash
   node site/tools/images.mjs <folder of baked PNGs>
   ```

   If a picture changes shape, set its `width` and `height` in `index.html` to
   its size at 1x (the PNG's size divided by 3) and check its shown width in
   `site.css`.

To change the staff pick, change `film.js` and bake again, run `prints.mjs`
(below) for the hero's scene, export the stills again, and change the quote
in the hero's `alt` in `index.html`; give the changed pictures new names (see
"Caching").

### The scenes' pictures

`public/stage/` holds what the two scenes draw with and the stills that stand
in for them, as WebP at 2x:

| File | What it is | Where on the page |
|---|---|---|
| `tape.webp`, `tape-compact.webp` | the hero scene's story still: Arthur's reply and the tape's link arrived (392 x 684 and 358 x 625) | the hero, with no script or under reduced motion; wide from 75rem |
| `tape-start.webp`, `tape-start-compact.webp` | its opening frame: the conversation, ending on the friend's question | the hero, until the scene draws |
| `tape-playing.webp`, `tape-playing-compact.webp` | its film playing: the player, its bar, and the film's page under them as far as its details (392 x 526 and 358 x 480) | the close; wide from 75rem |
| `lend.webp`, `lend-compact.webp` | the back office scene's story still: the tape lent, Copy link pressed, Copied (600 x 700, and 358 x 586 in its phone layout) | How it works, step 3, with no script or under reduced motion; the phone layout under 36rem |
| `lend-start.webp`, `lend-start-compact.webp` | its opening frame: the film's page in the back office | step 3, until the scene draws |
| `tape-print-shop.webp`, `-sleeve`, `-pick`, `-label` | the shop's name, the sleeve, the staff pick and the tape's label, baked from 1.1.0 at 3x | inside the hero's scene, on the film's page |
| `tape-film-title.webp`, `tape-film-line.webp` | the title card in plain type, and its second line alone | inside the hero's scene, in the player |

The stills are exported from the scenes themselves (see "The scenes"). The
printed things in the hero's scene are baked by `tools/prints.mjs` from the
real 1.1.0 web app, so they carry its seeded grain, wear, hand and ink: it
runs the app in Chromium at an iPhone's 402 points with the film's page
answered as the story has it, shoots each printed thing at its own box, and
prints the boxes, which `TapeScene.tsx` places them at. It needs a copy of
1.1.0 (the `v1.1.0` tag, or `main`) with its web app built (`npm ci && npm
run build` in it):

```bash
node site/tools/prints.mjs <1.1.0 checkout>                     # into public/stage
node site/tools/prints.mjs <1.1.0 checkout> --out /tmp/look-first
```

### Where the pictures differ from 1.1.0

Every word in the scenes is 1.1.0's, except the conversation, the address,
the link, the chat app's own words (Done) and the title card, which are the
scene's. Where the pictures differ from 1.1.0 as it runs:

- **The sleeve's label in the hero's scene.** On a phone, the released 1.1.0
  types this label on a 96px sleeve, and its `objects.css` (`overflow-wrap:
  anywhere` in a 72px measure) breaks the word as "Strangelov / e".
  `prints.mjs` sets it at 11px, so it shows whole, as the design mocks set it.
  For the picture to be true, the app's label has to fit an 11-letter word:
  `.ob--kraft .ob--label .ob__ink { font-size: 11px; padding: 7px 5px 6px; }`
  inside its `@container (max-width: 140px)` rule, which is what `prints.mjs`
  injects. Once that ships, drop the override, bake again and remove this
  entry.
- **The film's page in the hero's scene** has three placeholder lines where the
  synopsis is (the shop's own words for the film aren't settled). Everything
  else on it is 1.1.0's: the words under PLAY are `clockLines()` and
  `privacyLine()` for this tape, with the start-by time as WebKit formats it
  in en-GB, "Sat 14 Nov at 23:59" (Chromium writes "Sat 14 Nov, 23:59"; not
  seen on an iPhone), and the footer's rule and first line follow the film.
  The link's preview has no picture, as 1.1.0's server sends no `og:image`
  for a film with no artwork.
- **The PLAY screen** holds about 1.3 seconds before the picture, where 1.1.0
  holds it 800 ms (`crt.jsx` `PLAY_SCREEN_MS`), so it can be read in a demo.
- **The player's bar** is drawn as 1.1.0 lays it out on a phone under
  Safari's own player for a film with a ladder of pictures (any source of
  700p or more, `scripts/encode.mjs`): Picture with its menu on Auto, then
  Playback help on a row of its own, its words 12px right of Picture's, as
  1.1.0's quiet small button pads them. Measured from 1.1.0 in Playwright's
  WebKit playing a film with three pictures (1080p HEVC and H.264, 720p
  H.264); not seen on an iPhone. A film with one picture, or a browser with
  no `ManagedMediaSource` (iOS before 17.1, some apps' own web views), shows
  "Picture: Auto" in plain words instead. The title card's second line coming
  up is how the scene shows the film running.
- **The back office** shows every field of 1.1.0's form, with its hints, but
  "Who is it for?" is left empty (the friend's name isn't in the story), so no
  "For ..." line follows "1 tape ready.". Copied stays: 1.1.0 puts Copy link
  back after 1.5 seconds. The date is drawn as Safari draws it, with no
  calendar icon or spinners: in the wide cut as on a Mac (14/11/2026), in the
  phone cut as on an iPhone (14 Nov 2026, left-aligned like the other values;
  its alignment not checked on a device). On the phone, the lend button's
  label breaks into two even lines (`text-wrap: balance` on the scene's
  `.ui-btn`); 1.1.0's `ui.css` has no such rule, so at a phone's width the
  real button leaves "link" alone on its second line (the same rule belongs
  in 1.1.0's `.ui80 .ui-btn`). It leaves out the raster 1.1.0 draws behind
  the back office's work, which would resample into bands in a still, and the
  page opens 7px further down than 1.1.0's, so the crop doesn't cut a line of
  words. Its phone layout opens with 7 already in Days after the first play:
  typing it would need the iPhone's number pad.
- **The membership card's back** (`obj-cardback.webp`) is the design mocks'
  card. 1.1.0's card has since changed: Member since is a violet date stamp and
  the name is written in ballpoint. Re-bake it once the card is final.
- **The link preview's still** (`app-playing.webp`) is the design mocks' flat
  crop of the film playing, not the phone the close shows.

## The scenes

Two pictures of the app are scenes, React components built with the
Stageshow kit (`src/stageshow-kit/`, copied in from the Stageshow skill, MIT;
what this copy changes is in its `README.md`):

| Scene | File | Place on the page | Design sizes |
|---|---|---|---|
| `tape`: a friend's phone gets Arthur's reply and the tape's link, opens the film's page in the chat app's browser, scrolls to the tape, presses PLAY; the film's title card plays; Done | `src/stage/TapeScene.tsx` | the hero's right column, `figure.hero__app` | wide 392 x 684 from 75rem; compact 358 x 625 below (its `below` is 380); loops, about 16 seconds |
| `lend`: the back office, on the film's page, lends a tape for anyone with the link and copies it | `src/stage/LendScene.tsx` | How it works, step 3, `figure.step__pic--office` | wide 600 x 700, with a pointer; compact 358 x 586 under 36rem, with a finger (its `below` is 480); plays once, then holds |

Each place is a figure marked `data-scene` that holds the scene's stills as a
`<picture>` with real alt text that tells the scene's whole story: the
story's still (scripting off, reduced motion) and, in sources marked
`data-start`, the opening frame where the scene will play. The `width` and
`height` on each source and the `img` are the design sizes, and each place is
as wide as its scene's design (`tape-place.css`, `lend-place.css`), so the
still holds exactly the box the stage will fill and nothing moves when the
scene takes over.

No picture of the app stops on a straight cut. Each place fades its picture
and its live layer into the room at the foot, with a mask: the phone's last
3rem in the hero and the close, the back office's last 40px of its design
height in step 3. Each scene keeps that band to filler at every beat (the
scene files say what lies under it), and the Pause button, above the figure,
is never faded.

`src/stage/mount.ts` (from `main.ts`) waits for the page's `load`, then
fetches a scene's code as its section comes within 600px of the screen and
mounts it as its place comes within 300px, asking for the scene's own fonts
as it does; once the stage has drawn a settled frame (its fonts in) it fades
in over the still, which stays underneath for screen readers (the moving
layer is `aria-hidden` and `inert`), and its script starts only then, so a
slow connection never shows a scene mid-story. Each live scene has a Pause
button (Replay once a scene that plays once has ended).
Under reduced motion no scene code is ever fetched. The places' CSS is part
of the page's stylesheet (`src/stage/mount.css`, `tape-place.css`,
`lend-place.css`); each scene's own CSS (`look.css`, the kit's, its own) comes
with its code.

`src/stage/look.css` is 1.1.0's look for the scenes: the faces only they use,
1.1.0's own tokens under their own names (the page's where it has them), and
the kit's `--ss-*` tokens mapped onto those. Each scene file also exports
`info`: its id, design sizes and stills, which `stage.html` and `stills.mjs`
read, so neither keeps a list of its own. How each scene was rehearsed, beat
by beat, and what was checked, is in `src/stage/REHEARSAL-tape.md` and
`REHEARSAL-lend.md`.

The stills are exported from the scenes themselves, at 2x on a transparent
ground, as WebP (quality 0.95), with the development server running. A still
with a `height` in its scene's `info` keeps only the stage's top (the close's
film playing):

```bash
node_modules/.bin/vite --config site/vite.config.mjs --port 5199   # in another shell
node site/tools/stills.mjs http://127.0.0.1:5199/stage.html        # all of them, into public/stage
node site/tools/stills.mjs http://127.0.0.1:5199/stage.html --only tape --out /tmp/look-first
```

Export them again whenever a scene's look, its story's frame or its opening
frame changes, check the sizes it prints against `index.html`, and give
changed stills new names (see "Caching").

## The link preview

`public/og-v2.png` (1200 x 630) is what a link to the site shows in chat apps:
the wordmark, the shop poster with the headline, and the film playing
(`public/img/app-playing.webp`, a flat crop of the film's page, not the
phone the close shows), on the dark room, in the page's own faces and
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

Six faces (four for the page, two for the scenes), each under the SIL
Open Font License 1.1 with its licence beside it in `public/fonts/`. They
start as the app's own files in `web/public/fonts` (1.1.0's);
`tools/fonts.py` cuts each down to the Latin characters and to the
weights and settings the stylesheets ask for, as WOFF2:

| Face | File | Sets |
|---|---|---|
| Libre Franklin, variable, weights 400 to 700 | `LibreFranklin-400-700.woff2`, 27 KB | everything you read; the label tape's letters |
| Fraunces, one style: 800, `opsz` 72, `SOFT` 100, `WONK` 0 | `Fraunces-800.woff2`, 18 KB | the shop's own printing: the wordmark, the poster's headline |
| Matte Mono (IBM Plex Mono Regular, renamed) | `MatteMono-Regular.woff2`, 14 KB | the shop's computer: the bar, buttons, menu, step numbers |
| Courier Prime | `CourierPrime-Regular.woff2`, 18 KB | the till slip |
| Matte Mono SemiBold (IBM Plex Mono SemiBold, renamed), weights 500 to 700, with the left arrow | `MatteMono-SemiBold.woff2`, 15 KB | the scenes only: the machine's heavier words (and the back office's "← Films") |
| VT323 | `VT323-Regular.woff2`, 18 KB | the scenes only: the blue screen's lettering |

That is 77 KB for the page's four, where the app's files are 737 KB; the
scenes' two (33 KB) are declared in `src/stage/look.css`, which comes with
a scene's code, and a browser fetches one only when a scene sets text in it.
The staff pick's hand, Grape Nuts, is never set as text, on the page or in a
scene: the pick is always a picture (`obj-pick.webp`, `tape-print-pick.webp`),
so no file of it is sent.

A cut-down font is a modified version under the OFL. IBM Plex Mono's licence
reserves the name "Plex", so the modified copy can't carry it: it is named Matte
Mono, in the file and in `tokens.css`, and its name table says what it was cut
from. The others reserve no name and keep theirs. Each licence file is the
original's, unchanged.

`tokens.css` declares the page's four with `font-display: swap`. Both pages
preload Libre Franklin, Fraunces and Matte Mono, which set the first screen;
Courier Prime loads from the stylesheet when the till slip needs it.

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
everything else the pages send: the six fonts, with what was changed, their
copyright lines and the address of each licence, and the code the scenes
bring with them (React, react-dom and scheduler, the Stageshow kit, Vite's and
Rolldown's small module helpers). Add to the file when the pages gain a font
or a package: if a scene starts to use a kit part that draws a Lucide glyph
(`src/stageshow-kit/lucide-shim.tsx`), add Lucide's notice, which is in that
file.
