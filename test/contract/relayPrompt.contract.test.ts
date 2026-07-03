import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'

// relay_prompt is the agent-to-agent DISPATCH tool (M4 T4.6, the M4 gate) — orchestrator-
// tier only. A dispatch from board A to board B is expressed by an ORCHESTRATION connector
// A→B (the cable is the route); the host resolves + validates the edge (terminal→terminal,
// one-directional) before writing into B's PTY (nonce + human-confirm + audit).
const TOOL = 'relay_prompt'

/** Records every relayPrompt call, to prove wiring (relayPrompt returns void). */
class SpyOrchestrator extends MockOrchestrator {
  relayed: Array<{ sourceId: string; targetId: string; text: string }> = []
  override async relayPrompt(
    sourceId: BoardId,
    targetId: BoardId,
    text: string
  ): Promise<{ delivery: 'ready' | 'unconfirmed' } | void> {
    this.relayed.push({ sourceId, targetId, text })
  }
}

describe('relay_prompt tool (T4.6, agent-to-agent dispatch over a connector)', () => {
  it('worker tools/list OMITS relay_prompt (capability split)', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    await client.close()
  })

  it('orchestrator tools/list INCLUDES relay_prompt', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('forwards sourceId + targetId + prompt to the adapter and returns an ack', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: { sourceId: 'A', targetId: 'B', prompt: 'run the build' }
    })
    expect(orch.relayed).toEqual([{ sourceId: 'A', targetId: 'B', text: 'run the build' }])
    expect(res.isError).toBeFalsy()
    await client.close()
  })

  it('rejects an empty sourceId/targetId/prompt WITHOUT relaying', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const noSource = await client.callTool({
      name: TOOL,
      arguments: { sourceId: '', targetId: 'B', prompt: 'x' }
    })
    const noTarget = await client.callTool({
      name: TOOL,
      arguments: { sourceId: 'A', targetId: '', prompt: 'x' }
    })
    const noPrompt = await client.callTool({
      name: TOOL,
      arguments: { sourceId: 'A', targetId: 'B', prompt: '' }
    })
    expect(noSource.isError).toBe(true)
    expect(noTarget.isError).toBe(true)
    expect(noPrompt.isError).toBe(true)
    expect(orch.relayed).toEqual([])
    await client.close()
  })

  it('🔒 rejects a prompt with an embedded Ctrl-C (\\x03) WITHOUT relaying', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: { sourceId: 'A', targetId: 'B', prompt: 'go' }
    })
    expect(res.isError).toBe(true)
    expect(orch.relayed).toEqual([])
    await client.close()
  })

  // 🔒 BUG-021 part 2 — caller-identity binding. When the host designates a command board,
  // only the token bound to THAT board may relay (a second orchestrator token can't drive a
  // cable it doesn't own). ctx.boardId is token-derived, so it can't be forged by the client.
  it('🔒 with a command board set, the command orchestrator (matching boardId) CAN relay', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'app', 'app')
    const res = await client.callTool({
      name: TOOL,
      arguments: { sourceId: 'A', targetId: 'B', prompt: 'run the build' }
    })
    expect(res.isError).toBeFalsy()
    expect(orch.relayed).toEqual([{ sourceId: 'A', targetId: 'B', text: 'run the build' }])
    await client.close()
  })

  it('🔒 with a command board set, a DIFFERENT orchestrator token is rejected WITHOUT relaying', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'rogue-board', 'app')
    const res = await client.callTool({
      name: TOOL,
      arguments: { sourceId: 'A', targetId: 'B', prompt: 'exploit the A->B cable' }
    })
    expect(res.isError).toBe(true)
    expect(orch.relayed).toEqual([])
    await client.close()
  })

  it('without a command board set, relay stays open to any orchestrator (back-compat)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'whoever')
    const res = await client.callTool({
      name: TOOL,
      arguments: { sourceId: 'A', targetId: 'B', prompt: 'still works' }
    })
    expect(res.isError).toBeFalsy()
    expect(orch.relayed).toEqual([{ sourceId: 'A', targetId: 'B', text: 'still works' }])
    await client.close()
  })

  // 🔒 Connected tier (Agent Orchestration v1) — a consented Terminal board may relay ONLY from
  // its OWN board (scoped to its own outgoing cables). The cable graph (host-checked) authorizes
  // the target; this binding stops a connected board spoofing sourceId to drive another's cables.
  describe('connected tier — own-board source binding', () => {
    it('CAN relay when sourceId === its own (token-derived) boardId', async () => {
      const orch = new SpyOrchestrator()
      const client = await connectInMemory('connected', orch, 'board-A')
      const res = await client.callTool({
        name: TOOL,
        arguments: { sourceId: 'board-A', targetId: 'board-B', prompt: 'run the build' }
      })
      expect(res.isError).toBeFalsy()
      expect(orch.relayed).toEqual([
        { sourceId: 'board-A', targetId: 'board-B', text: 'run the build' }
      ])
      await client.close()
    })

    it('is REJECTED (no relay) when sourceId is a board it does not own', async () => {
      const orch = new SpyOrchestrator()
      const client = await connectInMemory('connected', orch, 'board-A')
      const res = await client.callTool({
        name: TOOL,
        arguments: { sourceId: 'board-X', targetId: 'board-B', prompt: 'exploit X cable' }
      })
      expect(res.isError).toBe(true)
      expect(orch.relayed).toEqual([])
      await client.close()
    })

    it('ignores commandBoardId — own-board binding governs the connected tier', async () => {
      // commandBoardId is the orchestrator-tier ('app') lever; a connected token is bound to its
      // own board regardless, so it can still relay from its own board even when one is set.
      const orch = new SpyOrchestrator()
      const client = await connectInMemory('connected', orch, 'board-A', 'app')
      const res = await client.callTool({
        name: TOOL,
        arguments: { sourceId: 'board-A', targetId: 'board-B', prompt: 'ok' }
      })
      expect(res.isError).toBeFalsy()
      expect(orch.relayed).toEqual([{ sourceId: 'board-A', targetId: 'board-B', text: 'ok' }])
      await client.close()
    })
  })

  it('surfaces a delivery WARNING when the host resolves { delivery: "unconfirmed" } (rc.6)', async () => {
    class UnconfirmedOrch extends SpyOrchestrator {
      override async relayPrompt(
        sourceId: BoardId,
        targetId: BoardId,
        text: string
      ): Promise<{ delivery: 'ready' | 'unconfirmed' }> {
        await super.relayPrompt(sourceId, targetId, text)
        return { delivery: 'unconfirmed' }
      }
    }
    const orch = new UnconfirmedOrch()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: { sourceId: 'A', targetId: 'B', prompt: 'run the build' }
    })
    expect(res.isError).toBeFalsy()
    expect(JSON.stringify(res)).toMatch(/WARNING: delivery unconfirmed/)
    await client.close()
  })

  it('a void-resolving (pre-rc.6) host keeps the legacy confirmed ack text', async () => {
    const orch = new SpyOrchestrator() // relayPrompt resolves undefined
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: { sourceId: 'A', targetId: 'B', prompt: 'run the build' }
    })
    expect(res.isError).toBeFalsy()
    const text = JSON.stringify(res)
    expect(text).toMatch(/relayed A/)
    expect(text).not.toMatch(/WARNING/)
    await client.close()
  })
})
