import { afterEach, describe, expect, it } from 'vitest'
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import { EmittingOrchestrator } from '../helpers/emittingOrchestrator'

let ts: TestServer | undefined
afterEach(async () => {
  await ts?.server.close()
  ts = undefined
})

describe('canvas://attention push over real SSE', () => {
  it('delivers resources/updated to a subscribed client on a membership delta', async () => {
    const orch = new EmittingOrchestrator()
    ts = await startTestServer(orch)
    mintToken(ts.tokens, 'tok-orch', { tier: 'orchestrator', boardId: 'bO' })

    const client = new Client({ name: 'live', version: '0.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(ts.url), {
        requestInit: { headers: { Authorization: 'Bearer tok-orch' } }
      })
    )

    const got = new Promise<string>((resolve) => {
      client.setNotificationHandler('notifications/resources/updated', (n) => resolve(n.params.uri))
    })
    await client.subscribeResource({ uri: 'canvas://attention' })

    orch.emit({ id: 't1', status: 'blocked' })
    expect(await got).toBe('canvas://attention')
    await client.close()
  })
})
