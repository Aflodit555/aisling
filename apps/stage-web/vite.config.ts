import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

import { aislingRelayPlugin } from './vite-plugin-aisling-relay'

// The core package is consumed as source (mirrors how AIRI aliases its
// `stage-ui`/`core-agent` packages to `src`), so editing core hot-reloads the
// app and there is no separate build/watch step for it.
export default defineConfig({
  plugins: [vue(), aislingRelayPlugin()],
  // Aisling uses a fixed port so it can run alongside AIRI (which occupies 5173).
  server: {
    port: 5174,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@aisling/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
})
