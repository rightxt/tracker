import { resolve } from 'node:path';
import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    rollupOptions: {
      input: { child: resolve(import.meta.dirname, 'child.html'), index: resolve(import.meta.dirname, 'index.html') },
    },
  },
  resolve: {
    conditions: ['development'],
  },
});
