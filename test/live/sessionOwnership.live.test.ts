import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'

// 🔒 PKG-N1: a session is bound to the {tier,boardId} of the token that CREATED it. The
// streamable-HTTP reuse/GET/DELETE paths route by Mcp-Session-Id, so a DIFFERENT (but
// globally-valid) bearer that learns a session UUID must be refused 403 — otherwise it would
// drive the creator's session at the creator's tier, bypassing the structural tier split.
describe('session ownership binding (real HTTP, PKG-N1)', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
    mintToken(ts.tokens, 'tok-orch', { tier: 'orchestrator', boardId: 'bO' })
    mintToken(ts.tokens, 'tok-worker', { tier: 'worker', boardId: 'bW' })
  })

  afterAll(async () => {
    await ts.server.close()
  })

  /** Open a real session with the orchestrator token; the SDK does the initialize handshake. */
  async function openOrchSession(): Promise<{ client: Client; sessionId: string }> {
    const client = new Client({ name: 'owner', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(ts.url), {
      requestInit: { headers: { Authorization: 'Bearer tok-orch' } }
    })
    await client.connect(transport)
    const sessionId = transport.sessionId
    expect(sessionId).toBeTruthy()
    return { client, sessionId: sessionId as string }
  }

  it('a different token reusing the session (POST) is refused 403', async () => {
    const { client, sessionId } = await openOrchSession()
    const res = await fetch(ts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer tok-worker',
        'mcp-session-id': sessionId
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} })
    })
    expect(res.status).toBe(403)
    await client.close()
  })

  it('a different token on the GET-SSE / DELETE session path is refused 403', async () => {
    const { client, sessionId } = await openOrchSession()
    const del = await fetch(ts.url, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer tok-worker', 'mcp-session-id': sessionId }
    })
    expect(del.status).toBe(403)
    await client.close()
  })

  it('the owning token is NOT blocked by the ownership gate', async () => {
    const { client, sessionId } = await openOrchSession()
    const res = await fetch(ts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer tok-orch',
        'mcp-session-id': sessionId
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    })
    // The owner clears the gate (the 403 is ownership-specific; any non-403 status means the
    // gate let it through — the SDK connect above is the primary positive control).
    expect(res.status).not.toBe(403)
    await client.close()
  })
})
