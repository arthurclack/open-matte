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
3. **Rename any film folder called `account`.** The name now belongs to the site, like
   `admin` and `api`, and a scan skips a folder with it.
4. **If you changed your copy of `deploy/compose.yml` or `deploy/Caddyfile`**, carry
   your changes over to the new ones. Both have changed.
5. **Check any `BACKUP_HOUR`, `BACKUP_KEEP_DAYS` or `BACKUP_KEEP_MONTHS` lines in
   `deploy/.env`.** Docker ignored them until now. From this release they apply, and
   the first backup after the update deletes the backups they don't keep. Empty them
   to keep the defaults: 4 (UTC), 14 days and 12 months.
6. **Update.** Migrations run when the new code starts, and take the database to
   schema 7. **Status** in the admin shows the schema it's on, at the foot of the
   page. The update signs you out of the admin once.

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

These matter only if you ran an earlier deploy:

- A screening held by a browser that can no longer play it (signed out, its person
  disabled, its ticket now someone else's) can be taken over at once, instead of after
  about 75 seconds. That includes tickets for anyone, after **Sign out every viewer**.
- Changes through the API are refused when the browser says they come from another
  site or from another subdomain of this one (`Sec-Fetch-Site: cross-site` or
  `same-site`), since passkeys can belong to the parent domain. Pages send no
  Referer, so a ticket's address goes no further.
- Rate limits count an IPv6 visitor by its /64.
- A new `ADMIN_PASSWORD` signs every browser out of the admin. Before, one already
  signed in stayed signed in for up to 12 hours.
- In Docker, `BACKUP_HOUR`, `BACKUP_KEEP_DAYS` and `BACKUP_KEEP_MONTHS` in
  `deploy/.env` now reach the app. Before, `compose.yml` didn't pass them on, and the
  defaults applied whatever they said.
- The database refuses to open when newer code wrote it, so starting older code
  without a restore fails at once instead of misreading tickets.
- Activity ends with **Show older** instead of stopping at the last 300 events.
- `npm test` runs the test files by pattern, so it works on Node 24, which the
  container uses.
