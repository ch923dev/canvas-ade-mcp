import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { RelayItem, RelayResult } from '../../src/orchestrator/Orchestrator'

// relay_prompts is the BATCH agent-to-agent dispatch tool (rc.8) — the plural of relay_prompt.
// It carries up to MAX_RELAY_BATCH {sourceId, targetId, prompt} items in ONE call so the host can
// surface them in ONE per-row human-confirm modal. Each item is still an INDEPENDENT host-gated
// dispatch (own cable check, own nonce, own audit); the batch shares only the confirm.
const TOOL = 'relay_prompts'

/** Records every relayPrompts batch, to prove wiring; returns all items relayed by default. */
class SpyOrchestrator extends MockOrchestrator {
  batches: RelayItem[][] = []
  override async relayPrompts(items: RelayItem[]): Promise<RelayResult[]> {
    this.batches.push(items)
    return items.map((it) => ({
      sourceId: it.sourceId,
      targetId: it.targetId,
      status: 'relayed' as const
    }))
  }
}

describe('relay_prompts tool (rc.8, batch agent-to-agent dispatch)', () => {
  it('worker tools/list OMITS relay_prompts (capability split)', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    await client.close()
  })

  it('orchestrator tools/list INCLUDES relay_prompts', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('forwards all items (source/target/text) to the adapter in ONE batch and returns an ack', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: {
        items: [
          { sourceId: 'A', targetId: 'B', prompt: 'run the build' },
          { sourceId: 'A', targetId: 'C', prompt: 'run the tests' }
        ]
      }
    })
    expect(orch.batches).toEqual([
      [
        { sourceId: 'A', targetId: 'B', text: 'run the build' },
        { sourceId: 'A', targetId: 'C', text: 'run the tests' }
      ]
    ])
    expect(res.isError).toBeFalsy()
    expect(JSON.stringify(res)).toMatch(/relayed 2\/2/)
    await client.close()
  })

  it('rejects the WHOLE batch (no relay) when ANY item has an empty id or prompt', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const badPrompt = await client.callTool({
      name: TOOL,
      arguments: {
        items: [
          { sourceId: 'A', targetId: 'B', prompt: 'ok' },
          { sourceId: 'A', targetId: 'C', prompt: '' }
        ]
      }
    })
    const badTarget = await client.callTool({
      name: TOOL,
      arguments: { items: [{ sourceId: 'A', targetId: '', prompt: 'x' }] }
    })
    expect(badPrompt.isError).toBe(true)
    expect(badTarget.isError).toBe(true)
    expect(orch.batches).toEqual([])
    await client.close()
  })

  it('🔒 rejects the batch (no relay) when any item prompt carries an embedded control char', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: {
        items: [
          { sourceId: 'A', targetId: 'B', prompt: 'fine' },
          { sourceId: 'A', targetId: 'C', prompt: 'line1\nline2' }
        ]
      }
    })
    expect(res.isError).toBe(true)
    expect(orch.batches).toEqual([])
    await client.close()
  })

  it('rejects an empty items array and a batch over the cap WITHOUT relaying', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const empty = await client.callTool({ name: TOOL, arguments: { items: [] } })
    const tooMany = await client.callTool({
      name: TOOL,
      arguments: {
        items: Array.from({ length: 11 }, (_, i) => ({
          sourceId: 'A',
          targetId: `B${i}`,
          prompt: 'x'
        }))
      }
    })
    expect(empty.isError).toBe(true)
    expect(tooMany.isError).toBe(true)
    expect(orch.batches).toEqual([])
    await client.close()
  })

  // 🔒 BUG-021 — caller-identity binding, same as relay_prompt but applied to the batch.
  it('🔒 with a command board set, the command orchestrator CAN relay the batch', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'app', 'app')
    const res = await client.callTool({
      name: TOOL,
      arguments: { items: [{ sourceId: 'A', targetId: 'B', prompt: 'go' }] }
    })
    expect(res.isError).toBeFalsy()
    expect(orch.batches).toEqual([[{ sourceId: 'A', targetId: 'B', text: 'go' }]])
    await client.close()
  })

  it('🔒 with a command board set, a DIFFERENT orchestrator token is rejected WITHOUT relaying', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch, 'rogue-board', 'app')
    const res = await client.callTool({
      name: TOOL,
      arguments: { items: [{ sourceId: 'A', targetId: 'B', prompt: 'exploit' }] }
    })
    expect(res.isError).toBe(true)
    expect(orch.batches).toEqual([])
    await client.close()
  })

  describe('connected tier — own-board source binding (per item)', () => {
    it('CAN relay when EVERY item sourceId === its own boardId', async () => {
      const orch = new SpyOrchestrator()
      const client = await connectInMemory('connected', orch, 'board-A')
      const res = await client.callTool({
        name: TOOL,
        arguments: {
          items: [
            { sourceId: 'board-A', targetId: 'board-B', prompt: 'one' },
            { sourceId: 'board-A', targetId: 'board-C', prompt: 'two' }
          ]
        }
      })
      expect(res.isError).toBeFalsy()
      expect(orch.batches).toEqual([
        [
          { sourceId: 'board-A', targetId: 'board-B', text: 'one' },
          { sourceId: 'board-A', targetId: 'board-C', text: 'two' }
        ]
      ])
      await client.close()
    })

    it('🔒 rejects the WHOLE batch when ANY item names a board it does not own', async () => {
      const orch = new SpyOrchestrator()
      const client = await connectInMemory('connected', orch, 'board-A')
      const res = await client.callTool({
        name: TOOL,
        arguments: {
          items: [
            { sourceId: 'board-A', targetId: 'board-B', prompt: 'ok' },
            { sourceId: 'board-X', targetId: 'board-C', prompt: 'spoof' }
          ]
        }
      })
      expect(res.isError).toBe(true)
      expect(orch.batches).toEqual([])
      await client.close()
    })
  })

  it('surfaces per-item denied/rejected + an unconfirmed-delivery WARNING in the ack', async () => {
    class MixedOrch extends SpyOrchestrator {
      override async relayPrompts(items: RelayItem[]): Promise<RelayResult[]> {
        this.batches.push(items)
        return [
          { sourceId: 'A', targetId: 'B', status: 'relayed', delivery: 'unconfirmed' },
          { sourceId: 'A', targetId: 'C', status: 'denied', detail: 'human declined' },
          { sourceId: 'A', targetId: 'D', status: 'rejected', detail: 'no cable A->D' }
        ]
      }
    }
    const orch = new MixedOrch()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: {
        items: [
          { sourceId: 'A', targetId: 'B', prompt: 'b' },
          { sourceId: 'A', targetId: 'C', prompt: 'c' },
          { sourceId: 'A', targetId: 'D', prompt: 'd' }
        ]
      }
    })
    expect(res.isError).toBeFalsy()
    const text = JSON.stringify(res)
    expect(text).toMatch(/relayed 1\/3/)
    expect(text).toMatch(/WARNING: delivery unconfirmed/)
    expect(text).toMatch(/denied/)
    expect(text).toMatch(/rejected/)
    await client.close()
  })
})
