# Rehearsal: the ticket (hero) and Send a ticket (admin)

Two scenes of the real Open Matte app, built with the Stageshow kit copied into
`../stageshow-kit/`, shown on the website's red-room ground. Filmed from
`/stage.html` (development only) with the skill's `scripts/film.mjs`; the built
site checked separately (end of this file).

## TicketScene: "the ticket", a phone

Gold: `messages` (thread, typing growing into the reply, true iOS bubbles) and
`phone-touch` (a phone pinned a gutter from the top, centred, off the bottom; a
touch cursor; in-app taps). Kept: the kit's `Phone`, `Thread`, `Bubble`,
`Stamp` and touch cursor, the phone pinned from the top running about 27% off
the bottom, phone-touch's flick-and-throw (the throw starts at the finger's
speed). Changed: the whole phone is dark (a chat app in neutral greys, no one
platform's colours, then the app's own near-black page), the conversation is
pinned to an unseen composer a gutter above the crop, and the screen-to-screen
move is the chat app's built-in browser sliding up (Expand would have folded
the page back into the card on the loop, a navigation played backwards).

Beats (times from the script's waits, approximate), loop about 14.7s:
1. 0.5s: Ellis is typing; the dots grow into "You should watch this film.
   Here’s the link." (2.0s: the bubble is shown from the dots' size and opens
   to its own on the thread's curve, as the rows above glide up), then the
   link's preview rises in from below with the thread (2.7s: Sherlock Jr.
   (1924) / A ticket from Back Row. / backrow.example).
2. 3.8s: a tap on the preview; the built-in browser slides up with the film's
   page (Back Row, the placeholder poster, Sherlock Jr.).
3. 5.8s: a flick up the page; it follows the finger, then carries on and
   settles on the ticket: "Admit one · Sherlock Jr.", "1 screening left on this
   ticket.", the 48-hour line, "Once you start, the ticket lasts 7 days.", ▶ Play.
4. 8.7s: Play. The button fades (its whole 0.25s, the page holding still),
   then the player opens above the film (the page holds its place, as scroll
   anchoring does) and the page scrolls up to it, as the app's scrollIntoView
   does; the film's title card fades up; the player bar shows Quality: Auto and
   Playback help. Payoff holds 2.9s.
5. 13.5s: Done; the browser slides down onto the conversation, which was put
   back to its opening while the browser covered it (the visible cause).

Poster (reduced motion, no script, the page's still): the link arrived, Ellis's
reply and its preview under Sam's question, the object the hero is about. Two
more stills come from the same scene (`still` prop, development preview only):
`start`, the opening frame, which the page shows until the live scene draws so
nothing changes as it takes over, and `playing`, the title card in the player,
the close's picture and og.png's.

Wide 540 x 700 (hero column), the phone at its true size (428: 402 points of
screen and the frame) at a 56px gutter; the page never draws it past 1:1 (its
column tops out at 540). Compact 358 x 500 below 480 (phone column), phone 326
at a 16px gutter, its smallest type stepped up (name, admit label,
recommendation label) so nothing renders under 10px. The earlier messages are
words, all Ellis's and from yesterday (a "Yesterday 23:41" stamp over them),
in the chat app's quieter grey, so Sam's question is the one sent bubble. They
were grey bars until the polish review: six stacked bars read as a page still
loading.

## IssueScene: "send a ticket", the admin

Gold: `form-error` (a window pinned top and sides, off the bottom; a form; a
button that confirms on itself; plays once). Kept: the pinned page and its
gutter, kit `Field`s with their caret and focus ring, `States` for the button
that changes label, play once with the payoff as the still. Changed: no browser
is drawn round it (Hallmark's Floor allows no hand-drawn browser bar): the
admin's own page is the surface, cropped, its top bar the top edge; the admin's
own dark look (its sunk inputs, amber pill, good notice), its narrow layout (a
top bar with the tabs, as the admin shows under 800px, none current, as on a
film's page), and a scroll beat, because the issued link lands under the form.

Beats, once, about 5.3s wide / 4.8s compact, so a visitor scrolling past its
moment of How it works sees it land. It starts when 60% of it is in view (the
kit's Stage, this copy), so one scrolled to at reading speed is seen from its
start, not its held ending; once it has ended, its Pause says Replay:
1. 0.3s: a beat while the scene takes over from its still, then: "Who is it
   for?" already says Sam. "Days valid after first play (optional)": 7.
   Screenings is 1, start-by left empty (dd/mm/yyyy).
2. about 2.1s: "Issue ticket for anyone with the link". The note field clears,
   as the app clears it, and "1 ticket ready. Send each link to the person it's
   for." drops in with For Sam and the link box. Compact: the page scrolls as
   it opens, so the crop never cuts the notice through its words.
3. Wide: the page scrolls the link into view, the pointer over empty card.
4. about 3.3 to 4.3s: Copy link, Copied. Holds, also when the moment is left and
   come back to (the kit copy keeps a hidden stage's layout).

Wide 600 x 560: the page 520 wide at a 40px gutter, 520 x 520 of it showing.
Compact 358 x 342: a square crop of the same page, already scrolled to the
start-by field; its link box keeps only Copy link, so the link shows.

## Captured

- Widths: wide at 1280 (shown size), compact at 390. Looks: the one dark look
  (the scenes have no light version). Stills and contact sheets for both, at
  both widths; `--states` for both at both widths; beats stepped at 50-80ms: the
  link arriving (390), the tap and the browser opening, the flick (390), Play to
  the title card, Done and the loop seam; the admin's issue, scroll and copy.
- Reduced motion: the exported posters are the Stage's reduced-motion still
  (Chromium, `reducedMotion: 'reduce'`); on the built page reduced motion keeps
  the poster image and never loads the scenes (Chromium and WebKit).
- A live resize from 1280 to 390 and back on the built page: both stages switch
  wide/compact and back, no errors.

## Film

`film.mjs --gate` ended `rehearsal passed` on all four after the review fixes,
and again after the polish review's (the earlier messages as words, the Play
fade, the admin's opening beat, the thread's motion by translate and clip):
ticket wide (17 frames at 1s), ticket 390, issue wide (14 at 0.7s), issue 390.
The thread's glide is no longer on `top` and the reply no longer grows by
width and height (the site's Floor animates neither): see
`../stageshow-kit/README.md`.
The admin's page carries the kit's `ss-window` class with no chrome at all: the
film reads it as an app surface, so the cards inside it are its layout, not
cards set on a plate; its tab row is as wide as its tabs, the row having no
surface of its own.

The film's kit-override check only exempts a folder named `kit/`; this copy is
`stageshow-kit/`, so the scratchpad copy of `film-checks.mjs` was taught that
name too (one regex), or it reads the kit's own CSS as the scene's.

Lines left standing, each looked at in the frames:
- `hard edge` (both): text crossing the edge under the browser bar (ticket) and
  under the admin's top bar (issue) while the page scrolls. That is a scrolling
  page under a toolbar, drawn as the browser draws it: a hard edge.
- `jump` at play (ticket): the page element moves up by the player's height in
  the frame the player is inserted above it; what's on screen doesn't move
  (scroll anchoring). The jumps at done are the conversation reset under the
  browser, unseen.
- `settle snap` (ticket): the page's scroll reset after the browser has gone
  (hidden, and now `visibility: hidden` as well).
- `layout:` the link preview fills its bubble edge to edge (the card takes back
  the bubble's padding on purpose); the collapsed player and the page running
  past the phone's foot are a scrolling page.
- `near aligned` / `touching` (issue): "For Sam" sits 11px left of the link
  text because the link is inside its box, as in the app; the link's text runs
  under its ellipsis, which is the app's `text-overflow: ellipsis`.
- `jump` on typing (issue): characters arriving in the field.
- `vanishes with no exit` at done (ticket wide): the reply and the link leave
  the conversation in the reset under the browser, unseen.

## Review

No second agent was available to this run for the fresh-eye review, so it was
done here from the frames, with `review.md`'s brief and the golds' stills
beside these. What it found and what became of it:
- The link card faded in where it landed, over the messages still gliding up
  (frame 2.0s of a 390 sheet): it now rises from below on the thread's curve.
- The thread's opening had a void under one message (`empty pane`, a gate
  line): earlier messages, as lines, now fill it and glide up as the reply comes.
- The page ended under the ticket with a void: the synopsis, as lines, follows.
- The compact admin showed a window taller than wide (`framing`, a gate line)
  and a notice wider than its column: the compact is now a square crop, and the
  notice's track can shrink.
- The issued-link button changed width as Copy link became Copied: both labels
  now share one slot.
- The loop held its opening for 2s at the seam: the next reply starts 0.5s
  after the browser has gone.
- Beside `form-error` the admin scene is the denser one (the admin's real form,
  11 to 12.5px type). Left so: the form is the product.
- Beside `phone-touch` the hero is far darker: on purpose, the app's own dark
  look on a dark page; the colour is the Play button and the blue of Messages.

## Assumptions

- The messaging app is a chat app on an iPhone that opens links in its own
  built-in browser (Done, the address), as many do, and whose link previews show
  the page's description line. Its bubbles, back arrow, monogram and Done are
  neutral greys, so it reads as no one app (iMessage would open Safari and leave
  the description out). The README names apps' built-in browsers, and Done
  gives the loop its seen cause.
- The link preview shows the poster in the app's no-artwork placeholder look.
  The server only sends og:image when the film has artwork; a film without any
  would preview with its title and line and no picture.
- The demo cinema is Back Row at backrow.example (a sample address); the friend
  is Ellis; the ticket is for anyone with the link, 1 screening, 7 days after
  first play, no start-by; the resume window is the default 48 hours. The
  conversation's question ("Anything good to watch tonight?") is Sam's own
  message, not app text.
- The film's first title card is set in the app's serif as "Sherlock Jr." in a
  ruled frame: a title card in that style, not a copy of the 1924 card.
- After Play the panel's text would change to "Your screening is open until…";
  it is off screen by then, so the scene keeps the earlier lines.

## Unresolved

- The issue scene's still shows "Only a person, signed in" (unselected) as the
  first choice in view; the selected "Anyone with the link" is scrolled above.
- The admin scene's link box ellipsizes the link, as the app does; at phone
  width it now shows about "https://backrow.example…".

## Not checked

- A real phone or touch input; frame pacing on the real page beyond the
  virtual clock (the built page was watched in Chromium and WebKit; Firefox
  loaded and played both scenes with no errors, but was not filmed).
- Light mode: the scenes have none (the page is dark only).
- Interrupting a scene mid-loop by scrolling away and back on the built page
  was not filmed (the kit resets an unfinished scene off screen).
