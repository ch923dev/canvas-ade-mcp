import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import type {
  BoardOutput,
  BoardResult,
  BoardSummary,
  MemoryDoc,
  Orchestrator
} from '../../src/orchestrator/Orchestrator'
import type { BoardId } from '../../src/types'

/** An orchestrator serving fixed memory docs (empty shell when absent). */
class MemoryOrchestrator implements Orchestrator {
  constructor(
    private readonly project: MemoryDoc,
    private readonly summaries: Record<string, MemoryDoc>
  ) {}
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
  async boardResult(): Promise<BoardResult> {
    return { present: false }
  }
  async projectMemory(): Promise<MemoryDoc> {
    return this.project
  }
  async boardSummary(boardId: BoardId): Promise<MemoryDoc> {
    return this.summaries[boardId] ?? { present: false, text: '' }
  }
}

function readText(contents: ReadonlyArray<{ uri?: unknown; text?: unknown }>): string {
  return contents.map((c) => (typeof c.text === 'string' ? c.text : '')).join('')
}

describe('canvas://memory + canvas://board/{id}/summary resources', () => {
  it('serves the project memory index', async () => {
    const doc: MemoryDoc = { present: true, text: '# Project\n- board A builds the parser' }
    const client = await connectInMemory('orchestrator', new MemoryOrchestrator(doc, {}))
    const res = await client.readResource({ uri: 'canvas://memory' })
    expect(JSON.parse(readText(res.contents))).toEqual(doc)
    await client.close()
  })

  it('serves a per-board summary by templated id', async () => {
    const sum: MemoryDoc = { present: true, text: 'board A: parser, 80% done' }
    const client = await connectInMemory(
      'orchestrator',
      new MemoryOrchestrator({ present: false, text: '' }, { 'b-1': sum })
    )
    const res = await client.readResource({ uri: 'canvas://board/b-1/summary' })
    expect(JSON.parse(readText(res.contents))).toEqual(sum)
    await client.close()
  })

  it('gracefully empties when memory is absent (never an error)', async () => {
    const empty: MemoryDoc = { present: false, text: '' }
    const client = await connectInMemory('orchestrator', new MemoryOrchestrator(empty, {}))
    const mem = await client.readResource({ uri: 'canvas://memory' })
    expect(JSON.parse(readText(mem.contents))).toEqual(empty)
    const sum = await client.readResource({ uri: 'canvas://board/ghost/summary' })
    expect(JSON.parse(readText(sum.contents))).toEqual(empty)
    await client.close()
  })

  it('is readable by the worker tier (passive context for both tiers)', async () => {
    const doc: MemoryDoc = { present: true, text: 'ctx' }
    const client = await connectInMemory('worker', new MemoryOrchestrator(doc, {}))
    const res = await client.readResource({ uri: 'canvas://memory' })
    expect(JSON.parse(readText(res.contents)).present).toBe(true)
    await client.close()
  })
})
