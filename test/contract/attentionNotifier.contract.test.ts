import { describe, expect, it } from 'vitest'
import { createAttentionNotifier } from '../../src/server/attentionNotifier'
import { EmittingOrchestrator } from '../helpers/emittingOrchestrator'
import type { McpServer } from "@modelcontextprotocol/server";
import type { BoardStatusChange, Orchestrator } from '../../src/orchestrator/Orchestrator'

/** Minimal fake exposing only what the notifier touches: `server.server.sendResourceUpdated`. */
function fakeServer(): { server: McpServer; updates: string[] } {
  const updates: string[] = []
  const server = {
    server: { sendResourceUpdated: (p: { uri: string }) => updates.push(p.uri) }
  } as unknown as McpServer
  return { server, updates }
}

describe('createAttentionNotifier', () => {
  it('emits once when a board ENTERS the attention set and once when it LEAVES', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })

    orch.emit({ id: 't1', status: 'running' }) // not attention → no emit
    orch.emit({ id: 't1', status: 'blocked' }) // enters → emit
    orch.emit({ id: 't1', status: 'idle' }) // leaves → emit
    expect(updates).toEqual(['canvas://attention', 'canvas://attention'])
  })

  it('does NOT emit while staying inside the attention set (blocked→failed)', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })
    orch.emit({ id: 't1', status: 'blocked' }) // enters → emit
    orch.emit({ id: 't1', status: 'failed' }) // still attention → no emit
    expect(updates).toEqual(['canvas://attention'])
  })

  it('does NOT emit for a non-attention change (running→idle)', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })
    orch.emit({ id: 't1', status: 'running' })
    orch.emit({ id: 't1', status: 'idle' })
    expect(updates).toEqual([])
  })

  it('does NOT emit when a monitorActivity:false board enters an attention bucket', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })
    orch.emit({ id: 'shell', status: 'blocked', monitorActivity: false }) // opted out → no emit
    expect(updates).toEqual([])
  })

  it('pushes a LEAVE when monitorActivity flips false on an in-attention board', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })
    orch.emit({ id: 't1', status: 'blocked' }) // monitored, enters → emit
    orch.emit({ id: 't1', status: 'blocked', monitorActivity: false }) // opts out → leaves → emit
    expect(updates).toEqual(['canvas://attention', 'canvas://attention'])
  })

  it('pushes an ENTER when monitorActivity flips true on an attention-bucket board', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })
    orch.emit({ id: 't1', status: 'blocked', monitorActivity: false }) // opted out → no emit
    orch.emit({ id: 't1', status: 'blocked', monitorActivity: true }) // opts in → enters → emit
    expect(updates).toEqual(['canvas://attention'])
  })

  it('does NOT emit when no client is subscribed', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => false })
    orch.emit({ id: 't1', status: 'blocked' })
    expect(updates).toEqual([])
  })

  it('emits when an attention board leaves via `gone`', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })
    orch.emit({ id: 't1', status: 'blocked' }) // enters → emit
    orch.emit({ id: 't1', status: 'gone' }) // leaves → emit
    expect(updates).toEqual(['canvas://attention', 'canvas://attention'])
  })

  it('dispose() stops further emits', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    const n = createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })
    n.dispose()
    orch.emit({ id: 't1', status: 'blocked' })
    expect(updates).toEqual([])
  })

  it('swallows a throwing sendResourceUpdated (the notifier is the ONLY guard)', () => {
    // Raw stub whose fan-out does NOT try/catch — so ONLY the notifier's own catch can
    // stop the throw. (EmittingOrchestrator.__emitStatus swallows, which would mask this.)
    let listener: ((c: BoardStatusChange) => void) | undefined
    const rawOrch = {
      subscribeStatus: (cb: (c: BoardStatusChange) => void) => {
        listener = cb
        return () => {
          listener = undefined
        }
      }
    } as unknown as Orchestrator
    const server = {
      server: {
        sendResourceUpdated: () => {
          throw new Error('Not connected')
        }
      }
    } as unknown as McpServer
    createAttentionNotifier({ server, orchestrator: rawOrch, isSubscribed: () => true })
    expect(listener).toBeDefined()
    expect(() => listener?.({ id: 't1', status: 'blocked' })).not.toThrow()
  })

  it('level-trigger seed: a board ALREADY in attention before the session emits its later LEAVE', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 'pre', type: 'terminal', title: 'Pre', status: 'blocked' }] // pre-session
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })
    await new Promise((r) => setTimeout(r, 0)) // let the async seed land
    orch.emit({ id: 'pre', status: 'idle' }) // leaves → MUST emit (was swallowed pre-Phase-A)
    expect(updates).toEqual(['canvas://attention'])
  })

  it('level-trigger seed skips monitorActivity:false boards (selectAttention parity)', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [
      { id: 'shell', type: 'terminal', title: 'S', status: 'blocked', monitorActivity: false }
    ]
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })
    await new Promise((r) => setTimeout(r, 0))
    // Not seeded → a later non-attention change compares equal and emits nothing.
    orch.emit({ id: 'shell', status: 'idle' })
    expect(updates).toEqual([])
  })

  it('tracks membership per board id (independent enter/leave)', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })
    orch.emit({ id: 't1', status: 'blocked' }) // t1 enters → emit
    orch.emit({ id: 't2', status: 'blocked' }) // t2 enters → emit
    orch.emit({ id: 't1', status: 'idle' }) // t1 leaves → emit
    expect(updates).toEqual(['canvas://attention', 'canvas://attention', 'canvas://attention'])
  })
})
