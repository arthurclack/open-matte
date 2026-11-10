# The video shop's look (web/src/look)

Open Matte 1.1.0 dresses the app as a one-shelf video shop: take 2 of the approved
design, with a quiet early-80s computer for the app's own controls. This folder is the
look in one place: its tokens and fonts, the interface layer, the flat printed objects,
the shop's video machine (the blue screen), and the words that depend on the settings.

Stage 1 changes how the app looks and what it says, nothing else: no database change,
no API or route change, no behaviour change. Today's tape rules stay exactly as they
are (start-by dates, a number of plays, days after the first play, the window to come
back, tapes for anyone or for one member, keeping a tape on your card). Version 2's
one-tape loans ("Out on loan", the till slip, handing it back, "Return it now") are
**not** built now.

The approved design is read-only, in the main checkout:
`.claude/design/vhs/analogue/` (take 2: `index.html`, `notes.md`, `kit.css`, `kit.js`;
the interface: `kit-ui.css`, `kit-ui-notes.md`, `ui.html`) and `.claude/design/vhs/app/`
(every screen: `friend/`, `office/`, `notes.md`, `review/*.png`). The mocks show
version 2's states; map them to today's (below) and leave out what only version 2 has.

## Files

| File | What it is | Loaded by |
|---|---|---|
| `tokens.css` | The room, text, rules, edges, lit blocks, focus, inks, the blue, faces, gutters; every `@font-face` | `main.jsx`, first |
| `../styles.css` | The page's base, the friend's shell and footer, the elements' own look (fields, tables), `.badge`, the card's `.btn`, the player's older classes (`.theatre`, `.player-bar`, `.cue-style*`, `.player-message`, `.playback-help`) and the back office's sign-in | `main.jsx`, second |
| `ui.css` | The interface layer (`.ui80`): bar, menus, back office, tabs, buttons, fields, checks, system lines, lists, tables, status line, raster | `main.jsx` |
| `objects.css` | The flat objects and the blue screen | `main.jsx` |
| `friend.css` | The friend's pages (`.fl-*`), and the player's older classes restyled under `.fl-page` | `main.jsx`, last |
| `office.css` | The back office's pages (`.of-*`) | `admin/AdminApp.jsx`, so friends never download it |
| `objects.jsx` | `Sleeve`, `PickCard`, `LabelTape`, `TapeStrip`, `Sticker`, `TypedLabel`, `ShopName`, `Paper`, `InkFilters` and the lettering (`Typed`, `Gun`, `Hand`, `Rub`) | |
| `crt.jsx` | The machine: `CrtScreen`, `PlayTile`, `PlayScreen`, `OsdStrip`, `VcrMenu`, `ComingBack`, `PxPlay`, `PxPause` | |
| `ui.jsx` | `Line`, `Menu`, `MenuSep`, `TabRow`, `Tri` | |
| `words.js` | The host's name, the sticker's deadline, plays left, the tape counter (no DOM: unit-tested) | |
| `wear.js` | Seeded unevenness of printed things, the label tape's strips, the E-number (no DOM: unit-tested) | |
| `paperCanvas.js` | Grain, tone, ink wear and gloss, drawn on `<canvas>` | |
| `devicePixels.js` | `installDevicePixels()` (`main.jsx` calls it): the raster and scanlines in whole device pixels, set on `<body>` (`<html>`'s own style is Branding's preview) | |
| `index.js` | Everything above, to import from one place | |

Tests: `test/look.test.js` (words, wear, device pixels), `test/friend-words.test.js`
(the friend's pages' words: `pages/tapeWords.js`), `test/office.test.js` (the status
line's facts, the attention strip, and no old noun on a back office screen),
`test/branding.test.js` (the theme, the old default background, every background
allowed before still allowed, every accent refused before still refused),
`test/admin-api.test.js` (the "Your name" setting, the old default front page message),
`test/third-party-licenses.test.js` (the fonts and their licences). In real browsers,
`e2e/` walks both sides in the new words.

## The colour rules

1. **The room is dark and lit by one warm white.** Ramp: `--deep` #100E0D, `--room`
   #171513 (the page), `--surface` #1F1C19, `--raised` #29251F. Text: `--text`
   #E9DFC9, `--text-2` #B4AC9B, `--text-3` #9A9284 (still 4.5:1 on `--surface`). Rules
   are `--rule` (14% warm white) and `--hair`; a control's edge is `--ui-edge` #8A8273.
   (No token may be called `--edge`, `--mid`, `--bar-h` or a one-letter name such as
   `--o`, `--x`, `--y` on `:root`: the membership card and the printed things use those
   on their own elements, with fallbacks, and would inherit it.)
2. **Blue means the machine, and only the machine.** `--blue` #2030C8 with the subtle
   CRT (static scanlines in whole device pixels, a soft bloom on the letters, darker
   edges) appears only on: the Play tile, the short PLAY screen as playback starts, the
   paused strip **under** the picture, and the coming-back screen. Never over the
   film's picture, never flickering or moving. While the film plays, the player is
   plain and the browser's own controls are as they were. VT323 is the machine's
   face, only on the blue, at 20px or more, ligatures off. (The staff-pick card's
   printed "Staff pick" and "Picked by" are the shop's second printing ink,
   `--ink-blue`, as approved in take 2: print on card, not a screen.)
3. **Orange is only ever the next deadline.** The price-gun sticker (`Sticker`, or
   `LabelTape`'s `sticker`) shows the one deadline `words.js nextDeadline()` picks:
   "Start by", "Due back" or "Come back by". Nothing else is orange.
4. **Lit (inverse) blocks are what is selected and the main action**: the current tab or
   section, an open menu's button, the item under the pointer or keyboard in a menu, a
   ticked box, the main button. Warm white with the room's colour for words (13.8:1).
   A shop with an accent of its own tints them up to 22% (OKLab), never below 7:1
   (`server/theme.js litTint`). The accent also inks the membership card, by the card's
   own rule.
5. **System lines, not coloured boxes.** A small block first, then words: solid (done),
   open box (information), amber `--ui-warn` (warning), warm red `--ui-bad` (error). A
   warning or an error starts with a word in bold ("Not sent."), so colour is never the
   only sign.
6. **One focus block**: 3px warm white `--ui-focus` on a 2px dark gap. It never sits on
   a printed object; the blue screen has its own (the same ring in the screen's white).
7. **The raster is the back office's alone** (`.ui-raster` on `.ui-office__main` and the
   back office's sign-in): the faintest static line every third device pixel row. Never
   on the friend's pages, a printed thing, a poster, the blue or the picture.
8. **Printed things are flat real objects**: the poster printed as a sleeve, a plain
   kraft sleeve with a typed label when a film has no artwork, the staff-pick card,
   black label-maker tape, the orange sticker, the membership card. No drawn 3D. Their
   wear is subtle and seeded (the same every render, on every device).

Not kitsch: no terminal green, prompts, blinking carets, glow on the interface,
curvature, glitch, animated noise, capitals or tracked labels, bevels, drop shadows on
menus, or VT323 in the interface. Minimum 12px; sentence case; contrast 4.5:1 or more
under 18px; it works at 390 and 320 with no sideways scroll; `prefers-reduced-motion`
and `forced-colors` are respected.

## Type

| Face | Token | For |
|---|---|---|
| IBM Plex Mono (400; 500 to 700 from the SemiBold file) | `--ui-face` | The machine's words: menus, tabs, buttons, table heads, small captions (`.ui-key`), status lines, dates, times and counts (tabular figures) |
| Libre Franklin (variable) | `--sans`, `--ui-read` | Headings, reading text, labels, help, errors, what you type |
| Fraunces (variable) | `--shop-face` | The shop's own printing: its name, "Staff pick", "Membership card" |
| Courier Prime | `--type` | Typed labels (a plain sleeve's, the card's typed lines) |
| Grape Nuts | `--hand` | The one hand: the staff pick and its signature, the member's name on the card |
| VT323 | `--osd-face` | The blue screen only, 20px and up |

All are served from `web/public/fonts` (OFL 1.1, each with its licence beside it and in
the generated licences file: `vite.config.js FONTS`), declared once, in `tokens.css`,
with `font-display: swap`. Doto (version 2's till slip) is not shipped yet.

## The theme

The owner's two colours (Settings, Branding: `accentColor`, `backgroundColor`) reach
the page as a `<style id="theme">` the server writes after the stylesheets
(`server/theme.js palette()`), allowed by its hash in the CSP.

- The **room ramp derives from the background**: `--bg` (= `--room`), `--bg-raised`
  (= `--surface`), `--bg-sunk` (= `--deep`), `--bg-high` (= `--raised`), the lines, the
  status tints and the poster placeholder. Use the room names in new CSS.
- The default background is the room, #171513. A shop still storing the old default
  (#0d0c0f, which the admin saved with any colour change) reads as the room
  (`server/settings.js get()`); any other background an owner chose is kept, with the
  same contrast checks as before (`check()`: text at 7:1, the secondary and faint text
  and status colours at 4.5:1, on the background and the raised surface). The room's
  text colours pass on every background the old check allowed (tested), so no shop
  that chose a background gets text that is harder to read, and Branding still saves.
- The same goes for the front page message: a shop still storing 1.0's default, word
  for word ("This is a private cinema..."), which Settings saved with every other
  field, reads the new default ("This is a private video shop..."). Any other message
  is the owner's and is kept.
- The **accent ("Your colour") tints the lit blocks** (`--ui-lit`, `--ui-lit-hover`,
  `--ui-lit-press`), up to 22%, keeping 7:1. Open Matte's own accent leaves them warm
  white. Nothing in the stylesheets draws the accent itself, so it has no custom
  property: the tab icon (`faviconSvg`) and the membership card (`printInk`) take it
  from the settings. `check()` still refuses an accent under 4.5:1 on the background
  or the raised surface, as it did when the accent was text and buttons; its reason
  is now the tab icon. (1.0's second refusal, too dark for the words on its buttons,
  went with the buttons: every accent it refused is refused by the first one anyway,
  which `test/branding.test.js` checks.) Whether these colours should be refused at
  all now is the owner's call.
- With Open Matte's own colours nothing is written: `tokens.css` has the values.

## Components (React)

All take plain props; none fetches anything. Seeds are strings, stable per thing (a
film's slug, a tape's id), so the print is the same every time.

### Printed things (`objects.jsx`)

- `<InkFilters />`: the SVG filters that give printed, typed, pen and gun lettering its
  edges. Rendered once per page by the shells (`site.jsx`, `AdminApp.jsx`); nothing
  else needs to.
- `<Sleeve film={{ title, posterUrl }} seed? width? className? label? thumb? logo? />`: the
  poster printed on card; with no `posterUrl`, a kraft sleeve with the title on a typed
  label, and `logo` (`site.logo`) printed at its foot in black ink from its light
  parts (the `look-logo` filter in `InkFilters`); without a logo, nothing is printed
  there (the owner, 10 Nov 2026: no Open Matte frame mark). Decorative (`aria-hidden`) unless `label` names it. `width` in px (or set `--w`
  in CSS; default 240, never wider than its box). `thumb` for a list's small thumbnail
  (the back office's 44px): a kraft sleeve is then blank, as the mock draws it. Seed it
  with something stable (the film's slug is the default; the mock seeds thumbnails
  with `thumb:` and the id).
- `<PickCard text={film.recommendation} site={site} seed={film.slug} />`: the staff
  pick, "Staff pick" printed, the text in the hand (line breaks kept), signed "Picked by
  {hostName}". Render it only when there is a recommendation. A long one is written
  smaller (`pickSize`).
- `<LabelTape lines={[...]} sticker={stickerText(...) | null} seed />`: black label-maker
  tape, one strip per line (`wear.js tapeLines` cuts them), with the sticker across the
  last strip's tail. Also for "For Sam only" (`forOnly(name)`), with no sticker.
- `<Sticker label="Due back" value="Sun 8 Nov" seed />`: the orange price-gun sticker on
  its own. Read as one line; on a narrow screen the gun's line goes under the words.
- `<TapeStrip text seed tail? />`, `<TypedLabel text seed />`: single pieces.
- `<ShopName site={site} />`: the shop's name in its rub-down printing, or its logo
  (with the name beside it when `site.logoWithName`). The header, the back office's
  brand and Branding's preview all use it (`site.jsx SiteName` is the same thing).
- `<Paper kind seed as? stuck? ...>`: the sheet under all of these (kinds: `sleeve`,
  `kraft`, `pick`, `label`, `sticker`, `tape`), for a new printed thing.
- `Typed`, `Gun`, `Hand`, `Rub`: the lettering, each read as one piece of text by a
  screen reader. `inkVars(variant)` gives the custom properties that point a printed
  thing's lettering at the ink filters (0 to 2; none on a WebKit high-density screen,
  where SVG filters blur).

### The machine (`crt.jsx`)

- `<PlayTile onClick disabled? counter="0:00:00" label="Play" mode="PLAY" />`: the Play
  button, a piece of the blue screen: `mode` lit and the tape counter. The words on it
  are hidden from screen readers, so `label` must say what pressing it does ("Play",
  or "Resume at 0:18" when it resumes).
- `<PlayScreen counter onDone hold={PLAY_SCREEN_MS} />`: the short PLAY screen in the
  picture's place as playback starts, 800 ms, then `onDone`. Under reduced motion it
  draws nothing and calls `onDone` at once. Show the picture only after `onDone`.
- `<OsdStrip at="0:18" onResume left="47 h 12 min" aside? resumeLabel?>{<VcrMenu/>}</OsdStrip>`:
  the paused strip under the picture: PAUSE, the lit "Resume at 0:18", "{left} to come
  back" (or `aside` instead), and its children (the VCR menu).
- `<VcrMenu title? rows={[{ id, label, value, options: [{ value, label }], onChange }]} />`:
  audio, subtitles and picture as a VCR's vertical menu. Each row is a radio group (one
  tab stop; the arrows move and choose; Home and End).
- `<ComingBack counter="0:18:04" at="0:18" onResume resumeLabel? />`: the telly when a
  paused tape is opened again.
- `<CrtScreen as className>`: a piece of the blue screen, for anything else the machine
  shows. `PxPlay`, `PxPause`: its ▶ and ❚❚ in whole pixels.

### The interface (`ui.jsx`)

- `<Line kind="done|info|warn|bad" lead="Not sent." block? wide? role?>words</Line>`: a
  system line. `role="alert"` for an error that has just happened.
- `<Menu label={<><span className="ui-item__t">Sam</span><Tri /></>} items={...} after? disabled? buttonClass? />`:
  a pull-down menu. Items are elements with `className="ui-menu__item"` and
  `role="menuitem"` (a `Link`, `<a>` or `<button>`), and `<MenuSep />`. As today's name
  menu: Enter, Space or a click opens it with the focus still on the button, and Tab
  goes on into the items (e2e/keyboard.spec.js holds it to that). Added: the arrow keys
  open it on the first or last item and move, Home and End go to the ends, skipping an
  item hidden at this width (`.ui-wide`, `.ui-narrow`). Escape closes
  it (focus back to the button); the focus leaving it or a press elsewhere closes it. `after` is drawn under the button (a
  `.ui-menu__error` line). `buttonClass` defaults to `ui-item` (a bar's item); use
  `ui-btn` for a menu on a page. `<Tri />` is the stepped triangle.
- `<TabRow watch={pathname} className? role? label?>{tabs with className="ui-tab"}</TabRow>`: one row
  of tabs that scrolls sideways on a phone (`role="tablist"` and `label` for tabs that
  switch panels in the page, as a film's page in the back office has them), keeps the current tab (`aria-current` or
  `aria-selected`) in view within the row, never by moving the page, and fades each end
  over what is hidden past it.

## Classes (CSS)

Everything in `ui.css` sits under `.ui80`, which is on `<body>` (`web/index.html`), so the
whole app has it.

| Class | What it is |
|---|---|
| `.ui-w` | The page's width with take 2's gutters (96, 48, 16px), made with padding: put no side padding of your own on the same element. |
| `.ui-mono`, `.ui-n`, `.ui-key`, `time` | The machine's face; tabular figures; a small caption; a date that never breaks. |
| `.ui-bar`, `.ui-bar__name`, `.ui-bar__items`, `.ui-item`, `.ui-item__t`, `.ui-item__rest`, `.ui-tri` | The friend's header (built by `site.jsx`). Items are lit by `[aria-current]`, `.is-on`, `[aria-expanded=true]`. `__t` ends in an ellipsis; `__rest` (all but a first name) goes under 360px. |
| `.ui-wide`, `.ui-narrow` | Shown only from 600px, or only under it. |
| `.ui-menu`, `.ui-menu__list`, `.ui-menu__item`, `.ui-menu__sep`, `.ui-menu__error` | The pull-down (`Menu`). |
| `.ui-office`, `__nav`, `__brand`, `__brand-k`, `__foot`, `__main`, `__page` | The back office (built by `AdminApp.jsx`): a column of sections on a wide screen, one row of tabs under 800px. |
| `.ui-nav`, `.ui-nav__item` | A vertical menu (the back office's foot links). |
| `.ui-tabs`, `.ui-tabs__row`, `.ui-tab`, `.ui-tab__n`, `.ui-tabs--edge` | A row of tabs (`TabRow`); `.ui-tab__n` is a count; `--edge` runs to the screen's edges. |
| `.ui-btn`, `--primary`, `--quiet`, `--danger`, `--big`, `--small`, `--wide`; `.ui-btns` | Buttons: a 1px box; the main one lit; quiet is underlined words; unavailable is dotted and dim. |
| `.ui-field`, `__label`, `__hint`, `__error`; `.ui-input`, `--num`; `.ui-select`; `.ui-textarea`; `.ui-fieldset`; `.ui-color` | Fields. `[aria-invalid=true]` marks an error (edge and inner bar, with the words in `__error`). |
| `.ui-check`, `.ui-choice` | A checkbox or radio with its words; a choice has a heading (`<b>`) and an explanation (`<small>`). |
| `.ui-line`, `--done`, `--info`, `--warn`, `--bad`, `--block`, `--wide` | System lines (`Line`). |
| `.ui-list`, `__row`, `__thumb`, `__main`, `__meta`, `__aside` | A ruled list; a row with `[aria-current]` gets a lit bar. |
| `.ui-table-wrap`, `.ui-table`, `.ui-table--stack`; `td.ui-n`, `td.ui-when`, `td.ui-title` | A ruled table; `--stack` turns rows into small cards under 640px (cells need `data-label`). |
| `.ui-status` | The status line at the foot of a back office screen. |
| `.ui-raster` | The back office's raster (already on `.ui-office__main` and the sign-in). |

`objects.css` styles the components above (`.ob`, `.ob--*`, `.etape`, `.pick__*`, `.stk__*`,
`.crt`, `.crt--strip|picture|tube`, `.crt-play`, `.osd*`, `.crt-telly`). Size them from
your own CSS with `--w` (sleeve, pick) or the box they sit in; don't restyle their insides.

Every screen is on the `ui-*` classes and the components now. What is left of the older
classes in `styles.css` is what something still uses: `.btn` (the membership card's Turn
over), `.badge`, and the player's `.theatre`, `.player-bar`, `.cue-style*`,
`.player-message` (`e2e/fixtures.js` watches it) and `.playback-help`, which
`friend.css` restyles under `.fl-page`. The rest went in 1.1.0.

## Helpers

`words.js` (reads the ticket as `/api/me` and the film page give it; renames no field):

| Function | Gives |
|---|---|
| `hostName(site)` | `site.ownerName` (Settings, "Your name"), else the shop's name, else "the shop" |
| `pickedBy(site)`, `askHost(site)`, `noTapeYet(site)` | "Picked by Arthur", "ask Arthur", "No tape yet: ask Arthur" |
| `shopName(site)` | The shop's name in a sentence, else "this video shop" |
| `forOnly(name)` | "For Sam only" (on label tape, once that member is signed in) |
| `nextDeadline(ticket, now?)` | `{ kind, key, at, withTime }` or null. Only for a tape in state `ok`; the soonest still to come of start-by (before the first play), due-back (`expiresAt`, days after the first play) and come-back (`openScreening.resumableUntil`). A tie goes to due-back. `withTime`: come-back always; start-by unless it is the end of a day here; due-back never, as the design has it, so **the page must give its exact time in words nearby** (today's "until Sun 8 Nov 19:40") |
| `stickerText(deadline)` | `{ label, value }` for `Sticker`/`LabelTape`, in the browser's date format (`api.js formatDay`/`formatDayTime`) |
| `playsLeft(ticket)` | "2 plays left" for a tape with a number of plays, else null |
| `tapeCounter(seconds)` | "0:18:04" |
| `pickSize(text)` | null, "long" or "longer" (PickCard uses it) |
| `endOfDay(ms)`, `DEADLINE_KEYS` | As used above |

`wear.js`: `tapeLines({ title, poster, e }, { cells, lastCells })` cuts the label tape's
strips (at most two; the title shortened at a word). Pass `lastCells` small enough for
the sticker to fit beside the last strip: about 5 at 320px and 10 at 390px when there is
a sticker (the E-number then gets its own strip); 18 on a wide screen. `eNumber(minutes)`
("E-120"), `objectWear`, `gunWheels`, `embossStrip`, `stickerShift`, `KINDS`.

## The shell

- **The friend's header** (`site.jsx`): the shop's name in its printing (or logo), then
  "Back office" (owner's browser; it moves into the name menu under 600px), the name
  menu (lit while open: Your tapes, Your membership card, Back office on a phone, Sign
  out) or Sign in (not while the player is open, nor on `/t/`, `/signin`, `/enroll`, as
  today). A long name ends in an ellipsis, and under 360px only the first name shows.
  On a narrow screen the items go onto a second line, at the right. The owner's preview
  line (`.site-preview`: "Preview. You're signed in to the back office here, so tape
  rules don't apply in this browser.") sits above it when the owner is also signed in
  as a member. `useSite()` gives `{ me, site, refresh, signOut, setPlayerOpen }`; `site`
  carries `ownerName` too. A page that names itself sets `document.title` in its own
  effect (the shell sets the shop's name first).
- **The footer** (`site.jsx`): TMDB's logo and its exact notice when the shop uses TMDB
  (`site.tmdbCredit`), "Only share films you have the right to share.", "Powered by
  Open Matte" (`site.poweredBy`), Licences.
- **The back office** (`admin/AdminApp.jsx`): the shop's name with "Back office" under
  it, the sections (Films, Tapes, Members, Ledger, Status, Settings) as a lit column or,
  under 800px, one scrolling row of tabs, View the shop and Sign out at the foot, the
  raster behind the work, and the sign-in page ("Sign in to the back office", "Back
  office password"). `AdminContext` gives `{ signedOut, site, setSite, facts,
  refreshFacts }`. At the foot of every screen, the status line (`.ui-status`): how
  many films, how many on the shelf, and "Server well, checked 14:02" or what on the
  server needs looking at (`admin/facts.js`). The films are read on each screen; the
  booth's checks only when the last reading is a minute old (`refreshFacts()`), at once
  after a scan (`refreshFacts('now')`), and Status hands over its own reading
  (`refreshFacts(booth)`).
- **Signing in** (`PasskeySignIn.jsx`, with `card`): on "Show your card" (`/signin`,
  and a tape for one member) the membership card's front is the button, nobody's
  (`<MembershipCard site face="front" />`), with "Sign in with a passkey" in a lit
  strip under it; the button's name is those words.
- **The "Your name" setting**: `ownerName` in `server/settings.js` (text, trimmed, up to
  80 characters, optional; empty means the shop's name), public in `/api/site` and
  `/api/me`'s `site`, like the shop's name. No migration: settings are stored as before.

## The codebase's rules, as they touch the look

- **CSP** (`server/csp.js`): `style-src 'self'` plus the theme's hash, so no `style="..."`
  attributes in served HTML and no `<style>` elements; React `style={{...}}` props are
  fine (the browser applies them through the DOM). `img-src 'self'` (plus TMDB's image
  server in the back office): no `data:` or `blob:` images, so textures are drawn on
  `<canvas>` (`paperCanvas.js`) or with the page's SVG filters (`InkFilters`), and an
  arrow or tick in CSS is made of gradients. TMDB's logo is an `<img src="/tmdb.svg">`,
  never inline SVG. `font-src 'self'`. The e2e journeys fail on any CSP report.
- **Motion** (`web/src/motion.js`): the interface changes state instantly (no
  transitions). The only movement is the Play tile's press (none under reduced motion)
  and the PLAY screen (skipped under reduced motion). Use `scrollBehavior()` for scrolls.
- **Words** (UI text only; British spelling, plain, dry and kind; clarity beats jokes in
  errors, setup, security and access): cinema → video shop ("Shop name"), ticket →
  tape, issue → lend ("Lend a tape"), revoke → take the tape back, recommendation →
  staff pick, publish → put on the shelf / take off the shelf, screening → play, People
  → Members, Activity → Ledger, "Projection booth" → Status, account → membership card
  where it means the person's card (keep "passkey" and "sign in" plain), no "Admit one".
  Keep the honest privacy and security lines, reworded only for the new nouns. **Never
  rename** routes, URLs, API fields, database columns, settings keys or log event kinds
  (a ticket is still `ticket` in code, `/t/` in links).
- **Tests**: tests that check UI text get the new words; never weaken what a test is
  for, and behaviour tests pass unchanged.

## Copy: the clean-copy rule

The owner (10 Nov 2026): "Also use the clean copy skill"
(`.claude/skills/clean-copy/SKILL.md` in the main checkout). Every user-facing string
you write or touch (labels, hints, captions, empty states, system lines, confirmations,
button text, help, errors) goes down the ladder, read next to what is on screen around
it:

1. Does it need to surface at all? (Would the person ever have wondered?)
2. Does the label need to exist? (Does the field, value or heading already say it?)
3. Is it pre-empting a worry they never had, or scar tissue from a fixed bug or a
   design decision?
4. Rewrite to remove the offending part; if nothing is left, delete the element, not a
   stub.

Keep what a person can't act without: a real consequence at the moment of choosing, a
scope fact they can't see, what a blank state means and what to do next, units.

**Protected, never cut** (reword only for the new nouns): TMDB's notice (word for word),
"Only share films you have the right to share.", the line telling friends what the
owner can see when they open and play a tape, licence and legal text, and passkey or
security explanations a person needs in order to act.

Report each string you cut or materially rewrote as
`file:line: "before" -> "after" | cut (rung N)`.

## Today's states in the look (stage 1)

| Today | In the look |
|---|---|
| A ticket and its `/t/` link | A tape; the link page stays at `/t/` |
| Start-by date, before the first play | Sticker "Start by Fri 6 Nov" |
| Days after the first play, once played | Sticker "Due back Sun 8 Nov", the exact time in words nearby |
| Paused, within the window to come back | Sticker "Come back by Sat 7 Nov 19:40" when that is the next deadline; the paused strip; the coming-back screen |
| A number of plays | "2 plays left" beside Play |
| Expired, used up, revoked, unavailable, off the shelf, playing elsewhere | Plain honest lines on the counter, and the tape's place empty. "This tape has gone back to the shop." only for expired; revoked: "{host} has taken this tape back."; and so on with the app's real reasons |
| `film.recommendation` | The staff-pick card, "Picked by {hostName}" (no card when empty) |
| Content note, synopsis | In plain type with the film, always visible |
| TMDB details | TMDB's logo and exact notice, as today |
| "Showing to members" | "On the shelf for members", with `noTapeYet(site)` |
| A ticket for one person | "For Sam only" on label tape once signed in; before that, the anonymous version (the app already hides the name and the film) |
| The owner's preview | The preview line under the header; Play doesn't use a play, as today |

## Stage 1, done, and what's left

Stage 1 (1.1.0) put every screen in the look, working exactly as before. The two
builders' file ownership has ended: `web/src/look/*`, `styles.css`, `site.jsx` and
the server are shared again, as the rest of the code is.

Left for later, on purpose:

- **Version 2's one-tape loans** ("Out on loan", the till slip and Doto, handing a
  tape back, "Return it now", Responses, "Due back after", ink presets, a separate
  "Send a link" page, an on-page "are you sure" for taking a tape back). Doto isn't
  shipped.
- **The blank card on an invite link** (the mock shows the card with its name line
  empty while the passkey is made): it needs the membership number in the enrol
  options, an API change.
- **The membership number on the Members list**: `server/routes/people.js summary()`
  doesn't send it (only a member's own page has it); another API change.
- **The front page doesn't feature a paused tape on its telly**, as the mock's front
  page does (there, it's version 2's tape out on loan).
- The player keeps today's menus while it plays (Audio, Subtitles, Aa, Picture), where
  the mock has one "Audio, subtitles and picture" button: that would mean pausing to
  change the audio, a change in behaviour.
