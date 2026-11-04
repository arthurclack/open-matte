# Changelog

What changed in each release of Open Matte, newest first, and what to do when you
update to it. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

A release has an **Upgrading** note when updating to it takes more than copying the
new code and rebuilding: a backup first, a setting to choose, or a migration you can't
undo without a restore. Read it before you update.

## Unreleased — 1.0.0

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
   `deploy/Caddyfile` to `deploy/caddy/Caddyfile`. The pages now have a
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
