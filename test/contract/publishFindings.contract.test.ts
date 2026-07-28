import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'

/**
 * `publish_findings` (orchestration P4) — the END-OF-RUN batch sibling of `add_card`.
 *
 * The tool exists for exactly one reason and the tests are shaped around it: `add_card` adds ONE
 * human-confirmed card, so N worker findings would be N modals. This is the batch path. What the
 * contract has to pin is (a) which tiers see it, (b) that it carries NO content, and (c) that
 * publishing zero cards is a SUCCESS, not an error — an empty batch or a fully-declined one wrote
 * nothing, and reporting that as a failure would push an agent into retrying a no-op.
 */
const TOOL = 'publish_findings'

function toolNames(list: { tools: Array<{ name: string }> }): string[] {
  return list.tools.map((t) => t.name)
}

class SpyOrchestrator extends MockOrchestrator {
  calls: Array<{ boardId: BoardId; opts?: { lane?: string } }> = []
  result: { ok: boolean; published: number; summary: string } = {
    ok: true,
    published: 3,
    summary: 'published 3 cards · 1 declined'
  }
  override async publishFindings(
    boardId: BoardId,
    opts?: { lane?: string }
  ): Promise<{ ok: boolean; published: number; summary: string }> {
    this.calls.push({ boardId, opts })
    return this.result
  }
}

/** A host that never wired the optional method — the tool must not appear at all. */
class UnwiredOrchestrator extends MockOrchestrator {
  override publishFindings = undefined as unknown as MockOrchestrator['publishFindings']
}

describe('publish_findings (P4, planningWrite-gated)', () => {
  it('orchestrator tools/list INCLUDES it when planningWrite is on', async () => {
    const c = await connectInMemory('orchestrator', new MockOrchestrator(), 'b', undefined, true)
    expect(toolNames(await c.listTools())).toContain(TOOL)
    await c.close()
  })

  it('orchestrator tools/list OMITS it when planningWrite is off', async () => {
    // It writes durable content onto a kanban board, so it lives behind the same gate as
    // add_planning_elements / add_card — never available when the host has content writes off.
    const c = await connectInMemory('orchestrator', new MockOrchestrator(), 'b', undefined, false)
    expect(toolNames(await c.listTools())).not.toContain(TOOL)
    await c.close()
  })

  it('LEAD tools/list includes it — a lead IS the orchestrator over the wire', async () => {
    // 🔒 The lead tier is the one that has silently collapsed before (the ctxFromAuth
    // closed-vocabulary gap in Phase 1), so its surface is asserted explicitly, never assumed.
    const c = await connectInMemory('lead', new MockOrchestrator(), 'b', undefined, true)
    expect(toolNames(await c.listTools())).toContain(TOOL)
    await c.close()
  })

  it('lead tools/list omits it when planningWrite is off', async () => {
    const c = await connectInMemory('lead', new MockOrchestrator(), 'b', undefined, false)
    expect(toolNames(await c.listTools())).not.toContain(TOOL)
    await c.close()
  })

  it('WORKER tools/list never contains it, gate or no gate', async () => {
    for (const gate of [true, false]) {
      const c = await connectInMemory('worker', new MockOrchestrator(), 'b', undefined, gate)
      expect(toolNames(await c.listTools())).not.toContain(TOOL)
      await c.close()
    }
  })

  it('CONNECTED tools/list does not contain it — publishing a run is an orchestrator act', async () => {
    const c = await connectInMemory('connected', new MockOrchestrator(), 'b', undefined, true)
    expect(toolNames(await c.listTools())).not.toContain(TOOL)
    await c.close()
  })

  it('is absent entirely when the host never wired the optional method', async () => {
    // Registering a tool whose host cannot serve it would advertise a call that always fails.
    const c = await connectInMemory('orchestrator', new UnwiredOrchestrator(), 'b', undefined, true)
    expect(toolNames(await c.listTools())).not.toContain(TOOL)
    await c.close()
  })

  it('🔒 accepts NO findings content — only a destination board and an optional lane', async () => {
    const c = await connectInMemory('orchestrator', new MockOrchestrator(), 'b', undefined, true)
    const tool = (await c.listTools()).tools.find((t) => t.name === TOOL)
    // This IS the trust property: the host derives every card from write_result data it already
    // holds, so an agent cannot author a finding no worker reported.
    expect(Object.keys(tool!.inputSchema.properties ?? {}).sort()).toEqual(['boardId', 'lane'])
    await c.close()
  })

  it('routes the board id and lane through to the host', async () => {
    const orch = new SpyOrchestrator()
    const c = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    await c.callTool({ name: TOOL, arguments: { boardId: 'kanban-1', lane: 'review' } })
    expect(orch.calls).toEqual([{ boardId: 'kanban-1', opts: { lane: 'review' } }])
    await c.close()
  })

  it('omits opts entirely when no lane is given (severity routing is the host default)', async () => {
    const orch = new SpyOrchestrator()
    const c = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    await c.callTool({ name: TOOL, arguments: { boardId: 'kanban-1' } })
    expect(orch.calls).toEqual([{ boardId: 'kanban-1', opts: undefined }])
    await c.close()
  })

  it('returns the host summary verbatim — the agent must relay it, not a bare success', async () => {
    const orch = new SpyOrchestrator()
    const c = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    const r = await c.callTool({ name: TOOL, arguments: { boardId: 'kanban-1' } })
    expect(r.isError).toBeFalsy()
    expect(JSON.stringify(r.content)).toContain('published 3 cards · 1 declined')
    await c.close()
  })

  it('🔒 publishing ZERO cards is a SUCCESS — an empty or fully-declined batch wrote nothing', async () => {
    // Reporting a legitimate no-op as an error is how an agent gets pushed into retrying it.
    const orch = new SpyOrchestrator()
    orch.result = { ok: true, published: 0, summary: 'no findings approved — nothing written' }
    const c = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    const r = await c.callTool({ name: TOOL, arguments: { boardId: 'kanban-1' } })
    expect(r.isError).toBeFalsy()
    expect(JSON.stringify(r.content)).toContain('nothing written')
    await c.close()
  })

  it('surfaces a REFUSAL as a tool error so it cannot read as a publish', async () => {
    const orch = new SpyOrchestrator()
    orch.result = { ok: false, published: 0, summary: 'board kanban-1 is a planning, not a kanban' }
    const c = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    const r = await c.callTool({ name: TOOL, arguments: { boardId: 'kanban-1' } })
    expect(r.isError).toBe(true)
    expect(JSON.stringify(r.content)).toContain('not a kanban')
    await c.close()
  })

  it('rejects an empty board id at the protocol layer', async () => {
    const orch = new SpyOrchestrator()
    const c = await connectInMemory('orchestrator', orch, 'b', undefined, true)
    const r = await c.callTool({ name: TOOL, arguments: { boardId: '' } })
    expect(r.isError).toBe(true)
    expect(orch.calls).toHaveLength(0)
    await c.close()
  })
})
