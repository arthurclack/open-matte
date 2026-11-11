#!/usr/bin/env node
// Exports the scenes' stills, from the development page stage.html: each
// scene's Stage drawn as its reduced-motion still, at 2x, on a transparent
// ground, encoded as WebP by Chromium itself. Which stills there are, their
// files, cuts and frames, each scene says in its own file (`info.stills` in
// src/stage/*Scene.tsx); stage.html lists them all as window.__stills.
//
//   node_modules/.bin/vite --config site/vite.config.mjs --port 5199   (in another shell)
//   node site/tools/stills.mjs http://127.0.0.1:5199/stage.html [--only tape] [--out <folder>]
//
// A still may keep only the stage's top (`height` in its entry): the close's
// picture is the tape scene's film playing, cut under the player's bar.
//
// --only exports one scene's stills (its id: tape, lend); --out writes them
// somewhere other than site/public/stage/ (to look at them first). Uses
// Playwright's Chromium from the repository's node_modules (run
// `npx playwright install chromium` once if it isn't there).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args.splice(i, 2)[1] : undefined
}
const only = flag('--only')
const outDir = resolve(flag('--out') ?? fileURLToPath(new URL('../public/stage/', import.meta.url)))
const base = args[0]
if (!base) {
  console.error('usage: node site/tools/stills.mjs <stage.html url> [--only <scene>] [--out <folder>]')
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
try {
  // The list, as the scene files give it
  const lister = await browser.newPage()
  await lister.goto(base)
  await lister.waitForFunction(() => Array.isArray(window.__stills))
  const shots = (await lister.evaluate(() => window.__stills)).filter((s) => !only || s.scene === only)
  await lister.close()
  if (!shots.length) throw new Error(only ? `no stills for a scene called ${only}` : 'no stills listed')

  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: shot.viewport, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
    await page.goto(`${base}?only=${shot.only}${shot.still ? `&still=${encodeURIComponent(shot.still)}` : ''}`)
    await page.waitForSelector('.ss-stage:not([data-placing])')
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(900)
    // The stage alone, on nothing: the page's room shows through on the page
    await page.addStyleTag({ content: 'html, body { background: transparent !important; }' })
    const stage = page.locator('.ss-stage').first()
    const layout = await stage.getAttribute('data-layout')
    const want = shot.only.endsWith('-compact') ? 'compact' : 'wide'
    if (layout && layout !== want) throw new Error(`${shot.file}: the stage drew its ${layout} design, not ${want}`)
    // A still with a height of its own keeps only the stage's top that many px
    const box = shot.height ? await stage.boundingBox() : null
    const png = box
      ? await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: Math.min(shot.height, box.height) }, omitBackground: true })
      : await stage.screenshot({ omitBackground: true })
    const webp = await page.evaluate(
      async ({ b64, quality }) => {
        const img = new Image()
        img.src = `data:image/png;base64,${b64}`
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d').drawImage(img, 0, 0)
        const blob = await new Promise((done) => canvas.toBlob(done, 'image/webp', quality))
        return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), w: canvas.width, h: canvas.height }
      },
      { b64: png.toString('base64'), quality: shot.quality },
    )
    writeFileSync(join(outDir, shot.file), Buffer.from(webp.bytes))
    console.log(`${shot.file}  ${webp.w / 2} x ${webp.h / 2}  ${Math.round(webp.bytes.length / 1024)} KB`)
    await page.close()
  }
} finally {
  await browser.close()
}
