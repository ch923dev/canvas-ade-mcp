import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'
import type { BoardConfig } from '../../src/orchestrator/Orchestrator'

// configure_board is a lifecycle WRITE tool (T3.3) — orchestrator-tier only. It
// changes a board's durable per-type config (shell / launchCommand / cwd).
const TOOL = 'configure_board'

/** Records every configureBoard call to prove wiring + id validation. */
class SpyOrchestrator extends MockOrchestrator {
  configured: Array<{ id: string; config: BoardConfig }> = []
  override async configureBoard(boardId: BoardId, config: BoardConfig): Promise<void> {
    this.configured.push({ id: boardId, config })
  }
}

describe('configure_board tool (T3.3, lifecycle write)', () => {
  it('worker tools/list OMITS configure_board (capability split)', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    await client.close()
  })

  it('orchestrator tools/list INCLUDES configure_board', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('forwards id + the supplied config fields to the adapter', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    await client.callTool({
      name: TOOL,
      arguments: { id: 'board-3', launchCommand: 'claude', cwd: '/repo' }
    })
    expect(orch.configured).toEqual([
      { id: 'board-3', config: { launchCommand: 'claude', cwd: '/repo' } }
    ])
    await client.close()
  })

  it('rejects an empty id WITHOUT configuring anything', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { id: '', shell: 'pwsh' } })
    expect(res.isError).toBe(true)
    expect(orch.configured).toEqual([])
    await client.close()
  })

  it('rejects a call with NO config fields (nothing to change)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { id: 'board-3' } })
    expect(res.isError).toBe(true)
    expect(orch.configured).toEqual([])
    await client.close()
  })
})
