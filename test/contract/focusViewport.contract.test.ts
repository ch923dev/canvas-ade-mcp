import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import { MAX_FOCUS_TARGET_ID } from '../../src/constants'

// focus_viewport (H1 / Lane H) moves the USER'S CAMERA — fit to one board, one Named Group, or the
// whole canvas. Widened in 0.27.0 (spatial-awareness D1) to ORCHESTRATOR + LEAD + CONNECTED; never
// worker. The orchestrator tier stays un-gated; a lead/connected call binds the caller's own board id
// as sourceBoardId so the HOST raises its approve/deny confirm first. The host owns the camera verbs
// + the outcome shape; this tool is the thin transport.
const TOOL = 'focus_viewport'

/** Records every focusViewport call, to prove the passthrough + the exactly-one-target guard. */
class SpyOrchestrator extends MockOrchestrator {
  calls: Array<{ boardId?: string; groupId?: string; sourceBoardId?: string }> = []
  override async focusViewport(input: {
    boardId?: string
    groupId?: string
    sourceBoardId?: string
  }): Promise<unknown> {
    this.calls.push(input)
    return super.focusViewport(input)
  }
}

function parse(res: unknown): Record<string, unknown> {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? []
  const text = content.map((c) => c.text ?? '').join('')
  return JSON.parse(text)
}

describe('focus_viewport tool (H1, camera focus — orchestrator/lead/connected)', () => {
  it('orchestrator tools/list INCLUDES focus_viewport', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('worker tools/list OMITS focus_viewport', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    await client.close()
  })

  for (const tier of ['lead', 'connected'] as const) {
    it(`${tier} tools/list INCLUDES focus_viewport (D1 widening, 0.27.0)`, async () => {
      const client = await connectInMemory(tier)
      expect((await client.listTools()).tools.map((t) => t.name)).toContain(TOOL)
      await client.close()
    })

    it(`🔒 ${tier} caller: the host receives sourceBoardId = its own board id (the confirm trigger)`, async () => {
      const orch = new SpyOrchestrator()
      const client = await connectInMemory(tier, orch, `${tier}-board`)
      const res = await client.callTool({
        name: TOOL,
        // A client-supplied sourceBoardId is not in the schema, so it is stripped — never forwarded.
        arguments: { groupId: 'g-1', sourceBoardId: 'forged' }
      })
      expect(res.isError).toBeFalsy()
      expect(orch.calls).toEqual([
        { boardId: undefined, groupId: 'g-1', sourceBoardId: `${tier}-board` }
      ])
      await client.close()
    })
  }

  it('orchestrator caller: NO sourceBoardId (un-gated host-side, unchanged)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'app')
    await client.callTool({ name: TOOL, arguments: { boardId: 'b-1', sourceBoardId: 'forged' } })
    expect(orch.calls).toHaveLength(1)
    expect('sourceBoardId' in orch.calls[0]!).toBe(false)
    await client.close()
  })

  it('forwards a boardId target and returns the host outcome as JSON', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { boardId: 'b-1' } })
    expect(res.isError).toBeFalsy()
    expect(orch.calls).toEqual([{ boardId: 'b-1', groupId: undefined }])
    expect(parse(res)).toEqual({ focused: 'board', id: 'b-1' })
    await client.close()
  })

  it('forwards a groupId target', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { groupId: 'g-1' } })
    expect(res.isError).toBeFalsy()
    expect(orch.calls).toEqual([{ boardId: undefined, groupId: 'g-1' }])
    expect(parse(res)).toEqual({ focused: 'group', id: 'g-1' })
    await client.close()
  })

  it('no target ⇒ fit-all (both ids forwarded undefined)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: {} })
    expect(res.isError).toBeFalsy()
    expect(orch.calls).toEqual([{ boardId: undefined, groupId: undefined }])
    expect(parse(res)).toEqual({ focused: 'all' })
    await client.close()
  })

  it('rejects boardId AND groupId together WITHOUT calling the adapter', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: { boardId: 'b-1', groupId: 'g-1' }
    })
    expect(res.isError).toBe(true)
    expect(orch.calls).toHaveLength(0)
    await client.close()
  })

  it('rejects an over-long id at the Zod layer WITHOUT calling the adapter', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: { boardId: 'x'.repeat(MAX_FOCUS_TARGET_ID + 1) }
    })
    expect(res.isError).toBe(true)
    expect(orch.calls).toHaveLength(0)
    await client.close()
  })

  it('surfaces a host rejection (unknown id) as a tool error', async () => {
    class RejectingOrchestrator extends MockOrchestrator {
      override async focusViewport(): Promise<unknown> {
        throw new Error('focus_viewport: unknown board id')
      }
    }
    const client = await connectInMemory('orchestrator', new RejectingOrchestrator())
    const res = await client.callTool({ name: TOOL, arguments: { boardId: 'nope' } })
    expect(res.isError).toBe(true)
    await client.close()
  })
})
