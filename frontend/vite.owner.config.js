import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Owner panel: builds into ../owner-panel/dist (served by owner-panel/server.js)
export default defineConfig({
  root: here('./owner'),
  publicDir: here('./shared/public'),
  plugins: [react()],
  build: {
    outDir: here('../owner-panel/dist'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5174, proxy: { '/api': 'http://localhost:4000' } },
});
