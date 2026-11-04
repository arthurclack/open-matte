#!/usr/bin/env node
// Renders site/public/og.png, the 1200 x 630 picture a link to openmatte.dev
// shows in chat apps and social sites: the wordmark, the headline and the
// film playing on the phone (public/stage/playing.webp, the close's picture),
// on the page's own ground, in its own font and tokens.
//
//   node site/tools/og.mjs
//
// Uses Playwright's Chromium from the repository's node_modules (run
// `npx playwright install chromium` once if it isn't there). Reads only local
// files: the tokens, the font and the still.

import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const site = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url))
const out = site('public/og.png')

// Local files as data: URLs, so the blank page Playwright opens can use them
const inline = (path, type) => `data:${type};base64,${readFileSync(site(path)).toString('base64')}`

// The page's tokens, with the font read from disk
const tokens = readFileSync(site('src/tokens.css'), 'utf8').replace(
  'url("/fonts/matte-sans.woff2")',
  `url("${inline('public/fonts/matte-sans.woff2', 'font/woff2')}")`,
)
const still = inline('public/stage/playing.webp', 'image/webp')

const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><style>
${tokens}
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; overflow: hidden; }
body { background: var(--color-paper); color: var(--color-ink); font-family: var(--font-body); -webkit-font-smoothing: antialiased; }
.card { position: relative; width: 1200px; height: 630px; padding: 64px 72px; display: grid; grid-template-columns: 1fr 440px; column-gap: 40px; }
.text { display: flex; flex-direction: column; justify-content: space-between; padding-bottom: 8px; }
.wordmark { display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 400; font-stretch: 125%; letter-spacing: -0.01em; }
.wordmark svg { width: 42px; height: 42px; }
.wordmark rect { fill: none; stroke: var(--color-accent); }
.wordmark path { fill: var(--color-accent); }
h1 { font-size: 76px; font-weight: 300; font-stretch: 125%; letter-spacing: -0.015em; line-height: 1.04; text-wrap: balance; }
p { margin-top: 24px; font-size: 26px; line-height: 1.35; color: var(--color-ink-2); max-width: 30ch; }
.phone { position: absolute; right: 56px; bottom: 0; width: 440px; }
.phone img { display: block; width: 100%; height: auto; }
</style></head><body>
<div class="card">
  <div class="text">
    <div class="wordmark"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="8" width="24" height="16" rx="1.5" stroke-width="2"/><path d="M14 12.5v7l6-3.5z"/></svg>Open Matte</div>
    <div>
      <h1>You should watch this film.</h1>
      <p>A small, self-hosted cinema for recommending films to friends.</p>
    </div>
  </div>
  <div class="phone"><img src="${still}" alt=""></div>
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
