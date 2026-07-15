import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'

// canvas://board/{id}/cards (P3b) is the per-board read-only projection of one Kanban board's columns
// + cards (grouped host-side). Registered in registerBoardResources, so it serves BOTH tiers
// (observation is safe — the read half of the card mutation loop). MockOrchestrator.boardCards returns
// a minimal kanban fixture — enough to prove the wire, the tier availability, and the grouped shape.
const URI = 'canvas://board/k1/cards'

function readText(contents: ReadonlyArray<{ uri?: unknown; text?: unknown }>): string {
  return contents.map((c) => (typeof c.text === 'string' ? c.text : '')).join('')
}

describe('canvas://board/{id}/cards resource (P3b, per-board kanban read)', () => {
  it('returns the grouped columns + cards for the templated board id', async () => {
    const client = await connectInMemory('orchestrator')
    const res = await client.readResource({ uri: URI })
    const cards = JSON.parse(readText(res.contents))
    expect(cards).toMatchObject({
      boardId: 'k1',
      isKanban: true,
      columns: expect.any(Array)
    })
    expect(cards.columns[0]).toMatchObject({
      id: 'backlog',
      title: 'Backlog',
      cards: expect.any(Array)
    })
    // wip is always present (a number or null); chips are omitted when absent.
    expect('wip' in cards.columns[0]).toBe(true)
    await client.close()
  })

  it('is readable by the worker tier (observation is safe for both tiers)', async () => {
    const client = await connectInMemory('worker')
    const res = await client.readResource({ uri: URI })
    expect(JSON.parse(readText(res.contents)).isKanban).toBe(true)
    await client.close()
  })

  it('is readable by the connected tier', async () => {
    const client = await connectInMemory('connected')
    const res = await client.readResource({ uri: URI })
    expect(JSON.parse(readText(res.contents)).boardId).toBe('k1')
    await client.close()
  })
})
