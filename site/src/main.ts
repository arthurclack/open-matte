// The page's one script. Everything here only adds to a page that already
// works without it:
// - the scenes of the app: mountScenes (stage/mount.ts) loads each, with
//   React, only as it nears the screen, and never under reduced motion;
//   until then, and without script, its stills stand in;
// - the phone's menu (a <details> in the bar, which opens and closes
//   without it) closes once a link in it has been followed, on Escape, with
//   focus back on Menu, on a tap or click anywhere outside it, or when focus
//   leaves it.
import { mountScenes } from './stage/mount'

mountScenes()

document.querySelectorAll<HTMLDetailsElement>('details.menu').forEach((menu) => {
  menu.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) menu.open = false
  })
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !menu.open) return
    menu.open = false
    menu.querySelector('summary')?.focus()
  })
  // Tabbing past the last link closes it, as the app's own menus do
  menu.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null
    if (menu.open && next && !menu.contains(next)) menu.open = false
  })
  document.addEventListener('click', (event) => {
    if (menu.open && !menu.contains(event.target as Node)) menu.open = false
  })
})
