import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'
import type { BoardResultInput } from '../../src/orchestrator/Orchestrator'

// write_result is the FIRST worker-tier WRITE tool (M4 T4.4): a worker records its OWN
// board's structured result. Registered for BOTH tiers. 🔒 It is bound to the caller's
// `ctx.boardId` (derived from the verified token) — there is NO client-supplied boardId,
// so a worker can never forge another board's result.
const TOOL = 'write_result'

/** Records every writeResult call, to prove the bound id + fields forward. */
class SpyOrchestrator extends MockOrchestrator {
  written: Array<{ id: string; result: BoardResultInput }> = []
  override async writeResult(boardId: BoardId, result: BoardResultInput): Promise<void> {
    this.written.push({ id: boardId, result })
  }
}

describe('write_result tool (T4.4, first worker-tier write)', () => {
  it('worker tools/list INCLUDES write_result (the first worker write tool)', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('orchestrator tools/list ALSO includes write_result (both tiers)', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('🔒 binds to the caller’s ctx.boardId and forwards the result fields', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('worker', orch, 'bound-board')
    const res = await client.callTool({
      name: TOOL,
      arguments: { status: 'success', summary: 'built ok', refs: ['a.ts', 'b.ts'] }
    })
    expect(res.isError).toBeFalsy()
    expect(orch.written).toEqual([
      { id: 'bound-board', result: { status: 'success', summary: 'built ok', refs: ['a.ts', 'b.ts'] } }
    ])
    await client.close()
  })

  it('🔒 a worker cannot forge another board’s id — there is no boardId input', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('worker', orch, 'my-board')
    // Even smuggling a boardId in the arguments must NOT redirect the write: the host
    // binds to ctx.boardId, so the forged id is ignored.
    await client.callTool({
      name: TOOL,
      arguments: { boardId: 'victim-board', status: 'failure' } as Record<string, unknown>
    })
    expect(orch.written).toHaveLength(1)
    expect(orch.written[0]!.id).toBe('my-board')
    await client.close()
  })

  it('🔒 refuses to write when no board is bound to the session (empty ctx.boardId)', async () => {
    const orch = new SpyOrchestrator()
    // A token whose `extra.boardId` was missing/non-string yields ctx.boardId === ''.
    // Writing to board '' would silently no-op or hit a sentinel — refuse instead.
    const client = await connectInMemory('worker', orch, '')
    const res = await client.callTool({ name: TOOL, arguments: { status: 'success' } })
    expect(res.isError).toBe(true)
    expect(orch.written).toHaveLength(0)
    await client.close()
  })

  it('accepts a minimal (all-optional) result', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('worker', orch, 'b1')
    const res = await client.callTool({ name: TOOL, arguments: {} })
    expect(res.isError).toBeFalsy()
    expect(orch.written).toEqual([{ id: 'b1', result: {} }])
    await client.close()
  })

  // 🔒 C3 / BUG-009: the caps are enforced at the Zod schema (the protocol layer) — an oversized
  // payload is rejected at the wire BEFORE the orchestrator is called, so the host's MAIN clamps
  // are a true backstop rather than the primary guard.
  describe('C3 / BUG-009 — write_result Zod .max() caps (protocol-layer rejection)', () => {
    it('rejects a summary longer than 100,000 characters WITHOUT calling the adapter', async () => {
      const orch = new SpyOrchestrator()
      const client = await connectInMemory('worker', orch, 'b1')
      const res = await client.callTool({
        name: TOOL,
        arguments: { summary: 'x'.repeat(100_001) }
      })
      expect(res.isError).toBe(true)
      expect(orch.written).toHaveLength(0)
      await client.close()
    })

    it('accepts a summary of exactly 100,000 characters', async () => {
      const orch = new SpyOrchestrator()
      const client = await connectInMemory('worker', orch, 'b1')
      const res = await client.callTool({
        name: TOOL,
        arguments: { summary: 'x'.repeat(100_000) }
      })
      expect(res.isError).toBeFalsy()
      expect(orch.written).toHaveLength(1)
      await client.close()
    })

    it('rejects a refs array with more than 256 elements', async () => {
      const orch = new SpyOrchestrator()
      const client = await connectInMemory('worker', orch, 'b1')
      const res = await client.callTool({
        name: TOOL,
        arguments: { refs: Array.from({ length: 257 }, (_, i) => `ref-${i}`) }
      })
      expect(res.isError).toBe(true)
      expect(orch.written).toHaveLength(0)
      await client.close()
    })

    it('rejects a refs element longer than 256 characters', async () => {
      const orch = new SpyOrchestrator()
      const client = await connectInMemory('worker', orch, 'b1')
      const res = await client.callTool({
        name: TOOL,
        arguments: { refs: ['x'.repeat(257)] }
      })
      expect(res.isError).toBe(true)
      expect(orch.written).toHaveLength(0)
      await client.close()
    })

    it('accepts 256 refs of exactly 256 chars each (the boundary)', async () => {
      const orch = new SpyOrchestrator()
      const client = await connectInMemory('worker', orch, 'b1')
      const res = await client.callTool({
        name: TOOL,
        arguments: { refs: Array.from({ length: 256 }, () => 'y'.repeat(256)) }
      })
      expect(res.isError).toBeFalsy()
      expect(orch.written).toHaveLength(1)
      await client.close()
    })
  })
})
