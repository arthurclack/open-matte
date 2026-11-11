#!/usr/bin/env node
// Renders site/public/og-v2.png, the 1200 x 630 picture a link to
// openmatte.dev shows in chat apps and social sites: the dark room, the
// wordmark, the shop poster with the page's headline, and the film playing
// for the friend (public/img/app-playing.webp, the app's own crop), in the
// page's own faces, tokens and grain. No sticker: a link preview has no
// deadline. Its alt text is index.html's og:image:alt; change both together.
//
//   node site/tools/og.mjs
//
// The file has a new name (the old one was og.png) because chat apps cache a
// preview by its address: a new address makes them fetch it again.
//
// Uses Playwright's Chromium from the repository's node_modules (run
// `npx playwright install chromium` once if it isn't there). Reads only local
// files: the tokens, the fonts, the grain and the still.

import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const site = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url))
const out = site('public/og-v2.png')

// Local files as data: URLs, so the blank page Playwright opens can use them
const inline = (path, type) => `data:${type};base64,${readFileSync(site(path)).toString('base64')}`

// The page's tokens, with each face read from disk
const tokens = readFileSync(site('src/tokens.css'), 'utf8').replace(
  /url\("\/fonts\/([^"]+)"\)/g,
  (_, file) => `url("${inline(`public/fonts/${file}`, 'font/ttf')}")`,
)
const grain = inline('public/img/grain-paper.webp', 'image/webp')
const still = inline('public/img/app-playing.webp', 'image/webp')

// The ink filter, as index.html has it, for the display print
const ink = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="ink-print" x="-4%" y="-12%" width="108%" height="124%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves="2" seed="12" result="n" />
<feDisplacementMap in="SourceGraphic" in2="n" scale="0.8" xChannelSelector="R" yChannelSelector="G" result="d" />
<feGaussianBlur in="d" stdDeviation="0.34" result="b" />
<feComponentTransfer in="b"><feFuncA type="linear" slope="1.5" intercept="-0.08" /></feComponentTransfer></filter></svg>`

const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><style>
${tokens}
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; overflow: hidden; }
body { background: var(--room); color: var(--text); font-family: var(--sans); }
.card { width: 1200px; height: 630px; padding: 52px 64px 60px; display: grid; grid-template-columns: minmax(0, 1fr) 470px; grid-template-rows: auto 1fr; column-gap: 56px; }
.mark { grid-column: 1 / -1; font: 800 30px/1 var(--shop); font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 72; letter-spacing: -0.005em; filter: url(#ink-print); }
.poster {
  align-self: center;
  padding: 40px 44px 44px;
  background-color: var(--stock-card);
  background-image:
    radial-gradient(60% 45% at 22% 30%, var(--mottle), transparent 70%),
    radial-gradient(50% 60% at 82% 76%, var(--paper-light), transparent 70%),
    radial-gradient(40% 35% at 70% 18%, var(--mottle-faint), transparent 70%),
    url("${grain}");
  background-size: 100% 100%, 100% 100%, 100% 100%, 128px 128px;
  color: var(--ink);
  clip-path: polygon(0 0.4px, 100% 0, calc(100% - 0.8px) 100%, 0.5px calc(100% - 0.6px));
  transform: rotate(-0.45deg);
  filter: drop-shadow(0 1px 0.8px var(--contact));
}
h1 { font: 800 70px/1.02 var(--shop); font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 72; letter-spacing: -0.012em; text-wrap: balance; filter: url(#ink-print); }
.still { align-self: center; }
.still img { display: block; width: 470px; height: auto; border: 1px solid var(--rule); }
</style></head><body>
${ink}
<div class="card">
  <p class="mark">Open Matte</p>
  <div class="poster"><h1>I think you should watch this film.</h1></div>
  <div class="still"><img src="${still}" alt=""></div>
</div>
</body></html>`

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: out, type: 'png' })
} finally {
  await browser.close()
}
console.log(`wrote ${out} (${Math.round(statSync(out).size / 1024)} KB)`)
