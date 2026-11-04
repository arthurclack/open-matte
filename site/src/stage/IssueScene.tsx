// The kit's parts by file, not through its index, so only their own CSS ships
import { Stage } from '../stageshow-kit/stage'
import type { Act } from '../stageshow-kit/act'
import type { Layout } from '../stageshow-kit/looks'
import { Bar } from '../stageshow-kit/window'
import { Collapse } from '../stageshow-kit/motion/Collapse'
import { States } from '../stageshow-kit/motion/States'
import { Field } from '../stageshow-kit/controls/Field'
import './look.css'
import './issue.css'

// "Send a ticket": the admin, on a film's page, issuing a ticket for anyone
// with the link. The admin's own page, cropped, with no browser drawn round it
// (Hallmark's Floor: no hand-drawn browser bar), narrow enough that it shows
// its top bar (as it does under 800px), scrolled to the film's ticket form.
// "Who is it for?" already says Sam (a note only the admin sees), so the story
// reaches its press within about two seconds of the plate appearing. Beats:
//   1. "Days valid after first play": 7. Screenings is already 1.
//   2. Issue ticket for anyone with the link: the field clears, as the app
//      clears it, and "1 ticket ready." drops in under the form.
//   3. The page scrolls the new link into view (at the phone column the page
//      carries the notice up as it opens, so the crop never cuts it).
//   4. Copy link: Copied. The scene plays once and holds that.
//
// At the phone column (compact) the page is a square crop, already scrolled to
// the lower fields, and the link box keeps only Copy link so the link shows.
//
// Every word is the admin's own (web/src/admin/Tickets.jsx, AdminApp.jsx); the
// choices' explanations are filler lines. No tab is current: the admin's Films
// link only lights on its own list, not on a film's page.

type S = {
  focus: 'label' | 'days' | null
  label: string
  days: string
  pressed: boolean
  issued: boolean
  /** The page scrolled so the issued link shows. */
  scrolled: boolean
  copied: boolean
}

const initial: S = { focus: null, label: 'Sam', days: '', pressed: false, issued: false, scrolled: false, copied: false }
// The still: the link made and copied
const poster: S = { focus: null, label: '', days: '7', pressed: false, issued: true, scrolled: true, copied: true }

const LINK = 'https://backrow.example/t/k7mq2xh9frw4d'
const TABS = ['Films', 'Tickets', 'People', 'Activity', 'Status', 'Settings']
// The tab row scrolls sideways when the window is narrow; the crop shows the
// ones that fit whole
const SHOWN: Record<Layout, number> = { wide: 6, compact: 4 }

const GEO: Record<Layout, { x: number; y: number; w: number; h: number; gap: number; stage: number }> = {
  wide: { x: 40, y: 40, w: 520, h: 620, gap: 40, stage: 560 },
  compact: { x: 16, y: 16, w: 326, h: 420, gap: 16, stage: 342 },
}

async function script(a: Act<S>) {
  // A beat first, so the pointer leaves its rest only once the scene has
  // taken over from its still (mount.css fades it in over 220ms)
  await a.wait(300)

  // 1. Days valid after first play: 7
  a.mark('days')
  await a.click({ at: 'days', x: 0.6, y: 0.55 })
  await a.set({ focus: 'days' })
  await a.wait(200)
  await a.type('days', '7')
  await a.wait(450)

  // 2. Issue it: the note clears and the link arrives under the form
  a.mark('issue')
  await a.click({ at: 'issue', x: 0.78, y: 0.6 })
  if (a.layout === 'compact') {
    // The page carries the notice up as it opens, so no frame shows it cut
    // through its words by the crop's foot
    await a.set({ focus: null, issued: true, label: '', scrolled: true })
    a.mark('scroll')
    await a.wait(950)
  } else {
    await a.set({ focus: null, issued: true, label: '' })
    await a.wait(350)

    // 3. Scroll it into view, from the empty part of the card beside the button
    a.mark('scroll')
    await a.move({ at: 'issue', x: 1.55, y: 0.4 })
    await a.wait(120)
    await a.set({ scrolled: true })
    await a.wait(900)
  }

  // 4. Copy link: Copied
  a.mark('copy')
  await a.click({ at: 'copy', x: 0.5, y: 0.6 })
  await a.set({ copied: true })
  await a.move({ at: 'notice', x: 0.9, y: 0.4 })
  await a.wait(1400)
}

/** `still` is for the development preview's exports only: the page mounts the
 *  scene with no props. 'start' draws the opening frame, the still the page
 *  shows until the live scene has drawn over it. */
export default function IssueScene({ still }: { still?: 'start' } = {}) {
  const start = still === 'start'
  return (
    <Stage<S>
      width={600}
      height={560}
      compact={{ below: 600, width: 358, height: 342 }}
      theme="dark"
      initial={initial}
      poster={start ? initial : poster}
      script={script}
      play="once"
      cursor={{ at: { wide: { x: 470, y: 520 }, compact: { x: 300, y: 318 } }, still: start }}
      className="om is"
    >
      {(s, rect, layout) => {
        const g = GEO[layout]
        // How far the page scrolls: enough to bring the issued link a gutter
        // above the stage's foot. Measured within the content, which moves as
        // one, so the offset doesn't depend on where it is now.
        const content = rect('content')
        const notice = rect('notice')
        const view = rect('viewport')
        const foot = g.stage - view.y
        const bottom = notice.y + notice.height - content.y
        // Compact starts scrolled to the start-by field, 12px under the bar
        const startBy = rect('startby')
        const base = layout === 'compact' && startBy.height ? Math.round(startBy.y - content.y - 12) : 0
        const offset = s.scrolled && notice.height ? Math.max(base, Math.round(bottom - foot + g.gap)) : base
        return (
          // ss-window: the kit's app surface, here with no chrome at all
          <div className="ss-window is-win" style={{ left: g.x, top: g.y, width: g.w, height: g.h }}>
            <nav className="is-nav">
              <div className="is-nav__top">
                <span className="is-brand">Open Matte</span>
                <span className="is-nav__links">
                  <span>View site</span>
                  <span>Sign out</span>
                </span>
              </div>
              <div className="is-tabs">
                {TABS.slice(0, SHOWN[layout]).map((t) => (
                  <span key={t} className="is-tab">
                    {t}
                  </span>
                ))}
              </div>
            </nav>

            <div className="is-viewport" data-target="viewport">
              <div className="is-content" data-target="content" style={{ transform: `translate3d(0, ${-offset}px, 0)` }}>
                <div className="is-h2">Tickets</div>
                <div className="is-card">
                  <div className="is-label">Who can use it?</div>
                  <div className="is-choice" data-on="">
                    <span className="is-radio" data-on="" />
                    <span className="is-choice__text">
                      <span className="is-choice__name">Anyone with the link</span>
                      <Bar w="88%" h={6} tone={3} />
                    </span>
                  </div>
                  <div className="is-keep">
                    <span className="is-check" />
                    <span className="is-choice__text">
                      <span className="is-keep__name">Let them keep it in their account</span>
                      <Bar w="72%" h={6} tone={2} />
                    </span>
                  </div>
                  <div className="is-choice">
                    <span className="is-radio" />
                    <span className="is-choice__text">
                      <span className="is-choice__name">Only a person, signed in</span>
                      <Bar w="80%" h={6} tone={2} />
                    </span>
                  </div>

                  <div className="is-grid">
                    <Field label="Who is it for?" value={s.label} placeholder="e.g. Sam" focused={s.focus === 'label'} box={{ 'data-target': 'label' }} className="is-field" />
                    <Field label="Screenings" value="1" className="is-field" />
                    <Field label="Start watching by (optional)" value="" placeholder="dd/mm/yyyy" className="is-field" data-target="startby" />
                    <Field label="Days valid after first play (optional)" value={s.days} placeholder="No limit" focused={s.focus === 'days'} box={{ 'data-target': 'days' }} className="is-field" />
                  </div>
                  <span className="is-issue" data-target="issue">
                    Issue ticket for anyone with the link
                  </span>
                </div>

                <Collapse open={s.issued} reveal="drop" className="is-notice-slot">
                  <div className="is-notice" data-target="notice">
                    <p className="is-notice__lead">
                      <strong>1 ticket ready.</strong> Send each link to the person it's for.
                    </p>
                    <div className="is-notice__for">For Sam</div>
                    <div className="is-linkbox">
                      <code>{LINK}</code>
                      <span className="is-btn" data-target="copy">
                        {/* Both labels in one slot, so Copied moves nothing beside it */}
                        <States value={s.copied ? 'copied' : 'copy'} states={{ copy: 'Copy link', copied: 'Copied' }} />
                      </span>
                      {layout === 'wide' && <span className="is-btn">Copy message</span>}
                    </div>
                  </div>
                </Collapse>
              </div>
            </div>
          </div>
        )
      }}
    </Stage>
  )
}
