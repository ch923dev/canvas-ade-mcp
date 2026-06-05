import { describe, expect, it } from 'vitest'
import { SessionManager } from '../../src/server/transport'
import type { ServerFactory } from '../../src/server/factory'

/** Reach into the private transport map to inject fakes (no real HTTP needed). */
function injectTransports(sm: SessionManager, fakes: Record<string, { close(): Promise<void> }>): void {
  const map = (sm as unknown as { transports: Map<string, unknown> }).transports
  for (const [id, t] of Object.entries(fakes)) map.set(id, t)
}

describe('SessionManager.closeAll', () => {
  it('closes EVERY session even if one transport.close() rejects, and clears the map', async () => {
    const sm = new SessionManager({} as ServerFactory)
    const closed: string[] = []
    injectTransports(sm, {
      a: {
        async close() {
          closed.push('a')
          throw new Error('boom') // one transport fails to close
        }
      },
      b: {
        async close() {
          closed.push('b')
        }
      }
    })

    // Must not reject — a single bad teardown can't abort the rest (leak guard).
    await expect(sm.closeAll()).resolves.toBeUndefined()
    // Both were attempted (the bad one did not short-circuit the loop).
    expect(closed.sort()).toEqual(['a', 'b'])
    // The map is cleared regardless.
    expect((sm as unknown as { transports: Map<string, unknown> }).transports.size).toBe(0)
  })

  it('runs every session disposer on closeAll (and clears them)', async () => {
    const sm = new SessionManager({} as ServerFactory)
    const disposed: string[] = []
    const map = (sm as unknown as { disposers: Map<string, () => void> }).disposers
    map.set('a', () => disposed.push('a'))
    map.set('b', () => disposed.push('b'))
    await sm.closeAll()
    expect(disposed.sort()).toEqual(['a', 'b'])
    expect(map.size).toBe(0)
  })
})
