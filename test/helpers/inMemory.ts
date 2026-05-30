import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import { ServerFactory } from '../../src/server/factory'
import type { Tier } from '../../src/types'

/**
 * Wire an SDK Client to a factory-built server of the given `tier` over an
 * in-memory transport pair. Fast, Electron-free, HTTP-free — the contract layer.
 * (It does NOT exercise bearer auth / Origin / session routing — those are
 * covered in test/live.)
 */
export async function connectInMemory(tier: Tier): Promise<Client> {
  const factory = new ServerFactory(new MockOrchestrator())
  const server = factory.getServer({ tier, scopes: [], boardId: 'test-board' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'contract-test', version: '0.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}
