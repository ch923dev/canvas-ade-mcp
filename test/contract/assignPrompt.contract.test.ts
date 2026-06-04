import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'

// assign_prompt is a DISPATCH write tool (M4 T4.4) — orchestrator-tier only. Unlike
// handoff_prompt it is FIRE-AND-FORGET: the host writes the prompt into the target
// terminal's PTY (gated: nonce + human-confirm + audit) and returns immediately, with
// NO await-idle and NO structured result. It is the existing Orchestrator.dispatchPrompt.
const TOOL = 'assign_prompt'

/** Records every dispatchPrompt call, to prove wiring (dispatchPrompt returns void). */
class SpyOrchestrator extends MockOrchestrator {
  dispatched: Array<{ id: string; text: string }> = []
  override async dispatchPrompt(boardId: BoardId, text: string): Promise<void> {
    this.dispatched.push({ id: boardId, text })
  }
}

describe('assign_prompt tool (T4.4, fire-and-forget dispatch write)', () => {
  it('worker tools/list OMITS assign_prompt (capability split)', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    await client.close()
  })

  it('orchestrator tools/list INCLUDES assign_prompt', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('forwards boardId + prompt to the adapter and returns an ack', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: { boardId: 'board-7', prompt: 'run the build' }
    })
    expect(orch.dispatched).toEqual([{ id: 'board-7', text: 'run the build' }])
    expect(res.isError).toBeFalsy()
    await client.close()
  })

  it('rejects an empty boardId WITHOUT dispatching anything', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { boardId: '', prompt: 'x' } })
    expect(res.isError).toBe(true)
    expect(orch.dispatched).toEqual([])
    await client.close()
  })

  it('rejects an empty prompt WITHOUT dispatching anything', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { boardId: 'board-7', prompt: '' } })
    expect(res.isError).toBe(true)
    expect(orch.dispatched).toEqual([])
    await client.close()
  })

  it('🔒 rejects a prompt with an embedded CR (line-injection) WITHOUT dispatching', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: { boardId: 'board-7', prompt: 'ls\rrm -rf ~' }
    })
    expect(res.isError).toBe(true)
    expect(orch.dispatched).toEqual([])
    await client.close()
  })
})
