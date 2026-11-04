// The kit's parts by file, not through its index, so only their own CSS ships
import { Stage } from '../stageshow-kit/stage'
import type { Act } from '../stageshow-kit/act'
import type { Layout } from '../stageshow-kit/looks'
import { Phone } from '../stageshow-kit/phone'
import { Bubble, Stamp, Thread } from '../stageshow-kit/messages'
import { Bar } from '../stageshow-kit/window'
import { Avatar } from '../stageshow-kit/parts/Avatar'
import './look.css'
import './ticket.css'

// The hero: a ticket, from the friend's side. A phone in its dark mode, one
// object throughout, in a chat app that opens links in its own built-in
// browser (Done, the address), as many do. Its colours are neutral greys, not
// any one app's. Beats:
//   1. A reply arrives in a conversation: "You should watch this film. Here's
//      the link.", then the link, which previews as the app makes it do (the
//      film's poster and title, "A ticket from Back Row.").
//   2. A tap on the preview: the messaging app's built-in browser slides up
//      with the film's page on the cinema (Back Row, an invented name).
//   3. A flick up the page to the ticket: "Admit one · Sherlock Jr." and its
//      rules, in the app's words.
//   4. Play: the player opens at the top of the page and the page scrolls to
//      it, as the app does; the film's first title card comes up.
//   5. The payoff holds; Done closes the browser and the conversation is back
//      where it began (reset while the browser covered it).
//
// Real strings: Ellis, the question, the reply, the preview (title, line,
// address), Done, the address bar, Back Row, Sign in, the ticket's rules and
// Play, the title card, the player bar's Quality: Auto and Playback help.
// Earlier messages (a few of Ellis's own, dimmed, so the question is the one
// sent bubble), the recommendation, the privacy line and the synopsis are
// filler.
//
// The still (reduced motion, no script, thumbnails) is the link arrived: the
// object the hero is about. The page's last picture is the film playing
// (`still="playing"`), and the still shown until the scene has drawn is its
// opening frame (`still="start"`), so the live scene takes over without a
// change.

type S = {
  typing: boolean
  reply: boolean
  link: boolean
  sheet: boolean
  /** The page's scroll offset in screen points, and how long it takes to get there. */
  scroll: number
  ms: number
  ease: string
  /** Play pressed: its button goes, the player opens above the film. */
  gone: boolean
  playing: boolean
  /** The film's first frame, once the player has scrolled into view. */
  frame: boolean
}

const TRAVEL = 'cubic-bezier(0.45, 0, 0.1, 1)'
const initial: S = { typing: false, reply: false, link: false, sheet: false, scroll: 0, ms: 0, ease: TRAVEL, gone: false, playing: false, frame: false }

// Header height on the page: the player scrolls in under it, as
// scrollIntoView({ block: 'start' }) leaves it.
const HEADER = 69
const poster: S = { ...initial, reply: true, link: true }
const playing: S = { ...initial, reply: true, link: true, sheet: true, scroll: HEADER, gone: true, playing: true, frame: true }

// Each layout: the phone's width and where it sits on the stage (the
// composition is the phone pinned a gutter from the top, centred, running off
// the bottom). Wide, the phone is at its true size: 402 points of screen and
// the pro frame's 13 a side.
const GEO: Record<Layout, { phone: number; left: number; top: number }> = {
  wide: { phone: 428, left: 56, top: 56 },
  compact: { phone: 326, left: 16, top: 16 },
}


// Earlier in the conversation: not the story, so short and dimmed, and all
// Ellis's, so the one sent bubble is the real question. Words, not bars: a
// stack of grey bars reads as a page still loading. They glide up under the
// header as the new messages arrive.
const EARLIER = ['Thanks for tonight', 'Home now', 'Still thinking about that ending', 'Free Friday?', 'My turn to pick', 'Bring the good popcorn']

const REST = { wide: { x: 450, y: 640 }, compact: { x: 300, y: 450 } }

const tick = (a: Act<S>) => a.wait(16)

async function script(a: Act<S>) {
  await a.wait(500)

  // 1. Their reply arrives: typing, then the words, then the link
  a.mark('reply')
  await a.set({ typing: true })
  await a.wait(1500)
  await a.set({ typing: false, reply: true })
  await a.wait(700)
  await a.set({ link: true })
  await a.wait(1100)

  // 2. Tap the preview: the built-in browser slides up with the film's page
  a.mark('open')
  await a.click({ at: 'link', x: 0.62, y: 0.55 })
  await a.set({ sheet: true })
  await a.wait(1500)

  // 3. A flick up the page to the ticket. The page follows the finger 1:1,
  //    then carries on at the finger's speed and settles on the ticket
  a.mark('scroll')
  const view = a.rect('viewport')
  const k = view.width / 402 // stage px per screen point
  // Measured as drawn (the page is at the top, at rest): the rects are in
  // stage pixels, through the phone's own scale
  const panel = a.rect('panel')
  const target = (panel.y - view.y) / k - 18
  const x = view.x + view.width * 0.7
  const y0 = view.y + Math.min(view.height * 0.78, 470 * k)
  const y1 = y0 - 190 * k
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
  const rest = Math.max(1, target - dragged)
  const throwMs = 620
  // A curve whose first slope is the finger's speed, easing out to rest
  const x1 = 0.25
  const y1c = Math.min(0.9, (x1 * v * throwMs) / rest)
  a.put({ scroll: target, ms: throwMs, ease: `cubic-bezier(${x1}, ${y1c.toFixed(3)}, 0.3, 1)` })
  await a.wait(throwMs + 1300)

  // 4. Play: the player opens above (the page holds its place), then the
  //    page scrolls up to it and the film's first title card comes up
  a.mark('play')
  await a.click({ at: 'play', x: 0.7, y: 0.6 })
  // The button fades (ticket.css) while the page holds still: the snap below
  // turns the page's transitions off, which would cut the fade short
  await a.set({ gone: true })
  await a.wait(220)
  const theatre = a.rect('theatre')
  await a.snap((s) => ({ playing: true, scroll: s.scroll + theatre.height / k, ms: 0 }), 'page')
  await tick(a)
  await a.set({ scroll: HEADER, ms: 760, ease: TRAVEL })
  await a.wait(900)
  a.mark('film')
  await a.set({ frame: true })
  await a.wait(2900)

  // 5. Done: the browser goes back down; the conversation was reset under it
  a.mark('done')
  await a.click({ at: 'done', x: 0.45, y: 0.55 })
  await a.snap({ typing: false, reply: false, link: false }, 'messages')
  await a.set({ sheet: false })
  await a.wait(450)
  await a.snap({ scroll: 0, ms: 0, ease: TRAVEL, gone: false, playing: false, frame: false }, 'page')
  // The finger has lifted: a touch shows nothing between taps, so it goes
  // back to rest unseen
  a.place(a.layout === 'wide' ? REST.wide : REST.compact)
}

function Chevron() {
  return (
    <svg viewBox="0 0 12 20" width="12" height="20" aria-hidden className="tk-back">
      <path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Lock() {
  // SF Symbols' lock.fill, after the kit's solid lock
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden className="tk-lock">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M8 1.25A3.25 3.25 0 0 0 4.75 4.5v2H4.5A1.5 1.5 0 0 0 3 8v5.25a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V8a1.5 1.5 0 0 0-1.5-1.5h-.25v-2A3.25 3.25 0 0 0 8 1.25Zm-1.75 5.25v-2a1.75 1.75 0 0 1 3.5 0v2Z"
      />
    </svg>
  )
}

/** The link as a ticket for anyone previews: the poster (here the app's own
 *  placeholder, as for a film without artwork, cropped as chat apps crop a
 *  preview's picture), "Title (year)" and the line server/page.js writes. */
function LinkPreview() {
  return (
    <span className="tk-link">
      <span className="om-poster tk-link__poster">Sherlock Jr.</span>
      <span className="tk-link__text">
        <span className="tk-link__title">Sherlock Jr. (1924)</span>
        <span className="tk-link__desc">A ticket from Back Row.</span>
        <span className="tk-link__site">backrow.example</span>
      </span>
    </span>
  )
}

function FilmPage({ s }: { s: S }) {
  return (
    <div
      className="tk-page"
      data-target="page"
      style={{
        transform: `translate3d(0, ${-s.scroll}px, 0)`,
        transition: s.ms ? `transform ${s.ms}ms ${s.ease}` : 'none',
      }}
    >
      <header className="tk-site">
        <span className="tk-site__name">Back Row</span>
        <span className="tk-site__signin" data-hide={s.playing || undefined}>
          Sign in
        </span>
      </header>

      {/* The player, above the film, once Play is pressed */}
      <div className="tk-theatre-slot" data-open={s.playing || undefined}>
        <div className="tk-theatre">
          <div className="tk-theatre__in" data-target="theatre">
          <div className="tk-video">
            <div className="tk-card" data-show={s.frame || undefined}>
              <span className="tk-card__title">Sherlock Jr.</span>
            </div>
          </div>
          <div className="tk-playerbar">
            <span>Quality: Auto</span>
            <span className="tk-playerbar__help">Playback help</span>
          </div>
          </div>
        </div>
      </div>

      <div className="tk-body">
        <div className="om-poster tk-poster">Sherlock Jr.</div>
        <div className="tk-title">Sherlock Jr.</div>
        <div className="tk-meta">
          <span>1924</span>
          <span>45 min</span>
          <span>Directed by Buster Keaton</span>
        </div>
        <div className="tk-rec">
          <span className="tk-rec__label">Why you should watch it</span>
          <Bar w="94%" h={8} tone={3} />
          <Bar w="86%" h={8} tone={3} />
          <Bar w="58%" h={8} tone={3} />
        </div>
        <div className="tk-panel" data-target="panel">
          <div className="tk-panel__admit">Admit one · Sherlock Jr.</div>
          <p>1 screening left on this ticket.</p>
          <p>Pressing Play starts a screening. You can pause and come back to it for 48 hours.</p>
          <p>Once you start, the ticket lasts 7 days.</p>
          <span className="tk-play" data-target="play" data-gone={s.gone || undefined}>
            <span aria-hidden>▶</span> Play
          </span>
          <div className="tk-privacy">
            <Bar w="96%" h={6} tone={2} />
            <Bar w="90%" h={6} tone={2} />
            <Bar w="40%" h={6} tone={2} />
          </div>
        </div>
        {/* The synopsis, under the ticket */}
        <div className="tk-synopsis">
          <Bar w="96%" h={8} tone={2} />
          <Bar w="91%" h={8} tone={2} />
          <Bar w="94%" h={8} tone={2} />
          <Bar w="62%" h={8} tone={2} />
        </div>
      </div>
    </div>
  )
}

/** `still` is for the development preview's exports only: the page mounts the
 *  scene with no props. */
export default function TicketScene({ still }: { still?: 'start' | 'playing' } = {}) {
  return (
    <Stage<S>
      width={540}
      height={700}
      compact={{ below: 480, width: 358, height: 500 }}
      theme="dark"
      initial={initial}
      poster={still === 'start' ? initial : still === 'playing' ? playing : poster}
      script={script}
      cursor={{ at: REST, style: 'touch' }}
      className="om tk"
    >
      {(s, _rect, layout) => {
        const g = GEO[layout]
        return (
          <Phone width={g.phone} dark time="20:14" className="tk-phone" style={{ left: g.left, top: g.top }}>
            <div className="tk-messages" data-target="messages">
              <div className="tk-head">
                <Chevron />
                <span className="tk-head__who">
                  <Avatar name="Ellis Ward" tone="ios" size={44} className="tk-avatar" />
                  <span className="tk-head__name">Ellis</span>
                </span>
              </div>
              <Thread className="tk-thread">
                <Stamp>Yesterday 23:41</Stamp>
                {EARLIER.map((words) => (
                  <Bubble key={words} from="them" className="tk-earlier">
                    {words}
                  </Bubble>
                ))}
                <Stamp>Today 20:12</Stamp>
                <Bubble from="me">Anything good to watch tonight?</Bubble>
                {(s.typing || s.reply) && (
                  <Bubble from="them" typing={s.typing}>
                    You should watch this film. Here’s the link.
                  </Bubble>
                )}
                {s.link && (
                  <Bubble from="them" className="tk-linkrow" data-target="link">
                    <LinkPreview />
                  </Bubble>
                )}
              </Thread>
            </div>

            {/* The chat app's built-in browser */}
            <div className="tk-sheet" data-open={s.sheet || undefined}>
              <div className="tk-bar">
                <span className="tk-bar__done" data-target="done">
                  Done
                </span>
                <span className="tk-bar__url">
                  <Lock />
                  backrow.example
                </span>
              </div>
              <div className="tk-viewport" data-target="viewport">
                <FilmPage s={s} />
              </div>
            </div>
          </Phone>
        )
      }}
    </Stage>
  )
}
