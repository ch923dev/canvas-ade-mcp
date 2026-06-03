import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'

// interrupt is a DISPATCH write tool (M4 T4.5) — orchestrator-tier only. It sends Ctrl-C
// (\x03) to the target terminal's PTY to interrupt a running command. Content-less: host
// gating (nonce + human-confirm + audit) identical to assign_prompt, no prompt body.
const TOOL = 'interrupt'

/** Records every interrupt call, to prove wiring (interrupt returns void). */
class SpyOrchestrator extends MockOrchestrator {
  interrupted: string[] = []
  override async interrupt(boardId: BoardId): Promise<void> {
    this.interrupted.push(boardId)
  }
}

describe('interrupt tool (T4.5, Ctrl-C dispatch write)', () => {
  it('worker tools/list OMITS interrupt (capability split)', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    await client.close()
  })

  it('orchestrator tools/list INCLUDES interrupt', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('forwards boardId to the adapter and returns an ack', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { boardId: 'board-7' } })
    expect(orch.interrupted).toEqual(['board-7'])
    expect(res.isError).toBeFalsy()
    await client.close()
  })

  it('rejects an empty boardId WITHOUT interrupting anything', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { boardId: '' } })
    expect(res.isError).toBe(true)
    expect(orch.interrupted).toEqual([])
    await client.close()
  })
})
