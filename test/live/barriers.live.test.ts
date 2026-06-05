import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import { EmittingOrchestrator } from '../helpers/emittingOrchestrator'
import { TOOL_WAIT_FOR_IDLE } from '../../src/constants'

let ts: TestServer | undefined
afterEach(async () => {
  await ts?.server.close()
  ts = undefined
})

async function orchClient(server: TestServer): Promise<Client> {
  mintToken(server.tokens, 'tok-orch', { tier: 'orchestrator', boardId: 'bO' })
  const client = new Client({ name: 'live', version: '0.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { Authorization: 'Bearer tok-orch' } }
    })
  )
  return client
}

describe('wait_for_idle over real HTTP', () => {
  it('resolves exactly when the board goes idle (event-timed, before the backstop)', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    ts = await startTestServer(orch)
    const client = await orchClient(ts)

    const started = Date.now()
    const call = client.callTool({
      name: TOOL_WAIT_FOR_IDLE,
      arguments: { boardId: 't1', timeoutMs: 5000 }
    })
    setTimeout(() => orch.emit({ id: 't1', status: 'idle' }), 50)
    const res = await call
    const text = (res.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')

    expect(JSON.parse(text)).toEqual({ id: 't1', status: 'idle' })
    expect(Date.now() - started).toBeLessThan(2000) // resolved on the event, not the 5s backstop
    await client.close()
  })
})
