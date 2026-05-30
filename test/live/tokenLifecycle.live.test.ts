import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'

// requireBearerAuth runs before session/tool logic, so a raw initialize POST is
// enough to assert the status. (No Origin header -> CLI-client path, passes the
// origin guard; the bearer token is the authority.)
function initPost(url: string, token: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 })
  })
}

describe('token lifecycle rejections (real HTTP)', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
    // expired: expiresAt 10s in the past.
    mintToken(ts.tokens, 'tok-expired', {
      tier: 'worker',
      boardId: 'b1',
      expiresAt: Math.floor(Date.now() / 1000) - 10
    })
    // revoked: minted then dropped from the store.
    mintToken(ts.tokens, 'tok-revoked', { tier: 'worker', boardId: 'b1' })
    ts.tokens.revoke('tok-revoked')
  })

  afterAll(async () => {
    await ts.server.close()
  })

  it('an invalid (never-minted) token -> 401', async () => {
    const res = await initPost(ts.url, 'tok-never-existed')
    expect(res.status).toBe(401)
  })

  it('an expired token -> 401', async () => {
    const res = await initPost(ts.url, 'tok-expired')
    expect(res.status).toBe(401)
  })

  it('a revoked token -> 401', async () => {
    const res = await initPost(ts.url, 'tok-revoked')
    expect(res.status).toBe(401)
  })

  // Task 6: a bad token is rejected BEFORE session routing. With a session-id
  // header present, a missing/bad token must still 401 (auth middleware first),
  // never reach the handler that would 404 an unknown session.
  it('a bad token with a session-id header -> 401, not 404', async () => {
    const res = await fetch(ts.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer tok-never-existed',
        'mcp-session-id': 'whatever'
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
    })
    expect(res.status).toBe(401)
  })
})
