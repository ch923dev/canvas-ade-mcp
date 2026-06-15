import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'
import type { PlanningElementsSpec } from '../../src/orchestrator/Orchestrator'

// add_planning_elements is the S2 planning content-write tool — orchestrator-tier AND
// flag-gated: it appears in tools/list ONLY when the host enables `planningWrite`. It writes
// attacker-influenceable content onto the durable canvas (ADR 0003), so the capability split
// (registration, not a prompt) is the load-bearing guarantee, plus the host's write-confirm.
const TOOL = 'add_planning_elements'

/** Records every addPlanningElements call to prove wiring + id/spec forwarding. */
class SpyOrchestrator extends MockOrchestrator {
  calls: Array<{ id: string; spec: PlanningElementsSpec }> = []
  override async addPlanningElements(boardId: BoardId, spec: PlanningElementsSpec): Promise<void> {
    this.calls.push({ id: boardId, spec })
  }
}

describe('add_planning_elements tool (S2, planning content write — flag-gated)', () => {
  it('is ABSENT from tools/list when the host has NOT enabled planningWrite (default off)', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    await client.close()
  })

  it('worker tools/list OMITS it even WHEN the flag is on (orchestrator-tier only)', async () => {
    const client = await connectInMemory(
      'worker',
      new MockOrchestrator(),
      'test-board',
      undefined,
      true
    )
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    await client.close()
  })

  it('orchestrator tools/list INCLUDES it when planningWrite is on', async () => {
    const client = await connectInMemory(
      'orchestrator',
      new MockOrchestrator(),
      'test-board',
      undefined,
      true
    )
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('forwards boardId + the validated elements to the adapter', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'test-board', undefined, true)
    await client.callTool({
      name: TOOL,
      arguments: {
        boardId: 'plan-1',
        elements: [
          { kind: 'note', text: 'audit middleware', tint: 'yellow' },
          {
            kind: 'checklist',
            title: 'Auth refactor',
            items: [
              { label: 'Audit current session mw', done: true },
              { label: 'Wire confirm gate' }
            ]
          }
        ]
      }
    })
    expect(orch.calls).toHaveLength(1)
    expect(orch.calls[0]?.id).toBe('plan-1')
    expect(orch.calls[0]?.spec.elements).toHaveLength(2)
    expect(orch.calls[0]?.spec.elements[0]).toEqual({
      kind: 'note',
      text: 'audit middleware',
      tint: 'yellow'
    })
    await client.close()
  })

  it('rejects an empty id WITHOUT calling the adapter', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'test-board', undefined, true)
    const res = await client.callTool({
      name: TOOL,
      arguments: { boardId: '', elements: [{ kind: 'note', text: 'x' }] }
    })
    expect(res.isError).toBe(true)
    expect(orch.calls).toEqual([])
    await client.close()
  })

  it('rejects an empty elements array (nothing to write)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'test-board', undefined, true)
    const res = await client.callTool({
      name: TOOL,
      arguments: { boardId: 'plan-1', elements: [] }
    })
    expect(res.isError).toBe(true)
    expect(orch.calls).toEqual([])
    await client.close()
  })

  it('rejects an unknown element kind WITHOUT calling the adapter (schema guard)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'test-board', undefined, true)
    const res = await client.callTool({
      name: TOOL,
      arguments: { boardId: 'plan-1', elements: [{ kind: 'doodle', squiggle: true }] }
    })
    expect(res.isError).toBe(true)
    expect(orch.calls).toEqual([])
    await client.close()
  })

  it('forwards a diagram element (Mermaid source) to the adapter', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'test-board', undefined, true)
    await client.callTool({
      name: TOOL,
      arguments: {
        boardId: 'plan-1',
        elements: [{ kind: 'diagram', source: 'graph TD\n  A[Plan] --> B[Build]' }]
      }
    })
    expect(orch.calls).toHaveLength(1)
    expect(orch.calls[0]?.spec.elements[0]).toEqual({
      kind: 'diagram',
      source: 'graph TD\n  A[Plan] --> B[Build]'
    })
    await client.close()
  })

  it('rejects a diagram with an empty source (schema guard)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'test-board', undefined, true)
    const res = await client.callTool({
      name: TOOL,
      arguments: { boardId: 'plan-1', elements: [{ kind: 'diagram', source: '' }] }
    })
    expect(res.isError).toBe(true)
    expect(orch.calls).toEqual([])
    await client.close()
  })

  it('rejects a batch over the per-call element cap', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'test-board', undefined, true)
    const elements = Array.from({ length: 51 }, (_, i) => ({ kind: 'note', text: `n${i}` }))
    const res = await client.callTool({ name: TOOL, arguments: { boardId: 'plan-1', elements } })
    expect(res.isError).toBe(true)
    expect(orch.calls).toEqual([])
    await client.close()
  })
})

describe('spawn_board seed (S2) — planning-only, flag-gated', () => {
  it('spawn_board has NO seed arg when planningWrite is off (a seed is silently ignored)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    // The seed key is not in the schema → it is stripped, the board still spawns, no content write.
    const res = await client.callTool({
      name: 'spawn_board',
      arguments: { type: 'planning', seed: [{ kind: 'note', text: 'x' }] }
    })
    expect(res.isError).toBeFalsy()
    expect(orch.calls).toEqual([]) // addPlanningElements never called
    await client.close()
  })

  it('spawn_board(planning, seed) mints + populates in one call when the flag is on', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'test-board', undefined, true)
    await client.callTool({
      name: 'spawn_board',
      arguments: { type: 'planning', seed: [{ kind: 'note', text: 'seeded' }] }
    })
    expect(orch.calls).toHaveLength(1)
    expect(orch.calls[0]?.id).toBe('mock-board') // the MockOrchestrator's spawn id
    expect(orch.calls[0]?.spec.elements[0]).toEqual({ kind: 'note', text: 'seeded' })
    await client.close()
  })

  it('rejects a seed on a NON-planning board without populating', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'test-board', undefined, true)
    const res = await client.callTool({
      name: 'spawn_board',
      arguments: { type: 'terminal', seed: [{ kind: 'note', text: 'x' }] }
    })
    expect(res.isError).toBe(true)
    expect(orch.calls).toEqual([])
    await client.close()
  })
})
