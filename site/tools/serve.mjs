#!/usr/bin/env node
// Serves site/dist the way production does, with the same response headers,
// so the built site can be checked locally before it is published.
//
//   node site/tools/serve.mjs [port]        (or PORT=…; 4173 by default)
//
// No dependencies. GET and HEAD only; unknown paths get 404.html with a 404
// status; a path that tries to climb out of site/dist is refused.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)))
const port = Number(process.argv[2] || process.env.PORT || 4173)
const host = process.env.HOST || '127.0.0.1'

// Exactly what the production server sends with every response.
export const HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cache-Control': 'public, max-age=300',
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

// The file a request path names inside root, or null. Never anything outside it.
async function find(pathname) {
  let path
  try {
    path = decodeURIComponent(pathname)
  } catch {
    return { refused: true }
  }
  if (path.includes('\0') || path.includes('\\')) return { refused: true }
  const full = resolve(root, '.' + path)
  if (full !== root && !full.startsWith(root + sep)) return { refused: true }
  try {
    const info = await stat(full)
    if (info.isFile()) return { file: full }
    if (info.isDirectory()) {
      const index = join(full, 'index.html')
      if ((await stat(index)).isFile()) return { file: index }
    }
  } catch {}
  return {}
}

async function send(req, res, status, file) {
  const body = await readFile(file)
  res.writeHead(status, {
    ...HEADERS,
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...HEADERS, Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('Method not allowed\n')
    }
    // The raw path, before any normalising, so a climb like /../ is seen
    const raw = (req.url || '/').split('?')[0].split('#')[0]
    if (!raw.startsWith('/') || raw.split('/').some((part) => part === '..' || /^%2e%2e$/i.test(part))) {
      res.writeHead(400, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('Bad request\n')
    }
    const found = await find(raw)
    if (found.refused) {
      res.writeHead(400, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('Bad request\n')
    }
    if (found.file) return await send(req, res, 200, found.file)
    return await send(req, res, 404, join(root, '404.html'))
  } catch (err) {
    console.error(err)
    if (!res.headersSent) res.writeHead(500, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Server error\n')
  }
})

server.listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}/`)
})
