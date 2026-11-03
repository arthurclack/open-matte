# Open Matte

A small, self-hosted, personal cinema. You publish a handful of films you want to
recommend, and friends watch them in the browser from a link:

> You should watch this film. Here's the link.

It isn't a media server. You prepare streaming-ready versions on your own
computer, copy them to a server, write a few lines on why someone should watch
the film, and send a ticket. The server serves the prepared files and never
transcodes, so playback doesn't depend on your home upload speed.

## What's here

Milestone 1, ticketed playback, is complete:

- **Film pages** with poster, details and your recommendation
- **Adaptive HLS playback** (hls.js, or Safari's own player) with audio and subtitle choices and quality on Auto
- **Tickets**: per-film "admit one" links with optional screening limits, a start-by date and a validity period counted from first playback
- **Screenings** that can be paused and resumed for 48 hours, one device at a time
- **Protected media**: every playlist, segment and subtitle request is checked against the viewer's session and screening
- **Admin**: scan the media folder, publish, issue and revoke tickets, see opened/played/finished activity
- **Import contract**: one folder per film, described by a `film.json` ([docs/import-format.md](docs/import-format.md))
- **Film information from TMDB**, optional: details, posters and backdrops filled in on import or chosen by hand, as Jellyfin does ([docs/metadata.md](docs/metadata.md))
- **Reference encoder** for HEVC + H.264 ladders with alternate audio ([docs/encoding.md](docs/encoding.md))

Milestone 2, people and passkeys, is built (planned in
[docs/milestone-2.md](docs/milestone-2.md)); checks on real devices are under way
([docs/device-checks.md](docs/device-checks.md)):

- **People and passkeys**: you add people and send each a single-use setup link; they create a passkey and can then sign in and out with no password. Recovery links, disabling people and removing passkeys are in the admin ([docs/access.md](docs/access.md))
- **Tickets for one person**: alongside tickets for anyone with the link, a ticket only one person can use, signed in with their passkey. It's listed on every device they sign in on, and forwarding the link does nothing ([docs/access.md](docs/access.md#two-kinds-of-ticket))
- **Keeping a ticket**: a ticket for anyone can be marked "Let them keep it". The first signed-in person to keep it makes it theirs, on every device they sign in on; other browsers holding the link lose it and are told why, and its limits and expiry don't change. You can give it to someone else or back to anyone with the link ([docs/access.md](docs/access.md#keeping-a-ticket))
- **An account page**: a signed-in person sees their passkeys and the browsers they're signed in on, and can sign out everywhere themselves ([docs/access.md](docs/access.md#signing-in-and-out))
- **Films shown to members**: a switch per film. Signed-in people see its page, poster and your recommendation, and are told to ask for a ticket; playing it still needs one ([docs/access.md](docs/access.md#films-shown-to-members))

Milestone 3, polish and public release, is under way (planned in
[docs/milestone-3.md](docs/milestone-3.md), progress in
[docs/roadmap.md](docs/roadmap.md)):

- **Branding**: an accent and a background colour, a logo and a tab icon, set in the admin and shown on every viewer page from the first paint: the server writes them into the page as it sends it, and the logo's image is requested along with the page. A ticket link for anyone previews its film's poster and title in chat apps; every other link previews as the cinema ([docs/access.md](docs/access.md#link-previews))
- **Lock screen and Playback help**: while a film plays, the lock screen, Control Center and Chrome's media controls show its title and poster (or, by a setting, only the cinema's name) and work the player as its own controls do. A **Playback help** link under the player shows what the browser is playing and can decode, and copies a summary with no addresses, names or titles in it, for a friend to send you when something won't play ([docs/access.md](docs/access.md#on-the-lock-screen))
- **Activity, retention and the projection booth**: Activity filters by film, person, ticket and kind, and **Show older** goes back as far as the records do; film and person pages count what was opened, played and finished. Progress reports, other events and signed-out browsers are deleted after times you set (by default 30 days, 12 months and 30 days), while tickets and screenings never are, so nothing a viewer can do changes. **Status** in the admin, the projection booth, shows what needs attention and whether the server is well ([docs/access.md](docs/access.md#how-long-its-kept))

## Running it locally

Needs Node 22.13 or later (it uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env        # set ADMIN_PASSWORD
npm run build               # build the web app into dist/
npm run dev                 # server on http://localhost:3000
```

To work on the web app with hot reload, run `npm run dev:web` alongside and use
http://localhost:5173. Vite serves the page itself there, without what the server on
:3000 writes into it: the page has Open Matte's own colours and tab icon rather than
the cinema's, no link-preview tags, and a header that waits for `/api/me` before
showing the cinema's name and logo.

Use `localhost`, not `127.0.0.1`: passkeys belong to a domain, and browsers won't use
them on an IP address. Locally they need no setting; on a server, see
[docs/deploying.md](docs/deploying.md#passkeys).

Put a film folder in `media/` (or make a test one with the encoder), open
http://localhost:3000/admin, scan, publish, and issue a ticket. Open the ticket
link in a private window to see it as a guest would.

```bash
npm test                    # access rules, scanner and the full ticket journey
npm run e2e                 # the main journeys in real browsers (Playwright)
```

`npm run e2e` needs ffmpeg (it makes two eight-second test films) and, for its `chrome`
project, Google Chrome (without it those journeys skip); the first time, `npx playwright
install chromium firefox webkit`. It starts its own server with its own data and a
password made for the run, and never touches `data/` or `media/`.

## Deploying

One container behind Caddy, which handles HTTPS. Choose `WEBAUTHN_RP_ID` before
inviting anyone. See [docs/deploying.md](docs/deploying.md).

## How access works

Tickets are bearer links, or work only for one person, signed in; pressing Play
starts a screening; media needs a screening this browser holds. People you add can
sign in with a passkey, created from a single-use link you send them. The details,
including what is recorded about viewers, are in [docs/access.md](docs/access.md).

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
