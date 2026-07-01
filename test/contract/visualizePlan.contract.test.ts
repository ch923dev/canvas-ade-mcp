import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { VisualizePlanSpec } from '../../src/orchestrator/Orchestrator'
import type { BoardId } from '../../src/types'

// The plan-visualize WRITE tool (P5) — `visualize_plan`. Flag-gated behind the SAME `planningWrite`
// gate as add_planning_elements / the Kanban card tools (all write content onto the durable canvas),
// registered for the orchestrator AND connected tiers, never the worker tier. It routes to
// Orchestrator.visualizePlan; the host does the sanitize / confirm-chooser / create / audit.
const TOOL = 'visualize_plan'

function toolNames(list: { tools: Array<{ name: string }> }): string[] {
  return list.tools.map((t) => t.name)
}

/** Captures the visualize call so the test can assert the tool → orchestrator routing + args. */
class SpyOrchestrator extends MockOrchestrator {
  calls: VisualizePlanSpec[] = []
  override async visualizePlan(spec: VisualizePlanSpec): Promise<{ id: BoardId }> {
    this.calls.push(spec)
    return { id: 'board-1' }
  }
}

describe('visualize_plan tool (P5, planningWrite-gated)', () => {
  it('orchestrator tools/list INCLUDES visualize_plan when planningWrite is on', async () => {
    const client = await connectInMemory(
      'orchestrator',
      new MockOrchestrator(),
      'b',
      undefined,
      true
    )
    expect(toolNames(await client.listTools())).toContain(TOOL)
    await client.close()
  })

  it('orchestrator tools/list OMITS visualize_plan when planningWrite is off (flag-gated)', async () => {
    const client = await connectInMemory(
      'orchestrator',
      new MockOrchestrator(),
      'b',
      undefined,
      false
    )
    expect(toolNames(await client.listTools())).not.toContain(TOOL)
    await client.close()
  })

  it('connected tools/list INCLUDES visualize_plan when planningWrite is on', async () => {
    const client = await connectInMemory('connected', new MockOrchestrator(), 'b', undefined, true)
    expect(toolNames(await client.listTools())).toContain(TOOL)
    await client.close()
  })

  it('worker tools/list OMITS visualize_plan regardless of the flag', async () => {
    const client = await connectInMemory('worker', new MockOrchestrator(), 'b', undefined, true)
    expect(toolNames(await client.listTools())).not.toContain(TOOL)
    await client.close()
  })

  it('routes to Orchestrator.visualizePlan with the plan + suggestion and echoes the minted id', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    const res = await client.callTool({
      name: TOOL,
      arguments: {
        title: 'Auth refactor',
        suggested: 'kanban',
        items: [
          { title: 'Audit token flow', status: 'backlog', tag: 'research' },
          { title: 'Wire PKCE', status: 'in progress', assignee: 'claude' }
        ]
      }
    })
    expect(orch.calls).toEqual([
      {
        title: 'Auth refactor',
        suggested: 'kanban',
        items: [
          { title: 'Audit token flow', status: 'backlog', tag: 'research' },
          { title: 'Wire PKCE', status: 'in progress', assignee: 'claude' }
        ]
      }
    ])
    const text = (res.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
    expect(text).toContain('board-1')
    await client.close()
  })

  it('omits suggested/title when the agent leaves them out (minimal plan)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    await client.callTool({ name: TOOL, arguments: { items: [{ title: 'One thing' }] } })
    expect(orch.calls).toEqual([{ items: [{ title: 'One thing' }] }])
    await client.close()
  })
})
