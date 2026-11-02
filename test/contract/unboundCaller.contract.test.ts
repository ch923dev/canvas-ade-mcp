import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type {
  ArrangeMainBoardInput,
  EditGroupsInput,
  GroupBoardsInput,
  SpawnGroupInput,
  SpawnGroupResult,
  TidyCanvasInput,
  VisualizePlanSpec
} from '../../src/orchestrator/Orchestrator'
import {
  TOOL_ARRANGE_MAIN_BOARD,
  TOOL_EDIT_GROUPS,
  TOOL_FOCUS_VIEWPORT,
  TOOL_GROUP_BOARDS,
  TOOL_SPAWN_BOARD,
  TOOL_SPAWN_GROUP,
  TOOL_TIDY_CANVAS,
  TOOL_VISUALIZE_PLAN
} from '../../src/constants'
import type { BoardId, Tier } from '../../src/types'

// 🔒 The caller binding fails CLOSED (0.27.1). A lead/connected tool that binds the caller's
// token-derived board id as `sourceBoardId` used to spread NOTHING when that id was empty (a token
// minted without a board — `ctxFromAuth` falls back to ''), so the host read the call as an un-gated
// ORCHESTRATOR call: tidy/focus ran with no human confirm. Now every such tool refuses the call as
// `unauthorized` — the write_result rule — and the host method is never reached. The orchestrator
// tier binds no source, so an empty id there changes nothing.

/** Records which host methods ran (and with what), to prove a refused call never reaches the host. */
class SpyOrchestrator extends MockOrchestrator {
  hostCalls: Array<{ method: string; input: unknown }> = []
  override async tidyCanvas(input: TidyCanvasInput): Promise<unknown> {
    this.hostCalls.push({ method: 'tidyCanvas', input })
    return super.tidyCanvas(input)
  }
  override async arrangeMainBoard(input: ArrangeMainBoardInput): Promise<unknown> {
    this.hostCalls.push({ method: 'arrangeMainBoard', input })
    return super.arrangeMainBoard(input)
  }
  override async focusViewport(input: {
    boardId?: BoardId
    groupId?: string
    sourceBoardId?: BoardId
  }): Promise<unknown> {
    this.hostCalls.push({ method: 'focusViewport', input })
    return super.focusViewport(input)
  }
  override async groupBoards(input: GroupBoardsInput): Promise<unknown> {
    this.hostCalls.push({ method: 'groupBoards', input })
    return super.groupBoards(input)
  }
  override async editGroups(input: EditGroupsInput): Promise<unknown> {
    this.hostCalls.push({ method: 'editGroups', input })
    return super.editGroups(input)
  }
  override async spawnBoard(input: {
    type: string
    prompt?: string
    cwd?: string
    title?: string
    url?: string
    sourceBoardId?: BoardId
  }): Promise<{ id: BoardId }> {
    this.hostCalls.push({ method: 'spawnBoard', input })
    return super.spawnBoard(input)
  }
  override async spawnGroup(input: SpawnGroupInput): Promise<SpawnGroupResult> {
    this.hostCalls.push({ method: 'spawnGroup', input })
    return super.spawnGroup(input)
  }
  override async visualizePlan(spec: VisualizePlanSpec): Promise<{ id: BoardId }> {
    this.hostCalls.push({ method: 'visualizePlan', input: spec })
    return super.visualizePlan(spec)
  }
}

/** Every tool that binds `sourceBoardId`, a minimal valid call, and the tiers that register it. */
const BINDING_TOOLS: Array<{ tool: string; args: Record<string, unknown>; tiers: Tier[] }> = [
  { tool: TOOL_TIDY_CANVAS, args: { mode: 'fit' }, tiers: ['lead', 'connected'] },
  { tool: TOOL_ARRANGE_MAIN_BOARD, args: { boardId: 'b-main' }, tiers: ['lead', 'connected'] },
  { tool: TOOL_FOCUS_VIEWPORT, args: {}, tiers: ['lead', 'connected'] },
  {
    tool: TOOL_GROUP_BOARDS,
    args: { groups: [{ name: 'api', boardIds: ['b1'] }] },
    tiers: ['lead', 'connected']
  },
  {
    tool: TOOL_EDIT_GROUPS,
    args: { ops: [{ op: 'ungroup', groupId: 'g1' }] },
    tiers: ['lead', 'connected']
  },
  { tool: TOOL_SPAWN_BOARD, args: { type: 'terminal' }, tiers: ['lead', 'connected'] },
  // spawn_group is orchestrator + lead only (connected never registers it).
  { tool: TOOL_SPAWN_GROUP, args: { name: 'zone-1' }, tiers: ['lead'] },
  { tool: TOOL_VISUALIZE_PLAN, args: { items: [{ title: 'ship' }] }, tiers: ['lead', 'connected'] }
]

/** Call `tool` as `tier` bound to `boardId` (planning writes on, so visualize_plan registers). */
async function call(tool: string, args: Record<string, unknown>, tier: Tier, boardId: string) {
  const orch = new SpyOrchestrator()
  const client = await connectInMemory(tier, orch, boardId, undefined, true)
  const res = await client.callTool({ name: tool, arguments: args })
  await client.close()
  return { res, hostCalls: orch.hostCalls }
}

function text(res: unknown): string {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? []
  return content.map((c) => c.text ?? '').join('')
}

function errorCode(res: unknown): unknown {
  return (res as { structuredContent?: { error?: { code?: unknown } } }).structuredContent?.error
    ?.code
}

describe('🔒 unbound lead/connected caller (empty board id) — refused `unauthorized`', () => {
  for (const { tool, args, tiers } of BINDING_TOOLS) {
    for (const tier of tiers) {
      it(`${tier} ${tool}: isError + unauthorized, and the host is never called`, async () => {
        const { res, hostCalls } = await call(tool, args, tier, '')
        expect(res.isError).toBe(true)
        expect(errorCode(res)).toBe('unauthorized')
        expect(text(res)).toBe(`${tool}: no board bound to this session`)
        expect(hostCalls).toEqual([])
      })
    }
  }
})

describe('the bound path is unchanged', () => {
  for (const { tool, args, tiers } of BINDING_TOOLS) {
    for (const tier of tiers) {
      it(`${tier} ${tool}: a bound caller reaches the host with sourceBoardId = its own id`, async () => {
        const { res, hostCalls } = await call(tool, args, tier, `${tier}-board`)
        expect(res.isError).toBeFalsy()
        expect(hostCalls).toHaveLength(1)
        expect(hostCalls[0]?.input).toMatchObject({ sourceBoardId: `${tier}-board` })
      })
    }
  }

  // The orchestrator tier binds no source by design, so an empty id is not a refusal there.
  for (const { tool, args } of BINDING_TOOLS) {
    it(`orchestrator ${tool}: an empty board id still runs un-bound (no sourceBoardId)`, async () => {
      const { res, hostCalls } = await call(tool, args, 'orchestrator', '')
      expect(res.isError).toBeFalsy()
      expect(hostCalls).toHaveLength(1)
      expect('sourceBoardId' in (hostCalls[0]?.input as object)).toBe(false)
    })
  }
})
