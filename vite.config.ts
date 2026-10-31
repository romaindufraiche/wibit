import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/',
  build: {
    chunkSizeWarningLimit: 1500,
    // deux pages : l'outil et l'administration
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin.html') } },
  },
  // en développement, l'API (npm run dev:api) tourne sur le port 3001
  server: { proxy: { '/api': 'http://localhost:3001' } },
  test: { environment: 'node' },
} as any);
