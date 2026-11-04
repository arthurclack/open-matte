// The project website: static pages built by Vite into site/dist.
//
//   node_modules/.bin/vite build --config site/vite.config.mjs
//   node_modules/.bin/vite --config site/vite.config.mjs        (dev, with /stage.html)
//
// Two pages go into the build: index.html and 404.html. stage.html is a
// development page for filming the scenes and is left out of it.

import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  root: here('.'),
  base: '/',
  publicDir: here('public'),
  plugins: [react()],
  resolve: {
    // The kit's parts import lucide-react, which this site doesn't install:
    // a few glyphs, drawn locally.
    alias: { 'lucide-react': here('src/stageshow-kit/lucide-shim.tsx') },
    dedupe: ['react', 'react-dom'],
  },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: {
    outDir: here('dist'),
    emptyOutDir: true,
    target: 'es2022',
    // Every byte comes from this origin: no inlined assets the
    // Content-Security-Policy would have to allow as data: (fonts especially).
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: here('index.html'),
        404: here('404.html'),
      },
    },
  },
})
