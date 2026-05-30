import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
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
    // The unregistered tool yields an isError result ("Tool ... not found"), not
    // a thrown rejection — either way the worker cannot invoke it.
    const res = await client.callTool({ name: TOOL_ORCHESTRATOR_PING })
    expect(res.isError).toBe(true)
    expect(JSON.stringify(res)).toContain('not found')
    await client.close()
  })

  it('an orchestrator calling orchestrator_ping succeeds', async () => {
    const client = await connect('tok-orch')
    const res = await client.callTool({ name: TOOL_ORCHESTRATOR_PING })
    expect(JSON.stringify(res)).toContain('orchestrator-pong')
    await client.close()
  })
})
