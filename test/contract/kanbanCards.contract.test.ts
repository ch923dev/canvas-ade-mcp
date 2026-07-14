import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'
import type { KanbanCardPatch, KanbanCardSpec } from '../../src/orchestrator/Orchestrator'

// The Kanban card WRITE tools (P3) — add_card / move_card / update_card / remove_card. Flag-gated
// behind the SAME `planningWrite` gate as add_planning_elements (a Kanban board is a plan surface),
// registered for the orchestrator AND connected tiers, never the worker tier. Each routes to the
// matching Orchestrator method; the host does the resolve/kanban-check/confirm/audit.
const CARD_TOOLS = ['add_card', 'move_card', 'update_card', 'remove_card'] as const

function toolNames(list: { tools: Array<{ name: string }> }): string[] {
  return list.tools.map((t) => t.name)
}

/** Captures every card call so the test can assert the tool → orchestrator routing + args. */
class SpyOrchestrator extends MockOrchestrator {
  calls: Array<{ method: string; args: unknown[] }> = []
  override async addCard(boardId: BoardId, spec: KanbanCardSpec): Promise<{ id: BoardId }> {
    this.calls.push({ method: 'addCard', args: [boardId, spec] })
    return { id: 'card-1' }
  }
  override async moveCard(boardId: BoardId, cardId: BoardId, toColumnId: string): Promise<void> {
    this.calls.push({ method: 'moveCard', args: [boardId, cardId, toColumnId] })
  }
  override async updateCard(
    boardId: BoardId,
    cardId: BoardId,
    patch: KanbanCardPatch
  ): Promise<void> {
    this.calls.push({ method: 'updateCard', args: [boardId, cardId, patch] })
  }
  override async removeCard(boardId: BoardId, cardId: BoardId): Promise<void> {
    this.calls.push({ method: 'removeCard', args: [boardId, cardId] })
  }
}

describe('kanban card tools (P3, planningWrite-gated)', () => {
  it('orchestrator tools/list INCLUDES the card tools when planningWrite is on', async () => {
    const client = await connectInMemory(
      'orchestrator',
      new MockOrchestrator(),
      'b',
      undefined,
      true
    )
    const names = toolNames(await client.listTools())
    for (const t of CARD_TOOLS) expect(names).toContain(t)
    await client.close()
  })

  it('orchestrator tools/list OMITS the card tools when planningWrite is off (flag-gated)', async () => {
    const client = await connectInMemory(
      'orchestrator',
      new MockOrchestrator(),
      'b',
      undefined,
      false
    )
    const names = toolNames(await client.listTools())
    for (const t of CARD_TOOLS) expect(names).not.toContain(t)
    await client.close()
  })

  it('connected tools/list INCLUDES the card tools when planningWrite is on', async () => {
    const client = await connectInMemory('connected', new MockOrchestrator(), 'b', undefined, true)
    const names = toolNames(await client.listTools())
    for (const t of CARD_TOOLS) expect(names).toContain(t)
    await client.close()
  })

  it('worker tools/list OMITS the card tools regardless of the flag', async () => {
    const client = await connectInMemory('worker', new MockOrchestrator(), 'b', undefined, true)
    const names = toolNames(await client.listTools())
    for (const t of CARD_TOOLS) expect(names).not.toContain(t)
    await client.close()
  })

  it('add_card routes to Orchestrator.addCard with the spec and echoes the minted id', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    const res = await client.callTool({
      name: 'add_card',
      arguments: {
        boardId: 'k1',
        columnId: 'backlog',
        title: 'Wire auth',
        tag: 'feature',
        assignee: 'claude'
      }
    })
    expect(orch.calls).toEqual([
      {
        method: 'addCard',
        args: [
          'k1',
          { columnId: 'backlog', title: 'Wire auth', tag: 'feature', assignee: 'claude' }
        ]
      }
    ])
    const text = (res.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
    expect(text).toContain('card-1')
    await client.close()
  })

  it('move_card / update_card / remove_card route to their Orchestrator methods', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    await client.callTool({
      name: 'move_card',
      arguments: { boardId: 'k1', cardId: 'c9', toColumnId: 'review' }
    })
    await client.callTool({
      name: 'update_card',
      arguments: { boardId: 'k1', cardId: 'c9', tag: 'shipped' }
    })
    await client.callTool({ name: 'remove_card', arguments: { boardId: 'k1', cardId: 'c9' } })
    expect(orch.calls).toEqual([
      { method: 'moveCard', args: ['k1', 'c9', 'review'] },
      { method: 'updateCard', args: ['k1', 'c9', { tag: 'shipped' }] },
      { method: 'removeCard', args: ['k1', 'c9'] }
    ])
    await client.close()
  })

  it('add_card forwards the v19 detail fields (description / tags / fileRefs)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    await client.callTool({
      name: 'add_card',
      arguments: {
        boardId: 'k1',
        columnId: 'backlog',
        title: 'Wire auth',
        description: 'Add the token middleware.\nCheck expiry with <=.',
        tags: ['feature', 'security'],
        fileRefs: [{ path: 'src/auth/mw.ts', line: 12, endLine: 20 }, { path: 'src/auth/token.ts' }]
      }
    })
    expect(orch.calls).toEqual([
      {
        method: 'addCard',
        args: [
          'k1',
          {
            columnId: 'backlog',
            title: 'Wire auth',
            description: 'Add the token middleware.\nCheck expiry with <=.',
            tags: ['feature', 'security'],
            fileRefs: [
              { path: 'src/auth/mw.ts', line: 12, endLine: 20 },
              { path: 'src/auth/token.ts' }
            ]
          }
        ]
      }
    ])
    await client.close()
  })

  it('update_card forwards the v19 detail fields (description / tags / fileRefs)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    await client.callTool({
      name: 'update_card',
      arguments: {
        boardId: 'k1',
        cardId: 'c9',
        description: 'Done.',
        tags: ['shipped'],
        fileRefs: [{ path: 'README.md', line: 1 }]
      }
    })
    expect(orch.calls).toEqual([
      {
        method: 'updateCard',
        args: [
          'k1',
          'c9',
          { description: 'Done.', tags: ['shipped'], fileRefs: [{ path: 'README.md', line: 1 }] }
        ]
      }
    ])
    await client.close()
  })

  it('add_card REJECTS a fileRef with a non-integer line (schema guard)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    const res = await client.callTool({
      name: 'add_card',
      arguments: {
        boardId: 'k1',
        columnId: 'backlog',
        title: 'Bad ref',
        fileRefs: [{ path: 'src/x.ts', line: 0 }]
      }
    })
    expect(res.isError).toBe(true)
    expect(orch.calls).toEqual([]) // never reached the orchestrator
    await client.close()
  })
})
