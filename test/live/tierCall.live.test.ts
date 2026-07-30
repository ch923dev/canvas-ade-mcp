import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import { TOOL_ORCHESTRATOR_PING } from '../../src/constants'

// Per ADR 0002 (D1): tier separation is enforced by REGISTRATION. A worker's
// server never registers orchestrator_ping, so the SDK answers tools/call with
// method-not-found. This proves the gate holds at tools/call, not just tools/list.
describe('tier enforcement at tools/call (real HTTP)', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
    mintToken(ts.tokens, 'tok-worker', { tier: 'worker', boardId: 'bW' })
    mintToken(ts.tokens, 'tok-orch', { tier: 'orchestrator', boardId: 'bO' })
  })

  afterAll(async () => {
    await ts.server.close()
  })

  async function connect(token: string): Promise<Client> {
    const client = new Client({ name: 'live-test', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(ts.url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
    await client.connect(transport)
    return client
  }

  it('a worker calling orchestrator_ping is rejected', async () => {
    const client = await connect('tok-worker')
    // SDK v1 answered an unregistered tool with an isError RESULT; SDK v2 answers
    // method-not-found at the protocol layer, so the call REJECTS. Either way the
    // worker cannot invoke it — the tier gate still holds at tools/call.
    await expect(client.callTool({ name: TOOL_ORCHESTRATOR_PING })).rejects.toThrow(/not found/)
    await client.close()
  })

  it('an orchestrator calling orchestrator_ping succeeds', async () => {
    const client = await connect('tok-orch')
    const res = await client.callTool({ name: TOOL_ORCHESTRATOR_PING })
    expect(JSON.stringify(res)).toContain('orchestrator-pong')
    await client.close()
  })
})
