import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import {
  TOOL_ASSIGN_PROMPT,
  TOOL_HANDOFF_PROMPT,
  TOOL_ORCHESTRATOR_PING,
  TOOL_RELAY_PROMPT,
  TOOL_SPAWN_BOARD,
  TOOL_SPAWN_GROUP,
  TOOL_WAIT_FOR_ALL,
  TOOL_WRITE_RESULT
} from '../../src/constants'

/**
 * Lead tier over REAL HTTP (orchestration Phase 1) — pins the 0.22.0 regression: the in-memory
 * contract layer builds SessionCtx directly, but the HTTP boundary re-derives it in `ctxFromAuth`
 * whose closed tier vocabulary originally omitted `lead`, silently collapsing a lead bearer to a
 * worker session (ping + write_result only). Only an HTTP-layer test can catch that class.
 */
describe('lead tier at the HTTP boundary (ctxFromAuth vocabulary)', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
    mintToken(ts.tokens, 'tok-lead', { tier: 'lead', boardId: 'lead-board' })
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

  it('a lead bearer reaches a LEAD session (orchestration core registered, not the worker fallback)', async () => {
    const client = await connect('tok-lead')
    const names = (await client.listTools()).tools.map((t) => t.name)
    for (const included of [
      TOOL_SPAWN_BOARD,
      TOOL_SPAWN_GROUP,
      TOOL_RELAY_PROMPT,
      TOOL_ASSIGN_PROMPT,
      TOOL_WAIT_FOR_ALL,
      TOOL_WRITE_RESULT
    ]) {
      expect(names, `expected ${included} registered over HTTP at lead`).toContain(included)
    }
    for (const omitted of [TOOL_ORCHESTRATOR_PING, TOOL_HANDOFF_PROMPT]) {
      expect(names, `expected ${omitted} absent over HTTP at lead`).not.toContain(omitted)
    }
    await client.close()
  })

  it('own-board relay binding holds over HTTP (spoofed source rejected)', async () => {
    const client = await connect('tok-lead')
    const res = await client.callTool({
      name: TOOL_RELAY_PROMPT,
      arguments: { sourceId: 'someone-else', targetId: 'worker-1', prompt: 'spoof' }
    })
    expect(res.isError).toBe(true)
    expect(JSON.stringify(res)).toContain('may only relay from its own board')
    await client.close()
  })
})
