// The kit's parts by file, not through its index, so only their own CSS ships
import { Stage } from '../stageshow-kit/stage'
import type { Act } from '../stageshow-kit/act'
import type { Layout } from '../stageshow-kit/looks'
import { Phone } from '../stageshow-kit/phone'
import { Bubble, Stamp, Thread } from '../stageshow-kit/messages'
import { Bar } from '../stageshow-kit/window'
import { Avatar } from '../stageshow-kit/parts/Avatar'
import type { SceneInfo } from './scene'
import './look.css'
import './tape.css'

// The hero: a tape, from the friend's side. A phone in its dark mode, one
// object throughout, in a chat app that opens links in its own built-in
// browser (Done, the address), as many do. Its colours are neutral greys, not
// any one app's. Re-told from the 1.0 site's TicketScene in 1.1.0's video
// shop. Beats:
//   1. The friend asked Arthur "Anything good to watch tonight?". Arthur is
//      typing; "I think you should watch this film." arrives, then the tape's
//      link, previewed as 1.1.0's server makes it (server/page.js: og:title
//      "Dr. Strangelove (1964)", og:description "A tape from The Lantern
//      Room.", and no og:image, as the film has no artwork: a plain sleeve).
//   2. A tap on the preview: the chat app's built-in browser slides up with
//      the film's page in The Lantern Room as 1.1.0 draws it at the phone's
//      402 points (pages/Film.jsx, look/friend.css, look/objects.css).
//   3. A flick up the page to the staff pick, the tape and Play.
//   4. Play: the tile presses as 1.1.0's does, the player opens at the top of
//      the page with the machine's PLAY screen (crt.jsx PlayScreen) and the
//      page scrolls up to it, as the app's scrollIntoView does; then the
//      picture: the film's title card in plain type, and the player's bar as
//      1.1.0 draws it under Safari's own player for a film with a ladder of
//      pictures (Picture, its menu on Auto, then Playback help). The film
//      runs: the card's second line comes up.
//   5. The payoff holds; Done closes the browser and the conversation is back
//      where it began (reset while the browser covered it).
//
// The page is 1.1.0's own geometry, measured from the real app at 402 points
// wide (its branch before the v1.1.0 tag, whose web app is the same: the
// film page with a tape for anyone with the link). Its printed things (the shop's name, the sleeve, the staff pick, the
// label tape with its sticker) are baked from the real app's own components
// at 3x (public/stage/tape-print-*.webp), so they carry its seeded grain,
// wear, hand and ink; the one change is the sleeve's label, set at 11px so
// "Strangelove" stays whole (site/README.md lists it). The PLAY tile and the
// PLAY screen are drawn live, from objects.css.
//
// Real strings: Arthur, the earlier messages, the question, the reply, the
// link and its preview, Done and the address, the shop's name and Sign in,
// the title and its details, the staff pick, the tape and its sticker, PLAY
// and the counter, 1 play left, the lines under Play (what pressing Play
// starts, as tapeWords.js clockLines() words it for this tape and WebKit
// formats its time in en-GB; what Arthur can see, privacyLine()), the
// footer's first line, the player's bar, the title card. The synopsis is
// placeholder lines.
//
// Framing: the stage crops the phone 734 points down its screen, and the
// page fades its last 3rem into the room (site.css). Every beat keeps that
// band to filler: under the conversation, 72 points of empty chat (where its
// composer would be); on the film's page, the PLAY tile's top as the page
// opens, the privacy line's foot and the page's footer rule at the flick's
// hold, the synopsis's last line and the pick's top edge while the film
// plays.
//
// The still (reduced motion, no script, thumbnails) is the link arrived: the
// message the hero's headline quotes, and the object the hero is about. The
// opening frame (`still="start"`) holds the place until the scene draws, so
// nothing changes as it takes over; the film playing (`still="playing"`) is
// the close's picture.

export const info: SceneInfo = {
  id: 'tape',
  label: 'The tape, hero column',
  // Wide: the hero's right column from 75rem (392 wide). Compact: every
  // narrower place (the 360 column from 64rem, and the single column's
  // min(100%, 360px) below it). Each height crops the phone 734 points down
  // its screen (the screen starts 13 points in, at 392/428 or 358/428 of a
  // point to the px): 628 points of page under the browser's bar, so its
  // last 3rem, which the page fades, falls on filler at every beat (above).
  wide: { width: 392, height: 684 },
  compact: { below: 380, width: 358, height: 625 },
  stills: [
    { file: 'tape.webp', layout: 'wide' },
    { file: 'tape-compact.webp', layout: 'compact' },
    { file: 'tape-start.webp', layout: 'wide', still: 'start' },
    { file: 'tape-start-compact.webp', layout: 'compact', still: 'start' },
    // The close's picture: the film playing, the player's bar, and the film's
    // page under it as far as its details (112 points), whose foot the page
    // fades: the title stays clear of the fade, the details go into it
    { file: 'tape-playing.webp', layout: 'wide', still: 'playing', height: 526 },
    { file: 'tape-playing-compact.webp', layout: 'compact', still: 'playing', height: 480 },
  ],
}

type S = {
  typing: boolean
  reply: boolean
  link: boolean
  sheet: boolean
  /** The page's scroll offset in screen points, and how long it takes to get there. */
  scroll: number
  ms: number
  ease: string
  /** Play pressed and answered: the tile is disabled while the play starts. */
  starting: boolean
  /** The play has started: the tile and its line go, the player opens above the page. */
  gone: boolean
  playing: boolean
  /** The PLAY screen has given way to the picture; the title card, then its second line. */
  picture: boolean
  frame: boolean
  line: boolean
}

const TRAVEL = 'cubic-bezier(0.45, 0, 0.1, 1)'
const initial: S = {
  typing: false,
  reply: false,
  link: false,
  sheet: false,
  scroll: 0,
  ms: 0,
  ease: TRAVEL,
  starting: false,
  gone: false,
  playing: false,
  picture: false,
  frame: false,
  line: false,
}

// The page, in screen points, as 1.1.0 lays it out at 402 wide (measured):
// the shop's bar is 61 tall (60 and its rule); the player, once open, sits
// right under it, 226.125 of picture, then (with the picture, not the PLAY
// screen) its bar, 116 tall: a row for the spacer, Picture with its menu
// (44 tall), Playback help (8 + 12 + 44 + 12 + 32 + 8), and a 1px rule.
// Measured in WebKit from 1.1.0 playing a film with three pictures (1080p
// HEVC and H.264, 720p H.264), as Safari's own player on iOS 17.1 and later
// lists them. Until the picture comes, the bar is tucked under it (tape.css),
// so the page opens by the picture's height.
const HEADER = 61
const PICTURE = 226.125
// Where the flick leaves the page: the staff pick 20 points under the
// browser's bar, the tape, Play, 1 play left and the lines under it in view.
const PICKED = 308

const poster: S = { ...initial, reply: true, link: true }
const playing: S = { ...initial, reply: true, link: true, sheet: true, scroll: HEADER, starting: true, gone: true, playing: true, picture: true, frame: true, line: true }
// Frames the development preview can draw as stills (stage.html &still=), for
// looking at each beat at rest: the opening, the page as it opens, the
// flick's hold, the PLAY screen, the film playing
const FRAMES: Record<string, S> = {
  start: initial,
  page: { ...poster, sheet: true },
  picked: { ...poster, sheet: true, scroll: PICKED },
  playscreen: { ...poster, sheet: true, scroll: HEADER, starting: true, gone: true, playing: true },
  playing,
}

// Each layout: the phone's width (it fills the stage's width; the page is
// the ground, and the column's edges are the frame). At both sizes the
// browser shows 628 points of page under its bar, the last 52 to 57 of them
// under the page's fade: as the page opens, the fade starts just under the
// tape's sticker and takes the top of the PLAY tile.
const GEO: Record<Layout, { phone: number }> = {
  wide: { phone: 392 },
  compact: { phone: 358 },
}

// Earlier in the conversation: not the story, so short and dimmed, and all
// Arthur's, so the one sent bubble is the real question. Words, not bars: a
// stack of grey bars reads as a page still loading. They glide up under the
// header as the new messages arrive.
const OLDER = ['Still on for tomorrow?', 'Doors at eight', 'Bring a jumper, the heating’s off']
const EARLIER = ['Good to see you tonight', 'Home safe', 'Still thinking about that ending', 'Same again next week?', 'Your turn to bring snacks', 'The good popcorn this time']

// A tape's link: the shop's address, /t/ and 13 characters of its code (the
// back office's picture has the same one)
const LINK = 'https://lanternroom.example/t/k7mq3vxe9tbwp'

// Where the finger waits between loops (a touch shows nothing between taps)
const REST = { wide: { x: 300, y: 590 }, compact: { x: 274, y: 540 } }

const tick = (a: Act<S>) => a.wait(16)

async function script(a: Act<S>) {
  await a.wait(500)

  // 1. Arthur's reply arrives: typing, then the words, then the link
  a.mark('reply')
  await a.set({ typing: true })
  await a.wait(1500)
  await a.set({ typing: false, reply: true })
  await a.wait(700)
  await a.set({ link: true })
  await a.wait(1000)

  // 2. Tap the preview: the built-in browser slides up with the film's page
  a.mark('open')
  await a.click({ at: 'link', x: 0.86, y: 0.2 })
  await a.set({ sheet: true })
  await a.wait(1300)

  // 3. A flick up the page to the staff pick and the tape. The page follows
  //    the finger 1:1, then carries on at the finger's speed and settles
  a.mark('scroll')
  const view = a.rect('viewport')
  const k = view.width / 402 // stage px per screen point
  const x = view.x + view.width * 0.72
  const y0 = view.y + view.height * 0.84
  const y1 = y0 - 200 * k
  await a.move({ x, y: y0 })
  await a.wait(150)
  const samples: { y: number; t: number }[] = []
  await a.drag(
    { x, y: y1 },
    (at) => {
      samples.push({ y: at.y, t: performance.now() })
      a.put({ scroll: Math.max(0, (y0 - at.y) / k), ms: 0 })
    },
    { duration: 280, path: (t, p0, p1) => ({ x: p0.x, y: p0.y + (p1.y - p0.y) * t }) },
  )
  const last = samples.slice(-4)
  const dragged = samples.length ? (y0 - samples[samples.length - 1]!.y) / k : 0
  const v = last.length > 1 ? Math.abs(last[last.length - 1]!.y - last[0]!.y) / k / Math.max(1, last[last.length - 1]!.t - last[0]!.t) : 1
  const rest = Math.max(1, PICKED - dragged)
  const throwMs = 640
  // A curve whose first slope is the finger's speed, easing out to rest
  const x1 = 0.25
  const y1c = Math.min(0.9, (x1 * v * throwMs) / rest)
  a.put({ scroll: PICKED, ms: throwMs, ease: `cubic-bezier(${x1}, ${y1c.toFixed(3)}, 0.3, 1)` })
  await a.wait(throwMs + 1000)

  // 4. Play: the tile presses (objects.css: scale 0.97 and the darker blue),
  //    is disabled while the play starts, then goes with its line; the
  //    player opens above (the page holds its place), the page scrolls up to
  //    it with the PLAY screen on, then the picture
  a.mark('play')
  await a.click({ at: 'play', x: 0.62, y: 0.55 })
  await a.set({ starting: true })
  await a.wait(200)
  // The tile and its line go (a short fade) as the player opens above: the
  // page takes it in place, its scroll moving by the picture's height in the
  // same frame (no transition on the page then), so nothing on screen moves
  await a.set({ gone: true })
  await a.wait(90)
  await a.set((s) => ({ playing: true, scroll: s.scroll + PICTURE, ms: 0 }))
  await tick(a)
  await a.set({ scroll: HEADER, ms: 780, ease: TRAVEL })
  await a.wait(780 + 560)
  // The picture: the PLAY screen gives way, the bar comes out from under it
  // and carries the page down with it
  a.mark('film')
  await a.set({ picture: true })
  await a.wait(300)
  await a.set({ frame: true })
  await a.wait(1600)
  await a.set({ line: true })
  await a.wait(2100)

  // 5. Done: the browser goes back down; the conversation was reset under it
  a.mark('done')
  await a.click({ at: 'done', x: 0.4, y: 0.55 })
  await a.snap({ typing: false, reply: false, link: false }, 'messages')
  await a.set({ sheet: false })
  await a.wait(460)
  await a.snap({ ...initial }, 'page')
  // The finger has lifted: a touch shows nothing between taps, so it goes
  // back to rest unseen
  a.place(a.layout === 'wide' ? REST.wide : REST.compact)
}

function Chevron() {
  return (
    <svg viewBox="0 0 12 20" width="12" height="20" aria-hidden className="tp-back">
      <path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Lock() {
  // SF Symbols' lock.fill, after the kit's solid lock
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden className="tp-lock">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M8 1.25A3.25 3.25 0 0 0 4.75 4.5v2H4.5A1.5 1.5 0 0 0 3 8v5.25a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V8a1.5 1.5 0 0 0-1.5-1.5h-.25v-2A3.25 3.25 0 0 0 8 1.25Zm-1.75 5.25v-2a1.75 1.75 0 0 1 3.5 0v2Z"
      />
    </svg>
  )
}

/** The machine's ▶, in whole pixels (crt.jsx PxPlay) */
function PxPlay() {
  return (
    <svg className="tp-px" viewBox="0 0 4 7" aria-hidden>
      <path d="M0 0h1v7H0zM1 1h1v5H1zM2 2h1v3H2zM3 3h1v1H3z" />
    </svg>
  )
}

/** The link as a tape for anyone previews: no picture (the film has no
 *  artwork, so the server sends no og:image), "Title (year)", the line
 *  server/page.js writes and the shop's address, over the link itself. */
function LinkPreview() {
  return (
    <span className="tp-link">
      <span className="tp-card">
        <span className="tp-card__title">Dr. Strangelove (1964)</span>
        <span className="tp-card__desc">A tape from The Lantern Room.</span>
        <span className="tp-card__site">lanternroom.example</span>
      </span>
      {/* It wraps after the shop's address, as a chat app breaks a link at a slash */}
      <span className="tp-url">
        {LINK.slice(0, LINK.indexOf('/t/') + 1)}
        <wbr />
        {LINK.slice(LINK.indexOf('/t/') + 1)}
      </span>
    </span>
  )
}

/** A printed thing, baked from 1.1.0 at 3x: placed at its measured box (the
 *  element's own box and 4px round it for its contact shadow). */
function Print({ name, x, y, w, h }: { name: string; x: number; y: number; w: number; h: number }) {
  return <img className={`tp-print tp-print--${name}`} src={`/stage/tape-print-${name}.webp`} alt="" width={w} height={h} decoding="async" style={{ left: x, top: y, width: w, height: h }} />
}

function FilmPage({ s }: { s: S }) {
  return (
    <div
      className="tp-page"
      data-target="page"
      style={{
        transform: `translate3d(0, ${-s.scroll}px, 0)`,
        transition: s.ms ? `transform ${s.ms}ms ${s.ease}` : 'none',
      }}
    >
      {/* The shop's bar: its name in its own printing, and Sign in, which
          1.1.0 doesn't offer while the player is open */}
      <div className="tp-shopbar">
        <Print name="shop" x={11.842} y={6} w={206.612} h={48} />
        <span className="tp-signin" data-hide={s.playing || undefined}>
          Sign in
        </span>
      </div>

      {/* The player, above the film, once Play has started a play */}
      <div className="tp-theatre" data-open={s.playing || undefined} data-target="theatre">
        <div className="tp-picture" data-on={s.picture || undefined}>
          {/* Gone with the picture, as 1.1.0's PlayScreen is (crt.jsx) */}
          {!s.frame && (
            <div className="tp-crt tp-playscreen">
              <div className="tp-osd">
                <span className="tp-osd__mode">
                  <span>PLAY</span>
                  <PxPlay />
                </span>
                <span className="tp-osd__ctr">0:00:00</span>
              </div>
            </div>
          )}
          <div className="tp-film">
            <img className="tp-film__card" src="/stage/tape-film-title.webp" alt="" width={402} height={226} decoding="async" data-show={s.frame || undefined} />
            <img className="tp-film__line" src="/stage/tape-film-line.webp" alt="" width={402} height={226} decoding="async" data-show={s.line || undefined} />
          </div>
        </div>
      </div>

      {/* Under the player: its bar (tucked under the picture until the
          picture comes), then the film's page */}
      <div className="tp-after" data-tucked={(s.playing && !s.picture) || undefined}>
        <div className="tp-playerbar" data-open={s.playing || undefined} data-on={s.picture || undefined}>
          {/* Picture and its menu (a select, ui.css .ui-select), on Auto */}
          <span className="tp-pic">
            <span>Picture</span>
            <span className="tp-select">Auto</span>
          </span>
          <span className="tp-help">Playback help</span>
        </div>
        <div className="tp-body">
        <Print name="sleeve" x={11.774} y={11.85} w={104.452} h={152.301} />
        <div className="tp-title">Dr. Strangelove</div>
        <div className="tp-meta">1964, 1 h 35 min, directed by Stanley Kubrick</div>
        <div className="tp-lines tp-synopsis">
          <Bar w="97%" h={9} r={2} tone={3} />
          <Bar w="91%" h={9} r={2} tone={3} />
          <Bar w="57%" h={9} r={2} tone={3} />
        </div>
        <Print name="pick" x={9.675} y={262.706} w={368.286} h={170.028} />
        <Print name="label" x={11.937} y={450.475} w={249.21} h={55.987} />
        <div className="tp-playrow" data-gone={s.gone || undefined}>
          <span className="tp-crt tp-play" data-target="play" data-starting={s.starting || undefined}>
            <span className="tp-play__in">
              <span className="tp-play__mode">
                <span>PLAY</span>
                <PxPlay />
              </span>
              <span className="tp-play__ctr">0:00:00</span>
            </span>
          </span>
          <span className="tp-left">1 play left</span>
        </div>
        {/* What pressing Play starts (Film.jsx fl-clock: clockLines() for a
            tape with a start-by date and days after the first play, not yet
            played; the start-by date is the end of Arthur's Saturday, as the
            back office stores it, in WebKit's en-GB) and what Arthur can see
            (fl-privacy: privacyLine(), signed out) */}
        <div className="tp-clock">
          Once you press Play, you can pause and come back to it for 48 hours. Start watching by Sat 14 Nov at 23:59. It's due back 7 days after you start.
        </div>
        <div className="tp-privacy">Arthur can see when this tape is opened and played, the kind of device (such as “Safari on iPhone”), and roughly how far playback gets.</div>
        </div>
        {/* The shop's footer: its rule, and the first of its lines */}
        <div className="tp-foot">Only share films you have the right to share.</div>
      </div>
    </div>
  )
}

/** `still` is for the development preview's exports only: the page mounts the
 *  scene with no props. 'start' draws the opening frame, 'playing' the film
 *  playing, another name in FRAMES that beat; anything else, or none, the
 *  story's still. */
export default function TapeScene({ still }: { still?: string } = {}) {
  return (
    <Stage<S>
      width={info.wide.width}
      height={info.wide.height}
      compact={info.compact}
      theme="dark"
      initial={initial}
      poster={(still && FRAMES[still]) || poster}
      script={script}
      cursor={{ at: REST, style: 'touch' }}
      className="om tp"
    >
      {(s, _rect, layout) => {
        const g = GEO[layout]
        return (
          <Phone width={g.phone} dark time="20:14" className="tp-phone">
            <div className="tp-chat" data-target="messages">
              <div className="tp-head">
                <Chevron />
                <span className="tp-head__who">
                  <Avatar name="Arthur" tone="ios" size={44} className="tp-avatar" />
                  <span className="tp-head__name">Arthur</span>
                </span>
              </div>
              <Thread className="tp-thread">
                <Stamp>Sunday 17:05</Stamp>
                {OLDER.map((words) => (
                  <Bubble key={words} from="them" className="tp-earlier">
                    {words}
                  </Bubble>
                ))}
                <Stamp>Yesterday 23:41</Stamp>
                {EARLIER.map((words) => (
                  <Bubble key={words} from="them" className="tp-earlier">
                    {words}
                  </Bubble>
                ))}
                <Stamp>Today 20:12</Stamp>
                <Bubble from="me">Anything good to watch tonight?</Bubble>
                {(s.typing || s.reply) && (
                  <Bubble from="them" typing={s.typing}>
                    I think you should watch this film.
                  </Bubble>
                )}
                {s.link && (
                  <Bubble from="them" className="tp-linkrow" data-target="link">
                    <LinkPreview />
                  </Bubble>
                )}
              </Thread>
            </div>

            {/* The chat app's built-in browser */}
            <div className="tp-sheet" data-open={s.sheet || undefined}>
              <div className="tp-bar">
                <span className="tp-bar__done" data-target="done">
                  Done
                </span>
                <span className="tp-bar__url">
                  <Lock />
                  lanternroom.example
                </span>
              </div>
              <div className="tp-viewport" data-target="viewport">
                <FilmPage s={s} />
              </div>
            </div>
          </Phone>
        )
      }}
    </Stage>
  )
}
