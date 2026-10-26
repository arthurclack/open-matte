# Deploying

Open Matte runs as one container behind Caddy, which handles HTTPS. You need a
server with Docker and a domain whose DNS points at it. Passkeys (milestone 2)
will need HTTPS on a stable domain, which this setup already provides.

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
nano .env                            # set DOMAIN and ADMIN_PASSWORD
chmod 600 .env
docker compose up -d --build
```

Caddy fetches a certificate on first start. Then open `https://your-domain/admin`.

The data directory must be writable by uid 1000 (the container's `node` user).

## Adding a film

```bash
rsync -av --partial --progress media/arrival/ my-server:/srv/open-matte/media/arrival/
```

Then press **Scan media folder** in the admin. If the scan reports missing
segments, the copy didn't finish: run the same `rsync` again.

## Updating

```bash
scripts/deploy.sh my-server
```

This copies the code and rebuilds; the database and films are untouched.
Database migrations run automatically on start.

## Backups

Everything Open Matte knows lives in its database: films' details, tickets,
screenings and activity, settings (including a TMDB key saved in the admin). The
films themselves aren't backed up here: keep your originals and encodes
elsewhere, as you already do.

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
snapshots) are a good extra layer.

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

## Logs

```bash
cd /srv/open-matte/app/deploy && docker compose logs -f app
```
