import { describe, expect, it } from 'vitest'
import { ServerFactory } from '../../src/server/factory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardStatusChange } from '../../src/orchestrator/Orchestrator'

/** Counts live status subscriptions so we can prove dispose() unsubscribes. */
class CountingOrchestrator extends MockOrchestrator {
  live = 0
  override subscribeStatus(listener: (c: BoardStatusChange) => void): () => void {
    void listener
    this.live++
    return () => {
      this.live--
    }
  }
}

describe('ServerFactory.getServer dispose', () => {
  it('returns { server, dispose }; dispose() drops the notifier subscription', () => {
    const orch = new CountingOrchestrator()
    const factory = new ServerFactory(orch)
    const { server, dispose } = factory.getServer({
      tier: 'orchestrator',
      scopes: [],
      boardId: 'b'
    })
    expect(server).toBeDefined()
    expect(orch.live).toBe(1) // notifier subscribed
    dispose()
    expect(orch.live).toBe(0) // notifier unsubscribed
  })
})
