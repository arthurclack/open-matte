#!/usr/bin/env node
// Turns the baked pictures into the WebP files the pages show, in
// site/public/img/.
//
//   node site/tools/images.mjs <folder>
//
// <folder> holds the pictures as the design folder's render script bakes
// them: PNG, the printed objects and the app stills at 3x, the wide back
// office at 2x, the grain tile at 2x (README.md, "The pictures"). Each one is
// drawn at twice the largest width the page shows it at, so it is sharp on a
// 2x screen, and encoded as WebP by Chromium itself; transparency is kept.
// Quality: 0.93 for the printed objects and the film page, or their paper
// grain smooths away; 0.95 for the app's flat screens, where less leaves
// pale 8px blocks around words on flat colour (the lit button's above all);
// 0.9 for the grain tile, which is noise.
//
// Uses Playwright's Chromium from the repository's node_modules (run
// `npx playwright install chromium` once if it isn't there).

import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// name, width written, WebP quality. The width is twice the widest the page
// draws the picture at, or a little more where that width wouldn't keep the
// picture's exact shape: a picture a fraction of a pixel taller or shorter
// moves everything under it by that fraction.
const PICTURES = [
  ['app-film-page', 780, 0.93], // the hero: the friend's film page, 390 wide
  ['app-lend', 1200, 0.95], // How it works, step 3: the back office, 600 wide from 36rem
  ['app-lend-compact', 716, 0.95], // the same under 36rem, the office's phone layout, 358 wide
  ['app-playing', 780, 0.95], // the close: the film playing, 390 wide
  ['obj-sleeve', 440, 0.93], // step 1: the kraft sleeve, 196 wide (220 x 326, so 440)
  ['obj-pick', 804, 0.93], // step 2: the staff-pick card, 402 wide
  ['obj-dueback', 771, 0.93], // Due back: the tape and its sticker, 292 wide (257 x 90, so its 3x bake as it is)
  ['obj-cardback', 800, 0.93], // What you need: the membership card's back, 400 wide
  ['grain-paper', 256, 0.9], // the paper's grain, a 128px tile behind the poster, the tape and the slip
]

const from = process.argv[2]
if (!from) {
  console.error('usage: node site/tools/images.mjs <folder of baked PNGs>')
  process.exit(2)
}
const out = (file) => fileURLToPath(new URL(`../public/img/${file}`, import.meta.url))

const browser = await chromium.launch()
let total = 0
try {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><title>images</title>')
  for (const [name, width, quality] of PICTURES) {
    const png = readFileSync(join(from, `${name}.png`)).toString('base64')
    const { height, data } = await page.evaluate(
      async ({ png, width, quality }) => {
        const blob = await (await fetch(`data:image/png;base64,${png}`)).blob()
        const source = await createImageBitmap(blob)
        const height = Math.round((source.height * width) / source.width)
        const drawn =
          width === source.width
            ? source
            : await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(drawn, 0, 0)
        return { height, data: canvas.toDataURL('image/webp', quality).split(',')[1] }
      },
      { png, width, quality },
    )
    const file = out(`${name}.webp`)
    writeFileSync(file, Buffer.from(data, 'base64'))
    const size = statSync(file).size
    total += size
    console.log(`${name}.webp  ${width} x ${height}  ${(size / 1024).toFixed(1)} KB`)
  }
} finally {
  await browser.close()
}
console.log(`total ${(total / 1024).toFixed(1)} KB`)
