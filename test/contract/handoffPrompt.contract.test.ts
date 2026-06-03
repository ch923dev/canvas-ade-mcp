import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'
import type { BoardResult } from '../../src/orchestrator/Orchestrator'

// handoff_prompt is a DISPATCH write tool (M4 T4.3) — orchestrator-tier only. It writes
// the prompt into the target terminal's PTY (host-gated: nonce + human-confirm + audit),
// blocks until the board goes idle, and returns the board's structured last result.
const TOOL = 'handoff_prompt'

/** Records every handoffPrompt call + returns a canned result, to prove wiring. */
class SpyOrchestrator extends MockOrchestrator {
  handedOff: Array<{ id: string; text: string }> = []
  result: BoardResult = { present: true, status: 'success', summary: 'done', refs: ['a.ts'] }
  override async handoffPrompt(boardId: BoardId, text: string): Promise<BoardResult> {
    this.handedOff.push({ id: boardId, text })
    return this.result
  }
}

describe('handoff_prompt tool (T4.3, dispatch write)', () => {
  it('worker tools/list OMITS handoff_prompt (capability split)', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    await client.close()
  })

  it('orchestrator tools/list INCLUDES handoff_prompt', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('forwards boardId + prompt to the adapter and returns the result as text', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: { boardId: 'board-7', prompt: 'run the build' }
    })
    expect(orch.handedOff).toEqual([{ id: 'board-7', text: 'run the build' }])
    const text = (res.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
    expect(text).toContain('success')
    expect(text).toContain('done')
    await client.close()
  })

  it('rejects an empty boardId WITHOUT dispatching anything', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { boardId: '', prompt: 'x' } })
    expect(res.isError).toBe(true)
    expect(orch.handedOff).toEqual([])
    await client.close()
  })

  it('rejects an empty prompt WITHOUT dispatching anything', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { boardId: 'board-7', prompt: '' } })
    expect(res.isError).toBe(true)
    expect(orch.handedOff).toEqual([])
    await client.close()
  })
})
