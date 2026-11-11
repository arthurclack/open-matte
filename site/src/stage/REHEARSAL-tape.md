# Rehearsal: the tape (the hero)

`TapeScene.tsx` and `tape.css`, built with the Stageshow kit copied into
`../stageshow-kit/`, shown in the hero's right column on the page's dark room.
Filmed from `/stage.html` (development only) with the skill's `scripts/film.mjs`;
the built site checked separately (end of this file).

Gold: `messages` (the thread, the typing dots growing into the reply, true iOS
bubbles at 17pt) and `phone-touch` (a phone pinned from the top running off the
bottom, a touch cursor, UIKit-quick in-app taps, the flick and throw). Started
from the 1.0 site's `TicketScene.tsx` and `ticket.css` (d781e01), copied and
changed, not rewritten: the same phone, chat app, built-in browser, flick (the
throw starts at the finger's speed), Play opening the player above the page
and scrolling to it, Done closing the browser over a reset made under it.

What changed from the 1.0 scene:

- The world is 1.1.0's video shop: The Lantern Room, Arthur, Dr. Strangelove on
  tape E-120, the staff pick, the label tape with its orange sticker, the blue
  PLAY tile and the PLAY screen, the player's bar as 1.1.0 draws it under
  Safari's own player for a film with a ladder of pictures (Picture and its
  menu on Auto, then Playback help).
- The page is 1.1.0 itself at the phone's 402 points, measured from the real
  app (the video-shop-look branch at 730f7ac, whose web app is the same as
  the v1.1.0 tag's apart from Settings, built and run with a mocked API in Playwright,
  the friend's film page for a tape for anyone with the link): every box,
  size and word placed where 1.1.0 puts it (`friend.css` under 768px,
  `objects.css`, `ui.css`). On a phone 1.1.0 gives Play the whole row and puts
  "1 play left" under it, unlike the design mock's still beside it.
- The printed things are baked from 1.1.0's own components at 3x on a
  transparent ground (`public/stage/tape-print-shop|sleeve|pick|label.webp`), so
  they carry the app's seeded grain, wear, hand, rub-down letters and ink, and
  the scene doesn't redraw them. The PLAY tile and the PLAY screen are live,
  from `objects.css` (VT323, the scanlines, the bloom, the press).
- The link preview has no picture: `server/page.js` sends og:image only for a
  film with artwork, and this one has a plain sleeve. So the chat app shows the
  preview on a panel of its own (title, "A tape from The Lantern Room.", the
  address) over the link itself, which wraps after the shop's address.
- The stage is the column: the phone fills its 392 (358) width, its top on
  the poster's top; no gutter of its own, since the page is the ground and
  the column's edges are the frame (from 75rem the Pause item and the phone's
  right edge line up with the bar's Install). It doesn't stop on a straight
  cut: the page fades its last 3rem into the room (`tape-place.css`), and the
  scene keeps that band to filler at every beat (Framing, below).
- The words under PLAY are 1.1.0's own (what pressing Play starts, what
  Arthur can see), not placeholder lines: real words next to the main
  control, as the 1.0 scene had beside its Play.
- Play opens the player with the PLAY screen only (no bar), as 1.1.0 does; the
  bar comes out from under the picture when the picture comes, carrying the
  page down (by transform), and its words fade in.
- The film runs: the title card fades up out of black, then its second line.

## Beats (from the script's waits; one loop about 15.6 s)

1. 0.5 s: Arthur is typing; at 2.0 s the dots grow into "I think you should
   watch this film."; at 2.7 s the link rises in with the thread.
2. about 4.0 s: a tap on the preview panel's empty right end (the finger off
   the words); the bubble lightens; the browser slides up (0.56 s, iOS's
   quick-off, long-settle curve) with the film's page at its top: the shop's
   bar, sleeve, title and details, the synopsis (lines), the staff pick, the
   tape and sticker, the top of the PLAY tile going into the page's fade.
3. about 5.8 s: a flick: the page follows the finger 200 points in 0.28 s,
   then is thrown on (0.64 s, a curve whose first slope is the finger's
   speed) to the staff pick, 20 points under the browser's bar: the pick, the
   tape, PLAY, "1 play left", what pressing Play starts, what Arthur can see,
   and the footer's rule in the fade. Holds 1 s.
4. about 8.3 s: Play. The tile presses (scale 0.97, the darker blue, 120 ms),
   dims while the play starts (0.2 s), and goes with its line (a 0.25 s fade);
   the player opens above in the same frames, the page's scroll taking it in;
   the page scrolls up to it (0.78 s), the PLAY screen on; it holds 0.56 s;
   then the picture: the PLAY screen gives way to black, the bar slides out
   from under it (0.5 s) with Picture and its menu on Auto, and Playback
   help; at 10.8 s the
   title card fades up (0.9 s); at 12.4 s its second line. Payoff holds to
   14.5 s.
5. about 14.5 s: Done; the browser slides down (0.42 s) onto the
   conversation, reset to its opening while the browser covered it; the next
   reply starts about 0.5 s after the browser has gone.

## Stills

From the scene itself (`info.stills`, `node site/tools/stills.mjs <stage.html> --only tape`),
in `public/stage/`, at 2x:

- `tape.webp` 392 x 684, `tape-compact.webp` 358 x 625: the story's still
  (reduced motion, no script, the picture's `<img>`): the link arrived. Chosen
  over the page at Play because it is the one frame that says the whole story
  by itself: Arthur's line, the film's name and year, the shop, the link. At
  Play the film's title is scrolled away (the crop shows 628 points of page,
  the last 52 to 57 under the fade, and the title and Play are 590 apart).
- `tape-start.webp`, `tape-start-compact.webp`: the opening frame (the
  question, no reply yet), shown until the scene draws, so nothing changes as
  it takes over.
- `tape-playing.webp` 392 x 526, `tape-playing-compact.webp` 358 x 480: the
  film playing in the phone, for the close: the player, its bar, and the
  film's page under them 112 points down, so the film's title sits clear of
  the close's 3rem fade and its details go into it.

## Sizes

Wide 392 x 684 from 75rem (the hero's 392 column), phone 392 wide (the screen
at 392/428 = 0.916, starting 13 points in). Compact 358 x 625 everywhere else
(below 380 of place: the 360 column from 64rem, and min(100%, 360px) under
it), phone 358 (0.836). Each height crops the screen 734 points down: 628
points of page under the browser's bar. At a 320 phone the compact stage is
drawn at 0.8.

## Framing

The page fades the stage's last 3rem into the room (`tape-place.css`, a mask
on the picture and the live layer; Pause is outside both): 52 points of the
screen wide, 57 compact, 72 at a 320 phone. What lies under it, beat by beat:

- The conversation: the pane ends 662 points down, so 72 points of empty
  chat (where the composer would be) lie under the newest bubble; the fade
  never reaches a bubble, at any width.
- The page as it opens: the fade starts 6 to 11 points under the tape's
  sticker and takes the top of the PLAY tile (it reads as the page going on).
- The flick's hold (the longest): PLAY, 1 play left, what pressing Play
  starts and what Arthur can see are clear; the fade holds the page's empty
  foot and the footer's hairline.
- The PLAY screen: the staff pick passes under the fade while the PLAY
  screen holds (0.56 s).
- The film playing: the title card, the bar and the film's title are clear;
  the fade takes the synopsis's last line and the pick's top edge.
- The close (`tape-playing*.webp`, the same 3rem): the film's title clear,
  its details and the sleeve's foot in the fade.

## Captured

- Widths: wide at its 392 slot (1280 viewport), compact at 390, and compact
  at 320. One look (the scene has only the dark one). Contact sheets of the
  whole loop at both widths (1 s), `--states` at both, and every beat stepped
  at 60 to 80 ms: the reply and link (390), the tap and the browser (wide),
  the flick (390), Play to the title card (wide), Done and the loop seam (390).
  Close-ups at 3x of the page's header and sleeve.
- The page itself (dev server and the built site): 1280, 1440, 1100 and 390,
  live; with no script and under reduced motion, the stills.
- The built site under `serve.mjs`'s production headers: `check-built.mjs` in
  Chromium, WebKit and Firefox: no CSP violations, no console errors, no
  third-party requests, no scene code by DOMContentLoaded, the tape scene wide
  at 1280 and compact at 390, nothing fetched under reduced motion, no script
  fetched with scripting off. The scene filmed on the built page in WebKit and
  Firefox at six moments (both draw it as Chromium does; Firefox wraps the link
  after "/t/" rather than after the address).

## Film

`film.mjs --gate` ends `rehearsal passed` on the wide and the compact loops
(re-filmed after the fixes of 10 November: the fade, the words under PLAY,
the bar with Picture's menu; contact sheets in the scratchpad's
`scenes/fix/film/`). The compact loop's old `loose stack` line ("Picture:
Auto" over Playback help) is gone with the menu.

Lines looked at and left standing:

- `hard edge`: the page's text crossing the browser's bar while the page
  scrolls: a scrolling page under a toolbar, drawn as a browser draws it.
- `jump` at play: the page element moves by the picture's height in the frame
  the player opens above it; what's on screen doesn't move (scroll anchoring).
  The jumps at done are the conversation's reset under the browser, unseen.
- Playback help's words start 12px right of Picture's: 1.1.0's own (its
  quiet small button keeps 12px of padding, `ui.css`), drawn as the app
  draws it. A one-line change in 1.1.0 (no inline padding on `.fl-bar >
  .fl-helpbtn`, its hit area kept by its `::before`) would line them up; the
  scene would follow it.

Fixed after filming: the chat's header (raised over its thread) drew over the
browser as it came up (a stacking context on the chat); a void above the
earliest messages at the opening (older messages added, and the thread now
softens under the header as iOS's scroll edge does, so a half-hidden line never
reads as cut); the finger landing on the preview's words (it taps the panel's
empty end now); the bar and the page under it jumping as the player opened (the
bar tucks under the picture at once, and only its letting down transitions);
the PLAY tile's and the page's text hopping where their transforms land (kept on
layers); the figure's browser-default margins pushing the place 40px in (now 0).

## Review

No second agent was available for the fresh-eye review; done here from the
frames with `review.md`'s questions and the 1.0 scene's stills beside these:

- What does the eye land on first? Arthur's reply and the link (the poster);
  the staff pick and the blue PLAY (the page); the title card (the payoff).
- Beside the 1.0 TicketScene: the same phone and chat; the link card is
  smaller (no picture, as 1.1.0 previews this film), the page far richer (the
  printed things, the blue screen), the payoff the same shape. Beside
  `phone-touch`: much darker, on purpose (the app's own room on the page's
  room); the colour is the pick's paper, the sticker and the blue screen.
- The synopsis is placeholder lines (the restraint rule: the shop's words
  for the film aren't settled; the design mock's are in `work/film.js`). The
  lines under Play were too, and read as a mock beside the main control at
  hero scale: they are 1.1.0's words now.

## Assumptions

- The chat app opens links in its own built-in browser (Done, the address) and
  shows a link without a picture as a panel over the link, as many do; its
  greys, back arrow, monogram and Done are neutral, no one app's. The system's
  own face (`-apple-system`), so on an Apple device it is San Francisco.
- The shop's address is lanternroom.example and the tape's link
  `https://lanternroom.example/t/k7mq3vxe9tbwp`, the code the back office's
  picture uses. The conversation's earlier messages and the question are the
  friend's and Arthur's own, not app text.
- Today is Tuesday 10 November 2026 at 20:14; the tape was lent for one play,
  start by Saturday 14 November (end of day), 7 days after the first play.
- After Play, 1.1.0's sticker becomes "Come back by" with the time and the
  counter's words change; both are out of view by then and the scene doesn't
  draw them.
- The PLAY screen shows about 1.3 s from the scroll's start (the app: 800 ms
  from the play's start, `PLAY_SCREEN_MS`, with the browser's own smooth
  scroll); the scroll is 0.78 s. Kept so it can be read; the README lists it.
- The player's bar: Picture with its select on Auto, then Playback help, as
  `Player.jsx` draws it on Safari's own player when more than one picture
  can be decoded (iOS 17.1 and later has `ManagedMediaSource`; the chat app's
  browser is Safari's). Measured from 1.1.0 in Playwright's WebKit at 402
  points with a three-picture film, `canPlayType` answering HLS and the
  media request left open so Safari's player stays (scratchpad
  `scenes/verify-truth/bar110.mjs`): the bar 116 tall, the select at x 82.8,
  283.2 x 44. Not seen on an iPhone. An in-app web view without
  `ManagedMediaSource`, or a film with one picture, shows "Picture: Auto".
- The start-by time under PLAY is the end of Arthur's Saturday (the back
  office stores 23:59:59.999 of the chosen day), in WebKit's en-GB: "Sat 14
  Nov at 23:59". Chromium writes "Sat 14 Nov, 23:59"; an iPhone not checked.
- The video's own controls (iOS draws them over the picture and hides them as
  it plays) aren't drawn: the picture is shown alone.
- The sleeve's typed label is set at 11px with 5px sides so "Strangelove" stays
  whole; 1.1.0 breaks it "Strangelov / e" at 96px (the README's first
  difference, now true of this scene).

## Unresolved

- At a 320 phone the scene is drawn at 0.8: the preview's address (13pt) and
  the chat's name (13.5pt) render at 8.7 and 9.1px, under the 10px floor.
- (Settled in integration: the close shows `tape-playing*.webp`, now 392 x
  526 and 358 x 480 by the still's `height`;
  `/img/app-film-page.webp` is removed; the printed things are baked by
  `tools/prints.mjs`, this scene's bake script moved into the repository.)

## Not checked

- A real iPhone or touch input; Safari itself (Playwright's WebKit only); frame
  pacing on the real page beyond the virtual clock and a few live shots.
- Light mode: the scene has none (the page is dark only).
- Scrolling away mid-loop and back on the built page (the kit resets an
  unfinished loop off screen); Pause and Play were exercised by
  `check-built.mjs` on the back office only.
- Forced colours and increased contrast on the live scene (the scene is a
  picture: `forced-color-adjust: none` on the live layer, from mount.css).
