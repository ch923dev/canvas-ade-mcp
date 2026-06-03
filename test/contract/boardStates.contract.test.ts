import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { groupBoardsByStatus } from '../../src/resources/boardStates'
import type {
  BoardOutput,
  BoardResult,
  MemoryDoc,
  BoardSummary,
  Orchestrator
} from '../../src/orchestrator/Orchestrator'
import type { BoardId } from '../../src/types'

/** An orchestrator returning a fixed mixed-status board list. */
class MixedOrchestrator implements Orchestrator {
  async listBoards(): Promise<BoardSummary[]> {
    return [
      { id: 't1', type: 'terminal', title: 'A', status: 'running' },
      { id: 't2', type: 'terminal', title: 'B', status: 'running' },
      { id: 'b1', type: 'browser', title: 'Web', status: 'failed' },
      { id: 'p1', type: 'planning', title: 'Plan', status: 'static' }
    ]
  }
  async spawnBoard(): Promise<{ id: BoardId }> {
    return { id: 'x' }
  }
  async dispatchPrompt(): Promise<void> {}
  async gitDiff(): Promise<string> {
    return ''
  }
  async boardStatus(): Promise<string> {
    return 'idle'
  }
  async boardOutput(): Promise<BoardOutput> {
    return { text: '', total: 0, returned: 0, droppedOlder: false }
  }
  async boardResult(): Promise<BoardResult> {
    return { present: false }
  }
  async projectMemory(): Promise<MemoryDoc> {
    return { present: false, text: '' }
  }
  async boardSummary(): Promise<MemoryDoc> {
    return { present: false, text: '' }
  }
}

function readText(contents: ReadonlyArray<{ uri?: unknown; text?: unknown }>): string {
  return contents.map((c) => (typeof c.text === 'string' ? c.text : '')).join('')
}

describe('groupBoardsByStatus', () => {
  it('groups board ids by status bucket, omitting empty buckets', () => {
    const grouped = groupBoardsByStatus([
      { id: 't1', type: 'terminal', title: 'A', status: 'running' },
      { id: 't2', type: 'terminal', title: 'B', status: 'running' },
      { id: 'b1', type: 'browser', title: 'Web', status: 'idle' }
    ])
    expect(grouped).toEqual({ running: ['t1', 't2'], idle: ['b1'] })
  })

  it('returns an empty object for no boards', () => {
    expect(groupBoardsByStatus([])).toEqual({})
  })
})

describe('canvas://board-states resource', () => {
  it('returns the live board list grouped by status bucket', async () => {
    const client = await connectInMemory('worker', new MixedOrchestrator())
    const res = await client.readResource({ uri: 'canvas://board-states' })
    expect(JSON.parse(readText(res.contents))).toEqual({
      running: ['t1', 't2'],
      failed: ['b1'],
      static: ['p1']
    })
    await client.close()
  })
})
