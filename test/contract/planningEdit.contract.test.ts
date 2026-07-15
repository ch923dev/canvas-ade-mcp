import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'
import type { PlanningElementPatch } from '../../src/orchestrator/Orchestrator'

// The planning-element UPDATE / REMOVE tools (S6) — update_planning_element / remove_planning_element.
// Flag-gated behind the SAME `planningWrite` gate as add_planning_elements, registered for the
// orchestrator AND connected tiers, never the worker tier. Each routes to the matching Orchestrator
// method; the host does the resolve/planning-check/kind-validate/confirm/audit.
const EDIT_TOOLS = ['update_planning_element', 'remove_planning_element'] as const

function toolNames(list: { tools: Array<{ name: string }> }): string[] {
  return list.tools.map((t) => t.name)
}

/** Captures every edit call so the test can assert the tool → orchestrator routing + args. */
class SpyOrchestrator extends MockOrchestrator {
  calls: Array<{ method: string; args: unknown[] }> = []
  override async updatePlanningElement(
    boardId: BoardId,
    elementId: string,
    patch: PlanningElementPatch
  ): Promise<void> {
    this.calls.push({ method: 'updatePlanningElement', args: [boardId, elementId, patch] })
  }
  override async removePlanningElement(boardId: BoardId, elementId: string): Promise<void> {
    this.calls.push({ method: 'removePlanningElement', args: [boardId, elementId] })
  }
}

describe('planning edit tools (S6, planningWrite-gated)', () => {
  it('orchestrator tools/list INCLUDES the edit tools when planningWrite is on', async () => {
    const client = await connectInMemory('orchestrator', new MockOrchestrator(), 'b', undefined, true)
    const names = toolNames(await client.listTools())
    for (const t of EDIT_TOOLS) expect(names).toContain(t)
    await client.close()
  })

  it('orchestrator tools/list OMITS the edit tools when planningWrite is off (flag-gated)', async () => {
    const client = await connectInMemory('orchestrator', new MockOrchestrator(), 'b', undefined, false)
    const names = toolNames(await client.listTools())
    for (const t of EDIT_TOOLS) expect(names).not.toContain(t)
    await client.close()
  })

  it('connected tools/list INCLUDES the edit tools when planningWrite is on', async () => {
    const client = await connectInMemory('connected', new MockOrchestrator(), 'b', undefined, true)
    const names = toolNames(await client.listTools())
    for (const t of EDIT_TOOLS) expect(names).toContain(t)
    await client.close()
  })

  it('worker tools/list OMITS the edit tools regardless of the flag', async () => {
    const client = await connectInMemory('worker', new MockOrchestrator(), 'b', undefined, true)
    const names = toolNames(await client.listTools())
    for (const t of EDIT_TOOLS) expect(names).not.toContain(t)
    await client.close()
  })

  it('update_planning_element routes to Orchestrator.updatePlanningElement with the assembled patch', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    await client.callTool({
      name: 'update_planning_element',
      arguments: {
        boardId: 'p1',
        elementId: 'el-9',
        title: 'Build progress',
        setItems: [{ id: 'it-1', done: true }]
      }
    })
    expect(orch.calls).toEqual([
      {
        method: 'updatePlanningElement',
        args: ['p1', 'el-9', { title: 'Build progress', setItems: [{ id: 'it-1', done: true }] }]
      }
    ])
    await client.close()
  })

  it('update_planning_element forwards note text + tint, and arrow deltas, in the flat patch', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    await client.callTool({
      name: 'update_planning_element',
      arguments: { boardId: 'p1', elementId: 'note-1', text: 'now correct', tint: 'green' }
    })
    await client.callTool({
      name: 'update_planning_element',
      arguments: { boardId: 'p1', elementId: 'arr-1', dx: 40, dy: -20 }
    })
    expect(orch.calls).toEqual([
      {
        method: 'updatePlanningElement',
        args: ['p1', 'note-1', { text: 'now correct', tint: 'green' }]
      },
      { method: 'updatePlanningElement', args: ['p1', 'arr-1', { dx: 40, dy: -20 }] }
    ])
    await client.close()
  })

  it('remove_planning_element routes to Orchestrator.removePlanningElement', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    await client.callTool({
      name: 'remove_planning_element',
      arguments: { boardId: 'p1', elementId: 'dup-2' }
    })
    expect(orch.calls).toEqual([
      { method: 'removePlanningElement', args: ['p1', 'dup-2'] }
    ])
    await client.close()
  })

  it('rejects an empty boardId WITHOUT calling the adapter (schema guard)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    const res = await client.callTool({
      name: 'update_planning_element',
      arguments: { boardId: '', elementId: 'el-1', text: 'x' }
    })
    expect(res.isError).toBe(true)
    expect(orch.calls).toEqual([])
    await client.close()
  })

  it('rejects a bad tint enum WITHOUT calling the adapter (schema guard)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    const res = await client.callTool({
      name: 'update_planning_element',
      arguments: { boardId: 'p1', elementId: 'el-1', tint: 'chartreuse' }
    })
    expect(res.isError).toBe(true)
    expect(orch.calls).toEqual([])
    await client.close()
  })
})
