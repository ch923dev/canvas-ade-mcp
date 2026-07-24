import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import { mintBoardToken } from '../../src/auth/mint'
import { TokenStore } from '../../src/auth/tokens'
import { defaultScopesFor } from '../../src/auth/scopes'
import type { BoardId } from '../../src/types'
import type { SpawnGroupInput, SpawnGroupResult } from '../../src/orchestrator/Orchestrator'
import {
  TOOL_ADD_PLANNING_ELEMENTS,
  TOOL_ASSIGN_PROMPT,
  TOOL_CLOSE_BOARD,
  TOOL_CONFIGURE_BOARD,
  TOOL_FOCUS_VIEWPORT,
  TOOL_GIT_DIFF,
  TOOL_HANDOFF_PROMPT,
  TOOL_INTERRUPT,
  TOOL_ORCHESTRATOR_PING,
  TOOL_PING,
  TOOL_RELAY_PROMPT,
  TOOL_RELAY_PROMPTS,
  TOOL_SPAWN_BOARD,
  TOOL_SPAWN_GROUP,
  TOOL_TIDY_CANVAS,
  TOOL_WAIT_FOR_ALL,
  TOOL_WAIT_FOR_IDLE,
  TOOL_WRITE_RESULT
} from '../../src/constants'

/**
 * Lead tier (orchestration Phase 1, precondition X) — the contract proof that a terminal-held
 * orchestrator token's dispatch authority binds to the CALLER'S OWN board id, never to the
 * hard-coded `commandBoardId:'app'`, and that its tool surface is the orchestration core only
 * (spawn + dispatch + barriers + write_result), registered structurally.
 */

/** Records relay/dispatch/spawn calls, to prove which adapter path each tool takes. */
class SpyOrchestrator extends MockOrchestrator {
  relayed: Array<{ sourceId: string; targetId: string; text: string }> = []
  dispatched: Array<{ boardId: string; text: string }> = []
  spawns: Array<{ type: string; sourceBoardId?: string }> = []
  groups: SpawnGroupInput[] = []

  override async relayPrompt(
    sourceId: BoardId,
    targetId: BoardId,
    text: string
  ): Promise<{ delivery: 'ready' | 'unconfirmed' } | void> {
    this.relayed.push({ sourceId, targetId, text })
  }

  override async dispatchPrompt(
    boardId: BoardId,
    text: string
  ): Promise<{ delivery: 'ready' | 'unconfirmed' } | void> {
    this.dispatched.push({ boardId, text })
  }

  override async spawnBoard(input: {
    type: string
    prompt?: string
    cwd?: string
    title?: string
    url?: string
    sourceBoardId?: BoardId
  }): Promise<{ id: BoardId }> {
    this.spawns.push({ type: input.type, sourceBoardId: input.sourceBoardId })
    return { id: 'spawned-1' }
  }

  override async spawnGroup(input: SpawnGroupInput): Promise<SpawnGroupResult> {
    this.groups.push(input)
    return { groupId: 'g1', terminalId: 't1' }
  }
}

describe('lead tier — structural tool surface (registration split)', () => {
  it('tools/list is the orchestration core: spawn + dispatch + barriers + write_result', async () => {
    const client = await connectInMemory('lead', undefined, 'lead-board')
    const names = (await client.listTools()).tools.map((t) => t.name)
    for (const included of [
      TOOL_PING,
      TOOL_SPAWN_BOARD,
      TOOL_SPAWN_GROUP,
      TOOL_RELAY_PROMPT,
      TOOL_RELAY_PROMPTS,
      TOOL_ASSIGN_PROMPT,
      TOOL_WAIT_FOR_ALL,
      TOOL_WAIT_FOR_IDLE,
      TOOL_WRITE_RESULT
    ]) {
      expect(names, `expected ${included} registered at lead`).toContain(included)
    }
    await client.close()
  })

  it('OMITS the app-resident orchestrator surfaces (handoff/interrupt/close/git_diff/configure/tidy/focus/orchestrator_ping)', async () => {
    const client = await connectInMemory('lead', undefined, 'lead-board')
    const names = (await client.listTools()).tools.map((t) => t.name)
    for (const omitted of [
      TOOL_ORCHESTRATOR_PING,
      TOOL_HANDOFF_PROMPT,
      TOOL_INTERRUPT,
      TOOL_CLOSE_BOARD,
      TOOL_GIT_DIFF,
      TOOL_CONFIGURE_BOARD,
      TOOL_TIDY_CANVAS,
      TOOL_FOCUS_VIEWPORT
    ]) {
      expect(names, `expected ${omitted} absent at lead`).not.toContain(omitted)
    }
    await client.close()
  })

  it('canvas://app-model stays orchestrator-only (absent from a lead resources/list)', async () => {
    const client = await connectInMemory('lead', undefined, 'lead-board')
    const uris = (await client.listResources()).resources.map((r) => r.uri)
    expect(uris).not.toContain('canvas://app-model')
    await client.close()
  })

  it('planning writes follow the planningWrite flag exactly like connected (absent off, present on)', async () => {
    const off = await connectInMemory('lead', undefined, 'lead-board', undefined, false)
    expect((await off.listTools()).tools.map((t) => t.name)).not.toContain(
      TOOL_ADD_PLANNING_ELEMENTS
    )
    await off.close()
    const on = await connectInMemory('lead', undefined, 'lead-board', undefined, true)
    expect((await on.listTools()).tools.map((t) => t.name)).toContain(TOOL_ADD_PLANNING_ELEMENTS)
    await on.close()
  })
})

describe('lead tier — own-board dispatch binding (the precondition-X proof)', () => {
  it('relay_prompt CAN relay when sourceId === its own (token-derived) boardId', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('lead', orch, 'lead-board')
    const res = await client.callTool({
      name: TOOL_RELAY_PROMPT,
      arguments: { sourceId: 'lead-board', targetId: 'worker-1', prompt: 'run the build' }
    })
    expect(res.isError).toBeFalsy()
    expect(orch.relayed).toEqual([
      { sourceId: 'lead-board', targetId: 'worker-1', text: 'run the build' }
    ])
    await client.close()
  })

  it('relay_prompt is REJECTED (no relay) when sourceId is a board it does not own', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('lead', orch, 'lead-board')
    const res = await client.callTool({
      name: TOOL_RELAY_PROMPT,
      arguments: { sourceId: 'other-board', targetId: 'worker-1', prompt: 'spoof' }
    })
    expect(res.isError).toBe(true)
    expect(orch.relayed).toEqual([])
    await client.close()
  })

  it("relay_prompt IGNORES commandBoardId — the 'app' designation never widens or narrows a lead", async () => {
    // The generalization under test: with the host's commandBoardId set to 'app', a lead token
    // bound to its own board still relays from its own board (and only from it).
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('lead', orch, 'lead-board', 'app')
    const ok = await client.callTool({
      name: TOOL_RELAY_PROMPT,
      arguments: { sourceId: 'lead-board', targetId: 'worker-1', prompt: 'ok' }
    })
    expect(ok.isError).toBeFalsy()
    const spoof = await client.callTool({
      name: TOOL_RELAY_PROMPT,
      arguments: { sourceId: 'app', targetId: 'worker-1', prompt: 'pretend to be app' }
    })
    expect(spoof.isError).toBe(true)
    expect(orch.relayed).toEqual([{ sourceId: 'lead-board', targetId: 'worker-1', text: 'ok' }])
    await client.close()
  })

  it('relay_prompts binds EVERY item to the own board; one foreign item fails the whole batch', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('lead', orch, 'lead-board')
    const res = await client.callTool({
      name: TOOL_RELAY_PROMPTS,
      arguments: {
        items: [
          { sourceId: 'lead-board', targetId: 'worker-1', prompt: 'a' },
          { sourceId: 'other-board', targetId: 'worker-2', prompt: 'b' }
        ]
      }
    })
    expect(res.isError).toBe(true)
    expect(orch.relayed).toEqual([])
    await client.close()
  })

  it('assign_prompt at lead routes through the RELAY path with the own board as source (cable-authorized)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('lead', orch, 'lead-board')
    const res = await client.callTool({
      name: TOOL_ASSIGN_PROMPT,
      arguments: { boardId: 'worker-1', prompt: 'do the task' }
    })
    expect(res.isError).toBeFalsy()
    // The load-bearing assertion: relayPrompt (cable check host-side), NOT dispatchPrompt.
    expect(orch.relayed).toEqual([
      { sourceId: 'lead-board', targetId: 'worker-1', text: 'do the task' }
    ])
    expect(orch.dispatched).toEqual([])
    await client.close()
  })

  it('assign_prompt at orchestrator tier still uses dispatchPrompt (zero regression)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'app', 'app')
    const res = await client.callTool({
      name: TOOL_ASSIGN_PROMPT,
      arguments: { boardId: 'worker-1', prompt: 'do the task' }
    })
    expect(res.isError).toBeFalsy()
    expect(orch.dispatched).toEqual([{ boardId: 'worker-1', text: 'do the task' }])
    expect(orch.relayed).toEqual([])
    await client.close()
  })
})

describe('lead tier — spawn auto-cable (dispatch into a spawned worker is pre-authorized)', () => {
  it('spawn_board passes the lead board as sourceBoardId (host auto-cables lead→spawned)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('lead', orch, 'lead-board')
    const res = await client.callTool({
      name: TOOL_SPAWN_BOARD,
      arguments: { type: 'terminal' }
    })
    expect(res.isError).toBeFalsy()
    expect(orch.spawns).toEqual([{ type: 'terminal', sourceBoardId: 'lead-board' }])
    await client.close()
  })

  it('spawn_group passes the lead board as sourceBoardId; an orchestrator spawn_group passes none', async () => {
    const leadOrch = new SpyOrchestrator()
    const lead = await connectInMemory('lead', leadOrch, 'lead-board')
    const leadRes = await lead.callTool({
      name: TOOL_SPAWN_GROUP,
      arguments: { name: 'zone-1' }
    })
    expect(leadRes.isError).toBeFalsy()
    expect(leadOrch.groups).toHaveLength(1)
    expect(leadOrch.groups[0]?.sourceBoardId).toBe('lead-board')
    await lead.close()

    const appOrch = new SpyOrchestrator()
    const app = await connectInMemory('orchestrator', appOrch, 'app', 'app')
    const appRes = await app.callTool({
      name: TOOL_SPAWN_GROUP,
      arguments: { name: 'zone-2' }
    })
    expect(appRes.isError).toBeFalsy()
    expect(appOrch.groups).toHaveLength(1)
    expect(appOrch.groups[0]?.sourceBoardId).toBeUndefined()
    await app.close()
  })
})

describe('lead tier — mint + scopes', () => {
  it('defaultScopesFor(lead) = read + dispatch + spawn (no git:write, no answer_permission)', () => {
    expect(defaultScopesFor('lead').sort()).toEqual(['dispatch', 'read', 'spawn'])
  })

  it('mintBoardToken mints a lead row bound to the board with the lead scopes', () => {
    const store = new TokenStore()
    const { token, row } = mintBoardToken(store, { boardId: 'lead-board', tier: 'lead' })
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(row.tier).toBe('lead')
    expect(row.boardId).toBe('lead-board')
    expect(row.scopes.sort()).toEqual(['dispatch', 'read', 'spawn'])
    expect(store.get(token)?.tier).toBe('lead')
  })
})
