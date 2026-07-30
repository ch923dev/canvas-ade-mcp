import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import { TOOL_ADD_CARD, TOOL_PUBLISH_FINDINGS } from '../../src/constants'

/**
 * `publish_findings` over REAL HTTP (orchestration P4).
 *
 * 🔒 WHY THIS EXISTS AS A LIVE TEST AND NOT ONLY A CONTRACT ONE. The contract layer builds
 * `SessionCtx` directly; the HTTP boundary RE-DERIVES it in `ctxFromAuth`, whose closed tier
 * vocabulary once omitted `lead` and silently collapsed a lead bearer into a worker session. Every
 * contract test passed while the real thing was broken. Any change that adds a tool to the lead
 * surface owes an HTTP-layer assertion, because that is the only layer where that class of bug is
 * visible — and P4 puts a durable-write tool on exactly that tier.
 */
describe('publish_findings at the HTTP boundary', () => {
  let ts: TestServer

  beforeAll(async () => {
    // Content writes ON — the tool lives behind the same gate as add_card.
    ts = await startTestServer(undefined, true)
    mintToken(ts.tokens, 'tok-lead', { tier: 'lead', boardId: 'lead-board' })
    mintToken(ts.tokens, 'tok-orch', { tier: 'orchestrator', boardId: 'app' })
    mintToken(ts.tokens, 'tok-worker', { tier: 'worker', boardId: 'worker-1' })
    mintToken(ts.tokens, 'tok-connected', { tier: 'connected', boardId: 'term-1' })
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

  async function names(token: string): Promise<string[]> {
    const client = await connect(token)
    const list = (await client.listTools()).tools.map((t) => t.name)
    await client.close()
    return list
  }

  it('🔒 a LEAD bearer really gets it over HTTP (not the worker fallback)', async () => {
    const list = await names('tok-lead')
    expect(list).toContain(TOOL_PUBLISH_FINDINGS)
    // Sanity that the session did not collapse to worker: add_card rides the same gate.
    expect(list).toContain(TOOL_ADD_CARD)
  })

  it('an ORCHESTRATOR bearer gets it over HTTP', async () => {
    expect(await names('tok-orch')).toContain(TOOL_PUBLISH_FINDINGS)
  })

  it('a WORKER bearer never sees it', async () => {
    expect(await names('tok-worker')).not.toContain(TOOL_PUBLISH_FINDINGS)
  })

  it('a CONNECTED bearer never sees it — publishing a run is an orchestrator act', async () => {
    expect(await names('tok-connected')).not.toContain(TOOL_PUBLISH_FINDINGS)
  })

  it('is callable over HTTP and returns the host summary', async () => {
    const client = await connect('tok-lead')
    const r = await client.callTool({
      name: TOOL_PUBLISH_FINDINGS,
      arguments: { boardId: 'kanban-1' }
    })
    expect(r.isError).toBeFalsy()
    expect(JSON.stringify(r.content)).toContain('nothing to publish')
    await client.close()
  })
})

describe('publish_findings is absent when the host has content writes OFF', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
    mintToken(ts.tokens, 'tok-lead', { tier: 'lead', boardId: 'lead-board' })
  })

  afterAll(async () => {
    await ts.server.close()
  })

  it('the gate holds at the HTTP boundary too', async () => {
    const client = new Client({ name: 'live-test', version: '0.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(ts.url), {
        requestInit: { headers: { Authorization: 'Bearer tok-lead' } }
      })
    )
    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain(TOOL_PUBLISH_FINDINGS)
    await client.close()
  })
})
