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
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude data --exclude media \
  --exclude .env --exclude deploy/.env --exclude .git --exclude .claude \
  ./ "$HOST:$DIR/app/"

ssh "$HOST" "cd '$DIR/app/deploy' && docker compose up -d --build && docker compose ps"
