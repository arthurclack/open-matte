// What each scene file says about itself, beside its component, so the
// development preview (preview.tsx, stage.html) and the stills' export
// (tools/stills.mjs) need no list of their own: a scene changes its sizes or
// its stills in its own file only.

import type { Layout } from '../stageshow-kit/looks'

/** One still exported from the scene into public/stage/, at 2x, as WebP. */
export interface Still {
  /** The file name in public/stage/. A changed picture takes a new name (README, Caching). */
  file: string
  layout: Layout
  /** Which frame, as the scene's own `still` prop takes it: none is the story's still (the Stage's
   *  reduced-motion poster), 'start' its opening frame; a scene may name others. */
  still?: string
  /** WebP quality, 0 to 1 (0.95 by default: the app's flat screens show blocks around words below it). */
  quality?: number
  /** Keep only this many CSS px from the stage's top: a still shown somewhere smaller than the stage. */
  height?: number
}

export interface SceneInfo {
  /** The name in data-scene on the page and in stage.html's ?only= (id-wide, id-compact). */
  id: string
  /** What the preview calls it. */
  label: string
  /** The Stage's design sizes: wide, and compact below `below` px of its place's width. */
  wide: { width: number; height: number }
  compact: { below: number; width: number; height: number }
  stills: Still[]
}
