import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import type {
  BoardOutput,
  BoardResult,
  MemoryDoc,
  BoardSummary
} from '../../src/orchestrator/Orchestrator'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'

/** Serves a fixed structured result for 'b-done', empty shell otherwise. */
class ResultOrchestrator extends MockOrchestrator {
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
  async boardStatus(): Promise<string> {
    return 'idle'
  }
  async boardOutput(): Promise<BoardOutput> {
    return { text: '', total: 0, returned: 0, droppedOlder: false }
  }
  async boardResult(boardId: BoardId): Promise<BoardResult> {
    return boardId === 'b-done'
      ? { present: true, status: 'success', summary: 'done', refs: ['a.ts'] }
      : { present: false }
  }
  async projectMemory(): Promise<MemoryDoc> {
    return { present: false, text: '' }
  }
  async boardSummary(): Promise<MemoryDoc> {
    return { present: false, text: '' }
  }
}

function parse(res: { contents: ReadonlyArray<{ uri?: unknown; text?: unknown }> }): BoardResult {
  const text = res.contents.map((c) => ('text' in c ? c.text : '')).join('')
  return JSON.parse(text as string) as BoardResult
}

// The result resource read over real HTTP (transport + bearer auth + template routing).
describe('canvas://board/{id}/result over real HTTP', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer(new ResultOrchestrator())
    mintToken(ts.tokens, 'tok-orch', { tier: 'orchestrator', boardId: 'bO' })
    mintToken(ts.tokens, 'tok-worker', { tier: 'worker', boardId: 'bW' })
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

  it('routes the templated id and returns the structured result', async () => {
    const client = await connect('tok-orch')
    const out = parse(await client.readResource({ uri: 'canvas://board/b-done/result' }))
    expect(out).toEqual({ present: true, status: 'success', summary: 'done', refs: ['a.ts'] })
    await client.close()
  })

  it('returns the empty shell for a board with no recorded result', async () => {
    const client = await connect('tok-orch')
    const out = parse(await client.readResource({ uri: 'canvas://board/b-new/result' }))
    expect(out).toEqual({ present: false })
    await client.close()
  })

  it('is readable by the worker tier', async () => {
    const client = await connect('tok-worker')
    const out = parse(await client.readResource({ uri: 'canvas://board/b-done/result' }))
    expect(out.present).toBe(true)
    await client.close()
  })
})
