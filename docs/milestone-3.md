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

### Branding (3 November, as slice 1 started)

| Decision | Choice |
|---|---|
| Logo | **PNG, JPEG or WebP, at most 1 MB**, recognised by its bytes. No SVG: an SVG is a document that can carry script, and it would be served from the site's own origin. |
| Tab icon | **A separate, optional square icon.** Without one, the tab shows Open Matte's icon drawn in the cinema's colours. A wide logo makes a poor 16-pixel icon. |
| Colours | **An accent and a background**, the background still dark. The other surfaces (raised, sunk, lines) are worked out from the background. A colour is refused if text, status colours or the accent would be hard to read on it: the accent needs 4.5:1, because it's used for small text. No light theme. |
| Link previews | **A ticket link shows its film's poster and title.** Every other link shows the cinema's name and logo. The preview is fetched by the sender's phone or the messaging app's servers, so they learn which film was sent. |

Our own call, within that: a ticket **only one person can use** previews as the cinema,
not the film. A browser that isn't signed in as that person learns neither the film nor
the name ([access.md](access.md#two-kinds-of-ticket)), and a preview fetcher is such a
browser.

### Media Session and Playback help (3 November, as slice 3 started)

| Decision | Choice |
|---|---|
| Lock screen | **The film's title and poster by default**, on the lock screen, in Control Center and in Chrome's media controls. A setting in the admin switches every viewer to the cinema's name only, with no poster, for when the title is part of the surprise. |
| Playback help | **For everyone, behind a small link** under the player. When playback stops with an error, the player's message offers it too. |

Our own call, within that: the lock screen's controls work the same `<video>` as the
page, and are cleared when the player halts or closes, so a screening that has stopped
(taken over on another device, say) never leaves a Play button behind that would try
to restart it. The player's message offers help only when playback itself went wrong
(an error, a refusal, a browser that can't play the film), not when the ticket has
ended or another device has taken over.

### Proposed, to confirm as each slice starts

- **Remembered choices stay in the browser** (audio language, subtitle language or
  off, subtitle size). Nothing new is stored on the server, and a person's choice
  doesn't follow them to another device.

## Slices

Six slices. 1 to 4 can be built in any order; 5 runs on your devices as soon as 2 and 3
are deployed; 6 comes last.

### 1. Branding

- Settings gets **Branding**: an accent and a background colour, a logo and a tab icon,
  next to the cinema name that's there already. The admin page previews the colours as
  you pick them, and says why one is refused.
- The logo and icon are uploaded in the admin, checked by their first bytes and their
  size in pixels (not their name or the browser's say-so), and stored in
  `DATA_DIR/branding` under a name made from their hash, so they can be cached for good
  and a new one replaces the old cleanly. Backups copy them, as they copy artwork. The
  logo appears in the header of every viewer page, sign-in and setup included, with or
  without the name beside it.
- The colours, name, tab icon and logo are written into `index.html` as the server
  sends it, so the page never flashes Open Matte's amber before switching, and the
  header shows the name and logo without waiting for `/api/me`. The logo's image is
  requested with the page. The same step adds the link-preview tags (`og:title`,
  `og:image`).
- A ticket link for anyone previews its film: the title, and the poster from an
  address made for the preview (`/poster/<id>.<mac>`) that works without a session
  under the same rule as the preview, and only then. Reading either writes nothing: no
  session, no "opened", no event. Both are rate limited; over the limit the page is
  still served, as the cinema. The poster's address holds no ticket code and can fetch
  nothing but the poster, because some chat apps' image servers repeat image addresses
  and people copy them.
- Served with `X-Content-Type-Options: nosniff`, and only the three image types.
- No migration: everything lives in the settings table.

**Done when** a fresh cinema with a name, colours, a logo and an icon shows them on every
viewer page from the first paint; a ticket link's preview in a messaging app shows the
film's poster and title, and a ticket for one person's shows only the cinema; and
opening neither records anything.

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

- **Media Session**: the title and poster (or only the cinema's name, by the setting
  above) and position on the lock screen, in Control Center and in Chrome's media
  notification; play, pause and ±10 s from hardware keys and headphones, routed through
  the same `<video>` so heartbeats and the one-device rule see them. Cleared when the
  player closes or halts.
- The setting is **Show the film's title and poster on lock screens and media
  controls**, in Settings, on by default.
- **Playback help**: a small "Playback help" link under the player (and in the player's
  message when playback stops with an error) opens a panel with which player is
  running (Safari's own or hls.js), the current rendition, codec and dynamic range,
  whether this screen is HDR, buffer ahead, dropped frames, what this browser says it
  can decode, and the last ten errors with their time. **Copy summary** copies all of
  that as text, leaving out every address (they contain screening IDs), cookies,
  ticket labels, people's names, the film's title and the cinema's name.
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
- **Old browser sessions go too.** Today nothing deletes a session once it has expired
  or been signed out, so the table only grows. They're deleted a while after they end,
  with the tickets those browsers held; screenings and their counts don't change.
- **A test pins the rule** that deleting anything here never gives a ticket a screening
  back, nor reopens a "start by" deadline.
- access.md's **What is recorded** gains how long each thing is kept.
- **The projection booth**: an admin page, and a short summary at the top of the admin,
  answering what needs attention and whether the server is well. Setup links nobody has
  used; tickets close to their start-by date that haven't been played; media requests
  the server refused recently (Playback help sends nothing, so the server's own refusals
  are all it knows); whether the media folder is there and readable; disk space for
  the data and the media; the last backup and the off-server copy's age; when old
  events and sessions were last cleared; the version running. Each line says exactly
  what it checked: "Backup file written at 04:03", never "recovery verified", since
  nothing tests a restore automatically. It shows facts to act on, not a log of who
  watched what.
- Probably migration 7, for an index on events by film and person. Any migration
  means going back to milestone 2's code needs a restore, as before.

**Done when** deleting with the defaults on a copy of the production database removes
only events and ended sessions, every test still passes, the ticket and person pages
read the same before and after, and the projection booth answers each of its questions
on the live server.

### 5. Playback compatibility testing

The checks moved from milestone 2 and milestone 1's open ones, in
[device-checks.md](device-checks.md#for-milestone-3): a TV's own browser, desktop
Firefox, Chrome's hls.js playback on Mac and Windows, a non-HDR screen, keyboard only
in Mac Safari, and Android playback on mobile data. Each runs with slices 2 and 3
deployed, so it also tests remembered choices, Media Session and the help panel, and
a failure comes with a copied summary.

Alongside the devices, **browser tests with Playwright** (a development tool only, never
shipped to viewers): the main journeys run in Chromium, Firefox and WebKit on every
change. Opening a ticket and playing it, revoking it and seeing the next media request
refused, keeping a ticket, signing in and setting up a passkey (with Chromium's virtual
authenticator), and the important pages by keyboard alone. Playwright's own browsers may
lack H.264 and HEVC, so playback runs in installed Chrome where they do. These catch
regressions; they don't replace the iPhone, Mac Safari, TV and non-HDR checks.

What fails gets fixed in this slice, or written up as its own work if it's bigger
(an encoding change, say).

**Done when** every row in "Results: milestone 3" has a result, and the Playwright
journeys pass in all three browsers.

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
- **Licence notices for the code the site sends to browsers.** The built app includes
  hls.js (Apache 2.0), React, React Router and SimpleWebAuthn's browser part (MIT), and
  today carries none of their licence texts, which both licences require. The build
  collects the licence of every package that ends up in the bundle into one file served
  with the app, linked from the footer and the README. No new dependency.
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
- The player's own controls overlay, a light theme, colours beyond the accent and the
  background.
- Remembering choices on the server, per person.
- Everything under Later and Ideas in [roadmap.md](roadmap.md).
