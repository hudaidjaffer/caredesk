import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Clinic app: builds into ../clinic-app/dist (served by clinic-app/server.js)
export default defineConfig({
  root: here('./clinic'),
  publicDir: here('./shared/public'),
  plugins: [react()],
  build: {
    outDir: here('../clinic-app/dist'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
