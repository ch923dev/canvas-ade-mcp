import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import type {
  BoardOutput,
  BoardResult,
  BoardSummary,
  Orchestrator
} from '../../src/orchestrator/Orchestrator'
import type { BoardId } from '../../src/types'

/** An orchestrator whose `boardStatus` returns a known bucket per id. */
class StatusOrchestrator implements Orchestrator {
  async listBoards(): Promise<BoardSummary[]> {
    return []
  }
  async spawnBoard(): Promise<{ id: BoardId }> {
    return { id: 'x' }
  }
  async dispatchPrompt(): Promise<void> {}
  async gitDiff(): Promise<string> {
    return ''
  }
  async boardStatus(boardId: BoardId): Promise<string> {
    return boardId === 'b-live' ? 'running' : 'idle'
  }
  async boardOutput(): Promise<BoardOutput> {
    return { text: '', total: 0, returned: 0, droppedOlder: false }
  }
  async boardResult(): Promise<BoardResult> {
    return { present: false }
  }
}

function readText(contents: ReadonlyArray<{ uri?: unknown; text?: unknown }>): string {
  return contents.map((c) => (typeof c.text === 'string' ? c.text : '')).join('')
}

describe('canvas://board/{id}/status resource', () => {
  it('returns the status bucket for the templated board id', async () => {
    const client = await connectInMemory('orchestrator', new StatusOrchestrator())
    const res = await client.readResource({ uri: 'canvas://board/b-live/status' })
    expect(JSON.parse(readText(res.contents))).toEqual({ id: 'b-live', status: 'running' })
    await client.close()
  })

  it('is readable by the worker tier (observation is safe for both tiers)', async () => {
    const client = await connectInMemory('worker', new StatusOrchestrator())
    const res = await client.readResource({ uri: 'canvas://board/b-idle/status' })
    expect(JSON.parse(readText(res.contents))).toEqual({ id: 'b-idle', status: 'idle' })
    await client.close()
  })
})
