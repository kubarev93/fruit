import { defineConfig } from 'vite';

// Share ONE pixi.js instance between the host game, pixi-reels and @open-slot-ui.
export default defineConfig({
  server: { port: 5173, strictPort: false, open: true },
  resolve: { dedupe: ['pixi.js'] },
  build: { target: 'es2022' },
});
