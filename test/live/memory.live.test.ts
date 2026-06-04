import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import type {
  BoardOutput,
  BoardResult,
  BoardSummary,
  MemoryDoc
} from '../../src/orchestrator/Orchestrator'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'

/** Serves a project memory doc + a per-board summary for 'b-1'; empty otherwise. */
class MemoryOrchestrator extends MockOrchestrator {
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
  async boardResult(): Promise<BoardResult> {
    return { present: false }
  }
  async projectMemory(): Promise<MemoryDoc> {
    return { present: true, text: '# Project memory' }
  }
  async boardSummary(boardId: BoardId): Promise<MemoryDoc> {
    return boardId === 'b-1'
      ? { present: true, text: 'board 1 summary' }
      : { present: false, text: '' }
  }
}

function parse(res: { contents: ReadonlyArray<{ uri?: unknown; text?: unknown }> }): MemoryDoc {
  const text = res.contents.map((c) => ('text' in c ? c.text : '')).join('')
  return JSON.parse(text as string) as MemoryDoc
}

describe('canvas://memory + canvas://board/{id}/summary over real HTTP', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer(new MemoryOrchestrator())
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

  it('serves the project memory index and a per-board summary', async () => {
    const client = await connect('tok-orch')
    expect(parse(await client.readResource({ uri: 'canvas://memory' }))).toEqual({
      present: true,
      text: '# Project memory'
    })
    expect(parse(await client.readResource({ uri: 'canvas://board/b-1/summary' }))).toEqual({
      present: true,
      text: 'board 1 summary'
    })
    await client.close()
  })

  it('gracefully empties a board with no summary', async () => {
    const client = await connect('tok-orch')
    expect(parse(await client.readResource({ uri: 'canvas://board/ghost/summary' }))).toEqual({
      present: false,
      text: ''
    })
    await client.close()
  })

  it('is readable by the worker tier (passive context)', async () => {
    const client = await connect('tok-worker')
    expect(parse(await client.readResource({ uri: 'canvas://memory' })).present).toBe(true)
    await client.close()
  })
})
