import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MAX_OUTPUT_PAGE } from '../../src/constants'
import type {
  BoardOutput,
  BoardResult,
  MemoryDoc,
  BoardSummary,
  Orchestrator
} from '../../src/orchestrator/Orchestrator'
import type { BoardId } from '../../src/types'

/**
 * An orchestrator whose `boardOutput` serves a fixed clean buffer, paged tail-first
 * by a chars-from-end cursor — exactly the contract the app accessor implements.
 * Lets the contract layer assert the resource (a) routes the templated id, (b)
 * threads the `?cursor` query var, and (c) hard-caps each page at MAX_OUTPUT_PAGE.
 */
class OutputOrchestrator implements Orchestrator {
  constructor(private readonly buffers: Record<string, string>) {}
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
  async boardOutput(boardId: BoardId, opts?: { cursor?: number }): Promise<BoardOutput> {
    const clean = this.buffers[boardId] ?? ''
    const total = clean.length
    const cursor = opts?.cursor ?? 0
    const end = Math.max(0, total - cursor)
    const start = Math.max(0, end - MAX_OUTPUT_PAGE)
    const text = clean.slice(start, end)
    const moreOlder = start > 0
    return {
      text,
      total,
      returned: text.length,
      nextCursor: moreOlder ? cursor + text.length : undefined,
      droppedOlder: false
    }
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

describe('canvas://board/{id}/output resource', () => {
  it('returns the tail page (no cursor) capped at MAX_OUTPUT_PAGE', async () => {
    const big = 'A'.repeat(MAX_OUTPUT_PAGE * 2 + 137)
    const client = await connectInMemory('orchestrator', new OutputOrchestrator({ 'b-1': big }))
    const res = await client.readResource({ uri: 'canvas://board/b-1/output' })
    const out = JSON.parse(readText(res.contents)) as BoardOutput
    expect(out.total).toBe(big.length)
    expect(out.returned).toBe(MAX_OUTPUT_PAGE)
    expect(out.text.length).toBe(MAX_OUTPUT_PAGE)
    // Tail-anchored: the newest page is the END of the buffer.
    expect(out.text).toBe(big.slice(big.length - MAX_OUTPUT_PAGE))
    expect(out.nextCursor).toBe(MAX_OUTPUT_PAGE)
    expect(out.droppedOlder).toBe(false)
    await client.close()
  })

  it('threads the ?cursor query var to fetch the next (older) page', async () => {
    const big = 'A'.repeat(MAX_OUTPUT_PAGE) + 'B'.repeat(MAX_OUTPUT_PAGE)
    const client = await connectInMemory('orchestrator', new OutputOrchestrator({ 'b-1': big }))
    const res = await client.readResource({
      uri: `canvas://board/b-1/output?cursor=${MAX_OUTPUT_PAGE}`
    })
    const out = JSON.parse(readText(res.contents)) as BoardOutput
    // Second page is the OLDER half (the A's) and reaches the front → no nextCursor.
    expect(out.text).toBe('A'.repeat(MAX_OUTPUT_PAGE))
    expect(out.nextCursor).toBeUndefined()
    await client.close()
  })

  it('hard-caps the page even if the orchestrator over-returns (🔒 never dump raw)', async () => {
    const over = 'Z'.repeat(MAX_OUTPUT_PAGE + 5000)
    // An orchestrator that ignores the cap and returns the whole buffer in one page.
    class RogueOrchestrator extends OutputOrchestrator {
      override async boardOutput(): Promise<BoardOutput> {
        return { text: over, total: over.length, returned: over.length, droppedOlder: false }
      }
    }
    const client = await connectInMemory('orchestrator', new RogueOrchestrator({}))
    const res = await client.readResource({ uri: 'canvas://board/b-1/output' })
    const out = JSON.parse(readText(res.contents)) as BoardOutput
    expect(out.text.length).toBe(MAX_OUTPUT_PAGE)
    expect(out.returned).toBe(MAX_OUTPUT_PAGE)
    await client.close()
  })

  it('is readable by the worker tier (observation is safe for both tiers)', async () => {
    const client = await connectInMemory('worker', new OutputOrchestrator({ 'b-1': 'hello' }))
    const res = await client.readResource({ uri: 'canvas://board/b-1/output' })
    const out = JSON.parse(readText(res.contents)) as BoardOutput
    expect(out.text).toBe('hello')
    expect(out.total).toBe(5)
    await client.close()
  })

  it('returns an empty page for an absent board (no error)', async () => {
    const client = await connectInMemory('orchestrator', new OutputOrchestrator({}))
    const res = await client.readResource({ uri: 'canvas://board/ghost/output' })
    const out = JSON.parse(readText(res.contents)) as BoardOutput
    expect(out).toEqual({ text: '', total: 0, returned: 0, droppedOlder: false })
    await client.close()
  })
})
