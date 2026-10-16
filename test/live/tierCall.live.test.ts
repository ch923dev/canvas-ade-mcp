import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, ProtocolError, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import { TOOL_ORCHESTRATOR_PING } from '../../src/constants'

// Per ADR 0002 (D1): tier separation is enforced by REGISTRATION. A worker's server never
// registers orchestrator_ping, so the call never reaches a handler. This proves the gate holds at
// tools/call, not just tools/list.
//
// The WIRE SHAPE of that refusal is pinned exactly because the host's e2e asserts on it. Under SDK
// v2 an unregistered tool is NOT an `isError` tool result (v1's shape) but a JSON-RPC ERROR:
// McpServer's tools/call handler throws `ProtocolError(InvalidParams, "Tool <name> not found")`
// BEFORE its result-producing try/catch (node_modules/@modelcontextprotocol/server/dist/
// mcp-*.mjs `setToolRequestHandlers`), and Protocol serializes a throw as
// `{ error: { code, message } }`. The code is -32602 InvalidParams — NOT -32601 MethodNotFound
// (`tools/call` itself exists; only the named tool does not). The package's tool error boundary
// cannot see this path: no handler runs, so there is no structuredContent either.
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

  it('a worker calling orchestrator_ping is rejected with a JSON-RPC -32602 error', async () => {
    const client = await connect('tok-worker')
    const err = await client.callTool({ name: TOOL_ORCHESTRATOR_PING }).then(
      () => undefined,
      (e: unknown) => e
    )
    // The v2 client REJECTS (no result object at all) with the server's code + message verbatim.
    expect(err).toBeInstanceOf(ProtocolError)
    expect((err as ProtocolError).code).toBe(-32602)
    expect((err as ProtocolError).message).toBe(`Tool ${TOOL_ORCHESTRATOR_PING} not found`)
    await client.close()
  })

  it('the raw wire frame is { error: { code: -32602, message: "Tool … not found" } }', async () => {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      Authorization: 'Bearer tok-worker'
    }
    const init = await fetch(ts.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'raw-tier-probe', version: '0.0.0' }
        }
      })
    })
    expect(init.status).toBe(200)
    const sid = init.headers.get('mcp-session-id') as string
    await init.text()
    const res = await fetch(ts.url, {
      method: 'POST',
      headers: { ...headers, 'mcp-session-id': sid, 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: TOOL_ORCHESTRATOR_PING, arguments: {} }
      })
    })
    expect(res.status).toBe(200) // the HTTP exchange succeeds; the refusal is in the JSON-RPC body
    const body = await res.text()
    // SSE (default) or plain JSON — take the JSON-RPC frame either way.
    const frame = body.includes('data:')
      ? (body
          .split('\n')
          .find((l) => l.startsWith('data:'))
          ?.slice(5)
          .trim() ?? '')
      : body
    expect(JSON.parse(frame)).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32602, message: `Tool ${TOOL_ORCHESTRATOR_PING} not found` }
    })
  })

  it('an orchestrator calling orchestrator_ping succeeds', async () => {
    const client = await connect('tok-orch')
    const res = await client.callTool({ name: TOOL_ORCHESTRATOR_PING })
    expect(JSON.stringify(res)).toContain('orchestrator-pong')
    await client.close()
  })
})
