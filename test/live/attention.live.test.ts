import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import type { BoardSummary, Orchestrator } from '../../src/orchestrator/Orchestrator'
import type { BoardId } from '../../src/types'

class MixedOrchestrator implements Orchestrator {
  async listBoards(): Promise<BoardSummary[]> {
    return [
      { id: 't1', type: 'terminal', title: 'Run', status: 'running' },
      { id: 'b1', type: 'browser', title: 'Web', status: 'failed' },
      { id: 'p1', type: 'planning', title: 'Plan', status: 'static' }
    ]
  }
  async spawnBoard(): Promise<{ id: BoardId }> {
    return { id: 'x' }
  }
  async dispatchPrompt(): Promise<void> {}
  async gitDiff(): Promise<string> {
    return ''
  }
  async boardStatus(): Promise<string> {
    return 'idle'
  }
}

describe('canvas://attention over real HTTP', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer(new MixedOrchestrator())
    mintToken(ts.tokens, 'tok-orch', { tier: 'orchestrator', boardId: 'bO' })
  })

  afterAll(async () => {
    await ts.server.close()
  })

  it('lists only the boards needing a human', async () => {
    const client = new Client({ name: 'live-test', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(ts.url), {
      requestInit: { headers: { Authorization: 'Bearer tok-orch' } }
    })
    await client.connect(transport)
    const res = await client.readResource({ uri: 'canvas://attention' })
    const text = res.contents.map((c) => ('text' in c ? c.text : '')).join('')
    expect(JSON.parse(text)).toEqual([
      { id: 'b1', type: 'browser', title: 'Web', status: 'failed' }
    ])
    await client.close()
  })
})
