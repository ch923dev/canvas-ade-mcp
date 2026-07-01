import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'

// tidy_canvas (P2) repositions the whole canvas into a clean, non-overlapping arrangement via the
// host's deterministic packer. ORCHESTRATOR-TIER ONLY — like spawn_group, a connected/worker agent
// must NOT rearrange everyone else's boards. UN-GATED (content-less, reposition-only, one-undo
// reversible). The host owns the packer + the moved count; this tool is the thin transport.
const TOOL = 'tidy_canvas'

/** Records every tidyCanvas call and returns a deterministic moved count, to prove the passthrough. */
class SpyOrchestrator extends MockOrchestrator {
  calls: Array<{ mode?: string }> = []
  override async tidyCanvas(input: { mode?: string }): Promise<unknown> {
    this.calls.push(input)
    return { moved: 3 }
  }
}

function parse(res: unknown): Record<string, unknown> {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? []
  const text = content.map((c) => c.text ?? '').join('')
  return JSON.parse(text)
}

describe('tidy_canvas tool (P2, orchestrator-tier canvas reposition)', () => {
  it('orchestrator tools/list INCLUDES tidy_canvas', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('worker tools/list OMITS tidy_canvas', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    await client.close()
  })

  it('connected tools/list OMITS tidy_canvas (orchestrator-scope reposition)', async () => {
    const client = await connectInMemory('connected')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    // sanity: the connected tier DOES get spawn_board — so the omission is specific to tidy_canvas.
    expect(names).toContain('spawn_board')
    await client.close()
  })

  it('forwards the mode and returns the moved count as JSON', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { mode: 'grid' } })
    expect(res.isError).toBeFalsy()
    expect(orch.calls).toEqual([{ mode: 'grid' }])
    expect(parse(res)).toEqual({ moved: 3 })
    await client.close()
  })

  it('mode is optional — omitting it forwards { mode: undefined } (host defaults to smart)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: {} })
    expect(res.isError).toBeFalsy()
    expect(orch.calls).toEqual([{ mode: undefined }])
    await client.close()
  })

  it('rejects an off-enum mode WITHOUT calling the adapter (Zod enum)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { mode: 'diagonal' } })
    expect(res.isError).toBe(true)
    expect(orch.calls).toHaveLength(0)
    await client.close()
  })
})
