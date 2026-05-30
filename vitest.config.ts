import { defineConfig } from 'vitest/config'

// Two projects: `contract` (fast, in-memory, no HTTP) and `live` (real HTTP
// server on an ephemeral loopback port). `pnpm test` runs contract; `pnpm
// test:live` runs live.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'contract',
          include: ['test/contract/**/*.test.ts'],
          environment: 'node'
        }
      },
      {
        test: {
          name: 'live',
          include: ['test/live/**/*.test.ts'],
          environment: 'node'
        }
      }
    ]
  }
})
