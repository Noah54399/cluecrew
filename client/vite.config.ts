import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const sharedSrc = fileURLToPath(new URL('../shared/src', import.meta.url));
const serverTarget = process.env.CLIENT_PROXY_TARGET ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [sharedSrc, '.'],
    },
    proxy: {
      '/api': { target: serverTarget, changeOrigin: false },
      '/socket.io': { target: serverTarget, ws: true, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
