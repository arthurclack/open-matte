// The kit's parts by file, not through its index, so only their own CSS ships
import { Stage } from '../stageshow-kit/stage'
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Act } from '../stageshow-kit/act'
import type { Layout } from '../stageshow-kit/looks'
import type { SceneInfo } from './scene'
import './look.css'
import './lend.css'

// How it works, step 3, "Lend a tape": the owner of The Lantern Room lends a
// tape of Dr. Strangelove from the back office (Open Matte 1.1.0).
//
// The back office's own page, cropped by the stage, with no browser drawn
// round it: at the scene's width (600, or a phone's 390 drawn at 358) 1.1.0
// lays it out with its menu as a bar across the top (ui.css, under 800px),
// the shop's name in its rub-down print over "Back office", View the shop
// and Sign out beside it, and the sections as one row of tabs, Films lit (a
// film's page is part of Films, AdminApp.jsx). The bar is sticky, as 1.1.0's
// is: the page scrolls under it.
//
// Wide (a computer, the macOS pointer), once, when the scene is in view;
// about 9.5s (REHEARSAL-lend.md has the beats in full):
//   0.0  The film's page, held: ← Films, the plain kraft sleeve, Dr.
//        Strangelove, 1964 · 1 h 35 min · /dr-strangelove, On the shelf,
//        Media OK, its tabs (Tapes lit), "Lend a tape", "Anyone with the
//        link" chosen.
//   1.1  The pointer on the page scrolls it down to the fields: Plays 1,
//        Start by 14/11/2026 (14 Nov 2026 on the phone), Days after the
//        first play (empty), How many tapes 1, and the lit button.
//   2.5  Days after the first play: 7.
//   4.2  "Lend a tape for anyone with the link". Unavailable while the back
//        office asks (1.1.0 disables it while busy), then "1 tape ready."
//        arrives under the form, under the crop.
//   5.3  The page scrolls it into view: the line, the link in its box with
//        Copy link and Copy message, "Start by 14 Nov 2026." and the line's
//        rule, just above the fade at the crop's foot (the page's next
//        heading, "Tapes lent", stays under the crop).
//   6.8  Copy link: Copied. The scene holds that (1.1.0 puts "Copy link"
//        back after 1.5s; a scene that plays once holds its payoff).
//
// Compact (a phone, a finger), about 7s: the same page at a phone's width,
// opening on the form already filled in (typing on a phone needs the iOS
// number pad, which isn't the kit's to draw), then a tap on the button, a
// flick up to the line, a tap on Copy link: Copied.
//
// Framing: the stage draws a 1px edge down its sides and across its top
// (the page's room is the app's room), none at its foot: the page fades the
// stage's last 40px into the room (lend-place.css), so the back office reads
// as going on under the crop. Every frame keeps that band to filler: the
// membership card's hint as the scene opens, the box's foot on the phone,
// and the space under the line's rule at the end.
//
// Every word is the back office's own: web/src/admin/AdminApp.jsx (the bar),
// FilmDetail.jsx (the film's page), Tickets.jsx (the form and "1 tape
// ready."), ui.jsx (Mark, LinkBox, CopyButton). Its CSS is 1.1.0's
// (web/src/look/ui.css and office.css) at its sizes, scoped under .ln.

export const info: SceneInfo = {
  id: 'lend',
  label: 'Lend a tape, How it works',
  // Wide: step 3's picture column (600 at 1:1 where the column is that wide,
  // scaled down to its narrowest, 485, at 60rem). Compact: the phone column
  // under 36rem, where the page narrows the place to 358 (lend-place.css).
  wide: { width: 600, height: 700 },
  compact: { below: 480, width: 358, height: 586 },
  stills: [
    { file: 'lend.webp', layout: 'wide' },
    { file: 'lend-compact.webp', layout: 'compact' },
    { file: 'lend-start.webp', layout: 'wide', still: 'start' },
    { file: 'lend-start-compact.webp', layout: 'compact', still: 'start' },
  ],
}

// ------------------------------------------------------------ the shop's name

// 1.1.0 prints the shop's name in rub-down letters, each set by hand a
// little off (look/objects.jsx ShopName and Rub), seeded by the name so it
// is the same everywhere. The seeded generator and rubDown are 1.1.0's
// (web/src/membershipCard.js), copied as they are.
function hash(s: string) {
  let h = 2166136261 >>> 0
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

function rng(seed: string) {
  let a = hash(seed) >>> 0
  const next = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { range: (lo: number, hi: number) => lo + (hi - lo) * next() }
}

const f2 = (n: number) => Math.round(n * 100) / 100

// Latin letters stand alone, so each is set on its own
function rubDown(text: string, seed: string) {
  const R = rng(`${seed}:rub`)
  const set = (ch: string) => ({ ch, y: f2(R.range(-0.45, 0.45)), r: f2(R.range(-0.9, 0.9)), m: f2(R.range(-0.2, 0.5)) })
  return text.split(' ').map((word) => [...word].map(set))
}

const SHOP = 'The Lantern Room'
const RUB = rubDown(SHOP, `shop:${SHOP}`)
// Which of the three ink edges the name takes (ShopName's variant)
const INK = hash(`shop:${SHOP}`) % 3

// WebKit draws an SVG filter at one pixel to a CSS pixel whatever the
// screen, which blurs type on a 2x screen: there 1.1.0 leaves the ink's edge
// plain (objects.jsx plainInk), and so does the scene.
const plainInk = () =>
  typeof navigator !== 'undefined' &&
  /AppleWebKit/.test(navigator.userAgent) &&
  !/Chrome|Chromium|Edg|Android/.test(navigator.userAgent) &&
  (window.devicePixelRatio || 1) > 1

function ShopName() {
  return (
    <span className="ui-shopname">
      <span className="ui-shopname__print">
        {RUB.map((letters, w) => (
          <span key={w}>
            {w > 0 && ' '}
            <span className="nw">
              {letters.map((l, i) => (
                <span key={i} className="rub" style={{ transform: `translateY(${l.y}px) rotate(${l.r}deg)`, marginRight: `${l.m}px` }}>
                  {l.ch}
                </span>
              ))}
            </span>
          </span>
        ))}
      </span>
    </span>
  )
}

// The printed ink's edge (look/objects.jsx InkFilters, look-kp-<variant>),
// under the scene's own id: the scene draws its own defs, so the page, the
// preview and the stills all have it.
function InkDefs() {
  return (
    <svg className="ln-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id="ln-kp" x="-4%" y="-12%" width="108%" height="124%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves={2} seed={11 + INK} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={0.8} xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation={0.34} result="b" />
          <feComponentTransfer in="b">
            <feFuncA type="linear" slope={1.5} intercept={-0.08} />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  )
}

// ------------------------------------------------------------ the scene

type Scroll = 'top' | 'form' | 'ready'

type S = {
  /** Where the page is scrolled. */
  scroll: Scroll
  /** Page px a finger is holding the page past `scroll` (the phone's flick). */
  pull: number
  /** The scroll's own timing, when a throw sets it (the phone's flick). */
  ms: number | null
  ease: string
  /** Days after the first play has the focus. */
  focus: boolean
  days: string
  /** The back office is asking the server: the button is unavailable. */
  busy: boolean
  /** "1 tape ready." is under the form. */
  lent: boolean
  copied: boolean
}

const initial: S = { scroll: 'top', pull: 0, ms: null, ease: '', focus: false, days: '', busy: false, lent: false, copied: false }
// The phone's design opens on the form already filled in (see the top)
const phoneStart: Partial<S> = { scroll: 'form', days: '7' }
// The story's still: the tape lent and its link copied
const poster: S = { ...initial, scroll: 'ready', days: '7', lent: true, copied: true }
// Frames the development preview can draw as stills (stage.html &still=), for
// looking at each beat at rest
const FRAMES: Record<string, S> = {
  start: initial,
  form: { ...initial, scroll: 'form' },
  days: { ...initial, scroll: 'form', focus: true, days: '7' },
  busy: { ...initial, scroll: 'form', days: '7', busy: true },
  lent: { ...initial, scroll: 'form', days: '7', lent: true },
  ready: { ...poster, copied: false },
}

const LINK = 'https://lanternroom.example/t/k7mq3vxe9tbwp'
// Where the pointer rests as the scene takes over: empty page right of Take
// off the shelf, just above its first move (a finger shows nothing at rest)
const REST = { wide: { x: 520, y: 310 }, compact: { x: 300, y: 500 } }
const TABS = ['Films', 'Tapes', 'Members', 'Ledger', 'Status', 'Settings']

// The page's "screen": the width 1.1.0 lays the back office out at, and the
// scale it is shown at. Wide is the page at 600, as the stage; compact is a
// phone's 390 (the phone's layout, the shop's name over two lines) shown at
// the column's 358. `form`: the field the first scroll puts `over` px under
// the sticky bar, so the fields from it to the button show whole, the button
// clear of the fade at the crop's foot. The second scroll stops with the
// line's rule `foot` px (of the page) above the crop's foot, at or just above
// the fade (40 stage px): the page's next heading, "Tapes lent", is 40px under
// the rule, so it stays under the crop, and the field the sticky bar cuts at
// the top is under the bar whole (wide) or clear of it (compact).
const SCREEN: Record<Layout, { w: number; k: number; form: string; over: number; foot: number }> = {
  wide: { w: 600, k: 1, form: 'f-plays', over: 16, foot: 46 },
  compact: { w: 390, k: 358 / 390, form: 'f-start', over: 14, foot: 44 },
}

/** How far the page is scrolled for `scroll`, in the page's own px. Measured
 *  inside the content, which moves as one, so it doesn't depend on where the
 *  page is now. */
function scrollOf(scroll: Scroll, layout: Layout, rect: (name: string) => { x: number; y: number; width: number; height: number }) {
  const sc = SCREEN[layout]
  const content = rect('content')
  const viewH = rect('view').height / sc.k
  if (!content.height || !viewH) return 0
  const top = (name: string) => (rect(name).y - content.y) / sc.k
  const bottom = (name: string) => (rect(name).y + rect(name).height - content.y) / sc.k
  // The film's page opens at its top, a hair down (8px or so) so the crop's
  // foot falls in the empty foot of "Let them keep it" (its bottom padding),
  // with only its explanation under the fade
  const at = scroll === 'top' ? bottom('keep') - 6 - viewH : scroll === 'form' ? top(sc.form) - sc.over : bottom('ready') - viewH + sc.foot
  return Math.max(0, Math.round(at))
}

async function script(a: Act<S>) {
  if (a.layout === 'compact') return phone(a)

  // The opening holds a moment: the film's page, read before anything moves
  // (and the scene has taken over from its still: mount.css fades it in
  // over 220ms)
  await a.wait(700)

  // 1. Down the film's page to the form's fields, the pointer on the page's
  //    empty right-hand side while it scrolls, as a trackpad does
  a.mark('scroll')
  await a.move({ at: 'view', x: 0.86, y: 0.62 })
  await a.wait(120)
  await a.set({ scroll: 'form' })
  await a.wait(1150)

  // 2. Days after the first play: 7
  a.mark('days')
  await a.click({ at: 'days', x: 0.88, y: 0.55 })
  await a.set({ focus: true })
  await a.wait(220)
  await a.type('days', '7')
  await a.wait(550)

  // 3. Lend it, pressed below its words. The field lets go of the focus as
  //    the button goes down. The button is unavailable for the moment the
  //    back office asks (1.1.0 disables it while busy), then the line
  //    arrives under the form, under the crop
  a.mark('lend')
  await a.move({ at: 'lend', x: 0.8, y: 0.84 })
  const press = a.click()
  await a.wait(40)
  a.put({ focus: false })
  await press
  await a.set({ busy: true })
  await a.wait(240)
  await a.set({ busy: false, lent: true })
  await a.wait(220)

  // 4. Down to it, the pointer off the button on the box's empty right side
  a.mark('ready')
  await a.move({ at: 'f-many', x: 0.8, y: 0.45 })
  await a.wait(100)
  await a.set({ scroll: 'ready' })
  await a.wait(900)

  // 5. Copy link: Copied. The pointer leaves it for the empty line beside
  //    Copy message
  a.mark('copy')
  await a.click({ at: 'copy', x: 0.5, y: 0.84 })
  await a.set({ copied: true })
  await a.wait(250)
  await a.move({ at: 'copy', x: 0.6, y: 1.95 })
  await a.wait(1600)
}

// The phone: a finger, so a tap, a flick and a tap; no hover
async function phone(a: Act<S>) {
  await a.wait(900)

  // 1. Lend it: a tap low on the button, off its words; unavailable while
  //    the back office asks, then the line arrives under the form
  a.mark('lend')
  await a.click({ at: 'lend', x: 0.86, y: 0.8 })
  await a.set({ busy: true })
  await a.wait(240)
  await a.set({ busy: false, lent: true })
  await a.wait(420)

  // 2. A flick up the page: it follows the finger, then carries on at the
  //    finger's speed and settles with the line in view
  a.mark('ready')
  const k = SCREEN.compact.k
  const view = a.rect('view')
  const content = a.rect('content')
  const from = (view.y - content.y) / k
  const to = scrollOf('ready', 'compact', a.rect)
  const x = view.x + view.width * 0.8
  const y0 = view.y + view.height * 0.7
  const y1 = y0 - view.height * 0.3
  await a.move({ x, y: y0 })
  await a.wait(120)
  const samples: { y: number; t: number }[] = []
  await a.drag(
    { x, y: y1 },
    (at) => {
      samples.push({ y: at.y, t: performance.now() })
      a.put({ scroll: 'form', pull: Math.max(0, (y0 - at.y) / k), ms: 0 })
    },
    { duration: 260, path: (t, p0, p1) => ({ x: p0.x, y: p0.y + (p1.y - p0.y) * t }) },
  )
  const last = samples.slice(-4)
  const dragged = samples.length ? (y0 - samples[samples.length - 1]!.y) / k : 0
  const v = last.length > 1 ? Math.abs(last[last.length - 1]!.y - last[0]!.y) / k / Math.max(1, last[last.length - 1]!.t - last[0]!.t) : 1
  const rest = Math.max(1, to - from - dragged)
  const throwMs = 640
  // A curve whose first slope is the finger's speed, easing out to rest
  const x1 = 0.25
  const y1c = Math.min(0.9, (x1 * v * throwMs) / rest)
  a.put({ scroll: 'ready', pull: 0, ms: throwMs, ease: `cubic-bezier(${x1}, ${y1c.toFixed(3)}, 0.3, 1)` })
  await a.wait(throwMs + 500)

  // 3. Copy link: Copied
  a.mark('copy')
  await a.click({ at: 'copy', x: 0.5, y: 0.7 })
  await a.set({ copied: true })
  await a.wait(1800)
}

/** `still` is for the development preview's exports only: the page mounts the
 *  scene with no props. 'start' draws the opening frame, the still the page
 *  shows until the live scene has drawn over it. */
export default function LendScene({ still }: { still?: string } = {}) {
  const ink = !plainInk()
  // Which design the place will show, measured as the Stage measures it, so
  // the phone's design gets a finger, not a mouse pointer, from its first run
  const place = useRef<HTMLDivElement>(null)
  const [phoneSized, setPhoneSized] = useState(false)
  useLayoutEffect(() => {
    const el = place.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      if (w) setPhoneSized(w < info.compact.below)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={place} className="ln-place">
      <Stage<S>
        width={info.wide.width}
        height={info.wide.height}
        compact={info.compact}
        theme="dark"
        fidelity="realistic"
        initial={initial}
        poster={(still && FRAMES[still]) || poster}
        script={script}
        play="once"
        cursor={phoneSized ? { at: REST, style: 'touch' } : { at: REST }}
        className="om ln"
      >
        {(s0, rect, layout) => {
          // The phone opens on the form filled in, until its flick moves on
          const s: S = layout === 'compact' && s0.scroll === 'top' ? { ...s0, ...phoneStart } : layout === 'compact' && !s0.days ? { ...s0, days: '7' } : s0
          const sc = SCREEN[layout]
          const offset = scrollOf(s.scroll, layout, rect) + s.pull
          const transform = `translate3d(0, ${-Math.round(offset)}px, 0)`
          return (
            <>
              <div
                className="ln-page ui-office"
                data-ink={ink || undefined}
                style={{ width: sc.w, height: (layout === 'wide' ? info.wide.height : info.compact.height) / sc.k, transform: sc.k === 1 ? undefined : `scale(${sc.k})` }}
              >
                <InkDefs />
                {/* The back office's menu: a bar across the top under 800px, sticky */}
                <div className="ui-office__nav">
                  <span className="ui-office__brand">
                    <ShopName />
                    <span className="ui-office__brand-k">Back office</span>
                  </span>
                  <span className="ui-tabs">
                    <span className="ui-tabs__row">
                      {TABS.map((t) => (
                        <span key={t} className="ui-tab" data-on={t === 'Films' || undefined}>
                          {t}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="ui-office__foot">
                    <span className="ui-nav__item">View the shop</span>
                    <span className="ui-nav__item">Sign out</span>
                  </span>
                </div>

                <div className="ln-view" data-target="view">
                  <div
                    className="ui-office__main"
                    data-target="content"
                    data-scroll={s.scroll}
                    style={{ transform, transition: s.ms === null ? undefined : s.ms ? `transform ${s.ms}ms ${s.ease}` : 'none' }}
                  >
                    <div className="ui-office__page">
                      <FilmPage s={s} layout={layout} />
                    </div>
                  </div>
                </div>
              </div>
              {/* The page's room is the site's room: a 1px rule down the crop's
                  sides and across its top parts them; its foot fades instead */}
              <div className="ln-edge" />
            </>
          )
        }}
      </Stage>
    </div>
  )
}

// A field: its label, the box and the hint under it (ui.css .ui-field)
function UiField({ label, optional, children, hint, target }: { label: string; optional?: boolean; children: ReactNode; hint: string; target?: string }) {
  return (
    <span className="ui-field" data-target={target}>
      <span className="ui-field__label">
        {label}
        {optional && <small> (optional)</small>}
      </span>
      {children}
      <span className="ui-field__hint">{hint}</span>
    </span>
  )
}

// Dr. Strangelove's page in the back office, on its Tapes tab
// (admin/FilmDetail.jsx), with its lending form (admin/Tickets.jsx IssueTicket)
function FilmPage({ s, layout }: { s: S; layout: Layout }) {
  // CopyButton: its word changes at once and the button takes the new word's
  // width, as 1.1.0's does
  const copy = (
    <span className="ui-btn ui-btn--small" data-target="copy" data-cursor="hand" data-snap="">
      {s.copied ? 'Copied' : 'Copy link'}
    </span>
  )
  return (
    <>
      <span className="of-back">
        <span aria-hidden="true">←</span>Films
      </span>
      <span className="of-head">
        <span className="of-filmhead">
          <span className="of-filmhead__sleeve">
            {/* The plain kraft sleeve, as a thumbnail (no label at this size) */}
            {/* A deliberate crop: the plain board under the step's own sleeve's label */}
            <span className="ln-sleeve" data-crop="">
              <img src="/img/obj-sleeve.webp" alt="" width="220" height="326" />
            </span>
          </span>
          <span className="of-filmhead__main">
            <span className="of-h1">Dr. Strangelove</span>
            <span className="of-facts">
              <span>1964</span>
              <span>1 h 35 min</span>
              <span>/dr-strangelove</span>
            </span>
            <span className="of-marks">
              <span className="of-mark">On the shelf</span>
              <span className="of-mark">Media OK</span>
            </span>
          </span>
        </span>
        <span className="ui-btns">
          <span className="ui-btn">Preview the page</span>
          <span className="ui-btn">Take off the shelf</span>
        </span>
      </span>

      <span className="ui-tabs of-tabs">
        <span className="ui-tabs__row">
          <span className="ui-tab" data-on="">
            Tapes
          </span>
          <span className="ui-tab">Details</span>
          <span className="ui-tab">Media</span>
        </span>
      </span>

      <span className="of-h2">Lend a tape</span>
      <span className="of-box" data-target="box">
        <span className="ui-fieldset of-w">
          <span className="ui-legend">Who can use it?</span>
          <span className="ui-choice" data-on="">
            <span className="ui-radio" data-on="" />
            <span>
              <b>Anyone with the link</b>
              <small>Like a real tape: whoever has the link can use it, on any device, TVs included.</small>
            </span>
          </span>
          <span className="ui-check of-under" data-target="keep">
            <span className="ui-box" />
            <span>
              Let them keep it on their membership card
              <small>A member can keep it, so it's on every device they sign in on. Whoever keeps it first takes it from everyone else with the link.</small>
            </span>
          </span>
          <span className="ui-choice">
            <span className="ui-radio" />
            <span>
              <b>Only one member, signed in</b>
              <small>The link only works for that member, signed in with their passkey. Forwarding it does nothing. TVs usually can’t sign in.</small>
            </span>
          </span>
        </span>

        <span className="of-grid2 of-w">
          <UiField label="Who is it for?" hint="Only you see this. It's a label, not a check: whoever has the link can use the tape.">
            <span className="ui-input">
              <span className="ui-input__ph">e.g. Sam</span>
            </span>
          </UiField>
          <UiField label="Plays" target="f-plays" hint="Each press of Play uses one; pausing and coming back doesn't. Leave empty for no limit.">
            <span className="ui-input ui-input--num" data-target="plays">
              1
            </span>
          </UiField>
          <UiField label="Start by" optional target="f-start" hint="If they haven't pressed Play by the end of this day, the tape expires.">
            {/* A date field as Safari draws it in en-GB: on a Mac its editable
                day, month and year; on an iPhone the date in words */}
            <span className="ui-input">{layout === 'compact' ? '14 Nov 2026' : '14/11/2026'}</span>
          </UiField>
          <UiField label="Days after the first play" optional target="f-days" hint="Counted from when they first press Play, not when they open the link.">
            <span className="ui-input ui-input--num" data-target="days" data-cursor="ibeam" data-focused={s.focus || undefined}>
              {/* The placeholder lies under the caret, which starts at the
                  field's start; both go with the first key, at once */}
              {!s.days && (
                <span className="ui-input__ph" data-snap="">
                  No limit
                </span>
              )}
              {s.days && (
                <span className="ui-input__v" data-typing="">
                  {s.days}
                </span>
              )}
              {s.focus && <span key={s.days.length} className="ui-input__caret" />}
            </span>
          </UiField>
          <UiField label="How many tapes" target="f-many" hint="Each gets its own link.">
            <span className="ui-input ui-input--num">1</span>
          </UiField>
        </span>
        <span className="ui-btns">
          <span className="ui-btn ui-btn--primary" data-target="lend" data-cursor="hand" data-disabled={s.busy || undefined}>
            Lend a tape for anyone with the link
          </span>
        </span>
      </span>

      {s.lent ? (
        <Fragment key="lent">
          {/* "1 tape ready." (Tickets.jsx), a system line ruled above and below */}
          <span className="ui-line ui-line--done ui-line--block of-ready" data-target="ready">
            <span>
              <b>1 tape ready. </b>
              Send each link to the person it's for.
              {/* LinkBox: a row that wraps. At 600 the address and Copy link
                  share the first line and Copy message wraps under them; at a
                  phone's 390 the address has the line to itself. Drawn as the
                  rows it wraps into */}
              <span className="of-linkbox">
                <span className="of-linkbox__row">
                  {/* the address's box takes what Copy link leaves, so it
                      widens at once when Copied is the shorter word, as in 1.1.0 */}
                  <span className="ln-code" data-snap="">
                    {LINK}
                  </span>
                  {layout === 'wide' && copy}
                </span>
                <span className="of-linkbox__row">
                  {layout === 'compact' && copy}
                  {/* beside Copy link on the phone: it moves up at once as the word shortens */}
                  <span className="ui-btn ui-btn--small" data-snap={layout === 'compact' || undefined}>
                    Copy message
                  </span>
                </span>
              </span>
              <span className="of-dim">Start by 14 Nov 2026.</span>
            </span>
          </span>
          {/* What the page shows under it once its tapes are read again */}
          <span className="of-h2" data-target="lent-h">
            Tapes lent
          </span>
        </Fragment>
      ) : (
        <Fragment key="members">
          <span className="of-h2">Members</span>
          <span className="ui-check of-w">
            <span className="ui-box" />
            <span>
              <b>Show to members</b>
              <small>Signed-in members see it on their front page and can read its page. Playing it still needs a tape.</small>
            </span>
          </span>
        </Fragment>
      )}
    </>
  )
}
