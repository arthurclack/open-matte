import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { useLook } from './looks'
import { Roll } from './motion/Roll'
import './messages.css'

// Message threads the way messaging apps draw them: runs of bubbles where only
// the last in a run has a tail, a typing indicator that grows into the reply,
// and older messages easing up as new ones arrive. One part for iMessage-style
// threads and for AI chat, where the reply is plain text with no bubble.

// Whether the thread has finished its first render: bubbles there from the
// start are the opening picture and don't rise in; only arrivals do
const Ready = createContext<{ current: boolean }>({ current: true })

// offsetTop rounds to whole pixels. Keep fractional positions through the
// FLIP, including inside a scaled Phone, or a row steps before its glide starts.
// Measured at each child's foot (this copy; the kit measures its top): the
// thread stands on its bottom, so a bubble that grows in place has not moved,
// and only what is above it glides.
function threadFeet(root: HTMLElement) {
  const style = getComputedStyle(root)
  const extra = style.boxSizing === 'border-box' ? 0 :
    [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth].reduce((sum, value) => sum + (parseFloat(value) || 0), 0)
  const width = parseFloat(style.width) + extra
  const scale = (width && root.getBoundingClientRect().width / width) || 1
  const parents = new Map<Element, number>()
  return new Map(Array.from(root.children, (el) => {
    const parent = (el as HTMLElement).offsetParent
    if (parent && !parents.has(parent)) parents.set(parent, parent.getBoundingClientRect().top)
    return [el, (el.getBoundingClientRect().bottom - (parent ? parents.get(parent)! : 0)) / scale]
  }))
}

// How far a row is still translated by a glide under way, in its own pixels
function translatedY(el: HTMLElement) {
  const value = getComputedStyle(el).translate
  if (!value || value === 'none') return 0
  return parseFloat(value.split(/\s+/)[1] ?? '0') || 0
}

// A bubble's border box in its own (unscaled) pixels, fractions kept
function borderBox(el: HTMLElement) {
  const cs = getComputedStyle(el)
  const extra = (a: string, b: string, c: string, d: string) =>
    cs.boxSizing === 'border-box' ? 0 : [a, b, c, d].reduce((sum, value) => sum + (parseFloat(value) || 0), 0)
  return {
    w: parseFloat(cs.width) + extra(cs.paddingLeft, cs.paddingRight, cs.borderLeftWidth, cs.borderRightWidth),
    h: parseFloat(cs.height) + extra(cs.paddingTop, cs.paddingBottom, cs.borderTopWidth, cs.borderBottomWidth),
  }
}

export interface ThreadProps {
  /**
   * imessage: blue and gray bubbles with tails (sms for green). chat: the
   * AI-app look, a quiet gray bubble for the person and plain text for the reply.
   */
  app?: 'imessage' | 'sms' | 'chat'
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

/**
 * A column of messages pinned to its bottom, as a conversation is. Messages
 * already on screen glide up when one arrives instead of jumping; the thread
 * clips what scrolls off its top, so put it under a header or let the stage
 * crop it. Tails go on the last bubble of each run automatically.
 */
export function Thread({ app = 'imessage', className, style, children }: ThreadProps) {
  const ref = useRef<HTMLDivElement>(null)
  const ready = useRef(false)
  // Where each message is right before this update. Read fresh every time,
  // not remembered from the last update: CSS motion in between (a receipt
  // opening, a bubble growing) moves messages without a render, and a stale
  // position would glide them from somewhere they no longer are
  const feet = ref.current ? threadFeet(ref.current) : new Map<Element, number>()
  useEffect(() => {
    ready.current = true
  }, [])
  // Glide: every message that moved since the last render starts where it
  // was and eases to where it is (FLIP), so an arrival pushes the rest up
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const next = threadFeet(root)
    for (const [node, foot] of Array.from(next)) {
      const el = node as HTMLElement
      const was = feet.get(el)
      if (was === undefined || Math.abs(was - foot) < 0.001) continue
      // Start from where it is on screen: a glide still under way continues
      // from its current offset instead of jumping back (by translate, on the
      // layer each row keeps, so a bubble and its words move as one picture)
      const now = translatedY(el)
      el.style.transition = 'none'
      el.style.translate = `0 ${was + now - foot}px`
      void el.offsetWidth
      el.style.transition = ''
      el.style.translate = ''
    }
  })
  // A tail closes each run: the last bubble before the sender changes
  const list = Children.toArray(children).filter(isValidElement) as ReactElement<BubbleProps>[]
  const fromOf = (c: ReactElement<BubbleProps>) => (c.type === Bubble ? c.props.from : null)
  const out = list.map((c, i) => {
    if (c.type !== Bubble || c.props.tail !== undefined) return c
    const next = list.slice(i + 1).find((n) => n.type === Bubble)
    return cloneElement(c, { tail: !next || fromOf(next) !== c.props.from })
  })
  return (
    <Ready.Provider value={ready}>
      <div ref={ref} className={`ss-thread${className ? ` ${className}` : ''}`} data-app={app} style={style}>
        {out}
      </div>
    </Ready.Provider>
  )
}

export interface BubbleProps {
  /** me sits on the right in the accent bubble; them on the left. */
  from: 'me' | 'them'
  /** Three bouncing dots in place of the text. Turning it off grows the bubble into the message. */
  typing?: boolean
  /** Set by Thread: true on the last bubble of a run. */
  tail?: boolean
  /**
   * Where the message comes from, as iMessage sends: a target name (or a
   * CSS selector) for the composer's text. The bubble forms out of it, the words
   * lifting from the field into place while the bubble fills in around them,
   * instead of rising in. Clear the field in the same update that adds the bubble.
   */
  source?: string
  /**
   * A tapback on this bubble: the emoji, and `show` to pop it in and out. It
   * sits in a white circle on the bubble's bottom corner, and the bubble makes
   * room below so the emoji never covers the words.
   */
  tapback?: { emoji: ReactNode; show?: boolean }
  /** A small `Avatar` beside a received bubble, as a group chat shows who is speaking. */
  avatar?: ReactNode
  className?: string
  style?: CSSProperties
  children?: ReactNode
  /** data-target and other data attributes land on the bubble itself. */
  [data: `data-${string}`]: unknown
}

/**
 * One message. Bubbles in the thread on its first render are the opening
 * picture and don't animate; only later arrivals rise in. In minimal
 * fidelity a string message becomes a bar.
 */
export function Bubble({ avatar, from, typing = false, tail, source, tapback, className, style, children, ...data }: BubbleProps) {
  const { fidelity } = useLook()
  const arrived = useRef(useContext(Ready).current).current
  const ref = useRef<HTMLDivElement>(null)
  const size = useRef<{ w: number; h: number } | null>(null)
  // Whether this bubble grew out of the typing dots (its words fade in as it grows)
  const wasTyping = useRef(typing)
  const grew = useRef(false)
  if (wasTyping.current && !typing) grew.current = true
  wasTyping.current = typing
  // Morph: measure the bubble before and after the content changes. The box
  // takes its new size at once (nothing is laid out frame by frame); a clip
  // shows it at the old size on its tail's corner and opens to the new
  // (messages.css, data-morph). This copy: the kit eases width and height.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const was = size.current
    // Resolved CSS dimensions retain the fractions offsetWidth/Height round away
    const now = borderBox(el)
    size.current = now
    if (!was) return
    // It only grows into place: a side that shrinks takes its size at once
    const dx = Math.max(0, now.w - was.w)
    const dy = Math.max(0, now.h - was.h)
    if (dx < 0.5 && dy < 0.5) return
    el.style.transition = 'none'
    el.style.setProperty('--ss-grow-x', `${dx}px`)
    el.style.setProperty('--ss-grow-y', `${dy}px`)
    el.setAttribute('data-morph', 'from')
    void el.offsetWidth
    el.style.transition = ''
    el.setAttribute('data-morph', 'run')
    const end = (e: TransitionEvent) => {
      if (e.target !== el || e.pseudoElement || e.propertyName !== 'clip-path') return
      el.removeEventListener('transitionend', end)
      el.removeAttribute('data-morph')
      el.style.removeProperty('--ss-grow-x')
      el.style.removeProperty('--ss-grow-y')
    }
    el.addEventListener('transitionend', end)
    return () => el.removeEventListener('transitionend', end)
  }, [typing, children])
  // Form out of the composer: start where the field's words were, in the
  // field's color with no fill, and travel into place as the fill comes in
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !arrived || !source) return
    const stage = el.closest('.ss-stage') ?? document
    const src = stage.querySelector<HTMLElement>(`[data-target="${source}"]`) ?? stage.querySelector<HTMLElement>(source)
    const text = el.querySelector<HTMLElement>('.ss-bubble__text')
    if (!src || !text) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || el.closest('[data-still]')) return
    // Measure where it rests, not where an earlier run already moved it
    el.style.transition = 'none'
    el.style.left = el.style.top = '0px'
    const k = el.getBoundingClientRect().width / el.offsetWidth || 1
    const o = src.getBoundingClientRect()
    const t = text.getBoundingClientRect()
    const dx = (o.left - t.left) / k
    const dy = (o.top + o.height / 2 - (t.top + t.height / 2)) / k
    const ease = 'cubic-bezier(0.22, 1, 0.36, 1)'
    // Travels by left and top, so the words land without a sub-pixel hop
    el.style.transition = 'none'
    el.style.left = `${dx}px`
    el.style.top = `${dy}px`
    el.setAttribute('data-flying', '')
    el.style.color = getComputedStyle(src).color
    void el.offsetWidth
    el.style.transition = `left 0.5s ${ease}, top 0.5s ${ease}, color 0.3s ease 0.06s`
    el.style.left = el.style.top = ''
    el.removeAttribute('data-flying')
    el.style.color = ''
    const end = (e: TransitionEvent) => {
      if (e.target !== el || e.propertyName !== 'top') return
      el.style.transition = ''
      el.removeEventListener('transitionend', end)
    }
    el.addEventListener('transitionend', end)
    return () => el.removeEventListener('transitionend', end)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  let body = children
  if (fidelity === 'minimal' && typeof children === 'string') body = <span className="ss-bar ss-bubble__bar" style={{ width: Math.min(180, children.length * 5.5) }} />
  return (
    <div className={`ss-bubble-row${className ? ` ${className}` : ''}`} data-from={from} data-avatar={avatar ? '' : undefined} style={style}>
      {avatar && from !== 'me' && <span className="ss-bubble__avatar" aria-hidden>{avatar}</span>}
      <div {...data} ref={ref} className="ss-bubble" data-arrived={arrived || undefined} data-source={source ? '' : undefined} data-tail={tail || undefined} data-typing={typing || undefined} data-grew={grew.current || undefined} data-tapback={tapback && tapback.show !== false ? '' : undefined}>
        {tapback && (
          <span className="ss-tapback" data-show={tapback.show !== false || undefined} aria-hidden>
            <span className="ss-tapback__emoji">{tapback.emoji}</span>
          </span>
        )}
        {typing ? (
          <span className="ss-bubble__dots" aria-label="typing">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <span className="ss-bubble__text">{body}</span>
        )}
        {/* Always drawn, so a tail grows out of the corner when its bubble
            becomes the last of a run, and retracts when it stops being */}
        <svg className="ss-bubble__tail" viewBox="0 0 18 16" aria-hidden>
          <path d={from === 'me' ? 'M0 0H12V8.5C12 12.6 14 15 17.5 16C15 16.7 12.2 16.5 9.8 15.3L0 15Z' : 'M18 0H6V8.5C6 12.6 4 15 0.5 16C3 16.7 5.8 16.5 8.2 15.3L18 15Z'} />
        </svg>
      </div>
    </div>
  )
}

/** A centered timestamp between runs ("Today 9:41"). */
export function Stamp({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`ss-stamp${className ? ` ${className}` : ''}`}>{children}</div>
}

/**
 * The small status under your last message. `children` rolls when it changes
 * (Delivered to Read); `show` false folds it away.
 */
export function Receipt({ show = true, children, className }: { show?: boolean; children: string; className?: string }) {
  return (
    <div className={`ss-receipt${className ? ` ${className}` : ''}`} data-show={show || undefined}>
      <span>
        <Roll variant="fade">{children}</Roll>
      </span>
    </div>
  )
}
