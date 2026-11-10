# Changelog

What changed in each release of Open Matte, newest first, and what to do when you
update to it. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

A release has an **Upgrading** note when updating to it takes more than copying the
new code and rebuilding: a backup first, a setting to choose, or a migration you can't
undo without a restore. Read it before you update.

## 1.1.0 — 2026-11-10

### Added

- **A new look: a one-shelf video shop.** Every page, the back office included, now
  looks and reads like a small video shop. The rules, links and data are the same,
  and there's no migration.
  - **Your films are tapes on the shelf.** A film's poster is printed as its sleeve,
    and a film with no artwork gets a plain kraft sleeve with its title on a typed
    label (and your logo at its foot, if you have one). Your recommendation is a
    handwritten staff pick card beside it, signed "Picked by" you.
  - **The counter.** The title is on black label-maker tape, and the next deadline is
    an orange price-gun sticker: "Start by Fri 6 Nov" before the first play, "Due back
    Sun 8 Nov" after it, or "Come back by Sat 7 Nov 19:40" while it's paused, when
    that comes first. The exact time is in words beside it, and the plays left beside
    Play. A tape that has run out or is unavailable says so in plain words, and its
    place on the counter is empty.
  - **The video machine.** Blue, with a soft screen, means the machine and only the
    machine: the Play tile, a short PLAY screen as playback starts (left out when your
    device asks for less motion), and, when you pause, a strip under the picture with
    PAUSE, Resume at the place you stopped, the time left to come back (counted down
    each minute), and the audio, subtitles and picture as a VCR's menu. Opening a
    paused tape again shows it on a small telly. The machine is never over the film:
    while the film plays, the player is plain, with the browser's own controls and the
    Audio, Subtitles, Aa and Picture menus.
  - **The interface** is IBM Plex Mono for the machine's own words (menus, tabs,
    buttons, dates and counts) and Libre Franklin for headings and reading text, in
    square boxes and thin rules. What's selected and the main button are lit in warm
    white; messages are short lines with a small block in front, a warning or an error
    starting with a word in bold. Every page works at 320px wide, keeps 4.5:1 contrast
    for small text, and respects reduced motion and forced colours.
  - **The front page** is Your tapes, face out on a shelf, each with its sticker and
    the same facts in words, and On the shelf for members with "No tape yet: ask"
    you. Signed out, it's the shop's name and your welcome.
  - **Signing in** is "Show your card": the front of the membership card is the
    button.
  - **The back office**: Films with sleeve thumbnails; a film's page with Tapes,
    Details and Media tabs (the tab is in the address after `#`); Tapes; Members;
    the Ledger, its heading on label tape; Status, which shows a still 12:00 on the
    machine until the first film is on the shelf; and Settings, in one page with an
    index, where the colours show a sample membership card as you pick them. At the
    foot of every screen, a status line: how many films, how many on the shelf, and
    whether the server is well.
- **Your name**, in Settings: friends see it on your staff picks ("Picked by Arthur")
  and wherever the pages say whom to ask ("ask Arthur"). Left empty, they see the
  shop's name, as before. Like the shop's name, it's in every page the site sends and
  in `/api/site`, so anyone who opens its address can read it.
- **A membership card for everyone you add.** It's a printed card that turns over:
  the front is all yours, with your shop's name (and logo, if you have one) and
  "Membership card" knocked out of a solid band of ink; the back has their name in
  ballpoint, the month and year you added them, stamped, their membership number on a
  stuck-on barcode label, and one line asking whoever finds it to hand it back. It's
  printed in your colour, darkened until it reads on the card; with Open Matte's own
  colour it prints in blue. Your membership card (the page that was Your account)
  shows it beside the keys to it, and the page that makes a passkey now ends on it,
  the name written on as it appears ("Your membership card is ready"); a recovery
  link ends on the same card, with "Your new passkey is ready". With less motion
  asked for, it turns and the name appears at once.
  - **It looks printed, stamped and written by hand.** Your ink soaks into the card,
    a little deeper and warmer than on screen, with the card's grain showing through
    it and the odd pin-hole of bare card in the band. The back's printed words bleed a
    hair into the card's fibres. Member since is stamped at the counter in a stamp
    pad's violet, a little crooked, faded and patchy. The name is a ballpoint's: full
    on the downstrokes, lighter elsewhere, now and then a short dry skip or a small
    blob of ink. It all reads at 4.5:1 or more where it's lightest. Turning over, it
    shows its thickness, the cut edge of the card. With more contrast or forced
    colours asked for, it's plain ink.
- **A membership number**, 11 digits, worked out from what each person already has,
  so nothing new is stored: the same number for good, through a new phone, a change
  of name or a lost phone. It's never their place in the list, and it opens nothing:
  no screen asks for it. Only they (their card, and the page that makes their
  passkey) and you (their page in the back office, with Member since) are sent it, as
  `membership: { number, since }` in `/api/account`, `/api/enroll/finish` and
  `/api/admin/people/:id`. Member since is the month you added them, in UTC.
- **The fonts come from your server**, in `fonts/`: Libre Franklin, IBM Plex Mono,
  Fraunces (the shop's name, "Staff pick" and "Membership card"), Courier Prime
  (typed labels), Grape Nuts (handwriting) and VT323 (only on the machine's blue
  screen). They're under the SIL Open Font License, not the GPL; the licences file
  names them and gives each licence in full. The pages' Content-Security-Policy now
  allows fonts from the shop's own address (`font-src 'self'`), and nowhere else.

### Changed

- **New words on every page**, and in link previews ("A tape from" your shop). Ticket
  is now tape (Issue ticket is Lend a tape, Revoke is Take the tape back), screening
  is play, the recommendation is the staff pick, Publish and Unpublish are Put on the
  shelf and Take off the shelf, People is Members, Activity is the Ledger, the
  projection booth is Status, Your account is Your membership card, Disable and
  Enable are Turn the card off and back on, Reset after loss is Lost phone: take back
  the keys, Admin is the Back office, the resume window is Time to come back, the
  cinema's name is the Shop name, the player's Quality menu is Picture, and Accent is
  Your colour. "Admit one" is gone. Routes, links, the API, the database, settings
  and the log's event kinds keep their names: a tape's link is still `/t/...`, and
  [docs/access.md](docs/access.md#words) has the full list. The back office API's
  error messages use the new words.
- **Fewer, plainer words.** Hints that only repeated their label, or answered a worry
  nobody had, are gone; the privacy line, TMDB's notice, "Only share films you have
  the right to share." and the passkey explanations stay, in the new nouns. A friend
  who has lost a phone is told you'll take back their keys and send a link to make a
  new one.
- **The default background is now `#171513`**, a little lighter and warmer than
  before. A shop still on the old default, `#0d0c0f`, gets the new one; a background
  you chose is kept, and every background allowed before still is. The same goes for
  the front page message: the old default, word for word, now reads "This is a
  private video shop. If someone sent you a tape, open the link they gave you."; one
  you wrote is kept.
- **Your colour no longer colours buttons and links.** It prints the membership card,
  colours the tab icon, and tints what's selected and the main button (up to 22%,
  always keeping 7:1 for their words). On a background of your own, the colours
  refused are the same as before. On the new default background, a few colours that
  passed on the old one, such as `#ff0000`, are refused; one you've already saved is
  kept. A refused colour is now "too close to the background for the tab icon to show
  up".

### Removed

- **A plain sleeve no longer prints Open Matte's frame mark**: it carries your logo,
  or nothing.
- The film page no longer has the backdrop behind it. The backdrop is still the
  player's picture before the film starts.

## 1.0.3 — 2026-11-05

### Changed

- **The licences file starts more clearly.** Open Matte's copyright line comes first,
  then its licence, where its source code is and the note on TMDB's logo, each in a
  paragraph of its own. Under Vite and Rolldown, a note says that only a little of
  each is in the app, and that most of Vite's licence file is about packages bundled
  inside Vite for its own work, which never reach your browser. Rolldown's second
  licence file, for the code from Rollup and esbuild that its own is derived from, is
  in it too. The file ends with "End of licences", so a copy that's cut short shows it.
- **Your account lists this browser first**, then your other signed-in browsers, the
  most recently seen first. Two that would read the same, such as two Safaris on one
  Mac signed in on the same day, also say what time each signed in.
- **The footer is one block**: TMDB's logo and its notice together, then Powered by
  Open Matte and Licences on a quieter line. Its text is a little smaller, but never
  under 12px. It no longer repeats the cinema's name, which is at the top of every
  page.
- **On a phone, the admin's tabs are one row that scrolls sideways**, with the start of
  the next tab showing, so you can tell there are more.
- The tests and the build run on GitHub for every push to main and every pull
  request, on Node 22, 24 and 26. Dependabot also proposes updates to the actions
  they use.
- **hls.js 1.7.4**, which plays the films wherever Safari's own player doesn't. Going
  back to the audio track that was playing before now finishes the switch, so the
  audio menu shows it. And while the player has stopped loading to ask the server why
  it refused a segment, a seek no longer starts it loading again.
- React Router 7.18.5. Its fixes are for server rendering and the data it streams,
  which Open Matte doesn't use, so nothing changes on the site.
- `scripts/deploy.sh` no longer copies `site/`, the project's website, to the server,
  and building the Docker image leaves it out too. The website is published on its
  own, at openmatte.dev, and a cinema never uses it.

### Removed

- `scripts/deploy.sh` no longer keeps `deploy/Caddyfile` on the server, so the next
  deploy deletes it. Caddy's config was there before 1.0.0, and nothing has read it
  since. From a deploy older than 1.0.0, step 8 of 1.0.0's Upgrading now applies to
  `scripts/deploy.sh` too: if the deploy stops before it finishes, move Caddy over at
  once.

### Fixed

- **On a phone, tapping a menu no longer zooms the page, and everything you tap is
  bigger.** iOS Safari zooms in on a field whose text is under 16px, and the player's
  Audio, Subtitles and Quality menus and the admin's filters were smaller. On a touch
  screen, and at a phone's width, every field's text is at least 16px; with a mouse,
  in a window wider than a phone, nothing changes. The small buttons, such as your
  name at the top, Admin and the admin's filters, reach 40px for a finger but still
  show 32px tall, so they look much as before. The player's menus, Aa and its
  choices, Playback help and the items in the menu with your name are 40px tall, and
  the admin's filter menus 32px. On a phone, the player's bar is now tidy rows: each
  label beside its menu, every menu starting at the same place, and Aa beside
  Subtitles.
- **Play, Resume, Preview and the menu with your name use drawn icons, not the
  characters ▶ and ▾.** iOS can draw ▶ as a coloured emoji, and screen readers read
  them out as "black right-pointing triangle" and the like. The icons are hidden from
  screen readers, so the buttons are just "Play", "Resume at 42:17" or your name. The
  ▸ between Settings, Accessibility and Subtitles & Captioning in the subtitle style
  panel is an icon too, read as a pause. And if your device is set to reduce motion,
  Play now jumps to the player, and Playback help to its panel, instead of scrolling
  smoothly, and a poster no longer lifts under the pointer.

## 1.0.2 — 2026-11-04

### Upgrading

- **If you chose your own background colour, it may now be refused the next time you
  change colours.** Faint text is now held to 4.5:1, not 3:1, so some backgrounds that
  passed before are too light for it: about a third of them, such as `#101820` and
  greys from `#151515` up. Colours already saved stay saved, and the site shows them
  as before, with faint text easier to read on them than it was. Nothing checks them
  again until you change either colour under Branding: then the admin says faint text
  would be hard to read, and won't save the pair, even if you only changed the accent.
  Choose a darker background. Open Matte's own colours pass.

### Changed

- **TMDB's logo and the notice its terms ask for.** While anything from TMDB can be on
  show, every page's footer shows TMDB's logo and, word for word, "This website uses
  TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by
  TMDB." It used to say "Film information and images from TMDB". The admin's TMDB
  settings show the same logo and notice, with "product" for "website"
  ([docs/metadata.md](docs/metadata.md#credit)).
- **Faint text is easier to read**: the hints under fields, table headings, the
  footer. It's a lighter grey, `#8a847a`, at 4.5:1 or more on the background, like the
  rest of the small text, where it needed only 3:1. The background colours you can
  choose are checked against it (see Upgrading).
- **What TMDB's terms ask of you** is in [docs/metadata.md](docs/metadata.md#commercial-use):
  a free key is for personal, non-commercial use only, and charging for tickets or
  membership, adverts or affiliate links make it commercial. The README says the key
  is free for non-commercial use, and that `web/public/tmdb.svg` is TMDB's logo and
  trademark, not covered by the GPL, as the site's licences file now does too.

### Fixed

- **The TMDB credit no longer goes when you remove the key.** The details and artwork
  fetched with it stay, so the credit now shows while a key is set, or once any film
  has been matched or has a poster or backdrop downloaded from TMDB.
- The docs said a two-hour 4K HDR film with every rendition takes about 50 GB. The
  encoder's caps for that ladder add up to 41.5 Mbit/s, so it's at most about 38 GB,
  often much less, and 1 TB holds at least 26 of them
  ([docs/encoding.md](docs/encoding.md#storage)). One without a 4K source is up to
  about 23 GB, or 17 GB without HDR, where the docs gave its usual 8 to 15 GB as if
  that were all it could take. The backup docs now say backdrops
  downloaded from TMDB are backed up with the posters.
- In the admin and on the site: on a phone, every admin tab can be reached. Cards side
  by side in two-column grids line up at the top. **Films** stays marked in the
  sidebar on a film's own page. The sidebar's **View site** lines up with the links
  above it, and **Sign out** is plain text like it. Everything the keyboard can reach
  shows a focus ring. On a 12-hour clock, times have no leading zero, and never break
  before AM or PM. The projection booth's sentence about the server log says what the
  log now keeps: the first refusal of each kind each minute, up to a few dozen a
  minute, then how many more there were.

### Security

- A poster or backdrop downloaded from TMDB that a browser may not have is answered
  exactly as if there were no such film: the same bare 404, byte for byte. It used
  to be a 403, and since the file's name comes from TMDB and a film's address from its
  folder's name, asking for a film's likely poster told anyone whether the film was
  here, drafts included. The refusal still reaches the booth and the log, as a 404
  with its reason, and nothing on the disk is read for it.
- A request for a film's files or its downloaded artwork marks the browser's session
  as seen whether the film exists or not. Only a real film's used to, so a person
  signed in on two browsers could see the difference on their account page and find
  out which films there are, unpublished ones included.
- Requests for posters and backdrops downloaded from TMDB that find nothing are
  limited to 2000 every ten minutes per visitor, and 6000 for each IPv6 /48, whichever
  of its /64s they come from. Posters that are sent don't count, so a household
  loads as many as it likes. Over the limit, every one answers the same 404.
- Refused media requests no longer write a line each to the log. The same refusal is
  logged once a minute at most, then a line says how many more like it there were,
  and the log takes at most 30 new lines a minute about browsers with a session and
  10 about requests with none, then says how many it left out
  ([docs/deploying.md](docs/deploying.md#refused-media-requests)). Only the start of a
  long address is logged. So nobody can fill the log with made-up requests. The
  projection booth still counts every one.
- Signing in to the admin is also limited to 30 tries every 15 minutes for each IPv6
  /48, on top of 10 per /64, so someone holding a whole range of addresses no longer
  gets ten fresh tries from each /64 in it. IPv4 is unchanged, and there's still no
  limit for everyone together, which anyone could use to lock you out.
- One browser, or one address asking for link preview posters, no longer holds every
  place for posters and backdrops on the films' folders. It holds all but one at most
  (3 of 4 in the Docker image), so one that reads them slowly leaves the others one.
  Posters waiting behind the browser's other posters no longer hold its places, so
  they never take more than three of its own four.
- **Keep it** answers a film that doesn't exist as it answers one with nothing to
  keep, so a signed-in person can't use it to find out which films there are.

## 1.0.1 — 2026-11-04

### Changed

- **The image runs on Node 26**, the long-term support line since October, in place
  of Node 24. Updating needs nothing more than the usual rebuild, and going back to
  1.0.0 needs no restore.
- Dependabot no longer proposes a new major version of the Node image: moving to the
  next long-term support line is done by hand.

## 1.0.0 — 2026-11-04

The first numbered release. It brings together the three milestones built before
there were version numbers: ticketed playback, people and passkeys, and the work for a
public release.

### Upgrading

**On a new server** there's nothing to do: follow
[docs/installing.md](docs/installing.md).

**From any earlier deploy**, whichever milestone it ran:

1. **Back up first.** In the admin, press **Settings → Backups → Back up now**, then
   copy that file off the server. **Back up now** writes to the same disk as the
   database.
2. **Set `WEBAUTHN_RP_ID`** in `deploy/.env` before you invite anyone, if it isn't
   set. It's the domain passkeys belong to: your `DOMAIN`, or a parent of it. Every
   passkey is tied to it for good, so changing it later, or moving the site to
   another domain, leaves every passkey useless. Without it, passkeys are switched off
   and say why in the log, and everything else, ticket links included, works as
   before.
3. **Check your film folders.** Rename any called `account`: the name now belongs to
   the site, like `admin` and `api`, and a scan skips a folder with it. Move any that
   is a symlink into the media folder itself: a scan now skips a symlink in a film
   folder's place, and a film imported from one shows as missing.
4. **If you changed your copy of `deploy/compose.yml` or the Caddyfile**, carry your
   changes over to the new ones. Both have changed, and the Caddyfile has moved from
   `deploy/Caddyfile` to `deploy/caddy/Caddyfile`. If you added a block to send
   another name, such as the bare domain, to `DOMAIN`, as the old Caddyfile suggested,
   leave it out of the new one and put the name in `REDIRECT_FROM` in `deploy/.env`
   instead: with both, Caddy won't start. The pages now have a
   Content-Security-Policy: if a proxy or CDN sits in front of Caddy, see [Your own
   changes to the Docker setup](docs/deploying.md#your-own-changes-to-the-docker-setup)
   so it doesn't add a policy of its own or change the pages.
5. **Check any `BACKUP_HOUR`, `BACKUP_KEEP_DAYS` or `BACKUP_KEEP_MONTHS` lines in
   `deploy/.env`.** Docker ignored them until now. From this release they apply, and
   the first backup after the update deletes the backups they don't keep. Empty them
   to keep the defaults: 4 (UTC), 14 days and 12 months. A value out of range now
   stops the app at start, and the log says which: `BACKUP_HOUR` must be 0 to 23,
   `BACKUP_KEEP_DAYS` at least 1, and `BACKUP_KEEP_MONTHS` 0 or more. Keep
   `BACKUP_PATH` on the server's own disk; for network storage, use the
   [copy timer](docs/deploying.md#keeping-a-copy-off-the-server).
6. **If you set `TRUST_PROXY`** (in `deploy/compose.override.yml`, say), check it. It
   now takes how many proxies stand in front of the app, such as `1`, or their
   addresses and subnets. Anything else, `true` and `false` included, stops the app
   at start.
7. **Make the data and backups folders yours alone.** They hold ticket links that work
   for whoever reads them. The app now makes its files readable by itself only, but
   the ones it made before are readable by every account on the server until you run,
   on the server (with your own paths, if `DATA_PATH` or `BACKUP_PATH` differ):

   ```bash
   chmod 700 /srv/open-matte/data /srv/open-matte/backups
   ```

   Both should belong to user 1000, the app's user in its container, as in
   [The folders](docs/installing.md#the-folders): `ls -ln /srv/open-matte` shows it.

8. **Update.** Migrations run when the new code starts, and take the database to
   schema 7. **Status** in the admin shows the schema it's on, at the foot of the
   page. The update signs you out of the admin once. With git, the steps in
   [docs/deploying.md](docs/deploying.md#updating-with-git) now end with a line that
   has Caddy load its Caddyfile; `scripts/deploy.sh` does that itself.

   Until the update has started the new Caddy, the one running reads the old
   `deploy/Caddyfile`, and can't start again without it. `scripts/deploy.sh` leaves
   that file on the server for this release (delete it afterwards, if you like), but
   a git update removes it. So if a git update stops before it finishes, a failed
   build say, move Caddy over at once, in `/srv/open-matte/app/deploy`:

   ```bash
   docker compose up -d --no-build --no-deps caddy
   ```

About a minute after the new code starts, its first clean-up deletes progress reports
over 30 days old, other events over 12 months old, and browser sessions that ended
over 30 days ago and that no remaining event names (see
[docs/access.md](docs/access.md#how-long-its-kept)). It never touches tickets or
screenings, so nothing a viewer can do changes. The backup from step 1 still has
everything it deleted.

**Going back needs a restore.** Never start older code on the upgraded database:

- Code from people and passkeys onwards refuses a database written by newer code, and
  stops at start saying so.
- Code from before people and passkeys has no such check. Started on the upgraded
  database, it would ignore who a ticket is for, and anyone with the link of a ticket
  for one person could use it.

To go back, stop the app, put the backup from step 1 in place (the database file,
with its `-wal` and `-shm` files removed, and the `artwork` and `branding` folders
where there are any),
and only then start the older code. Starting the new code on the restored database
would migrate it again. Screenings, events, people and tickets written since the
backup are lost.

### Added

Ticketed playback (milestone 1 and the days after it, October 2026):

- **Film pages** with the poster, details and your recommendation.
- **Tickets**: an "admit one" link per film, with an optional screening limit, a
  start-by date and a number of days after first play. The clock starts at the first
  Play, not when the link is opened, so a chat app's link scanner doesn't start it.
  Revoking takes effect on the next request, and can be undone.
- **Screenings**: pressing Play starts one, which can be paused and resumed for 48
  hours, on one device at a time.
- **Protected media**: every playlist, segment, audio and subtitle request is checked
  against the browser's session, its ticket and the screening it holds. A file that's
  really a symlink to somewhere outside its film folder is never served.
- **Playback**: adaptive HLS through hls.js, or Safari's own player where it does
  better, with a fallback between them, and audio, subtitle and quality choices.
- **The admin**: scan the media folder, publish and unpublish, issue and revoke
  tickets, and see when each was opened, played and finished. It works on a phone.
- **The import format**: one folder per film, described by a `film.json`, scanned in a
  worker thread and safe on network storage and during a copy
  ([docs/import-format.md](docs/import-format.md)).
- **Film details and artwork from TMDB**, optional: matched on import when the match is
  certain, or chosen by hand, and downloaded to the server
  ([docs/metadata.md](docs/metadata.md)).
- **A reference encoder** for HEVC and H.264 ladders, with HDR10 and tone-mapped SDR, a
  5.1 track when the source has surround, and the title and year guessed from
  release-style file names ([docs/encoding.md](docs/encoding.md)).
- **Backups**: a checked copy of the database every day, keeping the last 14 days and
  the first of each month for a year, with **Back up now** in the admin and a systemd
  timer to copy them off the server.
- **Deployment**: one container behind Caddy, which handles HTTPS, with each
  container's logs capped at 50 MB.

People and passkeys (milestone 2, October 2026):

- **People**: you add them in the admin, and nobody can sign up. Each gets a
  single-use setup link, creates a passkey, and can then sign in and out without a
  password ([docs/access.md](docs/access.md#people-and-passkeys)).
- **Recovery** is yours to give. **Add a sign-in method** keeps someone's passkeys;
  **Reset after loss** removes them and signs the person out everywhere at once. You
  can also disable a person or remove one passkey.
- **Tickets for one person**, alongside tickets for anyone with the link: they work
  only signed in as that person. Forwarding the link does nothing, and someone else who
  opens it learns neither the film nor the name. A setup link can carry a ticket, so a
  new friend gets one link that ends on the film.
- **Your tickets**: a person's tickets are listed on every device they sign in on.
- **Keeping a ticket**: a ticket for anyone can be marked "Let them keep it". The first
  signed-in person to keep it makes it theirs, and other browsers holding the link lose
  it and are told why. You can give a ticket to someone, or back to anyone with the
  link.
- **Films shown to members**: a switch per film. Signed-in people see its page and are
  told to ask for a ticket; playing it still needs one.
- **An account page**: a person's passkeys and signed-in browsers, and **Sign out
  everywhere**.
- **`REDIRECT_FROM`**: other names, such as the bare domain, redirect to `DOMAIN`.

The public release (milestone 3, November 2026):

- **Branding**: an accent and a background colour, checked so text stays readable, a
  logo and a tab icon (PNG, JPEG or WebP, up to 1 MB), set in the admin and shown on
  every viewer page from the first paint. Backups copy the images.
- **Link previews**: a ticket link for anyone shows its film's title and poster in chat
  apps; every other link, a ticket for one person's included, shows the cinema.
  Fetching a preview records nothing.
- **Audio and subtitles**: the languages a viewer picks, and the subtitles' size and
  background, are remembered in their browser for the next film. Forced subtitles, for
  signs and foreign dialogue, show by themselves. The bar under the picture and
  Safari's or the iPhone's own menus agree, and audio labels give the channel layout
  and audio description.
- **The lock screen**, Control Center and Chrome's media controls show the film's title
  and poster, or only the cinema's name if you switch that off in Settings, and play,
  pause and skip 10 seconds through the player.
- **Playback help**, under the player: what the browser is playing and can decode, and
  a summary to copy with no addresses, names or titles in it. It records and sends
  nothing.
- **Activity** filtered by film, person, ticket and kind, with **Show older** going
  back as far as the records do, and counts of what was opened, played and finished on
  each film's and person's page.
- **Keeping records**, in Settings: how long progress reports (30 days), other events
  (12 months) and ended browser sessions (30 days) are kept, with what a clean-up would
  delete now and **Clear now**.
- **The projection booth** (**Status** in the admin): links still waiting, unplayed
  tickets near their start-by date, media requests refused since the server started,
  the media folder, disk space, the last backup and, with `BACKUP_COPY_DIR`, the
  off-server copy, the last clean-up and the versions running. A line at the top of the
  admin says when something needs attention.
- **Licence notices** for the code the site sends to browsers, Open Matte's own and
  the packages it includes, at `/third-party-licenses.txt` and linked from the footer.
- **Documentation** for installing on a fresh server, this changelog, and
  [SECURITY.md](SECURITY.md).
- **Films on network storage**, in the install guide: how to mount CIFS (SMB)
  storage, such as a storage box or a share on a NAS, on the media folder
  ([docs/installing.md](docs/installing.md#films-on-network-storage)). The whole guide
  was followed on a fresh Ubuntu 26.04 server, and put right where it tripped.

### Changed

These matter only if you ran an earlier deploy.

For viewers:

- A screening held by a browser that can no longer play it (signed out, its person
  disabled, its ticket now someone else's) can be taken over at once, instead of after
  about 75 seconds. That includes tickets for anyone, after **Sign out every viewer**.
- Pressing **Play**, or **Watch here instead**, is limited to 60 times every 10
  minutes per visitor, so a script can't press it in a loop.
- hls.js, most of the player's code, is a file of its own, so an update to the rest of
  the app no longer makes every viewer download it again.

For the admin:

- A new `ADMIN_PASSWORD` signs every browser out of the admin. Before, one already
  signed in stayed signed in for up to 12 hours.
- Activity ends with **Show older** instead of stopping at the last 300 events.
- Pressing Play again in the browser that already holds a screening is recorded at
  most once every 5 minutes. A new screening, and a move to another device, are
  always recorded.
- **Reset to film.json** undoes only your own edits: what TMDB filled in stays. A
  value you took with **Find details…** in place of `film.json`'s counts as your
  edit, so it goes back. The button shows only when you've edited something.
- A scan skips a folder with neither a `film.json` nor `hls/master.m3u8` in it,
  instead of making it a film and looking it up on TMDB, and skips a symlink in a film
  folder's place.
- A file `film.json` names must be spelled exactly as in the folder, as a Linux
  server's disk requires. On a Mac, which doesn't mind, a scan now warns; on Linux,
  the error names the file the folder does have.
- After the startup scan, the server log names each film and field where `film.json`
  changed something you'd edited. Your version is kept, as before.
- The projection booth shows repeated refusals as one row with a count, keeps those
  from browsers with no session (no cookie, or one that has expired or was made up)
  to the latest five, and also lists requests the films' folder didn't answer in
  time.

For installers:

- Changes through the API are refused when the browser says they come from another
  site or from another subdomain of this one (`Sec-Fetch-Site: cross-site` or
  `same-site`), since passkeys can belong to the parent domain. Pages send no
  Referer, so a ticket's address goes no further.
- Rate limits count an IPv6 visitor by its /64.
- In Docker, `BACKUP_HOUR`, `BACKUP_KEEP_DAYS` and `BACKUP_KEEP_MONTHS` in
  `deploy/.env` now reach the app. Before, `compose.yml` didn't pass them on, and the
  defaults applied whatever they said.
- The database refuses to open when newer code wrote it, so starting older code
  without a restore fails at once instead of misreading tickets.
- `npm test` runs the test files by pattern, so it works on Node 24, which the
  container uses.
- The Caddyfile is now `deploy/caddy/Caddyfile`, and Caddy sees its folder rather
  than the file, so it can load a new one: `scripts/deploy.sh` has it do so, and so
  does the last line of the git update. A Caddyfile Caddy refuses fails the deploy, and
  Caddy carries on with the one it had.
- Every backup of the last three days is kept, **Back up now**'s included, before the
  daily and monthly rules apply (of the last day or two, if `BACKUP_KEEP_DAYS` is 1 or
  2). So a second backup on the same day no longer deletes the one you made before an
  update, on the server or in the off-server copy.
- A backup setting out of range stops the app at start, saying which:
  `BACKUP_HOUR` outside 0 to 23, `BACKUP_KEEP_DAYS` below 1 (0 deleted each backup as
  it was made), or a negative `BACKUP_KEEP_MONTHS`.
- `TRUST_PROXY` takes how many proxies stand in front of the app (`1` used to be read
  as the address 0.0.0.1), or their addresses and subnets. Empty means the default.
  Anything else, `true` and `false` included, stops the app at start.
- `scripts/deploy.sh` leaves out only the top-level `data`, `media` and `dist`
  folders, so a folder with one of those names deeper in the code is sent.
- The encoder refuses an output folder whose name can't be a film's, since the name
  becomes the film's address, and warns when a `--ladder` has no H.264 rung.

### Fixed

Found in a review before the release.

For viewers:

- The name menu (Your tickets, Your account, Sign out) opens over the player, not
  behind the video.
- A page left open from before an update no longer goes blank when Play is pressed:
  it says the site may have just been updated, and offers Reload, after which the
  screening shows as Resume. A mangled address shows the front page or "nothing
  showing", and any other failure says so with a way back, never a blank page.
- "Start watching by" shows its time as well as its day, so it's right in another time
  zone, and once it has passed, its year too. "Resumable until" is never later than
  the ticket's own expiry, on the film's page, Your tickets and every line of the
  admin's ticket page. Before Play, a ticket that ends sooner than the resume window
  says you can come back to it until the ticket expires, not for 48 hours.
- When a screening ends mid-film (its resume window closes, or you give it back), the
  player says the screening has ended, not that the ticket is no longer valid, and the
  page offers **Play** again if the ticket has screenings left. After any other stop
  the server explains, it offers **Play** or **Resume** if the ticket still allows
  them. After a takeover, a refused request says the film is playing on another
  device, with **Watch here instead**, rather than offering Playback help.
- A browser signed out while it plays is told so, and offered Sign in. A Play that
  fails for any other reason, such as a lost connection, says so instead of doing
  nothing, and the film's page shows the screening Play opened. The page reading
  itself again like this isn't logged as another open.
- The tab is named after the film on its page, and after the cinema again once you
  leave.
- After a passkey attempt the browser refuses, an app's built-in browser offers
  **Copy link**, to open it in Safari or Chrome, on the setup page too. WeChat's and
  Android's plain WebView count as built-in browsers.
- A film you re-encode never plays old pieces from a browser's cache: the browser
  checks with the server before reusing any part of a film, instead of keeping it for
  a day. A poster or backdrop that failed to load is tried again, not remembered as
  failed for a week.
- Network storage for the films that stops answering stops playback, with an error
  players retry, not the whole site. A request waits up to 5 seconds for the films'
  folder, then gets a 503.
- No one can take all of the films' places by asking for many files and reading them
  slowly or not at all. One browser holds 4 at most, posters and backdrops a quarter
  of them, so a link preview's poster never takes a player's place, and a download
  that has sent nothing for 20 seconds is cut off.

For the admin:

- **Sign out** shows the sign-in form only once the server has signed the browser out.
  If it couldn't, the admin stays and says so.
- The sign-in form tells a wrong password, too many tries and a lost connection apart.
- A ticket's page counts and lists only browsers still signed in as holding or waiting
  for it, and **Sign out every viewer** counts only browsers that were signed in.
- The admin's API refuses values of the wrong type with a 400 instead of misreading
  them: the text `"false"` no longer publishes a film or ticks a switch, and a TMDB key
  that isn't text no longer removes the saved one. A body that isn't JSON gets
  `bad-json`. Giving a ticket to someone who's gone or disabled says so in words.
- A title that shares a word with release names, such as *Charlotte's Web*, is no
  longer taken for a file name, so TMDB doesn't replace it and matching works. A
  title you edited is never replaced by matching.
- A `tmdbId` added to `film.json` after the first lookup is applied, which settles a
  film waiting for you to choose its match.
- A TMDB image that stalls or breaks off says "Couldn't download the image from TMDB."
  instead of failing with a server error.

For installers:

- The reference encoder picks its ladder from the picture's width as well as its
  height, so a cropped widescreen source (1920×800, say) gets the 1080p ladder, and a
  4K one keeps its 4K rung. `--help` no longer prints a line of code.
- If the app stops in the middle of a backup, the half-made copy is removed when it
  next starts.
- The restore guide says which tickets come back as they were with an older backup
  (revoked ones work again, kept and given ones are for anyone again), and how to find
  what to redo.
- `npm test` leaves nothing behind in the system's temp folder. With `npm run
  dev:web`, a film whose name starts with `api`, `media`, `artwork` or `branding`
  loads when you reload its page.

### Security

- Every page sends a Content-Security-Policy: it runs only the app's own scripts, uses
  only its stylesheets and the cinema's colours, loads from this server only (apart
  from TMDB's thumbnails in the admin), sends forms only here, and can't be shown in
  another site's frame. Everything else the server sends may run and load nothing,
  should it be opened as a page. Browsers report what the policy blocks, and the app
  writes one short line to its log for it, with no ticket code or query:
  `docker compose logs app | grep CSP`
  ([docs/deploying.md](docs/deploying.md#what-browsers-blocked)). If you put another
  proxy in front of Caddy, don't let it add a policy of its own.
- Answers from `/api` are never cached, and a page brought back with Back reloads. So
  after someone signs out on a shared computer, Back shows the signed-out page, not
  their account, the admin or ticket links.
- **Sign out**, **Sign out everywhere** and the "You already have a passkey" page
  forget a setup link the tab was keeping. The browser's own history still lists every
  link opened in it, as [docs/access.md](docs/access.md) now says.
- `/media` answers a film that doesn't exist as it answers one you can't play (403),
  so it no longer tells anyone which films there are, drafts included, and such
  probes no longer fill the projection booth.
- A browser that sends two different session cookies, as a site under the same parent
  domain could arrange, is treated as signed out instead of using the last one.
- A settings change refuses any name that isn't a setting. Names such as `toString`
  and `constructor` used to be stored and sent to every visitor, and `__proto__` got
  a 500.
- Setting up a passkey refuses an over-long credential id, and keeps only the
  transport names browsers use.
- Requests built to break the server (a ticket code or password that isn't text, a
  position that isn't a number, a NUL byte in a media address) get a 4xx, not a 500
  with a stack trace in the log.
- TMDB images are downloaded without following redirects, read no further than 15 MB,
  and judged by their bytes rather than the type the response claims.
- The encoder checks the language tags it reads from a source file, and the names given
  with `--audio`, so a crafted file can't make it write outside the output folder.
- The app makes its files readable by its own user only: the database, backups,
  artwork and branding. Existing installs need the `chmod` in step 7 above.
- In production on `https`, cookies are always marked Secure, even when the proxy
  isn't trusted and a request looks like plain HTTP. `COOKIE_SECURE` still overrides
  it.
- `scripts/deploy.sh` never sends a database file (`*.db`) from your copy of the code,
  such as a backup you downloaded, and the image build leaves them out too.
- The key admin sessions are stored under is now made from `ADMIN_PASSWORD` with
  scrypt, at OWASP's cost, and a random salt kept in the database. So with a copy of
  the database and an admin cookie, each guess at the password is slow. A long random
  `ADMIN_PASSWORD` (`openssl rand -base64 24`) is still the best defence. The key is
  made once, at startup; a sign-in attempt is checked without it. Updating signs the
  admin out once.
- `npm install` runs no package's install scripts (`.npmrc`, and the same in the
  Dockerfile), and the running image has no package manager: no `npm`, `npx`,
  `yarn` or `corepack`. Dependabot proposes
  dependency updates once a week; its security alerts need turning on in the
  repository's settings.
