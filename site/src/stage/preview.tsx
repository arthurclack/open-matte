// stage.html (development only): the scenes at their real sizes on the
// page's own ground and stylesheet, for filming with the Stageshow scripts
// and for exporting the stills (tools/stills.mjs). Each scene file says its
// own sizes and stills (`info`); nothing here needs changing for a scene.
import './preview.css'
import { createRoot } from 'react-dom/client'
import type { ComponentType } from 'react'
import type { SceneInfo } from './scene'
import TapeScene, { info as tape } from './TapeScene'
import LendScene, { info as lend } from './LendScene'

const SCENES: { info: SceneInfo; Scene: ComponentType<{ still?: string }> }[] = [
  { info: tape, Scene: TapeScene },
  { info: lend, Scene: LendScene },
]

// Each scene in two cuts: wide in a place as wide as its design, compact in
// one as wide as its compact design (narrower than its `below`)
const SHOTS = SCENES.flatMap(({ info, Scene }) => [
  { id: `${info.id}-wide`, scene: info.id, label: `${info.label}, wide ${info.wide.width} x ${info.wide.height}`, width: info.wide.width, Scene },
  { id: `${info.id}-compact`, scene: info.id, label: `${info.label}, compact ${info.compact.width} x ${info.compact.height}`, width: info.compact.width, Scene },
])

// For tools/stills.mjs: every still, the cut it is drawn from and the
// viewport it is drawn at (wide at 1280, compact at a phone's 390)
;(window as unknown as { __stills: unknown }).__stills = SCENES.flatMap(({ info }) =>
  info.stills.map((s) => ({
    scene: info.id,
    only: `${info.id}-${s.layout}`,
    still: s.still ?? null,
    file: s.file,
    quality: s.quality ?? 0.95,
    height: s.height ?? null,
    viewport: s.layout === 'wide' ? 1280 : 390,
  })),
)

const params = new URLSearchParams(location.search)
const only = params.get('only')
// ?still=start (or another frame a scene names) draws that frame as the
// still under reduced motion, for exporting the page's stills
const still = params.get('still') ?? undefined

function Preview() {
  return (
    <>
      {SHOTS.filter((s) => !only || s.id === only || s.scene === only).map(({ id, label, width, Scene }) => (
        <section key={id} className="pv-shot">
          <p className="pv-label">{label}</p>
          {/* A place like the page's: the stage measures this box */}
          <div id={id} className="pv-slot" style={{ maxWidth: width }}>
            <Scene still={still} />
          </div>
        </section>
      ))}
    </>
  )
}

// No StrictMode: the page mounts the scenes without it, and the preview
// should behave as the page does
createRoot(document.getElementById('preview')!).render(<Preview />)
