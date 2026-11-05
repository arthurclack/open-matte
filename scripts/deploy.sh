#!/usr/bin/env bash
# Copies the app to a server over SSH and (re)starts it with Docker Compose.
#
#   scripts/deploy.sh <ssh-host> [remote-dir]
#
# The server needs Docker, and <remote-dir>/app/deploy/.env (see
# deploy/.env.example). Films are copied separately; see docs/deploying.md.
set -euo pipefail

HOST="${1:?usage: scripts/deploy.sh <ssh-host> [remote-dir]}"
DIR="${2:-/srv/open-matte}"
cd "$(dirname "$0")/.."

# Excluded paths are left alone on the server, so deploy/.env survives --delete.
# A leading / means only at the top of the copy, so a folder called data or media
# deeper in the code is still sent. *.db keeps databases and backups behind, such
# as one downloaded into this folder: they hold people's names and ticket links.
# .agents and skills-lock.json are coding-agent skills installed on this computer;
# e2e/.cache, test-results and playwright-report are what npm run e2e leaves behind.
# site is the project's own website, published on its own: a cinema never uses it.
rsync -az --delete \
  --exclude node_modules --exclude /dist --exclude /data --exclude /media \
  --exclude '*.db' --exclude '*.db-*' \
  --exclude .env --exclude deploy/.env --exclude .git --exclude .claude \
  --exclude .agents --exclude skills-lock.json \
  --exclude e2e/.cache --exclude test-results --exclude playwright-report \
  --exclude /site \
  ./ "$HOST:$DIR/app/"

# Caddy reads its Caddyfile only when it starts, and Compose restarts it only when
# compose.yml or its image changes, so it is told to load the one just sent. A
# Caddyfile with a mistake is refused, Caddy carries on with the one it had, and
# the deploy fails. Right after a restart Caddy may take a moment to answer.
ssh "$HOST" "cd '$DIR/app/deploy' && docker compose up -d --build && \
  for try in 1 2 3; do \
    docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile && break; \
    [ \$try = 3 ] && exit 1; sleep 1; \
  done && \
  docker compose ps"
