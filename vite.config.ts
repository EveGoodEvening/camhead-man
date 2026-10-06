// owner: integrator（M1a 写；vite.config.ts 不在 src，不参与 tsc 与 check.mjs --stubs）
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 4000,
  },
});
