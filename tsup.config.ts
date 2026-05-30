import { defineConfig } from 'tsup'

// Single-file ESM bundle + .d.ts → dist/. The SDK/express/zod stay external
// (resolved from node_modules at runtime inside Canvas ADE MAIN).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  platform: 'node',
  external: ['@modelcontextprotocol/sdk', 'express', 'zod']
})
