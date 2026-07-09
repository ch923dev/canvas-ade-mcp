import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import { MAX_FOCUS_TARGET_ID } from '../../src/constants'

// focus_viewport (H1 / Lane H) moves the USER'S CAMERA — fit to one board, one Named Group, or the
// whole canvas. ORCHESTRATOR-TIER ONLY (steering the user's viewport is an app-level helper act;
// like tidy_canvas, a connected/worker agent must not yank the camera). UN-GATED (viewport-only,
// content-less, reversible by scrolling). The host owns the camera verbs + the outcome shape; this
// tool is the thin transport.
const TOOL = 'focus_viewport'

/** Records every focusViewport call, to prove the passthrough + the exactly-one-target guard. */
class SpyOrchestrator extends MockOrchestrator {
  calls: Array<{ boardId?: string; groupId?: string }> = []
  override async focusViewport(input: { boardId?: string; groupId?: string }): Promise<unknown> {
    this.calls.push(input)
    return super.focusViewport(input)
  }
}

function parse(res: unknown): Record<string, unknown> {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? []
  const text = content.map((c) => c.text ?? '').join('')
  return JSON.parse(text)
}

describe('focus_viewport tool (H1, orchestrator-tier camera focus)', () => {
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

  it('connected tools/list OMITS focus_viewport (orchestrator-scope camera act)', async () => {
    const client = await connectInMemory('connected')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    // sanity: the connected tier DOES get spawn_board — the omission is specific to focus_viewport.
    expect(names).toContain('spawn_board')
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
