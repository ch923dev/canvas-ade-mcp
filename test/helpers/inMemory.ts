import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { Orchestrator } from '../../src/orchestrator/Orchestrator'
import { ServerFactory } from '../../src/server/factory'
import type { Tier } from '../../src/types'

/**
 * Wire an SDK Client to a factory-built server of the given `tier` over an
 * in-memory transport pair. Fast, Electron-free, HTTP-free — the contract layer.
 * (It does NOT exercise bearer auth / Origin / session routing — those are
 * covered in test/live.) Pass a custom `orchestrator` to exercise resource/tool
 * wiring against known board state (defaults to the no-op mock).
 */
export async function connectInMemory(
  tier: Tier,
  orchestrator: Orchestrator = new MockOrchestrator(),
  boardId = 'test-board',
  commandBoardId?: string,
  planningWrite: boolean | (() => boolean) = false
): Promise<Client> {
  const factory = new ServerFactory(orchestrator, commandBoardId, planningWrite)
  const { server } = factory.getServer({ tier, scopes: [], boardId })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'contract-test', version: '0.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}
