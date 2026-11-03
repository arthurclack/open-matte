# Roadmap

## Milestone 1: ticketed playback (complete, October 2026)

Import one prepared film → publish it → issue a ticket → open it in another
browser → play and seek → revoke the ticket → confirm further media requests fail.

Verified on a live deployment: the journey above end to end, Safari on Mac and
iPhone (including HDR10 on iPhone, and the fallback when iPhone Safari's own
player gives up), Chromium-based browsers, and hls.js quality switching between
HEVC and H.264. Not yet tried: Android, smart TVs and AirPlay, Firefox on
desktop, and how the tone-mapped SDR renditions look on a non-HDR screen.

- [x] Application skeleton, SQLite database on a persistent volume
- [x] Admin login (password from the environment)
- [x] Folder scan and film import from `film.json`
- [x] Publish and unpublish
- [x] Ticket creation and redemption
- [x] Protected HLS playback
- [x] Screening limits, start-by deadline, expiry after first play, 48-hour resume
- [x] Opened, play, heartbeat and finished tracking
- [x] Container deployment behind Caddy

## Added since milestone 1

- [x] Film information and artwork from TMDB: matched on import when the match is
  certain, or chosen by hand; downloaded to the server ([metadata.md](metadata.md))
- [x] Title and year guessed from release-style file names, in the encoder and before searching
- [x] The encoder adds a 5.1 audio track when the source has surround
- [x] Daily database backups with retention, a Back up now button, a restore guide, and an off-server copy timer

## Milestone 2: people and passkeys

Planned in [milestone-2.md](milestone-2.md) and built in six slices, all deployed by
27 October 2026. What's left is checking it on real devices
([device-checks.md](device-checks.md)).

- [x] People, passkey setup and sign-in, with `openmatte.dev` as the relying party
- [x] Recovery as an explicit admin action: single-use, short-lived setup and recovery
  links, with Reset after loss to remove old passkeys and sessions
- [x] Tickets only one person can use, signed in, alongside tickets for anyone with
  the link; the admin chooses which kind to issue
- [x] "Your tickets" on every device a person signs in on
- [x] Keeping a ticket in an account (a per-ticket "Let them keep it"), and giving or
  releasing it from the admin
- [x] Films shown to members: listed and readable, never playable without a ticket
- [x] An account page: passkeys, signed-in browsers, Sign out everywhere
- [x] Keyboard only (Chromium): Play, pausing, the name menu
- [x] Signing in and playing on iPhone and Mac Safari (27 October)
- [ ] Device checks that close the milestone ([device-checks.md](device-checks.md#to-close-milestone-2)):
  keeping a ticket and signing out on Safari; signing in with the phone's QR code;
  Android; a password manager; WhatsApp and Instagram's browsers; AirPlay and
  Chromecast
- [x] The bare `openmatte.dev` redirects to `www` (`REDIRECT_FROM`, 27 October)

## Milestone 3: polish and public release

Planned in [milestone-3.md](milestone-3.md) (3 November), in six slices, ending in
v1.0.0.

- [ ] Branding: an accent colour and a logo, from the first paint, and link previews
  that show the cinema, never the film
- [ ] Audio and subtitles: remembered choices, forced subtitles, subtitle size and
  background, the bar and the native menus in agreement
- [ ] Media Session on the lock screen, and a Playback help panel with a copyable
  summary
- [ ] Activity filters and summaries, and retention: progress reports for 30 days,
  other events for 12 months
- [ ] Playback compatibility testing, starting with the checks moved here from
  milestone 2 on 1 November: a TV browser, desktop Firefox, Chrome's hls.js playback,
  a non-HDR screen and keyboard only in Safari
  ([device-checks.md](device-checks.md#for-milestone-3))
- [ ] Installation, update, backup and restore documentation, rehearsed on a clean
  server; a changelog; v1.0.0 tagged and released on GitHub

## Later

- Upload tools and automated encoding: upload an original in the admin (resumable),
  inspect it, encode it in the background with the existing recipe in a separate worker,
  preview, then publish. Its own milestone; it needs a film's identity separated from
  its folder name, and a benchmark on the server first
- AV1 renditions
- Collections
- Serving media straight from Caddy with forward auth, if Node becomes the bottleneck

## Ideas

Things to consider once people and passkeys exist. None of them grants playback on its
own: a programme, a note or a collection is presentation, and watching still needs a
ticket.

- A personal programme for each friend: "Start with this one, then these two", with a
  note for each film
- A sealed note for after the film, opened when the viewer says they've finished (not
  tied to the 92% "finished" event), with an optional question back
- Double bills and short seasons, curated by hand
- A "surprise me" ticket that hides the title until the viewer reveals it, while the
  running time, content notes, limits and expiry stay visible
- A private response after watching ("Loved that", "Still thinking about it", "Not for
  me", "Let's talk") with an optional sentence; no stars or reviews
- Tickets as small invitation cards: a message, the film shown or hidden, a suggested
  evening, a printable version
- Pairing a TV by approving a short code on a signed-in phone, without using a screening
- Screening nights: a shared page, a start time and an introduction, with everyone
  watching on their own ticket (not synchronised)
- A private viewing journal for members, which never implies they can still play a film
- A short test clip to check picture, sound and subtitles before the first Play, which
  never uses a screening

Browser features that would make the player feel native (most fit milestone 3's
playback work):

- Media Session (in milestone 3): title, poster and position on the lock screen and in media
  notifications, and hardware play/pause keys, routed through the player's own
  controls. Showing the title outside the page should be optional (and off for
  "surprise me" tickets)
- Media Capabilities: hls.js already uses it to skip renditions a device can't
  decode; the next step is preferring power-efficient ones and saying so ("Recommended
  for this device: 1080p H.264"). Safari's own player doesn't go through hls.js
- View transitions: a poster growing into the film page and back, short, honouring
  reduced motion (React Router can drive these)
- Installable: a home-screen icon, an app-like launch and an offline message. A
  service worker must never cache `/api`, `/media`, `/t/` or `/enroll`: tickets and
  revocation depend on every request reaching the server. No offline films
- An optional ambient glow sampled from the picture (infrequently, small, off by
  default, with a pure-black mode), benchmarked on phones first
- Listening aids through Web Audio (a dialogue preset, a late-night preset), tested
  carefully: iPhone Safari's own HLS player and Web Audio have a history of silence
- A "Playback help" panel (in milestone 3): stream, codec, buffer, recent errors, and a copyable
  summary that leaves out ticket links, cookies and names
