# Milestone 3: polish and public release

The plan for milestone 3, agreed on 3 November 2026. It starts from the tip of
`milestone-2` (commit 69f18b5, 306 tests passing), while milestone 2's own device checks
carry on alongside ([device-checks.md](device-checks.md#to-close-milestone-2)). As each
slice ships, its box in [roadmap.md](roadmap.md) gets ticked and what it built moves
into the docs that describe the app.

## What it's for

Someone who isn't you can install Open Matte from the docs alone, make it look like
their own cinema, and keep it running: update it, back it up, restore it. Friends get a
player that remembers their language, behaves on the lock screen, and can say what
went wrong when it doesn't play. Viewing data is kept only as long as it's useful.
Then it's tagged v1.0.0.

Nothing here changes who can watch what. Every rule in [access.md](access.md) stays as
it is.

## Decisions (3 November)

| Decision | Choice |
|---|---|
| Player controls | **Keep the browser's own controls.** AirPlay, picture-in-picture, fullscreen and the iPhone's player keep working as they do. The improvements go in the bar under the picture and in what the player chooses by itself. |
| Retention defaults | **Progress reports for 30 days; every other event for 12 months.** Both editable in Settings. Tickets, screenings, people and passkeys are never deleted by this. |
| Public release | **A v1.0.0 tag and a GitHub release.** Milestones 2 and 3 are merged into `main`, with a changelog, and installation, update and backup docs written for someone who isn't you. People build the image themselves, as you do now. No published image. |
| Player extras | **Media Session** and a **Playback help** panel join this milestone. Installing to the home screen stays an idea. |

### Proposed, to confirm as each slice starts

- **The logo is PNG, JPEG or WebP, at most 1 MB.** No SVG: an SVG is a document that
  can carry script, and it would be served from the site's own origin.
- **One accent colour**, refused if it's too close to the dark background to read
  (contrast below 3:1), with the text on accent buttons chosen automatically, dark or
  light. No light theme.
- **Remembered choices stay in the browser** (audio language, subtitle language or
  off, subtitle size). Nothing new is stored on the server, and a person's choice
  doesn't follow them to another device.
- **Media Session shows the film's title by default**, with a setting to show only
  the cinema's name instead.
- **Link previews show the cinema, never the film.** A ticket link pasted into
  WhatsApp or iMessage shows the cinema's name and logo. The preview is fetched by
  the messaging app's servers, so naming the film would tell them what was sent.

## Slices

Six slices. 1 to 4 can be built in any order; 5 runs on your devices as soon as 2 and 3
are deployed; 6 comes last.

### 1. Branding

- Settings gets **Branding**: an accent colour and a logo, next to the cinema name
  that's there already.
- The logo is uploaded in the admin, checked by its first bytes (not its name or the
  browser's say-so), and stored in `DATA_DIR/branding` under a name made from its
  hash, so it can be cached for good and a new one replaces it cleanly. Backups copy
  it, as they copy artwork. It appears in the header, on the sign-in and setup pages,
  and as the browser tab's icon (a default icon when there's none).
- The colour and name are written into `index.html` as the server sends it, so the
  page never flashes Open Matte's amber before switching. The same step adds the
  link-preview tags (`og:title`, `og:image`), the same for every address.
- Served with `X-Content-Type-Options: nosniff`, and only the three image types.
- No migration: everything lives in the settings table.

**Done when** a fresh cinema with a name, a colour and a logo shows them on every
viewer page from the first paint, and a ticket link's preview in a messaging app
shows the cinema and nothing about the film.

### 2. Audio and subtitles

- **Remembered choices.** The audio language and the subtitle language (or Off) you
  pick are kept in the browser and used for the next film, when that film has them.
  A film's own `default` subtitle still applies the first time.
- **Forced subtitles.** A track marked `forced` in `film.json` (foreign-language
  dialogue, signs) is shown when subtitles are Off and its language matches the audio
  you're hearing. The menu says so ("Off · signs and foreign dialogue shown").
  Choosing another audio language switches it with you.
- **Subtitle size and background**: Small, Medium, Large; a shadow or a box. Applied
  through `::cue`. iPhone fullscreen and AirPlay use the system's own caption style
  (Settings ▸ Accessibility ▸ Subtitles & Captioning), and the panel says so rather
  than pretending.
- **The bar and the player agree.** Choosing subtitles in Safari's or the iPhone's own
  menu updates the bar, and the other way round (`textTracks` change events), so the
  remembered choice is the one you actually made.
- **Clearer labels**: the audio menu shows the channel layout the encoder recorded
  ("English · 5.1"), and a film with one audio track and no subtitles shows no menus.

**Done when** on Mac Safari, iPhone Safari (inline and fullscreen) and Chrome: a
second film starts in the language chosen for the first; Test Pattern, given a forced
French track for the purpose, shows it with French audio and subtitles Off; and the
bar and the native menu never disagree.

### 3. Media Session and Playback help

- **Media Session**: the title (or only the cinema's name, by the setting above),
  poster and position on the lock screen, in Control Center and in Chrome's media
  notification; play, pause and ±10 s from hardware keys and headphones, routed through
  the same `<video>` so heartbeats and the one-device rule see them. Cleared when the
  player closes or halts.
- **Playback help**: a small "Playback help" link under the player opens a panel with
  which player is running (Safari's own or hls.js), the current rendition, codec and
  dynamic range, whether this screen is HDR, buffer ahead, dropped frames, what this
  browser says it can decode, and the last ten errors with their time. **Copy
  summary** copies all of that as text, leaving out every address (they contain
  screening IDs), cookies, ticket labels, names and the film's title.
- Reading the panel records nothing and sends nothing; it's all from the browser.

**Done when** the lock screen on iPhone and Chrome's media hub show the film and
control it, and a copied summary from each browser in slice 5 has no address, name or
title in it.

### 4. Activity and retention

- **Activity, filtered**: by film, person, ticket, and kind (viewing, or accounts and
  links), with **Show older** instead of today's last 300.
- **Summaries**: on a film's page, how many tickets, opened, started, finished; on a
  person's page, the films they've opened and finished. Built from tickets and
  screenings, so they survive the retention below.
- **Retention**: in Settings, how long to keep progress reports (30 days) and other
  events (12 months), with what deleting would remove right now. It runs daily, next
  to the backup, and on start. It deletes events only: screening limits, "finished",
  resume positions and first-opened times come from tickets and screenings, so nothing
  a viewer can do changes. The admin ticket list's "last activity" falls back to the
  screening when the event has gone.
- **Backups keep what they had.** Monthly backups hold up to a year of old events
  until they expire themselves; access.md and the backup docs say so.
- access.md's **What is recorded** gains how long each thing is kept.
- Probably migration 7, for an index on events by film and person. Any migration
  means going back to milestone 2's code needs a restore, as before.

**Done when** deleting with the defaults on a copy of the production database removes
only events, every test still passes, and the ticket and person pages read the same
before and after.

### 5. Playback compatibility testing

The checks moved from milestone 2 and milestone 1's open ones, in
[device-checks.md](device-checks.md#for-milestone-3): a TV's own browser, desktop
Firefox, Chrome's hls.js playback on Mac and Windows, a non-HDR screen, keyboard only
in Mac Safari, and Android playback on mobile data. Each runs with slices 2 and 3
deployed, so it also tests remembered choices, Media Session and the help panel, and
a failure comes with a copied summary.

What fails gets fixed in this slice, or written up as its own work if it's bigger
(an encoding change, say).

**Done when** every row in "Results: milestone 3" has a result.

### 6. Release documentation and v1.0.0

- **README** for someone deciding whether to run it: what it is and isn't, what you
  need (a server, a domain, prepared films), and where to start. Milestone history
  moves to the changelog.
- **Installing** (a rewrite of deploying.md's first part): a fresh server to a working
  cinema, including the choices that can't be undone (`WEBAUTHN_RP_ID`), DNS, the
  firewall and the first film.
- **Updating**: per-version notes in the changelog ("needs a backup first", "can't go
  back without a restore"), instead of steps that name your commits and tags.
- **Backups and restoring**, **Rolling back** and **Moving to a new server**, checked
  by doing each once.
- **Removing it**, and what's left behind.
- `CHANGELOG.md`, `SECURITY.md` (how to report a problem privately), the version in
  `package.json` shown in the admin, and `.env.example` reviewed.
- Your own setup (the VPS, Cloudflare, the home DNS block) stays out of the public
  docs, except as examples.
- **A rehearsal**: a fresh install on a clean machine from the docs alone, with
  nothing from your setup, and every place the docs had to be guessed fixed.
- Then: milestone 2 closed, `milestone-2` and `milestone-3` merged into `main`,
  `v1.0.0` tagged, and a GitHub release whose notes come from the changelog. Each of
  these is a push to a public repository, so each waits for your go-ahead.

**Done when** the rehearsal runs from an empty server to a played ticket with nothing
but the docs, and v1.0.0 is on GitHub.

## Out of this milestone

- A published container image, and a release workflow to build it.
- Installing to the home screen (a service worker, an offline message).
- The player's own controls overlay, a light theme, more than one accent colour.
- Remembering choices on the server, per person.
- Everything under Later and Ideas in [roadmap.md](roadmap.md).
