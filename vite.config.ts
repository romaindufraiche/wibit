import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: { chunkSizeWarningLimit: 1500 },
  // en développement, l'API (npm run dev:api) tourne sur le port 3001
  server: { proxy: { '/api': 'http://localhost:3001' } },
  test: { environment: 'node' },
} as any);
