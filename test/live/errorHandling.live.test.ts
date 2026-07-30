import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'

// Audit Phase A: an error thrown PAST the /mcp routes (malformed JSON from an
// AUTHENTICATED client, an oversized body) must answer in the JSON-RPC error shape —
// never Express's default finalhandler page, which embeds `err.stack` whenever
// NODE_ENV isn't 'production' (vitest runs with NODE_ENV=test, so without the
// middleware these responses WOULD leak the stack).
describe('final error middleware (real HTTP)', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
    mintToken(ts.tokens, 'tok-w', { tier: 'worker', boardId: 'b1' })
  })

  afterAll(async () => {
    await ts.server.close()
  })

  it('malformed JSON from an authenticated client → 400 JSON-RPC parse error, no stack', async () => {
    const res = await fetch(ts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer tok-w'
      },
      body: '{"jsonrpc": "2.0", "id": 1, "method": '
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toContain('application/json')
    const text = await res.text()
    expect(text).not.toContain('at ') // no stack frames
    expect(text).not.toContain('<html')
    expect(JSON.parse(text)).toEqual({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error: invalid JSON body' },
      id: null
    })
  })

  it('a body over the 1mb cap → 413 JSON-RPC error, no stack', async () => {
    const big = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { pad: 'x'.repeat(1_100_000) }
    })
    const res = await fetch(ts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer tok-w'
      },
      body: big
    })
    expect(res.status).toBe(413)
    const text = await res.text()
    expect(text).not.toContain('<html')
    expect(JSON.parse(text)).toEqual({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Request body too large' },
      id: null
    })
  })
})
