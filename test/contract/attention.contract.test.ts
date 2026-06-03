import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { selectAttention } from '../../src/resources/attention'
import type { BoardOutput, BoardSummary, Orchestrator } from '../../src/orchestrator/Orchestrator'
import type { BoardId } from '../../src/types'

/** An orchestrator returning a mix of attention + non-attention boards. */
class MixedOrchestrator implements Orchestrator {
  async listBoards(): Promise<BoardSummary[]> {
    return [
      { id: 't1', type: 'terminal', title: 'Run', status: 'running' },
      { id: 't2', type: 'terminal', title: 'Wait', status: 'awaiting-review' },
      { id: 't3', type: 'terminal', title: 'Block', status: 'blocked' },
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
}

function readText(contents: ReadonlyArray<{ uri?: unknown; text?: unknown }>): string {
  return contents.map((c) => (typeof c.text === 'string' ? c.text : '')).join('')
}

describe('selectAttention', () => {
  it('keeps only boards in an attention bucket (blocked/awaiting-review/failed)', () => {
    const attention = selectAttention([
      { id: 't1', type: 'terminal', title: 'Run', status: 'running' },
      { id: 't2', type: 'terminal', title: 'Wait', status: 'awaiting-review' },
      { id: 'b1', type: 'browser', title: 'Web', status: 'failed' },
      { id: 'p1', type: 'planning', title: 'Plan', status: 'static' }
    ])
    expect(attention.map((b) => b.id)).toEqual(['t2', 'b1'])
  })

  it('returns an empty list when nothing needs a human', () => {
    expect(selectAttention([{ id: 'p1', type: 'planning', title: 'P', status: 'static' }])).toEqual(
      []
    )
  })
})

describe('canvas://attention resource', () => {
  it('lists the boards needing a human, with full detail', async () => {
    const client = await connectInMemory('worker', new MixedOrchestrator())
    const res = await client.readResource({ uri: 'canvas://attention' })
    expect(JSON.parse(readText(res.contents))).toEqual([
      { id: 't2', type: 'terminal', title: 'Wait', status: 'awaiting-review' },
      { id: 't3', type: 'terminal', title: 'Block', status: 'blocked' },
      { id: 'b1', type: 'browser', title: 'Web', status: 'failed' }
    ])
    await client.close()
  })
})
