import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1500 },
  // service web Render : accepte le nom d'hôte public
  preview: { allowedHosts: true },
  test: { environment: 'node' },
} as any);
