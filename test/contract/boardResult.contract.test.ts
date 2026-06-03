import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import type {
  BoardOutput,
  BoardResult,
  MemoryDoc,
  BoardSummary,
  Orchestrator
} from '../../src/orchestrator/Orchestrator'
import type { BoardId } from '../../src/types'

/** An orchestrator serving a fixed structured result per id (empty shell otherwise). */
class ResultOrchestrator implements Orchestrator {
  constructor(private readonly results: Record<string, BoardResult>) {}
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
  async boardStatus(): Promise<string> {
    return 'idle'
  }
  async boardOutput(): Promise<BoardOutput> {
    return { text: '', total: 0, returned: 0, droppedOlder: false }
  }
  async boardResult(boardId: BoardId): Promise<BoardResult> {
    return this.results[boardId] ?? { present: false }
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

describe('canvas://board/{id}/result resource', () => {
  it('returns the structured result for the templated board id', async () => {
    const result: BoardResult = {
      present: true,
      status: 'success',
      summary: 'Built the parser',
      refs: ['src/parser.ts', 'PR #42'],
      at: '2026-06-03T10:00:00.000Z'
    }
    const client = await connectInMemory('orchestrator', new ResultOrchestrator({ 'b-1': result }))
    const res = await client.readResource({ uri: 'canvas://board/b-1/result' })
    expect(JSON.parse(readText(res.contents))).toEqual(result)
    await client.close()
  })

  it('returns the empty structured shell (present:false) when no result is recorded', async () => {
    const client = await connectInMemory('orchestrator', new ResultOrchestrator({}))
    const res = await client.readResource({ uri: 'canvas://board/ghost/result' })
    expect(JSON.parse(readText(res.contents))).toEqual({ present: false })
    await client.close()
  })

  it('is readable by the worker tier (observation is safe for both tiers)', async () => {
    const client = await connectInMemory(
      'worker',
      new ResultOrchestrator({ 'b-1': { present: true, status: 'failure' } })
    )
    const res = await client.readResource({ uri: 'canvas://board/b-1/result' })
    expect(JSON.parse(readText(res.contents))).toEqual({ present: true, status: 'failure' })
    await client.close()
  })
})
