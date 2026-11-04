// How it works: the three moments as a pinned run. On a wide screen the
// pictures share one sticky place beside the text, and the moment whose text
// crosses the upper middle of the screen is the one shown. Without this
// script (or under 60rem) each moment simply sits beside or above its own
// picture.
//
// A moment's text lights at once (is-current); its picture follows: the one
// showing starts to fade on that same frame (data-plate="out"), and only once
// it has gone does the next one come in (data-plate="in"), so two pictures
// are never seen through each other. The screen they share stays put
// (site.css, .moments.is-pinned::before): only what is on it changes.

const LEAVE_MS = 120

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function pinMoments(root: ParentNode = document) {
  const box = root.querySelector<HTMLElement>('[data-moments]')
  if (!box || !('IntersectionObserver' in window)) return
  const moments = Array.from(box.querySelectorAll<HTMLElement>('.moment'))
  let shown = 0
  let timer = 0
  moments[0]?.setAttribute('data-plate', 'in')
  const show = (index: number) => {
    moments.forEach((m, i) => m.classList.toggle('is-current', i === index))
    if (index === shown) return
    shown = index
    window.clearTimeout(timer)
    const enter = () => moments.forEach((m, i) => (i === index ? m.setAttribute('data-plate', 'in') : m.removeAttribute('data-plate')))
    const leaving = moments.filter((m, i) => i !== index && m.getAttribute('data-plate') === 'in')
    if (!leaving.length || reduced()) return enter()
    leaving.forEach((m) => m.setAttribute('data-plate', 'out'))
    timer = window.setTimeout(enter, LEAVE_MS)
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const index = moments.findIndex((m) => m.contains(entry.target))
        if (index >= 0) show(index)
      }
    },
    // A thin band just above the middle of the screen
    { rootMargin: '-42% 0px -56% 0px' },
  )
  moments.forEach((m) => {
    const text = m.querySelector('.moment__text')
    if (text) io.observe(text)
  })
  box.classList.add('is-pinned')
}

// The small-screen menu closes once a link in it has been followed, on
// Escape (focus goes back to Menu) and on a tap or click anywhere outside it
export function closeMenus(root: ParentNode = document) {
  root.querySelectorAll<HTMLDetailsElement>('details.slab__menu').forEach((menu) => {
    menu.addEventListener('click', (event) => {
      if ((event.target as Element).closest('a')) menu.open = false
    })
    menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !menu.open) return
      menu.open = false
      menu.querySelector('summary')?.focus()
    })
    document.addEventListener('click', (event) => {
      if (menu.open && !menu.contains(event.target as Node)) menu.open = false
    })
  })
}
