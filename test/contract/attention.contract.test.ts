import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { selectAttention } from '../../src/resources/attention'
import type {
  BoardOutput,
  BoardResult,
  MemoryDoc,
  BoardSummary
} from '../../src/orchestrator/Orchestrator'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'

/** An orchestrator returning a mix of attention + non-attention boards. */
class MixedOrchestrator extends MockOrchestrator {
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

  it('excludes a monitorActivity:false board even when it is in an attention bucket', () => {
    const attention = selectAttention([
      { id: 'agent', type: 'terminal', title: 'Agent', status: 'blocked' },
      { id: 'shell', type: 'terminal', title: 'Shell', status: 'blocked', monitorActivity: false }
    ])
    expect(attention.map((b) => b.id)).toEqual(['agent'])
  })

  it('keeps monitored boards (monitorActivity true or absent are both in-attention)', () => {
    const attention = selectAttention([
      { id: 'm1', type: 'terminal', title: 'On', status: 'failed', monitorActivity: true },
      { id: 'm2', type: 'terminal', title: 'Default', status: 'failed' }
    ])
    expect(attention.map((b) => b.id)).toEqual(['m1', 'm2'])
  })
})

describe('canvas://boards resource', () => {
  it('round-trips agentKind + monitorActivity through to agents', async () => {
    class IdentityOrchestrator extends MockOrchestrator {
      override async listBoards(): Promise<BoardSummary[]> {
        return [
          {
            id: 't1',
            type: 'terminal',
            title: 'Claude',
            status: 'running',
            agentKind: 'claude',
            monitorActivity: true
          },
          {
            id: 't2',
            type: 'terminal',
            title: 'Shell',
            status: 'idle',
            monitorActivity: false
          }
        ]
      }
    }
    const client = await connectInMemory('worker', new IdentityOrchestrator())
    const res = await client.readResource({ uri: 'canvas://boards' })
    expect(JSON.parse(readText(res.contents))).toEqual([
      {
        id: 't1',
        type: 'terminal',
        title: 'Claude',
        status: 'running',
        agentKind: 'claude',
        monitorActivity: true
      },
      { id: 't2', type: 'terminal', title: 'Shell', status: 'idle', monitorActivity: false }
    ])
    await client.close()
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
