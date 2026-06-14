import { describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { installResourceSubscriptions } from '../../src/server/resourceSubscriptions'

async function wired(): Promise<{ client: Client; isSubscribed: (u: string) => boolean }> {
  const server = new McpServer({ name: 'subs-test', version: '0.0.0' })
  // a resource must exist so the SDK advertises the resources capability
  server.registerResource(
    'attention',
    'canvas://attention',
    { description: 'd', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, text: '[]' }] })
  )
  const { isSubscribed } = installResourceSubscriptions(server)
  const [ct, st] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'c', version: '0.0.0' })
  await server.connect(st)
  await client.connect(ct)
  return { client, isSubscribed }
}

describe('installResourceSubscriptions', () => {
  it('tracks subscribe then unsubscribe for a URI', async () => {
    const { client, isSubscribed } = await wired()
    expect(isSubscribed('canvas://attention')).toBe(false)
    await client.subscribeResource({ uri: 'canvas://attention' })
    expect(isSubscribed('canvas://attention')).toBe(true)
    await client.unsubscribeResource({ uri: 'canvas://attention' })
    expect(isSubscribed('canvas://attention')).toBe(false)
    await client.close()
  })

  it('rejects a subscribe to a non-allowlisted URI (bounds the per-session set)', async () => {
    const { client, isSubscribed } = await wired()
    // canvas://attention is the only pushed URI; anything else must be refused, not tracked.
    await expect(client.subscribeResource({ uri: 'canvas://boards' })).rejects.toThrow()
    expect(isSubscribed('canvas://boards')).toBe(false)
    await client.close()
  })
})
