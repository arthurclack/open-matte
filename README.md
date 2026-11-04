# Open Matte

A small, self-hosted cinema for recommending films to friends. You publish a handful
of films you think people should see, write a few lines on why, and send a friend a
ticket: a link that opens the film in their browser.

> You should watch this film. Here's the link.

## What it is, and what it isn't

Open Matte is a small personal cinema you run on your own server, for people you
know. You choose every film, and nobody can sign up on their own.

It isn't a media server. There's no library of everything you own, and the server
never transcodes. You prepare streaming-ready versions of each film on your own
computer with the encoder, copy them to the server, and it sends those files as they
are. So playback doesn't depend on your home upload speed, and a small server copes.

It isn't DRM either. The aim is "private enough for friends": every media request is
checked against a ticket, but someone who can play a film could record it.

Only share films you have the right to share.

## What you need

| | |
|---|---|
| A server | Linux with Docker and Docker Compose, a public IPv4 address, and ports 80 and 443 open. [docs/installing.md](docs/installing.md) is written for Ubuntu 26.04 or 24.04 LTS, and installs Docker for you. Disk for your films: a two-hour 4K HDR film with every rendition is about 50 GB, one without a 4K source 8 to 15 GB. |
| A domain | A name whose DNS points at the server. Caddy, which runs alongside the app, gets the HTTPS certificate. Passkeys are tied to the domain for good, so pick one you'll keep. |
| Prepared films | Encoded on your computer with `scripts/encode.mjs`, which needs Node and `ffmpeg`, into one folder per film ([docs/encoding.md](docs/encoding.md), [docs/import-format.md](docs/import-format.md)). |
| Optionally | A TMDB API key, to fill in film details and artwork ([docs/metadata.md](docs/metadata.md)), and somewhere off the server to copy backups to. |

What your friends need:

- **A browser.** A ticket for anyone with the link works in any current browser,
  phones, TVs and apps' built-in browsers included, with no account.
- **A passkey, only if you give them an account.** You'd do that to send tickets only
  they can use, or to show them films before they have a ticket. They create the
  passkey from a link you send, and there's no password. TV browsers and apps'
  built-in browsers usually can't use passkeys.

## What it does

- **Film pages** with the poster, details and your recommendation, and details and
  artwork from TMDB if you want them.
- **Tickets**: an "admit one" link per film, with an optional screening limit,
  start-by date and number of days after first play. Revoking one stops it on the next
  request.
- **Screenings**: pressing Play starts one. It can be paused and resumed for 48 hours,
  on one device at a time.
- **Protected media**: every playlist, segment and subtitle request is checked against
  the browser's ticket and the screening it holds.
- **Playback**: adaptive HLS, through hls.js or Safari's own player, in HEVC and H.264,
  with HDR10. Audio and subtitle choices are remembered in each browser, and the lock
  screen shows the film. A **Playback help** link gives a friend a summary to send you
  when something won't play.
- **People and passkeys**: tickets only one person can use, signed in; letting someone
  keep a link ticket in their account; films shown to members; recovery when someone
  loses a device.
- **Branding**: your cinema's name, colours, logo and tab icon. A ticket link for
  anyone shows its film's poster and title in chat apps.
- **The admin**: scan the media folder, publish, issue tickets, add people, see
  Activity, choose how long records are kept, and check on the server under
  **Status**.
- **Backups** every day, keeping the last 14 days and one a month for a year, with a
  timer to copy them off the server.

[docs/access.md](docs/access.md) has the rules: who can play what, and what is
recorded about viewers and for how long.

## Where to start

[docs/installing.md](docs/installing.md) takes you from a fresh server to a working
cinema and a played ticket. Before you update, read [CHANGELOG.md](CHANGELOG.md): each
release says whether it needs a backup first, and whether you can go back without a
restore.

To report a security problem, see [SECURITY.md](SECURITY.md).

## Running it locally

Needs Node 22.13 or later (it uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env        # set ADMIN_PASSWORD
npm run build               # build the web app into dist/
npm run dev                 # server on http://localhost:3000
```

The project's `.npmrc` stops packages running install scripts. None of them needs
one, and it means a compromised release can't run its code as you just by being
installed.

To work on the web app with hot reload, run `npm run dev:web` alongside and use
http://localhost:5173. Vite serves the page itself there, without what the server on
:3000 writes into it: the page has Open Matte's own colours and tab icon rather than
the cinema's, no link-preview tags, a header that waits for `/api/me` before
showing the cinema's name and logo, and no Content-Security-Policy, which only the
server on :3000 sends. Check anything new against it there, or with `npm run e2e`,
before you deploy.

Use `localhost`, not `127.0.0.1`: passkeys belong to a domain, and browsers won't use
them on an IP address. Locally they need no setting; on a server, see
[docs/installing.md](docs/installing.md).

Put a film folder in `media/` (or make a test one with the encoder), open
http://localhost:3000/admin, scan, publish, and issue a ticket. Open the ticket link
in a private window to see it as a guest would.

```bash
npm test                    # access rules, passkeys, scanner, retention and the full ticket journey
npm run e2e                 # the main journeys in real browsers (Playwright)
```

The tests start servers of their own, with temporary folders and in-memory
databases, so they don't need `npm run dev` and never touch `data/` or `media/`.

`npm run e2e` needs ffmpeg (it makes two eight-second test films) and, for its `chrome`
project, Google Chrome (without it those journeys skip); the first time, `npx playwright
install chromium firefox webkit`. It starts its own server with its own data, a
password made for the run and a stand-in for TMDB, and never touches `data/` or
`media/`. A journey fails if any of its pages throws an error, or has anything blocked
by the pages' Content-Security-Policy.

## Layout

```text
server/         Express app: access rules, passkeys, scanner, routes, SQLite
web/            React app: viewer pages, player, admin
scripts/        encode.mjs (reference encoder), deploy.sh (copy to a server over SSH)
deploy/         Docker Compose, Caddy and the backup-copy timer
docs/           installing, running and updating, access rules, import format,
                encoding, film information, and the roadmap
docs/history/   the project's own build record: milestone plans and device checks
test/           node:test suites
```

## Licence

Open Matte is released under the GNU General Public License, version 3 or (at your
option) any later version (`GPL-3.0-or-later`). See [LICENSE](LICENSE).

The web app the site sends to browsers is Open Matte's own code too, and the GPL gives
everyone who receives it the right to its source. The licences file below starts by
saying where that is, from `repository` in `package.json`. If you run a changed copy,
publish your changes and point `repository` at them.

### Third-party licences

The web app the site sends to browsers includes other people's open-source code:
hls.js (Apache License 2.0), and React, React Router and SimpleWebAuthn's browser
library (MIT), among others. The build collects the licence of every package that
ends up in it into one file, served with the app at `/third-party-licenses.txt` and
linked from the site's footer. hls.js carries a few small packages inside its own
code (parts of the Common Media Library, eventemitter3 and url-toolkit), so
`vite.config.js` lists those, and the file has their licences too.

To read it locally, run `npm run build`. The file is then
`dist/third-party-licenses.txt`, and while `npm run dev` is running it's at
http://localhost:3000/third-party-licenses.txt. The hot-reload server on :5173 doesn't
make it.

The server's own dependencies, Express and SimpleWebAuthn's server library among
them, are never sent to browsers. Their licences are installed with them, in
`node_modules`.
