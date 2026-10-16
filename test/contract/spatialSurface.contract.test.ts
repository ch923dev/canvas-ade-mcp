import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import { ServerFactory } from '../../src/server/factory'
import {
  TOOL_EDIT_GROUPS,
  TOOL_FOCUS_VIEWPORT,
  TOOL_GROUP_BOARDS,
  TOOL_TIDY_CANVAS
} from '../../src/constants'
import type { Tier } from '../../src/types'

/**
 * The C6 spatial surface, per tier (D1), and the warn-on-skip rule for its OPTIONAL host methods.
 *
 *   surface                                   orchestrator  lead  connected  worker
 *   tidy_canvas / focus_viewport                   ✓          ✓       ✓         –
 *   group_boards / edit_groups                     ✓          ✓       ✓         –
 *   canvas://layout / canvas://contexts            ✓          ✓       ✓         –
 *
 * The split is structural: an absent surface never appears in that tier's list.
 */
const SPATIAL_TOOLS = [TOOL_TIDY_CANVAS, TOOL_FOCUS_VIEWPORT, TOOL_GROUP_BOARDS, TOOL_EDIT_GROUPS]
const SPATIAL_RESOURCES = ['canvas://layout', 'canvas://contexts']
const SPATIAL_TIERS: Tier[] = ['orchestrator', 'lead', 'connected']

async function lists(tier: Tier, orch = new MockOrchestrator()) {
  const client = await connectInMemory(tier, orch)
  const tools = (await client.listTools()).tools.map((t) => t.name)
  const resources = (await client.listResources()).resources.map((r) => r.uri)
  await client.close()
  return { tools, resources }
}

describe('spatial surface — tools/list + resources/list membership per tier (D1)', () => {
  for (const tier of SPATIAL_TIERS) {
    it(`${tier}: every spatial tool and resource is present`, async () => {
      const { tools, resources } = await lists(tier)
      for (const t of SPATIAL_TOOLS) expect(tools, `${tier} ${t}`).toContain(t)
      for (const r of SPATIAL_RESOURCES) expect(resources, `${tier} ${r}`).toContain(r)
    })
  }

  it('worker: none of the spatial tools or resources', async () => {
    const { tools, resources } = await lists('worker')
    for (const t of SPATIAL_TOOLS) expect(tools, t).not.toContain(t)
    for (const r of SPATIAL_RESOURCES) expect(resources, r).not.toContain(r)
  })

  it('canvas://app-model stays orchestrator-only (the widening is spatial-only)', async () => {
    expect((await lists('orchestrator')).resources).toContain('canvas://app-model')
    for (const tier of ['lead', 'connected', 'worker'] as const) {
      expect((await lists(tier)).resources, tier).not.toContain('canvas://app-model')
    }
  })

  it('each spatial tool is registered exactly once per tier (no duplicate registration)', async () => {
    for (const tier of SPATIAL_TIERS) {
      const { tools, resources } = await lists(tier)
      for (const t of SPATIAL_TOOLS)
        expect(
          tools.filter((n) => n === t),
          `${tier} ${t}`
        ).toHaveLength(1)
      for (const r of SPATIAL_RESOURCES) {
        expect(
          resources.filter((u) => u === r),
          `${tier} ${r}`
        ).toHaveLength(1)
      }
    }
  })
})

// --- warn-on-skip ---------------------------------------------------------------------------------

/** A host that forwarded NONE of the three optional C6 methods. */
class UnwiredOrchestrator extends MockOrchestrator {
  override describeContexts = undefined as unknown as MockOrchestrator['describeContexts']
  override groupBoards = undefined as unknown as MockOrchestrator['groupBoards']
  override editGroups = undefined as unknown as MockOrchestrator['editGroups']
}

/** A host that forgot exactly one method. */
class NoGroupBoards extends MockOrchestrator {
  override groupBoards = undefined as unknown as MockOrchestrator['groupBoards']
}
class NoEditGroups extends MockOrchestrator {
  override editGroups = undefined as unknown as MockOrchestrator['editGroups']
}
class NoDescribeContexts extends MockOrchestrator {
  override describeContexts = undefined as unknown as MockOrchestrator['describeContexts']
}

describe('spatial surface — optional-method registration + exactly-one warn per missing method', () => {
  let warn: MockInstance<typeof console.warn>
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
  })

  const warnings = (): string[] => warn.mock.calls.map((c) => String(c[0]))

  it('a fully wired host: everything registered, ZERO warnings', async () => {
    for (const tier of SPATIAL_TIERS) await lists(tier)
    expect(warn).not.toHaveBeenCalled()
  })

  const single: Array<[string, () => MockOrchestrator, string, string, 'tool' | 'resource']> = [
    ['groupBoards', () => new NoGroupBoards(), TOOL_GROUP_BOARDS, 'groupBoards', 'tool'],
    ['editGroups', () => new NoEditGroups(), TOOL_EDIT_GROUPS, 'editGroups', 'tool'],
    [
      'describeContexts',
      () => new NoDescribeContexts(),
      'canvas://contexts',
      'describeContexts',
      'resource'
    ]
  ]
  for (const [label, make, surface, method, kind] of single) {
    for (const tier of SPATIAL_TIERS) {
      it(`${tier}: missing ${label} ⇒ ${surface} absent + exactly ONE warn naming it`, async () => {
        const { tools, resources } = await lists(tier, make())
        if (kind === 'tool') expect(tools).not.toContain(surface)
        else expect(resources).not.toContain(surface)
        // The other spatial surfaces are unaffected by one missing method.
        expect(tools).toContain(TOOL_TIDY_CANVAS)
        expect(resources).toContain('canvas://layout')
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warnings()[0]).toContain(surface)
        expect(warnings()[0]).toContain(`${method}()`)
      })
    }
  }

  it('all three missing ⇒ all three absent + exactly three warns, one per method', async () => {
    const { tools, resources } = await lists('connected', new UnwiredOrchestrator())
    expect(tools).not.toContain(TOOL_GROUP_BOARDS)
    expect(tools).not.toContain(TOOL_EDIT_GROUPS)
    expect(resources).not.toContain('canvas://contexts')
    expect(warn).toHaveBeenCalledTimes(3)
    const w = warnings()
    for (const method of ['groupBoards', 'editGroups', 'describeContexts']) {
      expect(
        w.filter((m) => m.includes(`${method}()`)),
        method
      ).toHaveLength(1)
    }
  })

  it('one warn per missing method PER SERVER BUILD (each getServer is its own build)', () => {
    const factory = new ServerFactory(new NoGroupBoards())
    factory.getServer({ tier: 'orchestrator', scopes: [], boardId: 'app' }).dispose()
    expect(warn).toHaveBeenCalledTimes(1)
    factory.getServer({ tier: 'lead', scopes: [], boardId: 'lead-b' }).dispose()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('worker: never checks the optional methods, so an unwired host raises NO warn', async () => {
    await lists('worker', new UnwiredOrchestrator())
    expect(warn).not.toHaveBeenCalled()
  })
})
