# Stageshow kit (copy)

The parts the site's two product scenes (`../stage/`) are built with: a copy of
the Stageshow skill's `kit/` (MIT, see `LICENSE` and `NOTICE.md`), taken on
4 November 2026 and changed only where this site needs it:

- **No brand registry.** `brands/` and `parts/BrandMark.*` are left out (the
  scenes show no other company's marks), and `index.ts`, `parts/index.ts` and
  `stageshow.css` no longer export or import them.
- **No lucide-react.** The site doesn't install it: `vite.config.mjs` aliases
  `lucide-react` to `lucide-shim.tsx`, which draws the three glyphs the kit's
  parts reach for here (check, x, chevron-down) from Lucide's path data (ISC;
  the notice is in `/third-party-licenses.txt`). `parts/Icon.tsx` maps only
  those three; its solid glyphs are the kit's own and unchanged.
- **React 19.** The kit was written against React 18; it runs unchanged on the
  repository's React 19.
- **A hidden stage keeps its layout.** `stage.tsx`'s fit skips a measurement
  of 0 wide: the page hides the admin scene (`display: none`) while another
  moment of How it works is shown, and a width of 0 would flip it to its
  compact design, restart its script and lose a finished `once` ending.
- **A `once` scene waits to be seen.** `stage.tsx` counts a stage on screen
  from its first pixel (it pauses off screen as before), but starts a
  `play="once"` script only when 60% of it is in view, so a reader scrolling
  to the admin scene sees it from the start, not its held ending. A finished
  `once` stage is marked `data-done`, which the page's Pause turns into Replay.
- **Thread motion without layout.** The Floor of the site's design rules
  never animates width, height, top or left. `messages.css` and
  `messages.tsx` glide a thread's rows and stamps by `translate` (the kit uses
  `top`), measure each row at its foot (the thread stands on its bottom), rise
  an arriving bubble by `translate`, and grow a bubble out of its typing dots
  by a clip that opens from its tail's corner on the thread's own curve (the
  kit eases the box's width and height). Left as the kit has them: the
  composer flight (`source`, by left and top), `Roll`'s width and the circle
  cursor's size, none of which these scenes use, and the opening by
  `grid-template-rows` of `Receipt` and `Collapse` (the admin's notice), a
  property the Floor doesn't name.

Nothing in the kit injects a `<style>` element or sets a `style` attribute:
every style comes from its imported CSS, and the inline styles it sets go
through the CSSOM (`element.style`, React's `style` prop), which the site's
Content-Security-Policy (`style-src 'self'`) allows.

The scenes import parts by file (`../stageshow-kit/stage`, `.../phone`), not
through `index.ts`, so only the CSS of the parts they use ships.
