// Mounts the scenes into the page.
//
// The page marks each scene's place with data-scene ("ticket" or "issue") and
// puts the scene's stills inside it, as a picture with real alt text:
//
//   <figure class="scene" data-scene="ticket" data-label="the ticket demo">
//     <picture>
//       <source data-start media="(scripting: enabled) and (prefers-reduced-motion: no-preference)" srcset="/stage/ticket-start.webp" …>
//       <source media="(max-width: 511.98px)" srcset="/stage/ticket-compact.webp" width="358" height="500">
//       <img src="/stage/ticket.webp" width="540" height="700" alt="…">
//     </picture>
//   </figure>
//
// The img (and its compact source) is the story's still: the whole scene with
// scripting off and under reduced motion. Where the scene will play, the
// sources marked data-start come first: the scene's opening frame, so when the
// live scene draws over it nothing changes. A scene's code loads as its
// section comes near the viewport; once it has drawn its first settled frame,
// the still steps aside (kept for screen readers: the moving layer is
// aria-hidden and inert) and the scene plays while it is on screen (the kit's
// Stage pauses it off screen). Nothing in a scene takes focus.
//
// Each live scene gets a Pause button above its top-right corner (the scenes
// run past five seconds). It shows as the scene takes over from its still,
// not before. Pause takes the scene down and shows the story's still again;
// Play brings it back from its opening frame. A scene that plays once and has
// finished (the kit marks its stage data-done) offers Replay instead: from its
// opening frame again. data-label names the scene in the button's accessible
// name.

import type { ComponentType } from 'react'
import type { Root } from 'react-dom/client'
import './mount.css'

const SCENES: Record<string, () => Promise<{ default: ComponentType }>> = {
  ticket: () => import('./TicketScene'),
  issue: () => import('./IssueScene'),
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const live = new WeakMap<HTMLElement, { root: Root; layer: HTMLElement; watch: MutationObserver }>()
const SVG = 'http://www.w3.org/2000/svg'

// The opening-frame stills on (the scene is about to play from its start) or
// off (paused, or the scene failed to load: the story's still shows instead).
// Changing a source's media makes the picture choose again.
function openingStills(host: HTMLElement, on: boolean) {
  host.querySelectorAll<HTMLSourceElement>('source[data-start]').forEach((source) => {
    if (!on && source.dataset.media === undefined) {
      source.dataset.media = source.media
      source.media = 'not all'
    } else if (on && source.dataset.media !== undefined) {
      source.media = source.dataset.media
      delete source.dataset.media
    }
  })
}

async function mount(host: HTMLElement) {
  const load = SCENES[host.dataset.scene ?? '']
  if (!load || host.dataset.mounted) return
  host.dataset.mounted = 'loading'
  try {
    const [{ createRoot }, { createElement }, { default: Scene }] = await Promise.all([import('react-dom/client'), import('react'), load()])
    const layer = document.createElement('div')
    layer.className = 'scene-live'
    layer.setAttribute('aria-hidden', 'true')
    layer.setAttribute('inert', '')
    host.append(layer)
    const root = createRoot(layer)
    root.render(createElement(Scene))
    const control = toggle(host)
    // A scene that plays once says when it has finished: Pause becomes Replay
    const watch = new MutationObserver(() => {
      if (live.get(host)?.layer === layer) control.sync(layer.querySelector('.ss-stage[data-done]') ? 'done' : 'playing')
    })
    watch.observe(layer, { subtree: true, attributes: true, attributeFilter: ['data-done'] })
    live.set(host, { root, layer, watch })
    host.dataset.mounted = 'yes'
    control.sync('playing')
    // Swap once the stage has measured and settled (fonts in, nothing placed
    // from a guess), so the still never gives way to a half-drawn frame
    const settled = () => {
      if (live.get(host)?.layer !== layer) return
      const stage = layer.querySelector('.ss-stage')
      if (stage && !stage.hasAttribute('data-placing')) {
        host.setAttribute('data-live', '')
        control.button.removeAttribute('data-pending')
      } else requestAnimationFrame(settled)
    }
    requestAnimationFrame(settled)
  } catch (err) {
    // The story's still stays: it is the scene without its motion
    openingStills(host, false)
    delete host.dataset.mounted
    console.error('Scene failed to load', err)
  }
}

function unmount(host: HTMLElement) {
  const scene = live.get(host)
  if (!scene) return
  live.delete(host)
  scene.watch.disconnect()
  host.removeAttribute('data-live')
  scene.root.unmount()
  scene.layer.remove()
  delete host.dataset.mounted
}

// The Pause / Play button, made once per scene and kept. Made hidden
// (data-pending): it shows when the scene first takes over from its still
type Now = 'playing' | 'paused' | 'done'
const toggles = new WeakMap<HTMLElement, { sync: (now: Now) => void; button: HTMLButtonElement }>()
function toggle(host: HTMLElement) {
  const made = toggles.get(host)
  if (made) return made
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'scene-toggle'
  button.setAttribute('data-pending', '')
  const icon = document.createElementNS(SVG, 'svg')
  icon.setAttribute('viewBox', '0 0 16 16')
  icon.setAttribute('aria-hidden', 'true')
  icon.setAttribute('focusable', 'false')
  const shape = document.createElementNS(SVG, 'path')
  icon.append(shape)
  const word = document.createElement('span')
  const rest = document.createElement('span')
  rest.className = 'visually-hidden'
  rest.textContent = ` ${host.dataset.label || 'the demo'}`
  button.append(icon, word, rest)
  let state: Now = 'playing'
  const sync = (now: Now) => {
    state = now
    word.textContent = now === 'playing' ? 'Pause' : now === 'done' ? 'Replay' : 'Play'
    shape.setAttribute('d', now === 'playing' ? 'M4 3h3v10H4zM9 3h3v10H9z' : 'M5 3l8 5-8 5z')
  }
  button.addEventListener('click', () => {
    if (state === 'playing') {
      unmount(host)
      openingStills(host, false)
      sync('paused')
    } else {
      // Play, or Replay: the scene again from its opening frame
      unmount(host)
      openingStills(host, true)
      sync('playing')
      void mount(host)
    }
  })
  host.append(button)
  const made2 = { sync, button }
  toggles.set(host, made2)
  return made2
}

export function mountScenes(root: ParentNode = document) {
  const hosts = Array.from(root.querySelectorAll<HTMLElement>('[data-scene]'))
  if (!hosts.length) return

  const start = () => {
    if (!('IntersectionObserver' in window)) return hosts.forEach(mount)
    // Fetch a scene's code as its section comes near, not only its own place:
    // the admin's place stays hidden until its moment of How it works is
    // shown, and should draw as soon as it is
    const near = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          near.unobserve(entry.target)
          hosts
            .filter((host) => host.closest('section') === entry.target)
            .forEach((host) => {
              void SCENES[host.dataset.scene ?? '']?.().catch(() => {})
              void import('react-dom/client').catch(() => {})
            })
        }
      },
      { rootMargin: '300px 0px' },
    )
    new Set(hosts.map((host) => host.closest('section')).filter((s): s is HTMLElement => !!s)).forEach((s) => near.observe(s))
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          io.unobserve(entry.target)
          mount(entry.target as HTMLElement)
        }
      },
      { rootMargin: '300px 0px' },
    )
    hosts.forEach((host) => io.observe(host))
  }

  // Reduced motion: the stills are the scenes. If the preference is turned
  // off later, the scenes come in then; turned on again, a mounted Stage
  // shows its still by itself.
  if (!reduced()) return start()
  const query = matchMedia('(prefers-reduced-motion: reduce)')
  const change = () => {
    if (query.matches) return
    query.removeEventListener('change', change)
    start()
  }
  query.addEventListener('change', change)
}
