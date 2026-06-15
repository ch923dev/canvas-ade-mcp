import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'

// git_diff is a READ tool (PR-2b) — orchestrator-tier only. It returns a terminal board's
// read-only working-tree diff so the orchestrator can roll up per-worker changes. Content-less
// input (just the target id); the host resolves the id to the board's own cwd and runs
// `git diff` read-only there, bounded to 100 KB. A worker must NOT read another board's diff.
const TOOL = 'git_diff'

const DIFF = 'diff --git a/x.ts b/x.ts\n@@ -1 +1 @@\n-old\n+new\n'

/** Records every gitDiff call and returns a canned diff, to prove the wiring + passthrough. */
class SpyOrchestrator extends MockOrchestrator {
  diffed: string[] = []
  override async gitDiff(boardId: BoardId): Promise<string> {
    this.diffed.push(boardId)
    return DIFF
  }
}

describe('git_diff tool (PR-2b, read-only working-tree diff)', () => {
  it('worker tools/list OMITS git_diff (capability split — no cross-worker diff read)', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    await client.close()
  })

  it('orchestrator tools/list INCLUDES git_diff', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('forwards boardId to the adapter and returns the diff text', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { boardId: 'board-7' } })
    expect(orch.diffed).toEqual(['board-7'])
    expect(res.isError).toBeFalsy()
    const text = (res.content as Array<{ type: string; text?: string }>)
      .map((c) => c.text ?? '')
      .join('')
    expect(text).toBe(DIFF)
    await client.close()
  })

  it('surfaces an empty diff (not a repo / no changes) as empty text, not an error', async () => {
    // The default MockOrchestrator.gitDiff returns '' — the not-a-repo / clean-tree case.
    const client = await connectInMemory('orchestrator')
    const res = await client.callTool({ name: TOOL, arguments: { boardId: 'clean-board' } })
    expect(res.isError).toBeFalsy()
    const text = (res.content as Array<{ type: string; text?: string }>)
      .map((c) => c.text ?? '')
      .join('')
    expect(text).toBe('')
    await client.close()
  })

  it('rejects an empty boardId WITHOUT calling the adapter', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { boardId: '' } })
    expect(res.isError).toBe(true)
    expect(orch.diffed).toEqual([])
    await client.close()
  })
})
