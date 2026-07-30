import { describe, expect, it } from 'vitest'
import { SessionManager } from '../../src/server/transport'
import type { ServerFactory, SessionCtx } from '../../src/server/factory'

/** Reach into the private maps to inject fakes (no real HTTP needed — the closeAll precedent). */
function inject(
  sm: SessionManager,
  rows: Record<string, { close(): Promise<void>; owner: SessionCtx; dispose?: () => void }>
): void {
  const transports = (sm as unknown as { transports: Map<string, unknown> }).transports
  const owners = (sm as unknown as { owners: Map<string, SessionCtx> }).owners
  const disposers = (sm as unknown as { disposers: Map<string, () => void> }).disposers
  for (const [id, row] of Object.entries(rows)) {
    transports.set(id, { close: row.close })
    owners.set(id, row.owner)
    if (row.dispose) disposers.set(id, row.dispose)
  }
}

const worker = (boardId: string): SessionCtx => ({ tier: 'worker', scopes: [], boardId })
const orch = (boardId: string): SessionCtx => ({ tier: 'orchestrator', scopes: [], boardId })

describe('SessionManager.closeByBoardId (audit Phase A / roadmap Phase 9 revocation)', () => {
  it("closes ONLY the target board's sessions and reports the count", async () => {
    const sm = new SessionManager({} as ServerFactory)
    const closed: string[] = []
    inject(sm, {
      a: { close: async () => void closed.push('a'), owner: worker('b1') },
      b: { close: async () => void closed.push('b'), owner: worker('b1') },
      c: { close: async () => void closed.push('c'), owner: orch('bO') }
    })
    await expect(sm.closeByBoardId('b1')).resolves.toBe(2)
    expect(closed.sort()).toEqual(['a', 'b'])
    await sm.closeAll()
  })

  it('runs the disposer + clears the maps even when a transport.close() rejects', async () => {
    const sm = new SessionManager({} as ServerFactory)
    const disposed: string[] = []
    inject(sm, {
      bad: {
        close: async () => {
          throw new Error('boom')
        },
        owner: worker('b1'),
        dispose: () => disposed.push('bad')
      }
    })
    await expect(sm.closeByBoardId('b1')).resolves.toBe(1)
    expect(disposed).toEqual(['bad'])
    const transports = (sm as unknown as { transports: Map<string, unknown> }).transports
    expect(transports.size).toBe(0)
    await sm.closeAll()
  })

  it('an empty boardId (the unbound fallback identity) matches NOTHING', async () => {
    const sm = new SessionManager({} as ServerFactory)
    const closed: string[] = []
    inject(sm, {
      a: { close: async () => void closed.push('a'), owner: worker('') }
    })
    await expect(sm.closeByBoardId('')).resolves.toBe(0)
    expect(closed).toEqual([])
    await sm.closeAll()
  })
})
