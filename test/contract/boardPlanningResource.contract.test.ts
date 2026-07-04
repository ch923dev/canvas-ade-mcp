import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'

// canvas://board/{id}/planning (S6) is the per-board read-only projection of one Planning board's
// elements + their ids (projected host-side). Registered in registerBoardResources, so it serves BOTH
// tiers (observation is safe — the read half of the planning update loop). MockOrchestrator.boardPlanning
// returns a minimal planning fixture — enough to prove the wire, tier availability, and the element shape.
const URI = 'canvas://board/p1/planning'

function readText(contents: ReadonlyArray<{ uri?: unknown; text?: unknown }>): string {
  return contents.map((c) => (typeof c.text === 'string' ? c.text : '')).join('')
}

describe('canvas://board/{id}/planning resource (S6, per-board planning read)', () => {
  it('returns the elements (with ids) for the templated board id', async () => {
    const client = await connectInMemory('orchestrator')
    const res = await client.readResource({ uri: URI })
    const planning = JSON.parse(readText(res.contents))
    expect(planning).toMatchObject({
      boardId: 'p1',
      isPlanning: true,
      elements: expect.any(Array)
    })
    // A checklist element exposes its id + item ids so an agent can target update_planning_element.
    expect(planning.elements[0]).toMatchObject({
      id: expect.any(String),
      kind: 'checklist',
      items: expect.any(Array)
    })
    expect(planning.elements[0].items[0]).toMatchObject({
      id: expect.any(String),
      label: expect.any(String),
      done: expect.any(Boolean)
    })
    await client.close()
  })

  it('is readable by the worker tier (observation is safe for both tiers)', async () => {
    const client = await connectInMemory('worker')
    const res = await client.readResource({ uri: URI })
    expect(JSON.parse(readText(res.contents)).isPlanning).toBe(true)
    await client.close()
  })

  it('is readable by the connected tier', async () => {
    const client = await connectInMemory('connected')
    const res = await client.readResource({ uri: URI })
    expect(JSON.parse(readText(res.contents)).boardId).toBe('p1')
    await client.close()
  })
})
