import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// ⚠️ Deliberately the V1 SDK (devDependency), NOT @modelcontextprotocol/client.
// This lane exists to prove the v2-based server still serves TODAY'S clients —
// the stateful 2025-06-18 streamable-HTTP line Claude Code speaks (initialize
// handshake + Mcp-Session-Id header). Phase B's spike showed the v1-to-v2
// codemod rewrites these imports to the v2 client, silently gutting the lane —
// if a future codemod run touches this file, restore the v1 imports.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import { TOOL_PING } from '../../src/constants'

describe('v1-client back-compat (spec 2025-06-18 stateful line, real HTTP)', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
    mintToken(ts.tokens, 'tok-v1', { tier: 'worker', boardId: 'bV1' })
  })

  afterAll(async () => {
    await ts.server.close()
  })

  function v1Transport(): StreamableHTTPClientTransport {
    return new StreamableHTTPClientTransport(new URL(ts.url), {
      requestInit: { headers: { Authorization: 'Bearer tok-v1' } }
    })
  }

  it('v1 client completes the initialize handshake and gets a session id', async () => {
    const client = new Client({ name: 'v1-compat', version: '1.29.0' })
    const transport = v1Transport()
    await client.connect(transport)
    expect(transport.sessionId).toBeDefined()
    // The session must be REUSED across calls (stateful routing, not per-request).
    const sid = transport.sessionId
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL_PING)
    const res = await client.callTool({ name: TOOL_PING })
    expect(JSON.stringify(res)).toContain('pong')
    expect(transport.sessionId).toBe(sid)
    await client.close()
  })

  it('a raw 2025-06-18 initialize is answered with 2025-06-18 verbatim', async () => {
    const res = await fetch(ts.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        Authorization: 'Bearer tok-v1'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'raw-2025-06-18', version: '0.0.0' }
        }
      })
    })
    expect(res.status).toBe(200)
    const sid = res.headers.get('mcp-session-id')
    expect(sid).toBeTruthy()
    expect(await res.text()).toContain('"protocolVersion":"2025-06-18"')

    // Standalone GET-SSE (the attention-notifier channel) opens on the legacy line.
    const sse = await fetch(ts.url, {
      headers: {
        accept: 'text/event-stream',
        Authorization: 'Bearer tok-v1',
        'mcp-session-id': sid as string,
        'mcp-protocol-version': '2025-06-18'
      }
    })
    expect(sse.status).toBe(200)
    expect(sse.headers.get('content-type') ?? '').toContain('text/event-stream')
    await sse.body?.cancel()

    // DELETE tears the session down; reuse must 404 per the streamable-HTTP spec.
    const del = await fetch(ts.url, {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer tok-v1',
        'mcp-session-id': sid as string,
        'mcp-protocol-version': '2025-06-18'
      }
    })
    expect([200, 204]).toContain(del.status)
    const after = await fetch(ts.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        Authorization: 'Bearer tok-v1',
        'mcp-session-id': sid as string
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 9 })
    })
    expect(after.status).toBe(404)
  })

  it('v1 client DELETE teardown 404s the session for reuse', async () => {
    const client = new Client({ name: 'v1-compat', version: '1.29.0' })
    const transport = v1Transport()
    await client.connect(transport)
    const sid = transport.sessionId as string
    await transport.terminateSession()
    const after = await fetch(ts.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        Authorization: 'Bearer tok-v1',
        'mcp-session-id': sid
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 9 })
    })
    expect(after.status).toBe(404)
    await client.close()
  })
})
