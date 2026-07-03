import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'

// spawn_board is the first WRITE tool (T3.1, package Phase 3). The capability
// split is the load-bearing safety guarantee: a worker tier must NEVER see — let
// alone reach — a lifecycle write tool. Enforced by REGISTRATION, like
// orchestrator_ping, never by prompt/annotation.
const TOOL = 'spawn_board'

/** Records every spawnBoard call and returns a fixed id, to prove wiring + validation. */
class SpyOrchestrator extends MockOrchestrator {
  calls: Array<{
    type: string
    prompt?: string
    cwd?: string
    title?: string
    sourceBoardId?: string
  }> = []
  override async spawnBoard(input: {
    type: string
    prompt?: string
    cwd?: string
    title?: string
    sourceBoardId?: BoardId
  }): Promise<{ id: BoardId }> {
    this.calls.push(input)
    return { id: 'board-xyz' }
  }
}

describe('spawn_board tool (T3.1, lifecycle write)', () => {
  it('worker tools/list OMITS spawn_board (capability split)', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    await client.close()
  })

  it('orchestrator tools/list INCLUDES spawn_board', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('orchestrator spawn_board(terminal) calls the adapter and surfaces its id', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { type: 'terminal' } })
    expect(orch.calls).toEqual([{ type: 'terminal' }])
    // The orchestrator-issued id is surfaced to the agent (text + structured).
    expect(JSON.stringify(res)).toContain('board-xyz')
    await client.close()
  })

  it('passes through prompt + cwd to the adapter for a TERMINAL, with the queued note (rc.6)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: { type: 'terminal', prompt: 'run dev', cwd: '/repo' }
    })
    expect(orch.calls).toEqual([{ type: 'terminal', prompt: 'run dev', cwd: '/repo' }])
    // content[0] stays the bare id (back-compat); a prompt-carrying spawn appends the honest
    // "queued, boots asynchronously" note so the agent never reads success as "already ran".
    const content = (res as { content: Array<{ text: string }> }).content
    expect(content[0]?.text).toBe('board-xyz')
    expect(content[1]?.text).toMatch(/launch command queued/i)
    await client.close()
  })

  it('a prompt-less spawn returns ONLY the bare id (no queued note)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { type: 'terminal' } })
    expect((res as { content: unknown[] }).content).toHaveLength(1)
    await client.close()
  })

  it('rejects prompt/cwd on a NON-terminal board WITHOUT spawning (rc.6 — was a silent no-op)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const withPrompt = await client.callTool({
      name: TOOL,
      arguments: { type: 'browser', prompt: 'run dev' }
    })
    const withCwd = await client.callTool({
      name: TOOL,
      arguments: { type: 'planning', cwd: '/repo' }
    })
    expect(withPrompt.isError).toBe(true)
    expect(withCwd.isError).toBe(true)
    expect(orch.calls).toEqual([]) // rejected BEFORE the adapter — no orphan board
    await client.close()
  })

  it('rejects an over-long prompt WITHOUT spawning (wire-level 400 cap, rc.6)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: { type: 'terminal', prompt: 'x'.repeat(401) }
    })
    expect(res.isError).toBe(true)
    expect(orch.calls).toEqual([])
    await client.close()
  })

  it('a CONNECTED-tier spawn carries its token-derived boardId as sourceBoardId (auto-cable, rc.6)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('connected', orch, 'my-consented-term')
    await client.callTool({ name: TOOL, arguments: { type: 'terminal', prompt: 'claude' } })
    expect(orch.calls).toEqual([
      { type: 'terminal', prompt: 'claude', sourceBoardId: 'my-consented-term' }
    ])
    await client.close()
  })

  it('an ORCHESTRATOR-tier spawn carries NO sourceBoardId (the app board needs no cable)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'app')
    await client.callTool({ name: TOOL, arguments: { type: 'terminal' } })
    expect(orch.calls).toEqual([{ type: 'terminal' }])
    await client.close()
  })

  it('passes through an optional title to the adapter (2b)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    await client.callTool({
      name: TOOL,
      arguments: { type: 'planning', title: 'Auth refactor plan' }
    })
    expect(orch.calls).toEqual([{ type: 'planning', title: 'Auth refactor plan' }])
    await client.close()
  })

  it('rejects an over-long title WITHOUT spawning (wire-level cap, 2b)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: { type: 'terminal', title: 'x'.repeat(81) }
    })
    expect(res.isError).toBe(true)
    expect(orch.calls).toEqual([]) // the schema rejects > SPAWN_BOARD_MAX_TITLE before the adapter
    await client.close()
  })

  it('rejects an unknown board type WITHOUT spawning', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { type: 'malware' } })
    expect(res.isError).toBe(true)
    expect(orch.calls).toEqual([]) // the safety invariant: no spawn on bad input
    await client.close()
  })
})
