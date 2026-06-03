import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import type { BoardSummary, Orchestrator } from '../../src/orchestrator/Orchestrator'
import type { BoardId } from '../../src/types'

/** An orchestrator whose board status varies by id — proves the template var routes. */
class StatusOrchestrator implements Orchestrator {
  async listBoards(): Promise<BoardSummary[]> {
    return []
  }
  async spawnBoard(): Promise<{ id: BoardId }> {
    return { id: 'x' }
  }
  async dispatchPrompt(): Promise<void> {}
  async gitDiff(): Promise<string> {
    return ''
  }
  async boardStatus(boardId: BoardId): Promise<string> {
    return boardId === 'b-live' ? 'running' : 'idle'
  }
}

// The status resource read over real HTTP (transport + bearer auth + template
// routing), not just the in-memory contract path.
describe('canvas://board/{id}/status over real HTTP', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer(new StatusOrchestrator())
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

  it('routes the templated id and returns the board status bucket', async () => {
    const client = await connect('tok-orch')
    const res = await client.readResource({ uri: 'canvas://board/b-live/status' })
    const text = res.contents.map((c) => ('text' in c ? c.text : '')).join('')
    expect(JSON.parse(text)).toEqual({ id: 'b-live', status: 'running' })
    await client.close()
  })
})
