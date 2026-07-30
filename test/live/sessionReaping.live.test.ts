import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'

/**
 * Audit Phase A: (1) the host can revoke a board's LIVE sessions via
 * `closeSessionsForBoard` (TokenStore.revoke alone only 401s future requests), and
 * (2) the idle sweep reaps a session whose client vanished without DELETE. Both
 * verified over real HTTP. The handshake is raw fetch (not the SDK client) so no
 * standing GET-SSE stream marks the session live and blocks the sweep.
 */

/** Raw initialize → session id from the response header (body drained/cancelled). */
async function rawInitialize(url: string, token: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'reap-test', version: '0.0.0' }
      }
    })
  })
  expect(res.status).toBe(200)
  const sid = res.headers.get('mcp-session-id')
  expect(sid).toBeTruthy()
  await res.body?.cancel()
  return sid as string
}

/** POST tools/list on an existing session; returns the HTTP status. */
async function reuseStatus(url: string, token: string, sid: string): Promise<number> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'mcp-session-id': sid
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  })
  await res.body?.cancel()
  return res.status
}

describe('closeSessionsForBoard (host-driven revocation, real HTTP)', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
    mintToken(ts.tokens, 'tok-b1', { tier: 'worker', boardId: 'b1' })
    mintToken(ts.tokens, 'tok-b2', { tier: 'worker', boardId: 'b2' })
  })

  afterAll(async () => {
    await ts.server.close()
  })

  it("closes the target board's live session (404 on reuse) and leaves siblings alone", async () => {
    const sid1 = await rawInitialize(ts.url, 'tok-b1')
    const sid2 = await rawInitialize(ts.url, 'tok-b2')
    expect(await reuseStatus(ts.url, 'tok-b1', sid1)).toBe(200)

    await expect(ts.server.closeSessionsForBoard('b1')).resolves.toBe(1)

    expect(await reuseStatus(ts.url, 'tok-b1', sid1)).toBe(404) // revoked live session
    expect(await reuseStatus(ts.url, 'tok-b2', sid2)).toBe(200) // sibling untouched
  })

  it('an empty boardId closes nothing', async () => {
    await expect(ts.server.closeSessionsForBoard('')).resolves.toBe(0)
  })
})

describe('idle-session sweep (CANVAS_ADE_SESSION_IDLE_TTL_MS, real HTTP)', () => {
  const KEY = 'CANVAS_ADE_SESSION_IDLE_TTL_MS'
  const original = process.env[KEY]
  let ts: TestServer

  beforeAll(async () => {
    process.env[KEY] = '120' // tiny TTL; the sweep ticks at min(TTL, 60s)
    ts = await startTestServer()
    mintToken(ts.tokens, 'tok-w', { tier: 'worker', boardId: 'bW' })
  })

  afterAll(async () => {
    if (original === undefined) delete process.env[KEY]
    else process.env[KEY] = original
    await ts.server.close()
  })

  it('reaps a session with no activity and no open stream; the client 404s and re-initializes', async () => {
    const sid = await rawInitialize(ts.url, 'tok-w')
    expect(await reuseStatus(ts.url, 'tok-w', sid)).toBe(200)

    // Go quiet past the TTL — no requests, no SSE stream.
    await new Promise((r) => setTimeout(r, 500))

    expect(await reuseStatus(ts.url, 'tok-w', sid)).toBe(404) // reaped
    // Recovery is the spec path: re-initialize gets a fresh session.
    const fresh = await rawInitialize(ts.url, 'tok-w')
    expect(await reuseStatus(ts.url, 'tok-w', fresh)).toBe(200)
  })
})
