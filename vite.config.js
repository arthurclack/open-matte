import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The web app lives in web/ and builds to dist/, which the server serves.
// In development, Vite proxies API and media requests to the server on :3000.
const server = 'http://127.0.0.1:3000';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': server, '/media': server },
  },
});
