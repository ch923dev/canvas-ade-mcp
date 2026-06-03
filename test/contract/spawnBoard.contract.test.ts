import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'

// spawn_board is the first WRITE tool (T3.1, package Phase 3). The capability
// split is the load-bearing safety guarantee: a worker tier must NEVER see — let
// alone reach — a lifecycle write tool. Enforced by REGISTRATION, like
// orchestrator_ping, never by prompt/annotation.
const TOOL = 'spawn_board'

/** Records every spawnBoard call and returns a fixed id, to prove wiring + validation. */
class SpyOrchestrator extends MockOrchestrator {
  calls: Array<{ type: string; prompt?: string; cwd?: string }> = []
  override async spawnBoard(input: {
    type: string
    prompt?: string
    cwd?: string
  }): Promise<{ id: BoardId }> {
    this.calls.push(input)
    return { id: 'board-xyz' }
  }
}

describe('spawn_board tool (T3.1, lifecycle write)', () => {
  it('worker tools/list OMITS spawn_board (capability split)', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    await client.close()
  })

  it('orchestrator tools/list INCLUDES spawn_board', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('orchestrator spawn_board(terminal) calls the adapter and surfaces its id', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { type: 'terminal' } })
    expect(orch.calls).toEqual([{ type: 'terminal' }])
    // The orchestrator-issued id is surfaced to the agent (text + structured).
    expect(JSON.stringify(res)).toContain('board-xyz')
    await client.close()
  })

  it('passes through prompt + cwd to the adapter', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    await client.callTool({
      name: TOOL,
      arguments: { type: 'browser', prompt: 'run dev', cwd: '/repo' }
    })
    expect(orch.calls).toEqual([{ type: 'browser', prompt: 'run dev', cwd: '/repo' }])
    await client.close()
  })

  it('rejects an unknown board type WITHOUT spawning', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { type: 'malware' } })
    expect(res.isError).toBe(true)
    expect(orch.calls).toEqual([]) // the safety invariant: no spawn on bad input
    await client.close()
  })
})
