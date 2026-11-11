#!/usr/bin/env node
// Bakes the printed things the hero's phone scene shows (src/stage/
// TapeScene.tsx) from the real Open Matte 1.1.0, and the film's title card in
// plain type, as WebP into site/public/stage/:
//
//   tape-print-shop.webp     the shop's name in its rub-down letters
//   tape-print-sleeve.webp   the plain kraft sleeve with its typed label
//   tape-print-pick.webp     the staff-pick card, in Arthur's hand
//   tape-print-label.webp    the tape's label, E-120, with its Start by sticker
//   tape-film-title.webp     the title card (Fraunces), never the film's own titles
//   tape-film-line.webp      its second line alone, which comes up as the film runs
//
//   node site/tools/prints.mjs <1.1.0 checkout> [--out <folder>]
//
// <1.1.0 checkout> is a copy of the app at 1.1.0 (the v1.1.0 tag) with its
// web app built: `npm ci && npm run build`
// there writes dist/. Its fonts are read from web/public/fonts. The app runs
// in Playwright's Chromium at an iPhone's 402 points, 3x, with its API
// answered here (the film page with a tape for anyone with the link, one play,
// start by Sat 14 Nov, 7 days after the first play), on a transparent ground.
// Each printed thing is shot at its own box and 4px round it for its contact
// shadow; the boxes are printed, and TapeScene.tsx places each picture at its
// box. The one change to 1.1.0 is the sleeve's label, set at 11px so
// "Strangelove" stays whole (README.md, "Where the pictures differ").
//
// A picture that changes takes a new name (README.md, "Caching").

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args.splice(i, 2)[1] : undefined
}
const outDir = path.resolve(flag('--out') ?? fileURLToPath(new URL('../public/stage/', import.meta.url)))
const app = args[0]
if (!app) {
  console.error('usage: node site/tools/prints.mjs <built 1.1.0 checkout> [--out <folder>]')
  process.exit(2)
}
const DIST = path.resolve(app, 'dist')
const FONTS = path.resolve(app, 'web', 'public', 'fonts')
if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error(`no built app at ${DIST}: run npm ci && npm run build there`)
fs.mkdirSync(outDir, { recursive: true })

// The story's facts (README.md, "The pictures")
const ORIGIN = 'https://lanternroom.example'
const startBy = Date.parse('2026-11-14T23:59:00Z')
const film = {
  slug: 'dr-strangelove', title: 'Dr. Strangelove', originalTitle: '', year: 1964, runtimeMinutes: 95, directors: 'Stanley Kubrick', country: '',
  synopsis: 'An American general sends his bombers to attack the Soviet Union, and the President and his advisers try to call them back.',
  recommendation: 'Peter Sellers plays three parts. Sixty years on, it’s still funny.', contentNote: '', posterUrl: null, backdropUrl: null,
  media: { renditions: [] },
}
const ticket = { state: 'ok', startBy, expiresAt: null, firstPlayedAt: null, daysAfterFirstPlay: 7, openScreening: null, screeningLimit: 1, screeningsLeft: 1, inAccount: false }
const site = { cinemaName: 'The Lantern Room', ownerName: 'Arthur', resumeWindowHours: 48, tmdbCredit: false, logo: null, icon: null }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.txt': 'text/plain' }

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-GB', timezoneId: 'Europe/London' })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()))
  await page.route(`${ORIGIN}/**`, async (route) => {
    const p = new URL(route.request().url()).pathname
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (p === '/api/me') return json({ site, person: null, admin: false, tickets: [] })
    if (p === '/api/site') return json(site)
    if (p === '/api/films/dr-strangelove') return json({ film, access: { canPlay: true, via: 'ticket', ticket, preview: false, published: true, mediaStatus: 'ready', canKeep: false, ticketKept: false } })
    if (p.startsWith('/api/')) return json({ ok: true })
    let file = path.join(DIST, p)
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) })
  })

  // WebP, encoded by Chromium itself, as images.mjs and stills.mjs do
  async function save(png, name, quality) {
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
        return Array.from(new Uint8Array(await blob.arrayBuffer()))
      },
      { b64: png.toString('base64'), quality },
    )
    fs.writeFileSync(path.join(outDir, name), Buffer.from(webp))
    console.log(`${name}  ${Math.round(webp.length / 1024)} KB`)
  }

  await page.goto(`${ORIGIN}/dr-strangelove`)
  await page.waitForSelector('.fl-film')
  // The one change to 1.1.0: the plain sleeve's typed label keeps "Strangelove" whole at a phone's 96px
  // (1.1.0 breaks it "Strangelov / e"): 11px type, 5px sides
  await page.addStyleTag({
    content: `
    .ob--kraft .ob--label .ob__ink { font-size: 11px !important; padding: 7px 5px 6px !important; }
    html, body, .site, .site-main, .fl-page, .site-bar { background: transparent !important; }`,
  })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(800)

  // The union of everything an element draws, plus 4px for the contact shadows, in page coordinates
  const union = (sel) =>
    page.locator(sel).first().evaluate((c) => {
      let l = 1e9, t = 1e9, r = -1e9, b = -1e9
      for (const e of [c, ...c.querySelectorAll('*')]) {
        const x = e.getBoundingClientRect()
        if (!x.width || !x.height) continue
        l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); b = Math.max(b, x.bottom)
      }
      return { x: l - 4, y: t - 4 + scrollY, width: r - l + 8, height: b - t + 8 }
    })
  for (const [name, sel] of [
    ['shop', '.ui-shopname'],
    ['sleeve', '.fl-sleeve .ob'],
    ['pick', '.fl-pickcell .ob'],
    ['label', '.fl-tapeline .etape'],
  ]) {
    const box = await union(sel)
    console.log(`${name} at ${JSON.stringify(Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v * 1000) / 1000])))}`)
    await save(await page.screenshot({ omitBackground: true, clip: box, fullPage: true }), `tape-print-${name}.webp`, 0.93)
  }

  // The film's title card: plain type (Fraunces), never the film's own lettering. Two layers, so the
  // second line can come up after the first: the card with its title, then the second line alone, each
  // at the picture's 402 x 226.125 points.
  const card = (part) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: F; src: url("${ORIGIN}/fontfile/Fraunces-Variable.ttf") format("truetype"); font-weight: 100 900; }
html, body { margin: 0; background: transparent; }
.tc { width: 402px; aspect-ratio: 16 / 9; background: ${part === 'title' ? '#050505' : 'transparent'}; display: grid; place-items: center; }
.f { width: 74%; height: 66%; box-sizing: border-box; padding: 0 18px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; text-align: center;
  ${part === 'title' ? 'border: 1px solid #8d887c; outline: 1px solid #5d594f; outline-offset: 4px;' : ''} }
.t { margin: 0; font: 400 30px/1 F; font-synthesis: none; font-variation-settings: "opsz" 72, "SOFT" 0, "WONK" 0; letter-spacing: 0.01em; color: #e7e1d3; ${part === 'title' ? '' : 'visibility: hidden;'} }
.s { margin: 0; font: 400 13px/18px F; font-synthesis: none; font-variation-settings: "opsz" 12, "SOFT" 0, "WONK" 0; color: #e7e1d3; text-wrap: balance; ${part === 'title' ? 'visibility: hidden;' : ''} }
</style></head><body><div class="tc"><div class="f"><p class="t">Dr. Strangelove</p><p class="s">or: How I Learned to Stop Worrying and Love the Bomb</p></div></div></body></html>`
  await page.route(`${ORIGIN}/fontfile/*`, (route) =>
    route.fulfill({ status: 200, contentType: 'font/ttf', body: fs.readFileSync(path.join(FONTS, path.basename(new URL(route.request().url()).pathname))) }),
  )
  for (const part of ['title', 'line']) {
    await page.route(`${ORIGIN}/card-${part}`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: card(part) }))
    await page.goto(`${ORIGIN}/card-${part}`)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(300)
    await save(await page.locator('.tc').screenshot({ omitBackground: true }), `tape-film-${part}.webp`, 0.92)
  }
} finally {
  await browser.close()
}
