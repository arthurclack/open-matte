// The project website: two static pages built by Vite into site/dist.
//
//   node_modules/.bin/vite build --config site/vite.config.mjs
//   node_modules/.bin/vite --config site/vite.config.mjs        (development)
//
// index.html and 404.html go into the build, with their one stylesheet
// (src/site.css, which imports tokens.css and base.css) and the home page's
// one small script (src/main.ts). public/ is copied in as it is: the fonts,
// the pictures, the favicon, the link preview and the licences. No plugins.

import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  root: here('.'),
  base: '/',
  publicDir: here('public'),
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: {
    outDir: here('dist'),
    emptyOutDir: true,
    target: 'es2022',
    // Every byte comes from this origin: no inlined assets the
    // Content-Security-Policy would have to allow as data:
    assetsInlineLimit: 0,
    // One small module and nothing to preload: no helper is added to it
    modulePreload: false,
    rollupOptions: {
      input: {
        index: here('index.html'),
        404: here('404.html'),
      },
    },
  },
})
