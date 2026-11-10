# Running Open Matte

Everything after [installing.md](installing.md): adding films, changing settings,
updating, backups and restoring, rolling back, moving to a new server, keeping an eye
on it, and removing it.

The paths are the defaults from installing.md. Commands on the server run as your
user with id 1000, and those starting with `docker compose` run in
`/srv/open-matte/app/deploy`. The examples use `cinema.example.com` for the site and
`my-server` for the server's SSH name.

## Adding films

As for the first one ([installing.md](installing.md#the-first-film)): prepare the
folder on your computer, copy it to the server, and scan. On your computer:

```bash
rsync -av --partial-dir=.rsync-partial --progress media/arrival/ my-server:/srv/open-matte/media/arrival/
```

Then press **Scan media folder** in the back office. If the scan reports missing segments,
the copy didn't finish: run the same `rsync` again. `--partial-dir` keeps a
half-copied file out of sight until it's complete (plain `--partial` would leave it
under its real name, where a scan could take it for a whole one). A new film is always
off the shelf until you put it on the shelf.

To take a film down, press **Take off the shelf** on its page. Deleting its folder as well
frees the space: the next scan marks the film missing, keeping its tickets and
activity, and it comes back if the folder does. Don't rename a film's folder once
tickets are out ([import-format.md](import-format.md#rescans-and-your-edits)).

## Changing settings

Edit `deploy/.env` ([the settings](installing.md#settings)), then:

```bash
docker compose up -d
```

Compose restarts only the containers whose settings changed. `docker compose restart`
isn't enough: a container keeps the settings it was created with, and only `up -d`
reads `deploy/.env` again. Two settings are for good: changing `DOMAIN` breaks the
links you've sent, and changing `WEBAUTHN_RP_ID` every passkey
([Choices you make once](installing.md#choices-you-make-once)).

A new `ADMIN_PASSWORD` signs every browser out of the back office, yours included, and only
the new password signs in.

## Updating

### Before you update

1. **Read the [changelog](../CHANGELOG.md)** for every release between the one you
   run and the one you're updating to. A release with an **Upgrading** note needs
   more than new code: a backup first, a setting to choose, or a migration you can't
   go back from without a restore.
2. **Back up.** In the back office, press **Settings → Backups → Back up now**.
3. **Copy that backup off the server.** **Back up now** writes to the same disk as the
   database, and the off-server copy (below) only runs once a day. On your computer,
   into a folder of its own rather than your copy of the code:

   ```bash
   ssh my-server 'ls -t /srv/open-matte/backups/*.db | head -1'    # the one you just made
   mkdir -p ~/open-matte-backups
   scp my-server:/srv/open-matte/backups/open-matte-2026-11-03-153012.db ~/open-matte-backups/
   ```

   The server keeps it as well, for three days at least (unless `BACKUP_KEEP_DAYS` is
   below 3), however many backups are made after it.

4. **Note the version you run now**, in case you need to go back. **Status** in the
   admin shows it, and so does the foot of **Settings**. With git,
   `git -C /srv/open-matte/app describe --tags` gives the release.

### Updating with git

On the server, with the release you're updating to:

```bash
cd /srv/open-matte/app
git fetch --tags
git checkout v1.1.0
cd deploy
docker compose up -d --build
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Caddy reads `deploy/caddy/Caddyfile` only when it starts, and Compose restarts it
only when its image or its part of `compose.yml` changes. The last line has it load
the new one. If the Caddyfile has a mistake, Caddy says so and carries on with the
one it had. Just after Caddy has been restarted, the reload can fail with
`connection refused`: wait a moment and run it again.

### Updating with scripts/deploy.sh

On your computer, check out the release (or your own branch) and deploy it:

```bash
git fetch --tags
git checkout v1.1.0
scripts/deploy.sh my-server
```

`deploy.sh` copies whatever is checked out, uncommitted changes included, then runs
`docker compose up -d --build` on the server and has Caddy reload its Caddyfile, as
above. If Caddy refuses the Caddyfile, the deploy stops with Caddy's error. The
database, films and `deploy/.env` are left alone, and so is any database file in your
copy of the code, such as a backup: those are never sent.

### After an update

The database's migrations run when the new code starts. Once they have, older code
refuses to open it, and going back needs the backup you took
([Rolling back](#rolling-back)). Check that it started:

```bash
docker compose ps
docker compose logs app | grep -E 'Passkeys|CSP|Error'
```

A `CSP` line is something a browser blocked: see [What browsers
blocked](#what-browsers-blocked) for which ones matter.

**Status** in the back office shows the new version and the schema the database is on.

A film page someone left open from before the update can't load the player from
the new build. If they press Play there, the page says the site may have just been
updated and offers Reload. The screening that Play started isn't lost: after the
reload, it shows as Resume.

A build can leave the previous image behind, unnamed, depending on how Docker stores
its images. To remove any that are left:

```bash
docker image prune -f
```

### Your own changes to the Docker setup

Leave `compose.yml` as it is, so updates don't clash with your edits. Put your
additions in `deploy/compose.override.yml` instead: Docker Compose reads it alongside
`compose.yml` by itself, and adds what it says. For example, an extra folder for the
app (see [Keeping a copy off the server](#keeping-a-copy-off-the-server)):

```yaml
# deploy/compose.override.yml: additions to compose.yml for this server.
services:
  app:
    volumes:
      - /mnt/backup-copy/open-matte:/backup-copy:ro
```

Git leaves the file alone. With `deploy.sh`, keep it in `deploy/` on your computer:
the script makes the server's copy of the code match yours, so a file only on the
server would be deleted. The changelog says when `compose.yml` or
`deploy/caddy/Caddyfile` change, so you can check your additions still fit.

The app sets its own security headers, and Caddy adds only HSTS. One of them, the
Content-Security-Policy, differs from page to page (it names the shop's colours by
a hash of them) and is locked down for everything that isn't a page. If you put
another proxy or a CDN in front, or change the Caddyfile, let the app's headers
through as they are, and don't add a Content-Security-Policy there: browsers apply
every policy they're sent, so a second one can only block more, such as the `blob:`
addresses the player feeds the film through, and playback stops. Don't let it change
the pages either: a script it adds from elsewhere (analytics, say) is blocked, and so
are the shop's colours if it rewrites the style that holds them.

### Keeping the images up to date

The image is built on Node's official `node:26-slim`, and Caddy runs from `caddy:2`.
Both get security fixes between Open Matte releases. To pick them up:

```bash
docker compose pull caddy
docker compose build --pull app
docker compose up -d
docker image prune -f
```

Ubuntu installs its own security updates by itself. After a reboot, Docker starts both
containers again, unless you stopped them with `docker compose stop`.

### Running the tests on the server

To run the tests on exactly the Node and SQLite the site runs on, use a throwaway
container from the site's image (`deploy-app`), with no network and none of the
site's data:

```bash
docker run --rm --network none -e NODE_ENV=test \
  -v /srv/open-matte/app/test:/app/test:ro -w /app deploy-app node --test 'test/*.test.js'
```

All should pass: the summary at the end says `fail 0`. The image has no web app
source, no `scripts/`, `deploy/` or `docs/` folder, and no `Dockerfile` or `.npmrc`,
so the tests that read them are skipped, each shown on a line starting `﹣` with the
reason. A skipped group's tests aren't in the summary's counts, so it shows fewer
tests than on your computer.

## Backups

Nearly everything Open Matte knows lives in its database: films' details, tickets,
screenings and activity, people and their passkeys, and settings (including a TMDB key
saved in the back office, and the shop's colours). The exceptions are two folders of
images in the data folder: posters and backdrops downloaded from TMDB (`artwork`), and
the logo and tab icon you uploaded (`branding`). Backups copy both. The films
themselves aren't backed up here: keep your originals and encodes elsewhere.

**Every day**, between 04:00 and 04:15 UTC, the app saves a consistent copy of the
database, checks it with SQLite's integrity check, and keeps it in
`/srv/open-matte/backups` (`BACKUP_PATH`) as `open-matte-YYYY-MM-DD-HHMMSS.db`, named
by its UTC time. It keeps every backup of the last three days, including those made
with **Back up now**, then the newest of each of the last 14 days and the first of
each month for a year. Posters go to `backups/artwork`, and the logo and tab
icon to `backups/branding`. Those two folders only grow, so an older backup's logo is
still there to restore. If the server was down at 04:00, a backup runs shortly after it
starts.

**Settings → Backups** in the back office lists the latest and has **Back up now**. **Status**
shows when the newest backup file was written and the last error.

`BACKUP_HOUR`, `BACKUP_KEEP_DAYS` and `BACKUP_KEEP_MONTHS` in `deploy/.env` change the
timing and how many are kept. `BACKUP_KEEP_DAYS` is at least 1: with fewer than three,
every backup of that many days is kept, not three. A value out of range stops the
app at start, and its log says which. In this Docker setup backups are always on:
they go wherever `BACKUP_PATH` says.

Keep `BACKUP_PATH` on the server's own disk. The app reads the folder as it works, and
a network share that stops answering would stall the whole site. For network
storage, use the copy below.

**Backups keep what they had.** The app deletes old activity and ended browser
sessions after a while ([access.md](access.md#how-long-its-kept)), but a backup is the
database as it was, so it keeps them until the backup itself is deleted: the monthly
backups hold up to a year of events the app has since deleted.

Backups hold people's names, your notes about them and their activity, which are
personal data, and the codes of tickets for anyone with the link, which work for
whoever reads them. Keep every copy somewhere private. On the server, the app makes
its files readable by its own user only, and the data and backups folders should be
yours alone too ([The folders](installing.md#the-folders)). If
`ls -ld /srv/open-matte/data /srv/open-matte/backups` shows anything but
`drwx------` for them, run `chmod 700 /srv/open-matte/data /srv/open-matte/backups`.

**Your settings aren't in the backups.** `deploy/.env`, and
`deploy/compose.override.yml` if you have one, live only in
`/srv/open-matte/app/deploy`. Keep a copy of them somewhere private off the server:
`.env` holds the back office password, and the `WEBAUTHN_RP_ID` every passkey depends on.

### Keeping a copy off the server

Backups on the server protect against mistakes, not against losing the server. Copy
them somewhere else every day. If the server has network storage mounted
([installing.md](installing.md#films-on-network-storage)), such as a storage box from
your hosting provider or a share on a NAS, the systemd timer in `deploy/systemd` does
it at 04:30 UTC, after the app's backup. It mirrors the backups folder with `rsync`,
`artwork` and `branding` included.

As shipped, it assumes the storage is mounted as the media folder, and copies into a
hidden folder there, `.open-matte-backups` (the leading dot keeps it out of the film
scan). Install it, then edit the installed copy for your server:

```bash
sudo cp /srv/open-matte/app/deploy/systemd/open-matte-backup-copy.* /etc/systemd/system/
sudoedit /etc/systemd/system/open-matte-backup-copy.service
```

In the service, set `User=` to your user (the one with id 1000) in place of
`CHANGE-ME`, `RequiresMountsFor=` to where the storage is mounted, and the last path
in `ExecStart=` to the folder to copy into. If you changed `BACKUP_HOUR`, move
`OnCalendar=` in the `.timer` file to match. Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now open-matte-backup-copy.timer
sudo systemctl start open-matte-backup-copy.service     # once now, to check it works
systemctl status open-matte-backup-copy.service         # "status=0/SUCCESS" when it worked
```

`status=217/USER` means `User=` doesn't name a user on this server.

The copy is a mirror: a backup the app deletes is deleted from the copy at the next
run. It only runs while the storage is mounted, so it never fills an empty mount
point.

**Seeing the copy in the back office (optional).** Set `BACKUP_COPY_DIR` in `deploy/.env` to
the copy's folder as the app's container sees it, and Status shows the
newest backup there and its time, so you can tell whether the timer is keeping up. The
app only reads the folder. Like the rest of Status, it says what it found, a file
and its time, and doesn't claim a restore from it would work.

With the timer as shipped, the copy is inside the media folder, which the container
already sees as `/media`:

```bash
BACKUP_COPY_DIR=/media/.open-matte-backups
```

A copy anywhere else needs mounting for the app, read-only, in
[`compose.override.yml`](#your-own-changes-to-the-docker-setup), as in the example
there. Then:

```bash
BACKUP_COPY_DIR=/backup-copy
```

Run `docker compose up -d` after either. Without `BACKUP_COPY_DIR`, Status says the
off-server copy isn't checked.

Your hosting provider's own snapshots of the server or the storage are a good extra
layer.

### Checking a backup

The app checks every backup as it writes it, and keeps none that fails. To check a
copy yourself, on a computer with the `sqlite3` command:

```bash
sqlite3 ~/open-matte-backups/open-matte-2026-11-03-153012.db 'PRAGMA integrity_check; PRAGMA user_version;'
```

It prints `ok`, then the backup's schema number. Code opens a database at its own
schema or an older one, never a newer one; the changelog says which release moved to
which schema.

The surest check is to restore one. You can try that on your computer without touching
the server, in a copy of the code that you've installed and built as in [Running it
locally](../README.md#running-it-locally):

```bash
scp -r my-server:/srv/open-matte/backups/artwork my-server:/srv/open-matte/backups/branding ~/open-matte-backups/
mkdir -p ~/restore-test/data
cp ~/open-matte-backups/open-matte-2026-11-03-153012.db ~/restore-test/data/open-matte.db
cp -r ~/open-matte-backups/artwork ~/restore-test/data/
cp -r ~/open-matte-backups/branding ~/restore-test/data/
DATA_DIR=~/restore-test/data MEDIA_DIR=~/restore-test/media npm run dev
```

The first line fetches the posters and backdrops downloaded from TMDB, the logo and
the tab icon, which the database file doesn't hold. If nothing was ever downloaded
from TMDB, or no logo or icon uploaded, there's no folder to copy, and that `scp` and
`cp` say "No such file or directory". Nothing is wrong. `npm run dev` reads the rest
of its settings from your local `.env`; the two on the command line win over it.

Open `http://localhost:3000/admin` (or the `PORT` in your `.env`) and sign in with
the password in your local `.env`. Everything but the films is there to look at: their
folders aren't, so the scan says the media folder doesn't exist, and nothing plays.
Delete `~/restore-test` when you've finished, since it holds the same personal data
as the backup.

## Restoring

If you might want anything from the database as it is now, press **Back up now**
first: restoring replaces it. Then, on the server, stop the app, put the backup in
place and start it again:

```bash
cd /srv/open-matte/app/deploy && docker compose stop app
cp /srv/open-matte/backups/open-matte-2026-11-03-040012.db /srv/open-matte/data/open-matte.db
rm -f /srv/open-matte/data/open-matte.db-wal /srv/open-matte/data/open-matte.db-shm
cp -r /srv/open-matte/backups/artwork/. /srv/open-matte/data/artwork
cp -r /srv/open-matte/backups/branding/. /srv/open-matte/data/branding
docker compose start app
```

If nothing was ever downloaded from TMDB, or no logo or icon uploaded, there's no
folder to copy, and that `cp` says "No such file or directory". Nothing is wrong. If
the backup is no longer on the server, copy yours back first, from your computer:

```bash
scp ~/open-matte-backups/open-matte-2026-11-03-040012.db my-server:/srv/open-matte/backups/
```

Viewers stay signed in, because their sessions are in the backup too, unless the
backup is older than their sign-in. About a minute after the start, the clean-up
deletes again whatever in the backup is older than you keep records for.

### After restoring an older backup

The backup knows nothing of what happened since it was made, at the time in its
name (UTC). Everything you did after that is undone, so check Members and Tapes.

**Check Members.** Passkeys you removed since (one by one, or with **Lost phone: take
back the keys**) are back and work again; browsers you signed out (with **Sign out
everywhere**, **Turn the card off** or taking back the keys) are signed in again; a
card you turned off is on again; and a link cancelled or used since then works again
until it expires. Remove those passkeys again, use **Sign out everywhere** or **Turn
the card off** where needed,
and cancel any waiting link you didn't mean. Passkeys created since the backup are
gone from the server, so those people can't sign in until you send them a new link.

**Check Tapes.** A tape you took back since works again for anyone with its link, so
take it back again: if you took it back because the link got out, this matters most.
A tape you gave to someone, or that someone kept, since is for anyone with the link
again, and the browsers that opened it before have it back: give it to them again.
Browsers you signed out of a tape (**Sign out browsers**), and everyone signed out
with **Sign out every friend and member**, are signed in again. A film you took off
the shelf since is back on it, and one you put on the shelf since is off it. Tapes
you lent since are gone, so their links no longer open anything.

To see what to redo, look at the database as it was before the restore: the backup
you made with **Back up now** first. Copy it to your computer and open it there, as in
[Checking a backup](#checking-a-backup): its Tapes list shows which were taken back,
and who each was for.

**Don't delete people, passkeys or links by hand** (with `sqlite3`, say). Use the back office
instead: **Remove** for a passkey, **Lost phone: take back the keys**, **Turn the card
off** for a member. They sign out the browsers concerned first and record what
happened in the Ledger; deleting a
passkey's row by hand leaves every browser it signed in still signed in. People can't
be deleted at all: the app's database connection refuses while anything refers to
them, and the `sqlite3` command line, which doesn't check that unless told to, would
leave their passkeys, sessions and events pointing at nobody.

## Rolling back

The app refuses to open a database written by newer code. Start older code on it, and
the app stops at start, and Docker keeps restarting it, with:

```text
This database was written by a newer Open Matte (schema 8; this code knows 7). Deploy the newer code, or restore a backup from before the upgrade.
```

A release whose changelog entry has no **Upgrading** note has no migration, so going
back from it needs only the older code: check it out and rebuild, as below, without
touching the database. Going back from any other release needs the backup you took
before the update:

1. **Stop the app.** On the server:

   ```bash
   cd /srv/open-matte/app/deploy && docker compose stop app
   ```

2. **Put back the backup you took before the update**, with the commands in
   [Restoring](#restoring), but **without** its last line, `docker compose start app`:
   that would start the newer code, which would migrate the restored database
   straight back.
3. **Start the older release.** With git, on the server:

   ```bash
   cd /srv/open-matte/app
   git checkout v1.0.0
   cd deploy
   docker compose up -d --build
   ```

   With `scripts/deploy.sh`, on your computer, with no uncommitted changes (it copies
   whatever is checked out):

   ```bash
   git checkout v1.0.0
   scripts/deploy.sh my-server
   ```

   Check your branch out again afterwards.
4. **Check** that `docker compose logs app` shows no `newer Open Matte` line, and that
   **Status** shows the older version.

Screenings, events, people and tickets written since that backup are lost, and
whatever you changed since is as it was: check Members and Tapes, as [after
restoring an older backup](#after-restoring-an-older-backup). When you update again,
the migrations run again on the restored database.

## Moving to a new server

Everything that matters moves with the data folder: tickets, screenings, people,
passkeys, settings, posters and the logo. Keep the same `DOMAIN`, or every link you've
sent stops working, and the same `WEBAUTHN_RP_ID`, or nobody's passkey works.

### With the old server still running

1. **A day ahead, lower the TTL** of the DNS records (to 300 seconds, say), so the
   switch reaches everyone quickly.
2. **Set up the new server** as in installing.md, from
   [The server](installing.md#the-server) to [Settings](installing.md#settings), and
   don't start it. Use the same release the old server runs, and copy its
   `deploy/.env` across, and `deploy/compose.override.yml` if it has one (with
   `deploy.sh`, that's already in your copy of the code). The `.env` has the same
   `DOMAIN` and `WEBAUTHN_RP_ID`, and the back office password.
3. **Copy the films** to the new server's media folder, from your computer as you
   added them, or from the old server.
4. **On the old server, stop the app and the copy timer**, so nothing changes from here
   on. The site is down until the new server answers.

   ```bash
   cd /srv/open-matte/app/deploy && docker compose stop app
   sudo systemctl disable --now open-matte-backup-copy.timer
   ```

5. **Copy the data and backups folders.** On the new server, if it can reach the old
   one over SSH (as `old-server` here):

   ```bash
   rsync -a old-server:/srv/open-matte/data/ /srv/open-matte/data/
   rsync -a old-server:/srv/open-matte/backups/ /srv/open-matte/backups/
   ```

   Otherwise copy them through your computer with `rsync` in two steps, and delete the
   copy on your computer afterwards.
6. **Point the DNS records at the new server**, and wait until
   `dig +short cinema.example.com` gives its address.
7. **Start the new server** with `docker compose up -d --build`. Caddy gets new
   certificates once the names lead to it.
8. **Check** as in [Checking it works](installing.md#checking-it-works): the
   `Passkeys:` line, **Status** (the version, the films found, the schema), a ticket
   link you've already sent, and someone signing in with their passkey.
9. **Set up the off-server copy** on the new server
   ([Keeping a copy off the server](#keeping-a-copy-off-the-server)). It mirrors, so it
   deletes from the copy whatever isn't in the server's backups folder: that's why the
   old backups came across in step 5. And it's why the old server's timer is off: two
   servers mirroring into one folder delete each other's backups.
10. When you're happy, **remove the old server** ([Removing it](#removing-it)), but
    leave the DNS records, which now point at the new one.

Viewers stay signed in, since their sessions are in the database.

### With the old server gone

Set up the new server as above, up to the point where `docker compose up` would run,
and copy the films back. Then, before the first start, put the newest backup in place
from the off-server copy, as in [Restoring](#restoring): the database file as
`data/open-matte.db`, and the `artwork` and `branding` folders into `data`. Copy the
rest of the backups into the new backups folder too, before you set up the copy timer
again. Point the DNS records at the new server and start it.

Your settings aren't in the backup: they live only in `deploy/.env` (and
`compose.override.yml`), so use your copy of them. Without one, set a new admin
password, and set `DOMAIN` and `WEBAUTHN_RP_ID` exactly as they were: the database
doesn't record them, and a different `WEBAUTHN_RP_ID` leaves every passkey useless.
If you're not sure of it, a passkey in your own password manager or keychain is listed
under it. A TMDB key saved in the back office is in the backup; one set in `.env` is not.
Then check Members and Tapes, as after
[restoring an older backup](#after-restoring-an-older-backup).

## Status and logs

**Status** in the back office answers two questions without a trip to
the server. **Needs attention**: setup and recovery links still waiting, or expired
unused in the last 7 days; tickets never played whose start-by date is close or just
passed; and the media requests the app refused or couldn't answer since it started,
counted by reason, with the latest ten (repeats share a row). **The server**: whether
the media folder is readable and how many film folders the last scan found; the free
disk space for the data and the media; the newest backup file, the last backup error,
and the off-server copy if `BACKUP_COPY_DIR` is set; the last clean-up; and the
version, Node, SQLite and schema versions, and when the app started. When something
needs attention, the top of the Films page says so.

Each line says what was checked, such as "Backup file written at 4 Nov, 04:03" (in
the browser's own time zone and date format), never that a restore would work.
Reading it records nothing.

The logs, on the server:

```bash
docker compose logs -f app                 # follow the app's log; Ctrl-C to stop
docker compose logs --since 24h app        # the last day
docker compose logs caddy                  # certificates and Caddy's errors
```

The app logs its start and its first scan, clean-ups that deleted something, media
requests ([below](#refused-media-requests)) and passkeys it refused, what browsers
blocked under the pages' policy ([below](#what-browsers-blocked)), and errors. It never logs ticket codes, link tokens,
cookies or the back office password. Caddy keeps no access log. Its error log can hold a
ticket link's address if someone opens it while the app is down
([access.md](access.md#secrets-and-sessions)). Each container keeps at most 50 MB of
logs (five files of 10 MB), set in `compose.yml`.

### Refused media requests

When the app refuses a request for a film's files, or can't answer it, it writes a
line to its log, and Status counts it:

```bash
docker compose logs --since 24h app | grep media
```

```text
media 403: /media/arrival/hls/v_h264_720/seg_12.m4s - no screening held by this browser - Apple media player (iPhone)
media 403: /media/arrival/hls/v_h264_720/seg_19.m4s - no screening held by this browser - Apple media player (iPhone): 7 more like it in the minute before
media 404: /artwork/arrival/poster-1a2b3c4d5e6f.jpg - no session cookie - Chrome on Android
```

Each line gives the status the browser was answered with, the address it asked for
(only its start, if it's long), why, and the browser and device, as your account page
names them. On an iPhone, Safari's own player fetches the video itself, so those
requests are named "Apple media player (iPhone)". A poster or backdrop downloaded from
TMDB that a browser may not have is answered 404, as if there were no such film
([access.md](access.md#media-requests)), and logged with that 404 and the reason. A
request for a film that doesn't exist is neither logged nor counted.

Anyone can have a request refused, as often as they like, so these lines are limited
like the policy's reports below. The same refusal (the same status, reason, kind of
file, film and browser) is logged once a minute at most, then a line says how many
more like it there were, ending with the address of the last. And the log takes at
most 30 new lines a minute about browsers with a session, and 10 about requests with
none (no cookie, or one that has expired or was made up), which anyone can send. Past
those, a line says how many weren't logged:

```text
media: 412 more refused requests with no session not logged in the minute before
```

So someone with no session sending made-up requests can't push the lines about your
viewers out of the log, though a browser with a ticket shares the allowance for
sessions. Status still counts every one. A ticket link's preview poster that the
films' folder couldn't answer (`poster 503: ...`) shares the allowance for requests
with no session.

### What browsers blocked

Every page tells the browser what it may load and run: its Content-Security-Policy
([access.md](access.md#secrets-and-sessions)). When a browser blocks something under
it, the browser reports it, and the app writes one line to its log and keeps nothing
else:

```bash
docker compose logs --since 24h app | grep CSP
```

```text
CSP blocked img-src https://tracker.example.com on /arrival (Chrome on Android)
CSP blocked img-src https://tracker.example.com on /arrival (Chrome on Android): 12 more like it in the minute before
```

Each line gives the rule that blocked it, what was blocked, the page's path, and the
browser and device that said so, as your account page names them. The rules:
`img-src` is images, `media-src` the film itself, `font-src` the membership card's
fonts, `script-src` and `style-src` scripts and styles, `connect-src` the app's own
requests. A rule's name may end in
`-elem` (a script or style element) or `-attr` (a script or style written on an
element: `onclick=` and the like, or `style=`), as in `script-src-elem`,
`style-src-elem`, `script-src-attr` and `style-src-attr`.

`form-action`, `base-uri` and `frame-ancestors` mean a form or a `<base>` got into a
page, or another site tried to show the shop in a frame. Please report any of
these, and any `script-src-attr` line: the shop writes no script on an element, so
it may mean someone found a way to add their own.

Any other name, such as `frame-src`, `worker-src` or `manifest-src`, is
something the shop never uses, so it is almost always an extension or other
software on the visitor's device.

What was blocked is an address's origin only, or a kind: `inline` (a script or style
written into the page), `eval`, `blob` or `data`. A ticket link's page shows as
`/t/…`, and no line has a query or a ticket code. The same rule, origin, page and
browser is logged once a minute at most, then a line says how many more there were.

Look after an update, and when you try the shop on a device or app it hasn't met
before: an iPhone, an Android phone, a link opened inside WhatsApp or Instagram,
AirPlay or a Chromecast. A line for something the site needs is a bug: please report
it. Two kinds you can leave:

- `style-src-attr inline` from Safari (or any browser on an iPhone or iPad), on a
  page with a drop-down menu, such as the back office's Settings or a film's player.
  WebKit, the engine Safari is built on, holds the inside of its own menus against
  the policy; they look and work just the same. The same line from another browser,
  or on a page with no drop-down menu, is worth reporting. To be sure, open the page
  in another browser and see whether the line comes back.
- Origins that aren't the shop's, and kinds such as `chrome-extension`: a browser
  extension, or other software on a visitor's device, trying to add to the page. The
  policy stopped it.

Anyone can send these reports, so they are limited: each visitor's address may send
100 in ten minutes, of up to three reports each, and one over 8 KB is refused. The
log takes at most 30 new lines a minute from everyone together; past that, a line
says how many reports weren't logged, so someone sending made-up reports can't push
the rest of the log out:

```text
CSP: 412 more reports not logged in the minute before
```

If you see that line, the minute's real reports may be among those counted. Try the
device again a few minutes later.

## Passkeys

People you add sign in with passkeys, which belong to the domain in `WEBAUTHN_RP_ID`
for good ([Choices you make once](installing.md#choices-you-make-once)). The app
checks the setting when it starts. When all is well, the log says:

```text
Passkeys: RP ID example.com, origin https://cinema.example.com
```

and **Settings → Members and passkeys** in the back office says the same. Otherwise the log
says `Passkeys unavailable:` and why, the back office's Members and Settings pages show a
banner, setup links can't be created, and passkey requests answer 503
`passkeys-unavailable`. Everything else, ticket links included, carries on as normal.
To check after an update:

```bash
docker compose logs app | grep Passkeys
```

A passkey works only on the site's own address: `https://` and `DOMAIN`, exactly.
Names in `REDIRECT_FROM` only redirect there, so a passkey is never used on them.

TV browsers and the built-in browsers of apps such as Instagram and Facebook usually
can't use passkeys, so they can't use tickets for one person. For a TV, issue a ticket
for anyone with the link. Someone who opens their ticket in an app's browser can open
it again in Safari or Chrome: the code stays in the address until they sign in.

In development you don't set it: with no `PUBLIC_URL`, or one on `localhost`, passkeys
belong to `localhost` and work at `http://localhost` on any port. Use `localhost`,
never `127.0.0.1`: browsers won't use passkeys on an IP address.

### Testing from home

Some home networks block or rewrite DNS for your own domain: a router's content
filter, or a DNS filter for the whole network, can send it nowhere. Then the site
fails at home and works everywhere else. Passkeys only work when the browser itself
visits the site's real name, so tricks like `curl --resolve` don't help. For each
check, either:

- put the device on a phone's hotspot, or use the phone itself on mobile data with
  Wi-Fi off;
- allow the domain in the filter for the session; or
- on a computer, point the name at the server in its hosts file, with a line such as:

  ```text
  203.0.113.10 cinema.example.com
  ```

  The file is `/etc/hosts` on a Mac or Linux, and
  `C:\Windows\System32\drivers\etc\hosts` on Windows (edit it as an administrator).
  The certificate stays valid, because the name is still right. On a Mac, run
  `sudo killall -HUP mDNSResponder` afterwards so it takes effect; on Windows,
  `ipconfig /flushdns`. Take the line out when you've finished, or you won't notice if
  the server's address changes.

A TV can't have a hosts file, so it needs the hotspot or the filter's exception. The
same goes for checking a ticket link's preview in a chat app: the phone that sends the
link fetches the preview itself, so it needs mobile data or the exception.

## IPv6 and rate limits

Some requests are rate-limited per visitor, to slow down guessing, or a script
pressing a button in a loop:

| What | Each visitor may make |
|---|---|
| Opening a ticket link | 30 every 10 minutes |
| Pressing Play (or **Watch here instead**) | 60 every 10 minutes |
| Keeping a ticket | 30 every 10 minutes |
| A ticket link's preview, the page and its poster together | 60 every 10 minutes |
| Posters and backdrops downloaded from TMDB | 2000 requests that find nothing every 10 minutes, and 6000 for each IPv6 /48 |
| Setting up a passkey from a setup or recovery link | 20 requests every 15 minutes |
| Signing in with a passkey | 30 every 10 minutes |
| Signing in to the back office | 10 tries every 15 minutes, and 30 for each IPv6 /48 |

Over a limit, the API says to try again later. A ticket link's preview previews as
the shop instead, and its poster, like a poster or backdrop downloaded from TMDB,
answers as if there were no such film. Only the requests for posters and backdrops
that find nothing count, whether the film isn't there or the browser may not have it,
so a household sharing one address loads as many as it likes, while someone guessing
films' names gets a little over three a second.

The counts live in memory, so `docker compose restart app` clears them, should a
household that shares one address get stuck.

An IPv4 visitor counts by its address, an IPv6 visitor by its /64 (one household or
server usually holds a whole one). Signing in to the back office, and posters and backdrops
downloaded from TMDB, also count each IPv6 /48 as one, across all its /64s: anyone
can have a /48 for nothing from a tunnel broker, and with it tens of thousands of
/64s. Only what the /64's own limit lets through counts towards it. There's
deliberately no limit for everyone together, which anyone could use up to lock you
out. If someone else in your /48 has used up its tries, sign in from another network,
or restart the app. Posters and backdrops downloaded from TMDB can be used up the
same way: a phone network can put many people in one /48, or behind one IPv4 address.
If they stop loading for everyone on one network, the limit starts again within ten
minutes, and `docker compose restart app` clears it at once.

Counting visitors by address needs the app to see their real addresses. If your
domain has only an A record, everyone arrives over IPv4, and it does. Before you give
it an AAAA record, give Docker's network IPv6, in
[`compose.override.yml`](#your-own-changes-to-the-docker-setup):

```yaml
networks:
  default:
    enable_ipv6: true
```

Depending on your version of Docker, the network may also need an IPv6 subnet of its
own: Docker's IPv6 documentation has the details. Without IPv6 on the network, Docker
hands Caddy every IPv6 visitor as the network gateway's address, and they all share
one limit.

If you give the network a subnet, make it a private one, starting `fd` (such as
`fd12:3456:789a:1::/64`), not one of your server's public addresses. The app believes
what Caddy says about a visitor only when Caddy reaches it from a private address
(`TRUST_PROXY`, in [`.env.example`](../.env.example)). From a public one, every
visitor would look like Caddy, and share one limit, so that one person's wrong admin
passwords would lock you out. If the network must have a public subnet, tell the app
that one proxy stands in front of it, in `compose.override.yml`:

```yaml
services:
  app:
    environment:
      TRUST_PROXY: 1
```

## Removing it

Before you start, keep anything you'll want: a last backup, copied somewhere outside
`/srv/open-matte` (with the copy timer as shipped, the off-server copy is inside the
media folder), and your films' originals (the server only has the encodes). Then, on
the server:

```bash
cd /srv/open-matte/app/deploy
docker compose down --volumes --rmi all
```

That removes both containers, their network, Caddy's volumes (its certificates and
settings) and the two images. Unnamed images left from earlier builds can go too, and
Docker's build cache if nothing else on the server uses Docker; `docker image ls`
shows any image left:

```bash
docker image prune -f                  # unnamed images left from earlier builds
docker builder prune --all --force     # the build cache, if nothing else uses Docker
```

If you set up the off-server copy, remove its timer:

```bash
sudo systemctl disable --now open-matte-backup-copy.timer
sudo rm /etc/systemd/system/open-matte-backup-copy.service /etc/systemd/system/open-matte-backup-copy.timer
sudo systemctl daemon-reload
```

Then delete the folders. `data` and `backups` hold personal data: people's names, your
notes and their activity.

If network storage is mounted under `/srv/open-matte`, such as the media folder,
remove its line from `/etc/fstab` (or wherever you set up the mount) so it isn't
mounted again at the next start, run `sudo systemctl daemon-reload`, and unmount it.
Otherwise the `rm` would delete what's on the storage too: the films and the
off-server copy. With `x-systemd.automount`, as in
[Films on network storage](installing.md#films-on-network-storage), the folder is
listed twice, as `autofs` and under it as `cifs`, and unmounting only the `cifs` one
leaves it to be mounted again as soon as anything looks in. Unmount until `mount`
lists nothing there:

```bash
mount | grep /srv/open-matte               # anything mounted in there
sudo umount /srv/open-matte/media          # once for each line listed, autofs too
sudo rm -rf --one-file-system /srv/open-matte
```

`--one-file-system` makes `rm` skip anything still mounted, and say so, rather than
delete what's on it.

Close the ports, if nothing else on the server needs them:

```bash
sudo ufw delete allow 80/tcp
sudo ufw delete allow 443/tcp
sudo ufw delete allow 443/udp
```

What's left behind, outside the server:

| Where | What to do |
|---|---|
| The off-server copy of the backups | Delete it: it holds the same personal data. Your hosting provider's snapshots of the server or the storage may hold more. |
| Backups you copied to your computer | Delete them, for the same reason. |
| DNS | Delete the A and AAAA records for `DOMAIN` and every name in `REDIRECT_FROM`. A record pointing at an address you no longer have could one day lead to someone else's server. |
| People's devices | Their passkeys stay in their password manager or keychain, listed under `WEBAUTHN_RP_ID`, until they delete them. They're harmless, since nothing answers them any more. Tell people they can delete them. |
| Links you've sent | Ticket and setup links stop working. Nothing needs doing. |
| TMDB | If you made a TMDB key for the shop, delete it in your TMDB account's settings. |
| Certificate logs | Every HTTPS certificate is listed in public Certificate Transparency logs, so the names the shop used stay on record there. |
