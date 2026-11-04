# openmatte.dev

The project's website: one page and a 404, built by Vite into static files in
`site/dist` and served as they are. It is part of Open Matte and under the same
licence (GPL-3.0-or-later).

The page shows the real app in two short scenes, built with the Stageshow kit in
the app's own look: a friend opening a ticket on their phone (the hero), and a
ticket being issued in the admin (How it works). Each scene is a React component
that loads only when it comes near the screen. With scripting off and under
reduced motion, its story's still stands in for it (`public/stage/ticket.webp`,
`issue.webp` and their `-compact` cuts), with alt text that tells the same story;
where the scene will play, its opening frame (`*-start*.webp`) holds the place
until it draws, so the live scene takes over without a change. `playing.webp`
is the close's picture and the link preview's.

## Layout

```text
site/
  index.html, 404.html     the two pages (Vite entries)
  stage.html               development only: the scenes at their real sizes, for filming
  vite.config.mjs          the build; aliases lucide-react to a three-icon shim
  src/
    site.css               the page's stylesheet (Hallmark stamp on line 1)
    tokens.css, base.css   colours, type, spacing; the base rules
    main.ts                the one script: scenes, the pinned moments, the menu
    moments.ts             How it works, pinned beside its pictures on wide screens
    stage/                 the two scenes, their mount script and their CSS
    stageshow-kit/         the Stageshow kit (MIT), copied in, with its LICENSE and NOTICE
  public/                  copied into dist as is: font, favicon, og.png, stills,
                           third-party-licenses.txt
  tools/
    serve.mjs              serves dist with the production headers
    stills.mjs             exports the scenes' stills into public/stage
    og.mjs                 renders public/og.png
```

## Build and preview

From the repository's root (Vite, React and the React plugin come from the
repository's own `node_modules`; the site adds no dependencies):

```bash
node_modules/.bin/vite build --config site/vite.config.mjs   # writes site/dist
node site/tools/serve.mjs 4173                               # http://127.0.0.1:4173/
```

`serve.mjs` has no dependencies. It answers GET and HEAD, sends `404.html` with a
404 status for unknown paths, refuses any path that climbs out of `dist`, and
sends the same headers as production (below), so a Content-Security-Policy
problem shows up here first.

While working on the scenes, `node_modules/.bin/vite --config site/vite.config.mjs`
serves the pages with hot reload, and `/stage.html` shows both scenes at their
wide and compact sizes (`?only=ticket-wide`, `ticket-compact`, `issue-wide` or
`issue-compact` shows one; `&still=start`, or `&still=playing` for the ticket,
draws that frame as the reduced-motion still). `stage.html` is never built.

The stills are exported from `stage.html` under reduced motion, at 2x with a
transparent ground, as WebP: one per scene, cut and frame (the story, the
opening frame, and the film playing for the close). Export them again whenever
a scene's look or its first or last frame changes, with the development server
running:

```bash
node site/tools/stills.mjs http://127.0.0.1:5173/stage.html
```

## The link preview

`public/og.png` (1200 x 630) is what a link to the site shows in chat apps: the
wordmark, the headline and the film playing on the phone (`public/stage/playing.webp`).
After changing the tokens, the font or that still, render it again:

```bash
node site/tools/og.mjs
```

It uses Playwright's Chromium from the repository (`npx playwright install
chromium` once) and reads only local files.

## Publish

First merge `site/` into `main` and push it: the licences file says this site's
source is in the repository, so it must be there before the site is. Then
build, and copy `site/dist` to the server. `SITE_HOST` is the SSH name of the
server, set by whoever publishes:

```bash
node_modules/.bin/vite build --config site/vite.config.mjs
rsync -rlpt --delete site/dist/ "$SITE_HOST:/srv/openmatte-site/public/"
```

`-p` copies the build's own permissions (files 644, folders 755 with the usual
umask). The rsync that comes with macOS doesn't accept `--chmod`, so the command
leaves it out. If the folder on the server belongs to root, add
`--rsync-path="sudo rsync"`.

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

The policy is why the pages have no inline script, no `<style>` element and no
`style` attribute: styles come from the built stylesheets, and the scenes set
positions through the DOM (`element.style`), which the policy allows.

One known side effect: Safari shows a plain-text file (`/third-party-licenses.txt`,
`/fonts/OFL.txt`) inside a `<pre>` that it styles with a `style` attribute of its
own, which `style-src 'self'` blocks. The file still shows, in full, but Safari
logs a policy error and doesn't wrap its lines; the licences file keeps its lines
to 80 characters so little runs off a phone's screen. The headers stay the same
for every file.

## Nothing from elsewhere

The site makes no third-party requests: no web fonts from a CDN, no analytics,
no embeds. Every script, stylesheet, image and the font come from the site's own
origin.

## The font

Matte Sans is GitHub's Mona Sans (SIL Open Font License 1.1), cut down to Latin
and renamed, as the licence asks of a modified version. One variable file,
`public/fonts/matte-sans.woff2`, with width 100 to 125 and weight 300 to 600. The
licence is `public/fonts/OFL.txt`, served at `/fonts/OFL.txt`.

## Licences

The site's own code is Open Matte's: GPL-3.0-or-later, with its source in this
repository. `public/third-party-licenses.txt`, linked from the footer, holds the
licences of everything else the pages send: React, react-dom and scheduler, the
Stageshow kit, Lucide's path data for three icons, Vite's module-loading helper,
Rolldown's module helpers and the font. Add to it when the bundle gains a
package.
