# Rehearsal: Lend a tape (LendScene, How it works step 3)

The back office of The Lantern Room lends a tape of Dr. Strangelove, in
Open Matte 1.1.0's own markup, words and CSS (`web/src/admin/*.jsx`,
`web/src/look/ui.css`, `office.css`, read on the video-shop-look branch at
730f7ac; these files are the same in the released v1.1.0),
built with the Stageshow kit copied into `../stageshow-kit/`. Filmed from
`/stage.html` with the skill's `scripts/film.mjs` (the scratchpad copy that
knows the `stageshow-kit/` folder); the built site checked under
`tools/serve.mjs`'s headers.

Gold: `form-error` (a page pinned from the top, a field filled, a button that
confirms, plays once, the payoff as the still) and `table-edit` (the edit
lands, then what it feeds follows a beat later). Kept from them: play once and
hold, the poster as the payoff, the cursor resting off the words it presses,
the cause before its effect. Changed: no window drawn round it (the Floor
allows no browser chrome): the back office's own page is the surface, cropped
by the stage, its sticky top bar the top edge and a 1px `--rule` edge down
the crop's sides and across its top, because the app's room is the page's
room. At its foot there is no rule: the page fades the stage's last 40px (of
its design height) into the room (`lend-place.css`, a mask on the picture
and the live layer), so the back office reads as going on under the crop. Kept from the 1.0 site's
IssueScene: the page laid out narrow enough to show its top bar, the scroll
beat that brings the result into view. Changed from it: 1.1.0's look (square,
lit blocks, Matte Mono, the shop's rub-down name, no amber pill, no green
notice: "1 tape ready." is 1.1.0's system line, ruled above and below), and
1.1.0's words (tapes, plays, Lend, Members, Ledger).

## The two designs

**Wide, 600 x 700** (from 36rem; 1:1 from about 72rem, 0.81 at 60rem, 0.9 to
1 between 36 and 60rem). The page at 600, 1.1.0's narrow layout (under 800px:
the menu as a bar, the form in one column). The macOS pointer (`real`).

**Compact, 358 x 586** (under 36rem, `below` 480). The page laid out at a
phone's 390 (the shop's name on two lines, as on an iPhone; at 358 it would
break into three) and drawn at 358/390. A finger (`touch`): a tap, a flick, a
tap, and no hover (1.1.0's hover rules ask for `(hover: hover)`). It opens on
the form already filled in, because typing on a phone needs the iOS number
pad, which the kit doesn't have and the rules forbid drawing by hand; a
phone with a field taking keys and no keyboard would be the fake. The
cursor style follows the place's width (`LendScene` measures its place as
the Stage does), so a live resize swaps pointer and finger with the design.

## Beats (times from the script's start; plays once when 60% in view)

Wide, about 9.5 s:

1. 0.0 to 0.7 s: the film's page, held: the bar (The Lantern Room / Back
   office, View the shop, Sign out; Films lit), ← Films, the kraft sleeve,
   Dr. Strangelove, 1964 · 1 h 35 min · /dr-strangelove, On the shelf, Media
   OK, Preview the page, Take off the shelf, the tabs (Tapes lit), Lend a
   tape, Who can use it?, Anyone with the link (chosen), Let them keep it on
   their membership card.
2. about 1.1 s: the pointer onto the page's empty right side, the page scrolls
   (1.1 s, the travel curve) under the sticky bar to the fields: Plays 1,
   Start by 14/11/2026, Days after the first play (No limit), How many tapes
   1, the lit button clear of the fade, the box's foot going into it.
3. about 2.5 s: a click in Days after the first play (I-beam, off the
   placeholder): its edge lights and the 3px focus ring on its dark gap, the
   caret at the start; 7 typed, the placeholder gone with the key.
4. about 4.2 s: the pointer to the button's lower edge, off its words (hover
   lit-hover); the press (lit-press); the field lets go of the focus as the
   button goes down; the button unavailable (dashed, dim) for 240 ms while
   the back office asks; "1 tape ready." arrives under the form, under the
   crop (seen arriving by the scroll, never popping into view).
5. about 5.3 s: the pointer off the button to the box's empty right side; the
   page scrolls (0.8 s) the line into view: "■ 1 tape ready. Send each link to
   the person it's for.", the link in its box with Copy link, Copy message,
   "Start by 14 Nov 2026." and the line's rule, clear of the fade; the page
   goes on into the fade, its next heading, "Tapes lent", under the crop.
6. about 6.8 s: Copy link (hover, press): Copied. The button takes the shorter
   word's width and the address's box widens at once, as 1.1.0's does. The
   pointer leaves for the empty line beside Copy message. Holds; Replay
   from the page's Pause button.

Compact, about 7.2 s: 0.9 s held on the form (Start by, Days 7, How many
tapes, the button, two lines at a phone's width) → tap low on the button,
busy 240 ms, the line arrives under the crop → about 2.3 s a flick up the
page (follows the finger 1:1 for 260 ms, then thrown on at the finger's
speed over 640 ms) to the line → about 5.4 s tap Copy link: Copied. Holds.

Stills (`info.stills`, exported by `tools/stills.mjs` into `public/stage/`):
`lend.webp` 600 x 700 and `lend-compact.webp` 358 x 586 (the story: Copied),
`lend-start.webp` and `lend-start-compact.webp` (the opening frames, which the
page shows until the scene draws). `&still=` in `stage.html` also draws
`form`, `days`, `busy`, `lent` and `ready` for looking at each beat at rest.

## Every word, and where 1.1.0 says it

- The bar: `AdminApp.jsx:113-141` (ShopName of the site's name, "Back
  office" 114, Films 118 lit on a film's page by `aria-current={onFilms…}`
  117, Tapes 121, Members 124, Ledger 127, Status 130, Settings 133, View the
  shop 138, Sign out 141). The shop's name: `look/objects.jsx` ShopName/Rub,
  `membershipCard.js` rubDown (copied as is), ink edge `look-kp-<n>`.
- The film's page: `FilmDetail.jsx:67` (`<Back to="/admin">Films</Back>`, its
  ← from `ui.jsx:101`), 70-82 (the sleeve thumb, title, year,
  `formatRuntime(95)` = "1 h 35 min", `/{film.slug}`, On the shelf 81, Media
  OK `ui.jsx:138`), 89 Preview the page, 93 Take off the shelf, 26-28 the tabs
  Tapes / Details / Media, 135 Lend a tape, 145 Tapes lent, 150-156 Members /
  Show to members / its explanation.
- The form: `Tickets.jsx:157` (Plays starts at '1', the rest empty), 205 Who
  can use it?, 209-210 Anyone with the link and its explanation, 337-338 Let
  them keep it on their membership card and its explanation, 223 and 236 Only
  one member, signed in and its explanation, 265-269 Who is it for? / e.g.
  Sam / its hint, 273-276 Plays / its hint, 280-283 Start by (optional) / its
  hint, 287-290 Days after the first play (optional) / No limit / its hint,
  295-298 How many tapes / Each gets its own link., 197 the button's words,
  303 `disabled={action.busy…}` (the busy beat), 190 the form after lending.
- After lending: `Tickets.jsx:315-324` ("1 tape ready." from `plural(1,
  'tape')`, Send each link to the person it's for., LinkBox, "Start by
  {formatDate}." = "14 Nov 2026" in en-GB), `ui.jsx:177-183` (LinkBox: Copy
  link, Copy message), 159-171 (CopyButton: "Copied").
- Facts (shared with the tape scene): the link
  `https://lanternroom.example/t/k7mq3vxe9tbwp` (13 characters from
  `server/sessions.js` ticketCode's alphabet), start by Sat 14 Nov 2026, 7
  days after the first play, 1 play.

The explanations are 1.1.0's own words, not filler lines: at 15 and 14px in
1.1.0's dim inks they read as the real page, and a bar where 1.1.0 has words
read as a mock in this look.

## Framing

What lies under the 40px fade at the crop's foot, frame by frame:

- Wide, opening: the membership card's explanation under "Let them keep it";
  the check's own words and Anyone with the link are clear. The pointer rests
  on the empty page right of Take off the shelf (x 520, y 310), where it
  appears as the scene takes over, not on any word.
- Wide, the fields: the box's foot under the lit button; the button clear.
- Wide, the end: the empty page under the line's rule. The scroll stops with
  the rule 46px above the crop's foot: the Start by field above is then
  wholly under the sticky bar (a few px more showed a sliver of its box
  under the bar) and "Tapes lent", 40px under the rule, under the crop (its
  ink would start in the fade's last pixel, at 2% or less).
- Phone, opening: the box's foot under the lit button; the button clear
  (the stage grew from 570 to 586 for that).
- Phone, the end: the rule at the fade's top and "Tapes lent" under the crop;
  the explanation under Days at the top clear of the bar.

## Captured

- Widths: wide at 1280 (shown size), compact at 390. One look (1.1.0's dark
  room; the app has no light one). Sheets every 500/400 ms for the whole run
  at both widths, `--states` at both, beats stepped at 50 to 120 ms: the
  click into Days and the typing, the press and busy, the second scroll, Copy
  link to Copied (zoomed 3x). Stills at rest of every frame name, 2x.
- Reduced motion: the exported stills are the Stage's reduced-motion poster;
  on the built page reduced motion fetches no scene code and shows
  `lend.webp` (Chromium, WebKit, Firefox).
- Built site (`check-built.mjs`, production headers), Chromium, WebKit,
  Firefox: no CSP violations, no console errors, no third-party requests; no
  scene code by DOMContentLoaded; at 1280 the lend chunk is prefetched after
  load and mounts on reaching step 3 (wide), at 390 compact; Pause shows the
  story's still; no script fetches no JS.
- A live resize on the built page (Chromium) 1280 → 390 → 1280 with the scene
  playing and ended: wide/real, compact/touch, wide/real again, no errors.
- WebKit, the stills' frames at 2x in the dev preview: drawn as in Chromium,
  the shop's name without its ink edge (as 1.1.0 leaves it in WebKit at 2x).

Contact sheets: the scratchpad's `scenes/lend/film/` (`final-wide.png`,
`final-compact.png`, `w-states.png`, `c-states.png`, `w-at-*.png`).

## Film

`--gate` does not end `rehearsal passed`: every never-intentional line left
points at 1.1.0's own geometry, which the scene copies, or at content the
crop never shows. Each looked at in the frames:

- `uneven padding: div.ui-office__nav` (both): 1.1.0's bar is 10px over the
  shop's name and 6px under the tabs' lit block (`ui.css`, under 800px:
  `padding: 10px 16px 0`, the tab row `padding: 6px 16px`), as the approved
  bake `app-lend.webp` draws it. Standing; changing it would draw a bar 1.1.0
  doesn't have.
- `framing: span.of-box ends 11px short of the left/right edge` (compact):
  1.1.0's box on a phone runs 4px into the page's 16px gutter (`office.css`,
  under 520px), 12px from the screen's edge, 11 at 358/390. Standing.
- `tight control: Copy link sits 7.3px under the address` (compact): the
  LinkBox's 8px row gap at 358/390. Standing.
- `uneven gutters: span.ui-line … 41px from the bottom` (compact): the line is
  part of the page, not a floating card; the page goes on into the fade under
  it. Standing.
- `uneven gutters: span.ui-choice` and `loose stack: of-facts / of-marks`
  (compact): the choices and the film's heading are above the crop for the
  whole compact run (it opens on the fields); never seen.
- Candidates, not gate lines: `hard edge` (text passing under the sticky bar
  while the page scrolls: a scrolling page under a bar, drawn as the browser
  draws it); `layout: … leaves -140px below its last child` (the page runs
  past the crop by design); `jump`/`settle snap` on the address's box and
  Copy message as Copied replaces Copy link (1.1.0's instant redraw, marked
  `data-snap`); the placeholder leaving with the first key (`data-snap`) and
  the 7 (`data-typing`).
- Fixed on 10 November (re-filmed; `scenes/fix/film/` in the scratchpad):
  the crop's foot was a hairline under an orphaned "Tapes lent"; it fades now
  and ends above that heading (Framing, above); the pointer appeared over the
  end of "Whoever" as the scene took over (now on empty page); on the phone,
  "link" stood alone on the lend button's second line (`text-wrap: balance`,
  listed as a difference from 1.1.0 in the README); the phone cut's date as
  an iPhone formats it.
- Fixed along the way: the Plays label under the bar at the first scroll (the
  stage grew from 600 to 700 so Plays to the button show whole); the crop's
  foot through the explanation under "Let them keep it" in the opening (the
  page opens 7px down, the foot in that row's empty padding); the caret after
  the placeholder (now at the field's start, the placeholder under it); the
  pointer over the words it pressed; the flex rows that wrap at these widths
  drawn as the rows they wrap into (`spills its slot` read the wrap as a
  closed gap); the phone's mouse pointer (now a finger); hover on the phone.

## Review

No second agent was available to this run for the fresh-eye review; it was
done here from the frames with `review.md`'s brief, the old IssueScene's still
(d781e01 `public/stage/issue.webp`) and the approved bake (`app-lend.webp`,
since removed from the site, which shows this scene's stills instead) beside
these. Found and fixed: the items above. Judged and left: the lit
button is the heaviest mark in the payoff (it is in 1.1.0; the line and the
link are under it, cause then effect, in reading order). A later review
found "Tapes lent" alone on the crop's bottom rule unfinished; it is under
the crop now, and the foot fades.

## Assumptions

- The page's width is the scene's (600) or a phone's (390): 1.1.0's narrow
  layout, as the approved bake chose.
- A Mac's Safari for the wide design: the date field drawn as Safari on a
  Mac draws a date, 14/11/2026 (no calendar glyph), no number spinners, the
  macOS pointer. An iPhone's Safari for the phone design: the date as iOS
  formats a date field's value in en-GB, "14 Nov 2026", left-aligned like the
  other values (its alignment not checked on a device).
- No raster (the plan: a line every third device pixel bands in a still).
- Copied holds (the brief: hold the payoff); 1.1.0 puts "Copy link" back after
  1.5 s.
- Who is it for? left empty (the friend's name isn't in the story), so no
  "For …" line under "1 tape ready.".

## Settled

- `←` (U+2190) is in `MatteMono-SemiBold` (`fonts.py` keeps it: `extra=
  "U+2190"`), which `.of-back` (weight 500) draws from, so "← Films" has
  Matte Mono's own arrow in every engine; the stills are exported from the
  current cut.

## Unresolved

- The phone's design skips typing (see above); its story starts with 7 in
  the field.

## Not checked

- A real iPhone and a real Safari on a Mac (only Playwright's engines).
- Live pacing on a slow device (rAF timing against the transforms), and a
  return from a background tab mid-run.
- Touch input itself on the page (the scene is inert; only Pause is live).
- The gold examples filmed beside it in the skill's playground (compared from
  their code and the old site's still instead).
