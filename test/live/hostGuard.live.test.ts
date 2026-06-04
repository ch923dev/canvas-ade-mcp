import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { request } from 'node:http'
import { startTestServer, type TestServer } from '../helpers/httpServer'

// fetch() forbids overriding the `Host` header, so the host guard's live test
// uses a raw node:http request to forge it. Asserts the guard fires BEFORE auth:
// a spoofed Host is 403'd outright, while a loopback Host falls through to the
// bearer check (401, not 403) — proving the guard rejects only on bad Host.
function rawPost(
  url: string,
  host: string,
  body: string = JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 })
): Promise<number> {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', host }
      },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

describe('host guard (real HTTP)', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
  })

  afterAll(async () => {
    await ts.server.close()
  })

  it('spoofed Host -> 403', async () => {
    expect(await rawPost(ts.url, 'evil.example')).toBe(403)
  })

  it('suffix-attack Host -> 403', async () => {
    expect(await rawPost(ts.url, 'localhost.evil.example:80')).toBe(403)
  })

  it('loopback Host passes the host guard (falls through to 401, not 403)', async () => {
    const u = new URL(ts.url)
    const status = await rawPost(ts.url, `127.0.0.1:${u.port}`)
    expect(status).not.toBe(403)
    expect(status).toBe(401) // no bearer token → auth rejects, host guard did not
  })

  it('host guard runs BEFORE body parsing: spoofed Host + malformed JSON -> 403', async () => {
    // If express.json() parsed first, a malformed body would 400 before the guard.
    // The guard must reject the bad Host outright (no pre-auth body parsing).
    const status = await rawPost(ts.url, 'evil.example', '{ not: valid json')
    expect(status).toBe(403)
  })
})
