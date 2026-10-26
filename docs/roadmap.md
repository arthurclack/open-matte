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

- People, and claiming a ticket into a person's account (an admin toggle per ticket)
- Passkey enrollment and sign-in; HTTPS with a stable WebAuthn relying-party ID
- Identity-enforced tickets, which require signing in as the assigned person,
  alongside today's bearer tickets; the admin chooses which kind to issue
- "Your tickets", plus films marked visible to members
- Recovery as an explicit admin action: single-use, short-lived enrollment and
  recovery links, with the option to revoke old passkeys and sessions

## Milestone 3: polish and public release

- Branding settings (colours, logo)
- Better audio and subtitle controls
- Playback compatibility testing across browsers and devices
- Installation, backup and upgrade documentation
- Refined activity views and retention controls for viewing data

## Later

- Upload tools and automated encoding
- AV1 renditions
- Collections
- Serving media straight from Caddy with forward auth, if Node becomes the bottleneck
