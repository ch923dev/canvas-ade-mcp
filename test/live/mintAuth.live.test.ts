import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startTestServer, type TestServer } from '../helpers/httpServer'
import { mintBoardToken } from '../../src/auth/mint'
import { TOOL_ORCHESTRATOR_PING, TOOL_PING } from '../../src/constants'

// Regression lock: the production mint helper (mintBoardToken) must produce a
// token that PASSES requireBearerAuth over real HTTP. The earlier live tests only
// exercised the test-only `mintToken` helper (which sets an expiry), so a
// mintBoardToken token with no `expiresAt` slipped through — the SDK rejects it
// with "Token has no expiration time". This test mints the real way and connects.
describe('mintBoardToken tokens authenticate over real HTTP', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
  })

  afterAll(async () => {
    await ts.server.close()
  })

  it('an orchestrator token minted by mintBoardToken initializes + lists tools', async () => {
    const { token } = mintBoardToken(ts.tokens, { boardId: 'b-orch', tier: 'orchestrator' })
    const client = new Client({ name: 'mint-live', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(ts.url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
    await client.connect(transport)
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL_PING)
    expect(names).toContain(TOOL_ORCHESTRATOR_PING)
    await client.close()
  })

  it('a worker token minted by mintBoardToken initializes and omits the orchestrator tool', async () => {
    const { token } = mintBoardToken(ts.tokens, { boardId: 'b-worker', tier: 'worker' })
    const client = new Client({ name: 'mint-live', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(ts.url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
    await client.connect(transport)
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL_PING)
    expect(names).not.toContain(TOOL_ORCHESTRATOR_PING)
    await client.close()
  })
})
