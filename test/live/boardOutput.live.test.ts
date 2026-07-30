import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import { MAX_OUTPUT_PAGE } from '../../src/constants'
import type {
  BoardOutput,
  BoardResult,
  MemoryDoc,
  BoardSummary
} from '../../src/orchestrator/Orchestrator'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'

/** Tail-anchored paging over a fixed buffer — the real app accessor's contract. */
class OutputOrchestrator extends MockOrchestrator {
  constructor(private readonly clean: string) {
    super()
  }
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
  async boardOutput(_boardId: BoardId, opts?: { cursor?: number }): Promise<BoardOutput> {
    const total = this.clean.length
    const cursor = opts?.cursor ?? 0
    const end = Math.max(0, total - cursor)
    const start = Math.max(0, end - MAX_OUTPUT_PAGE)
    const text = this.clean.slice(start, end)
    const moreOlder = start > 0
    return {
      text,
      total,
      returned: text.length,
      nextCursor: moreOlder ? cursor + text.length : undefined,
      droppedOlder: false
    }
  }
  async boardResult(): Promise<BoardResult> {
    return { present: false }
  }
  async projectMemory(): Promise<MemoryDoc> {
    return { present: false, text: '' }
  }
  async boardSummary(): Promise<MemoryDoc> {
    return { present: false, text: '' }
  }
}

function parse(res: { contents: ReadonlyArray<{ uri?: unknown; text?: unknown }> }): BoardOutput {
  const text = res.contents.map((c) => ('text' in c ? c.text : '')).join('')
  return JSON.parse(text as string) as BoardOutput
}

// The output resource read over real HTTP: transport + bearer auth + BOTH the tail
// template and the `?cursor` query template, plus the 25k page cap.
describe('canvas://board/{id}/output over real HTTP', () => {
  let ts: TestServer
  // 2.5 pages of distinct chars so paging order is unambiguous.
  const buf =
    'A'.repeat(MAX_OUTPUT_PAGE) + 'B'.repeat(MAX_OUTPUT_PAGE) + 'C'.repeat(MAX_OUTPUT_PAGE)

  beforeAll(async () => {
    ts = await startTestServer(new OutputOrchestrator(buf))
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

  it('caps the tail page and pages older content via ?cursor, ordered', async () => {
    const client = await connect('tok-orch')

    // Page 1 (no cursor) = newest tail = the C's, capped at one page.
    const p1 = parse(await client.readResource({ uri: 'canvas://board/b1/output' }))
    expect(p1.total).toBe(buf.length)
    expect(p1.returned).toBe(MAX_OUTPUT_PAGE)
    expect(p1.text).toBe('C'.repeat(MAX_OUTPUT_PAGE))
    expect(p1.nextCursor).toBe(MAX_OUTPUT_PAGE)

    // Page 2 (?cursor from p1) = the B's.
    const p2 = parse(
      await client.readResource({ uri: `canvas://board/b1/output?cursor=${p1.nextCursor}` })
    )
    expect(p2.text).toBe('B'.repeat(MAX_OUTPUT_PAGE))
    expect(p2.nextCursor).toBe(MAX_OUTPUT_PAGE * 2)

    // Page 3 = the A's, reaches the front → no nextCursor.
    const p3 = parse(
      await client.readResource({ uri: `canvas://board/b1/output?cursor=${p2.nextCursor}` })
    )
    expect(p3.text).toBe('A'.repeat(MAX_OUTPUT_PAGE))
    expect(p3.nextCursor).toBeUndefined()

    // Reassembled oldest→newest reproduces the whole buffer.
    expect(p3.text + p2.text + p1.text).toBe(buf)
    await client.close()
  })

  it('is readable by the worker tier for its OWN board (read-scoped, audit Phase A)', async () => {
    const client = await connect('tok-worker')
    const p1 = parse(await client.readResource({ uri: 'canvas://board/bW/output' }))
    expect(p1.returned).toBe(MAX_OUTPUT_PAGE)
    await client.close()
  })

  it("🔒 refuses a worker's read of a SIBLING board's output over HTTP", async () => {
    const client = await connect('tok-worker')
    await expect(client.readResource({ uri: 'canvas://board/b1/output' })).rejects.toThrow(
      /forbidden/
    )
    await client.close()
  })
})
