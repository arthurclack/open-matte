#!/usr/bin/env node
// Exports every still the page uses into site/public/stage/, from the
// development page stage.html: each scene's Stage drawn as its reduced-motion
// still, at 2x, on a transparent ground, encoded as WebP (quality 0.9) by
// Chromium itself.
//
//   node_modules/.bin/vite --config site/vite.config.mjs --port 5199   (in another shell)
//   node site/tools/stills.mjs http://127.0.0.1:5199/stage.html
//
// Uses Playwright's Chromium from the repository's node_modules (run
// `npx playwright install chromium` once if it isn't there).

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const base = process.argv[2]
if (!base) {
  console.error('usage: node site/tools/stills.mjs <stage.html url>')
  process.exit(2)
}
const out = (file) => fileURLToPath(new URL(`../public/stage/${file}`, import.meta.url))

// The story's stills (scripting off, reduced motion), the opening frames (shown
// until a scene draws) and the film playing (the close and og.png). The width
// is the viewport each cut is drawn at.
const SHOTS = [
  { only: 'ticket-wide', file: 'ticket.webp', width: 1280 },
  { only: 'ticket-compact', file: 'ticket-compact.webp', width: 390 },
  { only: 'ticket-wide', still: 'start', file: 'ticket-start.webp', width: 1280 },
  { only: 'ticket-compact', still: 'start', file: 'ticket-start-compact.webp', width: 390 },
  { only: 'ticket-compact', still: 'playing', file: 'playing.webp', width: 390 },
  { only: 'issue-wide', file: 'issue.webp', width: 1280 },
  { only: 'issue-compact', file: 'issue-compact.webp', width: 390 },
  { only: 'issue-wide', still: 'start', file: 'issue-start.webp', width: 1280 },
  { only: 'issue-compact', still: 'start', file: 'issue-start-compact.webp', width: 390 },
]

const browser = await chromium.launch()
try {
  for (const shot of SHOTS) {
    const page = await browser.newPage({ viewport: { width: shot.width, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
    await page.goto(`${base}?only=${shot.only}${shot.still ? `&still=${shot.still}` : ''}`)
    await page.waitForSelector('.ss-stage:not([data-placing])')
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(900)
    await page.addStyleTag({ content: 'html, body { background: transparent !important; }' })
    const png = await page.locator('.ss-stage').first().screenshot({ omitBackground: true })
    const webp = await page.evaluate(async (b64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
      const blob = await new Promise((done) => canvas.toBlob(done, 'image/webp', 0.9))
      return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), w: canvas.width, h: canvas.height }
    }, png.toString('base64'))
    writeFileSync(out(shot.file), Buffer.from(webp.bytes))
    console.log(`${shot.file}  ${webp.w / 2} x ${webp.h / 2}  ${Math.round(webp.bytes.length / 1024)} KB`)
    await page.close()
  }
} finally {
  await browser.close()
}
