import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@aisling/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
