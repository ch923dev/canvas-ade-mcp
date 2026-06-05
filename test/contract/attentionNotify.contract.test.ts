import { describe, expect, it } from 'vitest'
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { connectInMemory } from '../helpers/inMemory'
import { EmittingOrchestrator } from '../helpers/emittingOrchestrator'

/** Collect resources/updated URIs the client receives. */
function collectUpdates(client: Awaited<ReturnType<typeof connectInMemory>>): string[] {
  const got: string[] = []
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
    got.push(n.params.uri)
  })
  return got
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

describe('canvas://attention notifications (wired)', () => {
  it('a subscribed client is notified on an attention membership delta', async () => {
    const orch = new EmittingOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const updates = collectUpdates(client)
    await client.subscribeResource({ uri: 'canvas://attention' })

    orch.emit({ id: 't1', status: 'blocked' }) // enters attention
    await tick()
    expect(updates).toEqual(['canvas://attention'])
    await client.close()
  })

  it('does NOT notify a client that never subscribed', async () => {
    const orch = new EmittingOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const updates = collectUpdates(client)

    orch.emit({ id: 't1', status: 'blocked' })
    await tick()
    expect(updates).toEqual([])
    await client.close()
  })

  it('does NOT notify on a non-attention change', async () => {
    const orch = new EmittingOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const updates = collectUpdates(client)
    await client.subscribeResource({ uri: 'canvas://attention' })

    orch.emit({ id: 't1', status: 'running' })
    orch.emit({ id: 't1', status: 'idle' })
    await tick()
    expect(updates).toEqual([])
    await client.close()
  })
})
