# Installing Open Matte

This takes you from a fresh Ubuntu server to a working cinema: the site on your own
domain over HTTPS, your first film published, and a ticket played. Once it's running,
[deploying.md](deploying.md) covers updates, backups, restoring and the rest.

Open Matte runs in one container, with Caddy in another in front of it to handle
HTTPS, and Docker Compose starts both. Each command block says where it runs: on the
server, or on your computer. The paths are the defaults, under `/srv/open-matte`, and the examples use
`cinema.example.com` for the site, `203.0.113.10` for the server's address and
`my-server` for the SSH name of the server. Put your own in their place.

## What you need

| | |
|---|---|
| A server | Ubuntu 24.04 LTS with a public IPv4 address, and SSH access as a user who can use `sudo`. Docker comes from Ubuntu's own packages below. |
| Disk | Room for your films: about 50 GB for a two-hour 4K HDR film with every rendition, 8 to 15 GB for one without a 4K source ([encoding.md](encoding.md#storage)). The films can live on network storage mounted on the server. |
| A domain | A name you can add DNS records to, such as `cinema.example.com`. |
| Ports | 80 and 443 (TCP), and 443 (UDP), reachable from the internet. |
| On your computer | SSH and `rsync`, to copy films. To prepare films with the encoder, Node 22.13 or later and `ffmpeg` ([encoding.md](encoding.md)). |

## Choices you make once

Two settings stay with the cinema for as long as it runs. Decide them before you
start.

**`DOMAIN`, the address people visit.** Every ticket link and setup link you send
carries it. If the site moves to another name later, links already sent only keep
working while the old name still points at the server and is listed in
`REDIRECT_FROM` (below), which sends it on to the new one.

**`WEBAUTHN_RP_ID`, the domain passkeys belong to.** People you add to the cinema sign
in with a passkey, and every passkey is made for this domain and works only there.
It must be `DOMAIN` itself or a parent of it. For `DOMAIN=cinema.example.com`:

| `WEBAUTHN_RP_ID` | What it means |
|---|---|
| `cinema.example.com` | Passkeys work on this exact name only. Choose this when other people or services run sites under `example.com`. |
| `example.com` | Passkeys would also work if the cinema moved to another name under `example.com`, such as `www.example.com`. In return, every subdomain of `example.com` must stay under your control, since browsers treat them all as one site. |

**Choose it before you create the first setup link.** Changing it later, or moving
the site to a domain it doesn't cover, leaves every passkey useless, and each person
needs a recovery link from you to make a new one. Tickets for anyone with the link
don't use passkeys, so they aren't affected by this choice. The cinema's name,
colours and logo, and people's names, can change whenever you like.

`WEBAUTHN_RP_ID` must be a lowercase domain name with at least one dot, with no
`https://`, port or path, and not an IP address: browsers don't use passkeys on IP
addresses. [Passkeys](deploying.md#passkeys) in deploying.md says how to check it once
the site is running.

Cookies are another matter, whichever `WEBAUTHN_RP_ID` you choose. Any site under
`example.com` can set cookies that browsers also send to `cinema.example.com`. The
cinema ignores its session cookie when a browser sends two different ones, so such
a site can stop someone's browser using the cinema. It can also hand its own session
to a browser with no cookie from the cinema, and it can make that so, by setting
more cookies than the browser keeps for `example.com` so the cinema's is dropped.
Ticket links opened in that browser then work for whoever runs that site too, until
the browser next signs in. So if other people run sites under `example.com`, give
the cinema a domain of its own.

## DNS

Point `DOMAIN` at the server with an **A record** holding the server's IPv4 address.
Do this first: at its first start, Caddy asks for an HTTPS certificate for the name,
and the certificate authority checks that the name leads to this server.

| Name | Type | Value |
|---|---|---|
| `cinema.example.com` | A | `203.0.113.10` |
| `example.com`, only if you list it in `REDIRECT_FROM` | A | `203.0.113.10` |

Add an **AAAA record** (IPv6) only after you've given Docker's network IPv6 (see
[IPv6 and rate limits](deploying.md#ipv6-and-rate-limits)). Without that, every
visitor who arrives over IPv6 looks to the app like the same one, and they all share
one rate limit. A name in `REDIRECT_FROM` gets an AAAA record only if `DOMAIN` has
one.

Point the records straight at the server. If your DNS provider offers to send
traffic through its own proxy network, leave that off for these names: the app would
then see the proxy's addresses instead of your visitors', and they'd all share one
rate limit.

To check, on your computer:

```bash
dig +short cinema.example.com          # prints 203.0.113.10
```

On Windows, `nslookup cinema.example.com` does the same. A new record can take a few
minutes to appear, and a changed one as long as its old TTL.

## The server

### Software

On the server:

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git rsync
docker compose version                  # prints Compose's version if all is well
```

The server needs nothing else: Node and everything the app uses are inside its
image. If Docker is already installed from Docker's own packages, keep that instead;
what matters is that `docker compose` (Compose version 2) works.

### Your user

Run everything from here on as an ordinary user with `sudo`, whose user id is 1000.
The app runs in its container as user 1000, so when the same id owns its folders, you
can copy films in and restore backups without `sudo`, and the app can read and write
what you put there.

```bash
id -u                                   # should print 1000
```

On many Ubuntu images the first user, such as `ubuntu`, already is 1000. If `id -u`
prints another number, log in as the user that has 1000 instead: `getent passwd 1000`
names it. Use that one even if you'd rather have another name, since the folders below
end up owned by whoever runs the commands.

If you log in as root, run `getent passwd 1000` first. If it names a user, give that
user your SSH key with the last two lines below (its name in place of `cinema`), and
log in as it. If it prints nothing, add a user, which gets 1000, give it your SSH key,
and log in as it:

```bash
adduser cinema
usermod -aG sudo cinema
mkdir -p /home/cinema/.ssh && cp /root/.ssh/authorized_keys /home/cinema/.ssh/
chown -R cinema: /home/cinema/.ssh
```

Then let your user run Docker, and log out and back in for it to take effect:

```bash
sudo usermod -aG docker "$USER"
```

Being in the `docker` group is as good as being root on this server, so keep it to
yourself.

### The firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
```

Allow SSH first, or `ufw enable` locks you out. If SSH listens on another port, allow
that port instead. Port 80 lets the certificate authority check the name and sends
visitors on to HTTPS; 443 over UDP carries HTTP/3.

Docker opens the ports it publishes by itself, whatever `ufw` says. Here it publishes
only 80 and 443, for Caddy. The app's own port, 3000, isn't published: only Caddy
talks to it, over Docker's own network. If your hosting provider has a firewall of its
own, open the same ports there.

### The folders

```bash
sudo mkdir -p /srv/open-matte/{app,data,media,backups}
sudo chown -R "$USER": /srv/open-matte
chmod 700 /srv/open-matte/data /srv/open-matte/backups
```

| Folder | What it holds | The app |
|---|---|---|
| `app` | The code, and your settings in `app/deploy/.env` | Docker builds the image from it |
| `data` | The database, posters downloaded from TMDB (`artwork`), and your logo and tab icon (`branding`) | Reads and writes |
| `media` | One folder per film | Only reads |
| `backups` | The daily backups | Reads and writes |

Create them before the first start. Docker would create a missing one owned by root,
and the app couldn't write to it.

The database and its backups hold ticket links that work for whoever reads them, and
people's names, so `chmod 700` keeps every other account on the server out of `data`
and `backups`. The app makes its own files there readable by itself only.

If your films live on network storage, mount it at `/srv/open-matte/media`, or
anywhere else and set `MEDIA_PATH` (below). The app only reads it, and a scan that
finds it missing or unreadable says so and changes nothing. If the storage stops
answering, playback stops with an error that players retry, and the rest of the site
carries on. Mount it `soft`, as CIFS (SMB) does unless told otherwise, not `hard`:
then a request the storage never answers fails in the end instead of waiting for ever.

## Getting the code

There are two ways to put the code on the server. Pick one and keep to it.

**With git, on the server.** Use this unless you change the code yourself. The server
then knows exactly which release it runs, and updating or going back is a checkout.
In the command, put the newest release in [CHANGELOG.md](../CHANGELOG.md) in place
of `v1.0.0` (and your own fork's address, if you run a changed copy). On the server:

```bash
cd /srv/open-matte
git clone --branch v1.0.0 https://github.com/arthurclack/open-matte.git app
```

Git ignores `deploy/.env`, so your settings stay put when you update.

**With `scripts/deploy.sh`, from your computer.** Use this if you work on the code. It
copies your working copy, uncommitted changes included, to `/srv/open-matte/app` over
SSH, leaving `deploy/.env` and the server's films and data alone, then builds and
starts the app. Database files in your copy, such as a backup you downloaded, are
never sent. It needs `rsync` on both ends, and an SSH name that logs in to the
server as [your user](#your-user): a `Host` in `~/.ssh/config`, or `user@address`. On
your computer, in your copy of the code:

```bash
scripts/deploy.sh my-server
```

The first run copies the code and then stops, because `deploy/.env` doesn't exist
yet: Docker Compose says `Set ADMIN_PASSWORD in deploy/.env`, or the same for
`DOMAIN`. Carry on below, and the next run starts it.

Don't mix the two. `deploy.sh` copies over a git checkout without telling git, so
afterwards the server's `git status` no longer says what's running.

## Settings

The settings live in `deploy/.env`, next to `compose.yml`. On the server:

```bash
cd /srv/open-matte/app/deploy
cp .env.example .env
chmod 600 .env
nano .env
```

| Setting | What to put |
|---|---|
| `DOMAIN` | The address people visit, without `https://`, such as `cinema.example.com`. Its DNS must point at the server. Required. |
| `REDIRECT_FROM` | Optional. Other names to send to `DOMAIN`, separated by spaces, such as `example.com` when `DOMAIN` is `www.example.com`. Caddy gets their certificates and answers every request on them with a permanent redirect to the same path on `DOMAIN`. Nothing else is served there, so passkeys only ever run on `DOMAIN`. |
| `WEBAUTHN_RP_ID` | The domain passkeys belong to: `DOMAIN` or a parent of it ([Choices you make once](#choices-you-make-once)). Left empty, the site works but passkeys are off, and the log says why. |
| `ADMIN_PASSWORD` | The admin password, at least 12 characters. Required. `openssl rand -base64 24` makes a good one. |
| `TMDB_API_KEY` | Optional. A TMDB key, for film details and posters ([metadata.md](metadata.md)). You can paste one in the admin instead; one set here takes precedence. |
| `DATA_PATH` | Where the database lives on the server. Default `/srv/open-matte/data`. |
| `MEDIA_PATH` | Where the film folders are. Default `/srv/open-matte/media`. |
| `BACKUP_PATH` | Where the daily backups go, on the server's own disk. Default `/srv/open-matte/backups`. |
| `BACKUP_HOUR` | Optional. The hour (UTC, 0 to 23) the daily backup runs. Default 4. |
| `BACKUP_KEEP_DAYS` | Optional. How many days' newest backups to keep, at least 1. Default 14. Every backup of the last three days is kept as well. |
| `BACKUP_KEEP_MONTHS` | Optional. How many months' first backups to keep; 0 keeps none. Default 12. |
| `BACKUP_COPY_DIR` | Optional, and best left until later: where the off-server copy of the backups appears inside the app's container, so the admin can show it ([deploying.md](deploying.md#keeping-a-copy-off-the-server)). |

`deploy/.env` is read by Docker Compose, which treats `$` as the start of a variable.
If you choose your own password with a `$`, a space or a `#` in it, put it in single
quotes: `ADMIN_PASSWORD='your password'`.

To change a setting later, edit `deploy/.env` and run `docker compose up -d` in
`/srv/open-matte/app/deploy`. Compose restarts only the containers whose settings
changed.

## First start

On the server:

```bash
cd /srv/open-matte/app/deploy
docker compose up -d --build
```

The first build takes a few minutes. Then Compose starts two containers: `app`, the
cinema, and `caddy`, which gets the certificate and passes requests to the app. With
`scripts/deploy.sh`, run it again from your computer instead; it does the same.

Check both are up. Within a minute the app should say `(healthy)`:

```bash
docker compose ps
docker compose logs app
```

The app's log should start like this, with your own names:

```text
Open Matte listening on :3000 (media: /media, data: /data)
Passkeys: RP ID example.com, origin https://cinema.example.com
Media scan: 0 film folder(s) (0 ok, 0 with warnings, 0 with errors), 0 missing, 0 skipped
```

| If the log says | Then |
|---|---|
| `ADMIN_PASSWORD must be set and at least 12 characters long` | The app stops and Docker keeps restarting it. Set a longer password in `deploy/.env` and run `docker compose up -d`. |
| A setting's name and what it must be, such as `BACKUP_KEEP_DAYS must be 1 or more` | The same: fix that setting in `deploy/.env` and run `docker compose up -d`. |
| `Passkeys unavailable:` and a reason | Everything else works. Fix `WEBAUTHN_RP_ID` (or `DOMAIN`) as the reason says, then `docker compose up -d`. |
| `unable to open database file`, or a minute later `Backup failed:` with `EACCES` | The data or backups folder isn't writable by user 1000, or doesn't exist. Check [The folders](#the-folders). If they belong to another id, `sudo chown -R 1000:1000 /srv/open-matte/data /srv/open-matte/backups` gives them to 1000. Then `docker compose restart app`. |

Then check Caddy got its certificate:

```bash
docker compose logs caddy | grep -i certificate
```

Look for `certificate obtained successfully`. If you see errors about a challenge
instead, check the DNS record and that ports 80 and 443 are open. Caddy keeps trying
by itself, so once they're right the certificate follows within a few minutes.

Now open `https://cinema.example.com/admin` and sign in with `ADMIN_PASSWORD`. Under
**Settings**, give the cinema its name. **Branding** (colours, a logo, a tab icon) and
**Film information** (a TMDB key) can wait. **People and passkeys** on the same page
should say which domain passkeys belong to.

## The first film

Open Matte plays films you've prepared: one folder per film, with HLS playlists and a
`film.json` ([import-format.md](import-format.md)). It never encodes anything itself.

**With the encoder.** On your computer, with Node and `ffmpeg` installed, get the code
(the same address as in [Getting the code](#getting-the-code)) and encode a source
file. `--seconds 60` encodes only the first minute, which makes a quick test:

```bash
git clone https://github.com/arthurclack/open-matte.git
cd open-matte
npm run encode -- ~/Films/Arrival.mkv media/arrival --subs --seconds 60
```

It writes `media/arrival` with `hls/`, `subtitles/` and a `film.json`. Add a
`poster.jpg` to the folder and `"poster": "poster.jpg"` to `film.json` (or let TMDB
supply one, if you've set a key), and write your recommendation in `film.json`.
[encoding.md](encoding.md) has the options.

**With films you've already encoded.** Put the HLS files in a folder and write its
`film.json` by hand. Only `schemaVersion`, `title` and `hls` are required, so this is
enough to start with:

```json
{
  "schemaVersion": 1,
  "title": "Arrival",
  "hls": "hls/master.m3u8",
  "recommendation": "Your personal recommendation."
}
```

The folder name becomes the film's address (`cinema.example.com/arrival`). Use
lowercase letters, digits and hyphens. A few names belong to the site itself, such as
`admin`, `api` and `account`, and a scan skips a folder with one of them.

**Copy it to the server.** On your computer:

```bash
rsync -av --partial-dir=.rsync-partial --progress media/arrival/ my-server:/srv/open-matte/media/arrival/
```

**Scan and publish.** In the admin, on **Films**, press **Scan media folder**. The
film appears as a **Draft**. If the scan reports missing segments, the copy didn't
finish: run the same `rsync` again and scan again. Open the film, check its details,
and press **Publish**.

## The first ticket

On the film's page in the admin, under **Tickets**:

1. Choose **Anyone with the link**.
2. Under **Who is it for?**, write `Test`. It's only a note for you.
3. Leave **Screenings** at 1, and press **Issue ticket for anyone with the link**.
4. Press **Copy link**. The link looks like `https://cinema.example.com/t/...`.

Open the link on your phone, or in a private window on your computer, so it isn't
signed in to the admin, and press Play. A screening starts, and **Activity** in the
admin shows the ticket opened and played.

That test used the ticket's one screening, so it's spent once the screening's resume
window (48 hours by default) is over. Issue a fresh ticket for each person you send
one to.

If the site works everywhere except on your home network, the network may be blocking
or rewriting your domain: see [Testing from home](deploying.md#testing-from-home).

## Checking it works

- **`docker compose ps`** shows `app` as `(healthy)`, and `caddy` up.
- **HTTPS works**, and plain HTTP sends you there. On your computer,
  `curl -sI http://cinema.example.com` shows a redirect to `https://`, and
  `curl -s https://cinema.example.com/api/site` answers with the cinema's name.
- **The log has a `Passkeys:` line** naming your `WEBAUTHN_RP_ID`, not
  `Passkeys unavailable:`.
- **Status** in the admin (the projection booth) shows the media folder readable with
  your film's folder in it, the free disk space, a backup file (the first is written
  about a minute after the first start), and the version running.
- **A ticket plays** on a phone over mobile data, away from your own network.
- **Passkeys work.** Under **People**, add yourself as a person, press **Create a
  setup link** on your page, and open the link on your phone. Create the passkey,
  then sign out and sign in again with it. Recovery links and how people sign in are
  in [access.md](access.md#people-and-passkeys).

## What next

- **Keep a copy of the backups off the server.** The daily backups sit on the same
  disk as the database. [Keeping a copy off the server](deploying.md#keeping-a-copy-off-the-server)
  sets up a daily copy.
- **Read [deploying.md](deploying.md)** before your first update: it covers updating,
  backups and restoring, rolling back and moving to a new server.
- **Read [access.md](access.md)** for the rules: the two kinds of ticket, people and
  passkeys, and what is recorded about viewers and for how long.
- **Before each update, read [CHANGELOG.md](../CHANGELOG.md).** Each release says
  whether it needs a backup first, and whether you can go back without a restore.
