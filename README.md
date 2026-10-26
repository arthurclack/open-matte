# Open Matte

A small, self-hosted, personal cinema. You publish a handful of films you want to
recommend, and friends watch them in the browser from a link:

> You should watch this film. Here's the link.

It isn't a media server. You prepare streaming-ready versions on your own
computer, copy them to a server, write a few lines on why someone should watch
the film, and send a ticket. The server serves the prepared files and never
transcodes, so playback doesn't depend on your home upload speed.

## What's here (milestone 1: ticketed playback, complete)

- **Film pages** with poster, details and your recommendation
- **Adaptive HLS playback** (hls.js, or Safari's own player) with audio and subtitle choices and quality on Auto
- **Tickets**: per-film "admit one" links with optional screening limits, a start-by date and a validity period counted from first playback
- **Screenings** that can be paused and resumed for 48 hours, one device at a time
- **Protected media**: every playlist, segment and subtitle request is checked against the viewer's session and screening
- **Admin**: scan the media folder, publish, issue and revoke tickets, see opened/played/finished activity
- **Import contract**: one folder per film, described by a `film.json` ([docs/import-format.md](docs/import-format.md))
- **Film information from TMDB**, optional: details, posters and backdrops filled in on import or chosen by hand, as Jellyfin does ([docs/metadata.md](docs/metadata.md))
- **Reference encoder** for HEVC + H.264 ladders with alternate audio ([docs/encoding.md](docs/encoding.md))

Milestone 2 adds people and passkeys; milestone 3 branding, polish and release
documentation. See [docs/roadmap.md](docs/roadmap.md).

## Running it locally

Needs Node 22.13 or later (it uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env        # set ADMIN_PASSWORD
npm run build               # build the web app into dist/
npm run dev                 # server on http://localhost:3000
```

To work on the web app with hot reload, run `npm run dev:web` alongside and use
http://localhost:5173.

Put a film folder in `media/` (or make a test one with the encoder), open
http://localhost:3000/admin, scan, publish, and issue a ticket. Open the ticket
link in a private window to see it as a guest would.

```bash
npm test                    # access rules, scanner and the full ticket journey
```

## Deploying

One container behind Caddy, which handles HTTPS. See [docs/deploying.md](docs/deploying.md).

## How access works

Tickets are bearer links; pressing Play starts a screening; media needs a
screening this browser holds. The details, including what is recorded about
viewers, are in [docs/access.md](docs/access.md).

## Layout

```text
server/         Express app: access rules, scanner, routes, SQLite
web/            React app: viewer pages, player, admin
scripts/        encode.mjs (reference encoder), deploy.sh
deploy/         Docker Compose + Caddy
docs/           import format, access rules, encoding, deploying, roadmap
test/           node:test suites
```

Only share films you have the right to share.

## Licence

GNU General Public License v3.0. See [LICENSE](LICENSE).
