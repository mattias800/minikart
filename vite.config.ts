import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  build: {
    // three.js alone is ~600 kB; one chunk is fine for a game.
    chunkSizeWarningLimit: 1200,
  },
});
