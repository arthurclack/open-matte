# Roadmap

## Milestone 1: ticketed playback (complete)

Import one prepared film → publish it → issue a ticket → open it in another
browser → play and seek → revoke the ticket → confirm further media requests fail.

Verified on a live deployment: the journey above end to end, Safari on Mac and
iPhone (including HDR10 on iPhone, and the fallback when iPhone Safari's own
player gives up), Chromium-based browsers, and hls.js quality switching between
HEVC and H.264. Not tried then: Android, smart TVs and AirPlay, Firefox on
desktop, and how the tone-mapped SDR renditions look on a non-HDR screen. These
moved on later: Android and AirPlay to milestone 2's device checks, a TV browser,
desktop Firefox and a non-HDR screen to milestone 3's.

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

## Milestone 2: people and passkeys (complete)

Planned in [history/milestone-2.md](history/milestone-2.md) and built in six slices,
all deployed, and checked on real devices
([history/device-checks.md](history/device-checks.md)).

- [x] People, passkey setup and sign-in, with the relying party set once
  (`WEBAUTHN_RP_ID`)
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
- [x] Signing in and playing on iPhone and Mac Safari
- [x] Device checks that close the milestone
  ([history/device-checks.md](history/device-checks.md#to-close-milestone-2)):
  keeping a ticket and signing out on Safari; signing in with the phone's QR code;
  Android; a password manager; WhatsApp and Instagram's browsers; AirPlay and
  Chromecast
- [x] Other names, such as the bare domain, redirect to the cinema's (`REDIRECT_FROM`)

## Milestone 3: polish and public release (complete)

Planned in [history/milestone-3.md](history/milestone-3.md), in six slices, ending in
v1.0.0. All six slices are merged: slices 5 and 6 built the Playwright journeys, the
documentation, the changelog and the licence notices. The device checks are done,
the install guide has been rehearsed on a clean server, with the films on network
storage, and v1.0.0 is released.

- [x] Branding: accent and background colours, a logo and a tab icon, from the first
  paint; ticket links that preview their film's poster
- [x] Audio and subtitles: remembered choices, forced subtitles, subtitle size and
  background, the bar and the native menus in agreement
- [x] Media Session on the lock screen, and a Playback help panel with a copyable
  summary
- [x] Activity filters and summaries, and retention: progress reports for 30 days,
  other events for 12 months, ended browser sessions cleared; a "projection booth" page
  saying what needs attention and whether the server is well
- [x] Playback compatibility testing, starting with the checks moved here from
  milestone 2: a TV browser, desktop Firefox, Chrome's hls.js playback, a non-HDR
  screen and keyboard only in Safari
  ([history/device-checks.md](history/device-checks.md#for-milestone-3)); the main
  journeys as Playwright tests in Chromium, Firefox and WebKit
- [x] Installation, update, backup and restore documentation, rehearsed on a clean
  server; a changelog; licence notices for the code sent to browsers; v1.0.0 tagged and
  released on GitHub

## Version 2: one tape, one borrower

Agreed on 2026-11-05, planned in [version-2.md](version-2.md) on 2026-11-11, and
built there slice by slice for 2.0.0. Open Matte becomes a small video shelf for lending films to
friends: you choose a film, write a note for one person, and lend it. Each film is one
tape, and only one person can have it out at a time. It's 2.0, not 1.x, because two
people can no longer watch the same film at once.

How a loan works:

- Links are sent freely, several for one film if you like. Sending a link doesn't take
  the tape.
- Pressing Play takes it, if it's in. Checking that it's free and taking it
  happen in one step, so two people can't take it at once.
- From then on the borrower has a set time to watch, shown as the date it's due back.
- While it's out, anyone else with a link sees "Out on loan" and the date it's due back,
  never who has it, and can't press Play.
- It comes back when the time runs out, when the borrower returns it early, or when you
  take it back.

In 2.0:

- [x] Loans: one tape per film, taken on the first Play, due back after a set time
- [x] The note on the tape. From milestone 4:
  - Picked for you: your message to one person about one film, kept apart from your
    general note about the film, so editing one never changes the other. (For one
    film; programmes are still milestone 4's.)
- [x] Handing it back, while the tape is out, for signed-in friends only, on a link for
  them alone (anyone a link was forwarded to could write one). From milestone 4:
  - A private response ("Loved it", "Still thinking about it", "Not for me", "Let's
    talk") with an optional message, shared only with you, and saying so
- [x] On your card: what you have out and when it's due back, and continue watching
  (the first part of milestone 4's warmer front page)
- [x] The video shop look, across the app (1.1.0) and then the website

Decided, from [version-2.md](version-2.md#decisions):

- Two links for one film: first to press Play gets it, and the back office warns, and
  only warns, when you send a link for a film that is out or already has links
  waiting. One member may have two links for one film: the second waits, and lends
  once the first is back
- A link lends once: it is spent when its tape comes back. There are no play limits:
  the borrower watches as often as they like until it's due back
- One clock: the time to come back and "valid for N days after first play" became one
  due-back date, 3 days by default and chosen for each link when you send it, from 1
  to 30. You can move it, earlier or later, while the tape is out
- Start-by dates don't count down while the tape is out with someone else: the time is
  given back once it's in, to the minute
- Finishing the film keeps the tape until it's due back, so a scene can be watched
  again, with "Return it now" at the end
- A friend can hand a tape back with a response at any time while they have it, not
  after it has gone back on its own
- A link can't change hands while it has the tape: keeping, giving, letting anyone use
  it and Sign out browsers all wait until it's back
- A tape out to a browser on a link anyone can use goes back when that browser is
  signed out, and a member's when their card is turned off. Taking a tape back cancels
  the member's other waiting links for that film
- Members see whether a film on the shelf for members is in, and when it's due back,
  never who has it
- Upgrading: of several people part-way through one film, one keeps the tape, the one
  playing now, else the one heard from last; the others' links lend once when it's
  back. A link part-way through keeps the tape for that play only. The 2.0.0 changelog
  has the rest, and `scripts/upgrade-preview.mjs` says what the upgrade will do to a
  shop before it's done

Still later, from [version-2.md](version-2.md#out-of-20): a page of its own for a tape
taken back, a loan length per film, responses after a tape goes back on its own, a tape
that moves with its link when the link is kept or given, and keeping the name behind a
browser's loan after its session is gone.

After 2.0, as 2.x releases, moved from milestone 4. Before and after notes are the
note in the sleeve, best watched blind is a plain unlabelled tape (the due-back date
stays visible too), an answer to "Pick something for me" is a loan, and the journal is
the tapes on your card:

- Before and after notes: a spoiler-free note before, and a note for after (your reading,
  a favourite moment, a question) opened when the viewer chooses to. Never unlocked by
  how much has played, and opening it isn't the same as marking the film watched
- Best watched blind: a recommendation or a member's own choice can hide the synopsis,
  stills and your more revealing notes until the viewer chooses to see them. Access
  details and content notes always stay visible
- Asking for a recommendation: a member sends "Pick something for me", with an optional
  note ("nothing too heavy", "I have 100 minutes"). It waits in an admin inbox, marked
  unread, and you answer with a film and a message. No email or notifications at first
- A viewing journal that belongs to the member: watched films, an optional date,
  private notes, a "watch again" list, marked and unmarked by hand

Later, maybe version 3: two people on the same film at the same time, only as a live
watch-along with playback kept in step. This replaces milestone 4's rule against
synchronised watch parties.

## Milestone 4: curation

Agreed as the next milestone, not yet planned in detail. Milestone 1 delivers the
film, milestone 2 remembers the person, milestone 4 makes the recommendation personal.
It comes after the v1.0.0 release. Version 2 has taken over part of it (see above):
"Picked for you", the private response and the first part of the front page are in
2.0; the before and after notes, best watched blind, asking for a recommendation and
the journal come as 2.x releases. What's left still needs fitting around one tape:
programmes especially, since a programme sent to several people has them taking turns
with the same tapes.

- Programmes: a named, ordered set of films with your introduction, a cover, a note for
  each film, optional suggested dates, draft and published. Shown to every member, or to
  the people you choose. Double bills and short seasons are programmes
- A warmer front page for members: continue watching, picked for you, your programmes,
  your other films, and what you've watched behind a link
- Readiness before a programme goes out: artwork and media there, each recipient able
  to play each film, no ticket expiring before a suggested date, subtitles in the
  languages they need, no draft note showing. And "Preview as this person": a read-only
  view built from their rules, never their session
- Preferences that follow a member rather than a browser: audio and subtitle language,
  subtitles on by default, content notes shown before Play. Advisories are yours to
  write, not guessed; "warn me" and "hide this film" are different choices
- Letterboxd, through links and files only: no API, no scraping, never a Letterboxd
  password. "View on Letterboxd" from a film's TMDB id, a setting you switch on; a member
  can export the films they marked watched (never ones they only pressed Play on, and
  their private notes only if they choose) as a file Letterboxd imports; and a programme
  can be exported as a Letterboxd list, with your notes on each film. Check Letterboxd's
  link format and import columns before building

What stays true throughout:

- Presentation never grants playback. Someone can see a programme yet have no ticket
  for some of its films; the admin says so ("Alex can't play two of these films") and
  you choose whether to issue tickets.
- Resume position, "watched" and permission to play are three different things. A film
  in someone's journal never gives them access back.
- Each has its own check: seeing a programme, reading a note, playing a film. Being able
  to watch a film never shows someone else's recommendation, response or journal.
- Out of it: public reviews, ratings, followers, likes, activity feeds, recommendation
  algorithms, timed commentary. Synchronised watch parties were here too; a live
  watch-along is now a possible version 3 (see version 2).

## Later

- Upload tools and automated encoding: upload an original in the admin (resumable),
  inspect it, encode it in the background with the existing recipe in a separate worker,
  preview, then publish. Its own milestone; it needs a film's identity separated from
  its folder name, and a benchmark on the server first
- AV1 renditions
- Serving media straight from Caddy with forward auth, if Node becomes the bottleneck
- Deleting or erasing a person: their passkeys, sessions, links and events removed or
  anonymised and their tickets revoked, in one go. Today you disable someone instead,
  and milestone 3's retention never deletes people

## Ideas

Things to consider once people and passkeys exist. None of them grants playback on its
own: a programme, a note or a collection is presentation, and watching still needs a
ticket. Programmes are now milestone 4; after-notes, responses and the journal are
version 2.

- A "surprise me" ticket that hides the title until the viewer reveals it, while the
  running time, content notes, limits and expiry stay visible
- Tickets as small invitation cards: a message, the film shown or hidden, a suggested
  evening, a printable version
- Pairing a TV by approving a short code on a signed-in phone, without using a screening
- Screening nights: a shared page, a start time and an introduction, with everyone
  watching on their own ticket (not synchronised). With one tape per film, this only
  works across different films, or as version 3's watch-along
- A short test clip to check picture, sound and subtitles before the first Play, which
  never uses a screening
- "Start now, finishes around 10:42": the end time from the running time, and an
  optional "I'd like to finish by 11" that highlights the films that fit. An estimate,
  never a promise
- "What kind of evening?": a choice of time and mood (comforting, tense, surprise me)
  from a small vocabulary of your own, over the films that person can watch. Worth it
  once there are dozens of films; with a handful, the front page does the job
- A short introduction from you, audio or video, before a film or a programme: played
  only when asked, skippable, with a transcript. Needs media other than films, so after
  uploads
- "Watching with…": another member, who agrees, or "with guests", so the film goes in
  both journals from one screening. Never a ticket or access for the companion. After
  the journal
- Importing a member's Letterboxd history (watched films, a watchlist), so you can see
  whether someone has already seen a film before picking it. Opt-in and plain about it:
  it puts their whole history on a server you run and can read, most of it films the
  cinema doesn't have. Never their ratings. Following their public Letterboxd feed only
  if importing proves useful first
- Programme templates other installations can import: the title, introduction, film
  identifiers (TMDB) and, if you choose, your notes, matched against the films they
  have. Never media, tickets or people

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
