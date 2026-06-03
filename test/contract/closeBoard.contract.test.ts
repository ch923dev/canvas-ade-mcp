import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'

// close_board is a lifecycle WRITE tool (T3.2). Like spawn_board it is
// orchestrator-tier only — a worker must never be able to tear a board down.
const TOOL = 'close_board'

/** Records every closeBoard call to prove wiring + id validation. */
class SpyOrchestrator extends MockOrchestrator {
  closed: string[] = []
  override async closeBoard(boardId: BoardId): Promise<void> {
    this.closed.push(boardId)
  }
}

describe('close_board tool (T3.2, lifecycle write)', () => {
  it('worker tools/list OMITS close_board (capability split)', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    await client.close()
  })

  it('orchestrator tools/list INCLUDES close_board', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('orchestrator close_board(id) calls the adapter with that id', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    await client.callTool({ name: TOOL, arguments: { id: 'board-7' } })
    expect(orch.closed).toEqual(['board-7'])
    await client.close()
  })

  it('rejects an empty id WITHOUT closing anything', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { id: '' } })
    expect(res.isError).toBe(true)
    expect(orch.closed).toEqual([])
    await client.close()
  })
})
