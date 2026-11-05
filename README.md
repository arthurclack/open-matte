# Open Matte

A small, self-hosted cinema for recommending films to friends. You publish a handful
of films you think your friends should see, write a few lines on why, and send a
friend a ticket: a link that opens the film in their browser. You choose every film,
and nobody can sign up on their own.

> You should watch this film. Here's the link.

## What it isn't

It isn't a media server. There's no library of everything you own, and the server
never transcodes. You prepare streaming-ready versions of each film on your own
computer with the encoder, copy them to the server, and it sends those files as they
are. So the server needs little processing power. What matters is its disk space and
upload speed.

Nor is it copy protection: every request for a film is checked against a ticket, but
anyone who can play a film could record it.

Only share films you have the right to share.

## What you need

| | |
|---|---|
| A server | Linux with Docker and Docker Compose, a public IPv4 address, and ports 80 and 443 open. [docs/installing.md](docs/installing.md) is written for Ubuntu 26.04 or 24.04 LTS, and installs Docker for you. Disk for your films: a two-hour 4K HDR film with every rendition is up to about 38 GB, and one without a 4K source up to about 23 GB (17 GB without HDR), often much less. |
| Upload speed | Each viewer streams one rendition at a time. The encoder caps 4K at 16 Mbit/s and 1080p at 8 Mbit/s or less, plus 0.16 Mbit/s of stereo audio (0.4 for 5.1). So a stream runs at up to about 16.5 Mbit/s in 4K and 8.5 Mbit/s at 1080p, briefly a little more. Players only move up to a rendition when the connection has room to spare, so allow about half as much again for each viewer: about 25 Mbit/s for 4K, 13 at 1080p. One viewing of a two-hour film is up to about 15 GB in 4K or 7.5 GB at 1080p. Simple scenes use less. Viewers watching at the same time each need that much. On a slower connection, hls.js and Safari pick a lower rendition. If your host limits monthly traffic, count viewings against it. |
| A domain | A name whose DNS points at the server. Caddy, which runs alongside the app, gets the HTTPS certificate. Passkeys are tied to the domain for good, so pick one you'll keep. |
| Prepared films | Encoded on your computer with `scripts/encode.mjs`, which needs Node and `ffmpeg`, into one folder per film ([docs/encoding.md](docs/encoding.md), [docs/import-format.md](docs/import-format.md)). |
| Optionally | A TMDB API key, free for non-commercial use, to fill in film details and artwork ([docs/metadata.md](docs/metadata.md)), and somewhere off the server to copy backups to. |

What your friends need depends on the kind of ticket. The admin offers two: **Anyone
with the link**, and **Only a person, signed in**, which this page calls a ticket for
one person.

- **A browser.** A ticket for anyone with the link needs no account. Playback has been
  checked in Safari on iPhone and Mac (on the Mac by keyboard alone too), Chrome on a
  computer and on Android, desktop Firefox, WhatsApp's and Instagram's built-in
  browsers, a TV browser, AirPlay, Chromecast and a screen without HDR
  ([device checks](docs/history/device-checks.md)). TV browsers vary, so others may
  not work.
- **A passkey, only if you add them under People.** You'd do that to send them a
  ticket for one person, or to show them films before they have a ticket. They create
  the passkey from a link you send, and need no password. The only password is yours:
  you sign in to the admin with `ADMIN_PASSWORD`. Passkeys have been checked on iPhone, Mac,
  Android, Chrome signing in with a phone's QR code, and a password manager. TV
  browsers and apps' built-in browsers usually can't use them.

## What it does

- **Film pages** with the poster, details and your recommendation, and details and
  artwork from TMDB if you want them.
- **Tickets**, each for one film, with its own link. By default a ticket admits one: a
  single screening, whenever they like. You can allow more screenings, or leave the
  limit empty for no limit. You can also set a date to start watching by, and the days
  it stays valid after first play. Revoking one stops it on the next request.
- **Screenings**: pressing Play starts one. It can be paused and resumed for 48 hours
  by default (the resume window, in Settings), on one device at a time.
- **Protected media**: every playlist, segment and subtitle request is checked against
  the browser's ticket and the screening it holds.
- **Playback**: adaptive HLS, through hls.js or Safari's own player, in HEVC and H.264,
  with HDR10. Audio and subtitle choices are remembered in each browser, and the lock
  screen shows the film. A **Playback help** link gives a friend a summary to send you
  when something won't play.
- **People and passkeys**: tickets for one person; letting someone keep a ticket for
  anyone with the link in their account; films shown to members (the people you've
  added, signed in), who can read about a film but need a ticket to play it; recovery
  when someone loses a device.
- **Branding**: your cinema's name, colours, logo and tab icon. A ticket for anyone
  with the link previews its film's poster and title in chat apps.
- **The admin**: scan the media folder, publish, issue tickets, add people, see
  Activity, choose how long records are kept, and check on the server under
  **Status**.
- **Backups** every day, keeping the last 14 days and one a month for a year, with a
  timer to copy them off the server. A backup holds the database (films' details,
  tickets, screenings, activity, people, passkeys and the admin's settings), the
  posters and backdrops downloaded from TMDB, and your logo and tab icon, but not the films or `deploy/.env`.

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
server on :3000 sends. Before you deploy, run `npm run build` and check anything new
on http://localhost:3000, or run `npm run e2e`, which builds first.

Use `localhost`, not `127.0.0.1`: passkeys belong to a domain, and browsers won't use
them on an IP address. Locally they need no setting; on a server, see
[docs/installing.md](docs/installing.md).

Put a film folder in `media/` (or make a test one with the encoder), open
http://localhost:3000/admin, scan, publish, and issue a ticket. Open the ticket link
in a private window to see it as a friend would.

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
site/           the project website, openmatte.dev
media/          film folders for npm run dev (MEDIA_DIR), not in git
data/           npm run dev's database, images and backups (DATA_DIR), not in git
```

## Licence

Open Matte is released under the GNU General Public License, version 3 or (at your
option) any later version (`GPL-3.0-or-later`). See [LICENSE](LICENSE).

The GPL's conditions apply when you convey a copy, that is, pass it on. Your site
sends the built web app to every browser that opens it. That conveys it, so everyone
who gets it must be offered its source. The site's licences file,
`/third-party-licenses.txt`, linked from its footer, starts with Open Matte's
copyright and licence, and where that source is, from `repository` in `package.json`.
If you change the web app, publish your changed source and point `repository` at it.
Server code that only runs on your own server isn't conveyed, so the GPL doesn't make
you publish changes to it. Passing on the code itself, such as a copy of the
repository or a Docker image, does convey it.

`web/public/tmdb.svg` is TMDB's logo and trademark, included unchanged because TMDB's
terms require apps that use its data to show it. It isn't covered by the GPL.

### Third-party licences

The web app also includes other people's open-source code: hls.js (Apache License
2.0), and React, React Router and SimpleWebAuthn's browser library (MIT), among
others. The build puts the licence of every package that ends up in it into the same
file, including the small packages hls.js carries inside its own code, which
`vite.config.js` lists.

To read it locally, run `npm run build`. The file is then
`dist/third-party-licenses.txt`, and while `npm run dev` is running it's at
http://localhost:3000/third-party-licenses.txt. The hot-reload server on :5173 doesn't
make it.

The server's own dependencies, Express and SimpleWebAuthn's server library among
them, are never sent to browsers. Their licences are installed with them, in
`node_modules`.
