import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import { TOOL_PING } from '../../src/constants'

// NOTE: Phase 0 live tests spin a REAL in-process HTTP server on an ephemeral
// 127.0.0.1 port. They do NOT boot the Electron app — Canvas ADE does not host
// the MCP server yet (that wiring lands in a later phase). The live layer covers
// what the in-memory contract layer cannot: bearer auth, Origin, session routing.

describe('handshake + security (real HTTP)', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
    mintToken(ts.tokens, 'tok-orch', { tier: 'orchestrator', boardId: 'b1' })
  })

  afterAll(async () => {
    await ts.server.close()
  })

  it('a valid bearer token initializes and lists ping', async () => {
    const client = new Client({ name: 'live-test', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(ts.url), {
      requestInit: { headers: { Authorization: 'Bearer tok-orch' } }
    })
    await client.connect(transport)
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL_PING)
    await client.close()
  })

  it('bad Origin -> 403', async () => {
    const res = await fetch(ts.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'http://evil.example' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 })
    })
    expect(res.status).toBe(403)
  })

  it('missing bearer token -> 401', async () => {
    const res = await fetch(ts.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 })
    })
    expect(res.status).toBe(401)
  })

  it('unknown session id -> 404', async () => {
    const res = await fetch(ts.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer tok-orch',
        'mcp-session-id': 'does-not-exist'
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 })
    })
    expect(res.status).toBe(404)
  })

  it('no session id + non-initialize -> 400', async () => {
    const res = await fetch(ts.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer tok-orch' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 3 })
    })
    expect(res.status).toBe(400)
  })
})
