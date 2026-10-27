# Deploying

Open Matte runs as one container behind Caddy, which handles HTTPS. You need a
server with Docker and a domain whose DNS points at it. Passkeys need HTTPS on a
stable domain, which this setup provides, and one setting you choose once:
`WEBAUTHN_RP_ID` (see [Passkeys](#passkeys)).

## First install (Ubuntu)

On the server:

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"            # log out and back in afterwards
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo mkdir -p /srv/open-matte/{app,data,media,backups} && sudo chown -R "$USER": /srv/open-matte
```

From your computer, copy the app over:

```bash
scripts/deploy.sh my-server          # an SSH host name from ~/.ssh/config
```

The first run stops because `deploy/.env` doesn't exist yet. On the server:

```bash
cd /srv/open-matte/app/deploy
cp .env.example .env
nano .env                            # set DOMAIN, ADMIN_PASSWORD and WEBAUTHN_RP_ID
chmod 600 .env
docker compose up -d --build
```

Caddy fetches a certificate on first start. Then open `https://your-domain/admin`.

To send other names to the site, such as the bare domain when `DOMAIN` is
`www.example.com`, list them as `REDIRECT_FROM` in `deploy/.env`, separated by spaces,
and point their DNS at the server too: an A record, and an AAAA record only if
`DOMAIN` has one (see [IPv6 and rate limits](#ipv6-and-rate-limits)). Caddy gets their
certificates and answers every request there with a permanent redirect to the same
path on `DOMAIN`; nothing else is served on them, so passkeys only ever run on
`DOMAIN`. After changing it, `docker compose up -d caddy` picks it up. This deployment
sends `openmatte.dev` to `www.openmatte.dev`.

The data directory must be writable by uid 1000 (the container's `node` user).

## Passkeys

People you add sign in with passkeys, and every passkey belongs to one domain: the
**relying-party ID**, set as `WEBAUTHN_RP_ID` in `deploy/.env`. It must be your
`DOMAIN` or a parent of it, so for `DOMAIN=www.example.com` there are two choices:

- `www.example.com`: this exact site only.
- `example.com`: also covers the bare domain or another subdomain, should the site
  ever move there. In return, every subdomain of `example.com` must stay under your
  control, since browsers treat them all as the same site.

This deployment uses `openmatte.dev`, with `DOMAIN=www.openmatte.dev`.

**Choose it once, before you create the first setup link.** Every passkey is tied to
it for good: browsers only offer a passkey on the domain it was made for (and its
subdomains), so changing the ID, or moving the site to another domain altogether,
leaves every existing passkey useless. Each person would then need a recovery link
from you to create a new one. The cinema name and people's names can change freely.

The app checks the setting when it starts. It must be a lowercase domain name with at
least one dot, without `https://`, a port or a path, and not an IP address, and the
site must be on https (behind Caddy, it is). When all is well, the log says:

```text
Passkeys: RP ID openmatte.dev, origin https://www.openmatte.dev
```

Otherwise it says `Passkeys unavailable:` and why, the admin's People and Settings
pages show a banner, setup links can't be created, and passkey requests answer 503
`passkeys-unavailable`. Everything else, ticket links included, carries on as
normal. To check after a deploy:

```bash
cd /srv/open-matte/app/deploy && docker compose logs app | grep Passkeys
```

In development you don't set it: with no `PUBLIC_URL`, or one on `localhost`,
passkeys belong to `localhost` and work at `http://localhost` on any port. Use
`localhost`, never `127.0.0.1`: browsers won't use passkeys on an IP address.

TV browsers and the built-in browsers of apps such as Instagram and Facebook usually
can't use passkeys, so they can't use tickets for one person. For a TV, issue a
ticket for anyone with the link. Someone who opens their ticket in an app's browser
can open it again in Safari or Chrome: the code stays in the address until they sign
in.

### Testing from home

Passkeys only work when the browser itself visits the site's real name, so tricks
like `curl --resolve` don't help. That matters if your home network blocks or
rewrites your own domain, as some gateways and DNS filters do (this deployment's
home gateway sinkholes openmatte.dev). For each check, either:

- put the device on a phone's hotspot (or use the phone itself on mobile data, with
  Wi-Fi off);
- allow the domain on the gateway or filter for the session; or
- on a computer, point the name at the server in its hosts file. Here that's this
  line in `/etc/hosts`:

  ```text
  65.21.54.126 www.openmatte.dev
  ```

  The certificate stays valid, because the name is still right. On a Mac, run
  `sudo killall -HUP mDNSResponder` afterwards so it takes effect. Take the line out
  when you've finished, or you won't notice if the server's address changes.

A TV can't have a hosts file, so it needs the hotspot or the gateway exception.

## Adding a film

```bash
rsync -av --partial-dir=.rsync-partial --progress media/arrival/ my-server:/srv/open-matte/media/arrival/
```

Then press **Scan media folder** in the admin. If the scan reports missing
segments, the copy didn't finish: run the same `rsync` again. `--partial-dir`
keeps a half-copied file out of sight until it's complete (plain `--partial`
would leave it under its real name, where a scan could take it for a whole one).

## Updating

**Before each update**, so you can go back:

1. Tag the commit you're about to deploy, so every version that has run has a name.
   If the code running now was never tagged, tag that first (here, milestone 1 is
   commit `b28a56d`):

   ```bash
   git tag milestone-1 b28a56d          # once, for what's running now
   git tag m2-slice-1                   # what you're about to deploy
   ```

2. In the admin, press **Settings → Backups → Back up now**.
3. Copy that backup off the server. **Back up now** writes to the same disk as the
   database, and the off-server copy (below) only runs once a day.

   ```bash
   ssh my-server 'ls -t /srv/open-matte/backups/*.db | head -1'    # the one you just made
   scp my-server:/srv/open-matte/backups/open-matte-2026-10-26-153012.db .
   ```

Then:

```bash
scripts/deploy.sh my-server
```

This copies the code and rebuilds; the database and films are untouched.
Database migrations run automatically on start.

To run the tests on exactly the Node and SQLite the site now runs on (the server's
image, which can differ from your computer's), use a throwaway container from that
image, with no network and none of the site's data:

```bash
ssh my-server "docker run --rm --network none -e NODE_ENV=test \
  -v /srv/open-matte/app/test:/app/test:ro -w /app deploy-app node --test 'test/*.test.js'"
```

Before the first milestone 2 update (people and passkeys), set `WEBAUTHN_RP_ID`
(above), so it's in place before anyone creates a setup link, and check that no film
folder is called `account`: that name is now reserved for the site, like `admin` and
`api`, and a scan would skip it.

From milestone 2's second update (tickets for one person) on, going back to older
code always needs a restore of the backup you took before it: see
[Rolling back](#rolling-back).

## Backups

Everything Open Matte knows lives in its database: films' details, tickets,
screenings and activity, people and their passkeys, settings (including a TMDB key
saved in the admin). The films themselves aren't backed up here: keep your
originals and encodes elsewhere, as you already do.

**Automatic backups.** Every day at 04:00 UTC the app saves a consistent copy of
the database, checks it, and keeps it in `/srv/open-matte/backups` (`BACKUP_PATH`
in `deploy/.env`), as `open-matte-YYYY-MM-DD-HHMMSS.db`. It keeps the newest of
each of the last 14 days and the first of each month for a year. Posters
downloaded from TMDB are copied to `backups/artwork`. If the server was down at
04:00, a backup runs shortly after it starts. **Settings → Backups** in the admin
shows the latest and has a **Back up now** button.

Change the timing with `BACKUP_HOUR`, `BACKUP_KEEP_DAYS` and `BACKUP_KEEP_MONTHS`;
turn backups off with `BACKUP_DIR=off`.

**Keep a copy off the server.** Backups on the VPS protect against mistakes, not
against losing the VPS. If you have network storage mounted (a Hetzner Storage
Box, say), copy them there every day with the systemd timer in `deploy/systemd`
(edit the paths first):

```bash
sudo cp /srv/open-matte/app/deploy/systemd/open-matte-backup-copy.* /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now open-matte-backup-copy.timer
sudo systemctl start open-matte-backup-copy.service     # once now, to check it works
```

Your hosting provider's own snapshots (Hetzner's server backups, or Storage Box
snapshots) are a good extra layer. Backups hold people's names and your notes about
them, which are personal data, so keep every copy somewhere private.

**Restoring.** Stop the app, put the backup in place, start it again:

```bash
cd /srv/open-matte/app/deploy && docker compose stop app
cp /srv/open-matte/backups/open-matte-2026-10-26-040000.db /srv/open-matte/data/open-matte.db
rm -f /srv/open-matte/data/open-matte.db-wal /srv/open-matte/data/open-matte.db-shm
cp -rn /srv/open-matte/backups/artwork/. /srv/open-matte/data/artwork/
docker compose start app
```

Viewers stay signed in, because their sessions are in the backup too, unless
the backup is older than their sign-in.

**After restoring an older backup, check People.** The backup knows nothing of what
happened since it was made. Passkeys you removed since (one by one, or with **Reset
after loss**) are back and work again; browsers you signed out (with **Sign out
everywhere**, **Disable** or a reset) are signed in again; someone you disabled is
enabled again; and a link cancelled or used since then
works again until it expires. Remove those passkeys again, use **Sign out
everywhere** or **Disable** where needed, and cancel any waiting link you didn't
mean. Passkeys created since the backup are gone from the server, so those people
can't sign in until you send them a new link.

**Don't delete people, passkeys or links by hand** (with `sqlite3`, say). Use the
admin instead: **Remove** for a passkey, **Reset after loss**, **Disable** for a
person. They sign out the browsers concerned first and record what happened in
Activity; deleting a passkey's row by hand leaves every browser it signed in still
signed in. People can't be deleted at all in this milestone: the app's database
connection refuses while anything refers to them, and the `sqlite3` command line,
which doesn't check that unless told to, would leave their passkeys, sessions and
events pointing at nobody.

**Restoring onto a new server.** Follow **First install** up to the point where
`docker compose up` would run, copy the films back into `media`, and put the
database (and `artwork`) in place as above before the first start. With the old
server gone, take them from the off-server copy (`.open-matte-backups` on the
Storage Box, if you set up the timer above). Use the same `DOMAIN`, or every ticket
link you've sent stops working, and the same `WEBAUTHN_RP_ID`, or nobody's passkey
works. The admin password isn't in the backup: it lives only in `deploy/.env`, so
set a new one if the old `.env` is gone. A TMDB key saved in the admin is in the
backup; one set in `.env` is not.

## Rolling back

From milestone 2 on, the app refuses to open a database written by newer code. Deploy
older code without restoring, and it stops at start with:

```text
This database was written by a newer Open Matte (schema 4; this code knows 3). Deploy the newer code, or restore a backup from before the upgrade.
```

So the backup has to be in place before the older code starts:

1. Stop the app:

   ```bash
   cd /srv/open-matte/app/deploy && docker compose stop app
   ```

2. Copy the backup taken before the update over `/srv/open-matte/data/open-matte.db`
   and delete the `-wal` and `-shm` files, as in **Restoring** above, but **don't**
   run its final `docker compose start app`: that would start the newer code, which
   would migrate the restored database straight back. If the backup is no longer on
   the server, `scp` your off-server copy back first.

   ```bash
   cp /srv/open-matte/backups/open-matte-2026-10-26-153012.db /srv/open-matte/data/open-matte.db
   rm -f /srv/open-matte/data/open-matte.db-wal /srv/open-matte/data/open-matte.db-shm
   cp -rn /srv/open-matte/backups/artwork/. /srv/open-matte/data/artwork/
   ```

3. On your computer, check out the previous tag and deploy it. `deploy.sh` runs
   `docker compose up -d --build`, which builds and starts the older code:

   ```bash
   git checkout milestone-1
   scripts/deploy.sh my-server
   ```

   `deploy.sh` copies whatever is checked out, so do this with no uncommitted
   changes, and check your branch out again afterwards.

Screenings, events, people and tickets written since that backup are lost.

From milestone 2's second update (tickets for one person) on, always restore. The
only rollback that ever worked without one was from the first update (people and
passkeys) back to milestone 1 (`b28a56d`), while no ticket for one person existed.
Don't try that now: milestone 1 code has no guard and ignores who a ticket is for, so
started on a database that has tickets for one person, it would run, and let anyone
with their links use them. Code from the first update onwards has the guard, and
stops as above.

## IPv6 and rate limits

Opening ticket links, setup and recovery links, signing in and the admin password
are rate-limited per visitor, and an IPv6 visitor counts by its /64 (one household or
server usually holds a whole one). For that the app has to see visitors' real
addresses. www.openmatte.dev has no AAAA record, so everyone arrives over IPv4 and it
does. If you give your domain an AAAA record, give the compose network IPv6 first
(`enable_ipv6` in `deploy/compose.yml`; Docker's IPv6 documentation has the details
for your version). Otherwise Docker hands Caddy every IPv6 visitor as the network
gateway's address, and they all share one limit.

## Logs

```bash
cd /srv/open-matte/app/deploy && docker compose logs -f app
```

Each container keeps at most 50 MB of logs (five files of 10 MB), set in
`deploy/compose.yml`.
