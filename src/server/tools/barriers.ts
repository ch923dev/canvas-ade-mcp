import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import { DEFAULT_BARRIER_TIMEOUT_MS, TOOL_WAIT_FOR_ALL, TOOL_WAIT_FOR_IDLE } from '../../constants'
import { waitForBoards, type BarrierBoardResult } from '../barrierWaiter'

/**
 * Resolve the effective backstop: an explicit per-call `timeoutMs` wins (≤ 0 / non-finite
 * opts out, handled downstream by waitForBoards), else the validated env override, else the
 * 30-min default. (env validation mirrors BUG-023: reject non-positive / non-finite.)
 */
export function resolveBarrierTimeout(arg?: number): number {
  if (arg !== undefined) return arg
  const env = process.env.CANVAS_ADE_BARRIER_TIMEOUT_MS
  if (env !== undefined) {
    const n = Number(env)
    if (Number.isFinite(n) && n > 0) return n
  }
  return DEFAULT_BARRIER_TIMEOUT_MS
}

/**
 * Register the M5 BARRIER tools — orchestrator-tier blocking waits over the host status
 * stream. The CALLER (ServerFactory) gates them to the orchestrator tier (registered only in
 * that block); a worker's tools/list never contains them (structural split). READ-ONLY: no
 * PTY write, no human confirm, no audit (those are dispatch-tool concerns). Returns a
 * `dispose()` that cancels any in-flight waits (called on session close to avoid a leaked
 * orchestrator subscription).
 */
export function registerBarrierTools(server: McpServer, orchestrator: Orchestrator): () => void {
  const active = new Set<() => void>()

  const run = async (targets: string[], timeoutMs: number): Promise<BarrierBoardResult[]> => {
    const handle = waitForBoards({ orchestrator, targets, timeoutMs })
    active.add(handle.cancel)
    try {
      return await handle.promise
    } finally {
      active.delete(handle.cancel)
    }
  }

  server.registerTool(
    TOOL_WAIT_FOR_IDLE,
    {
      description:
        'Block until a target board leaves the running state, then report how it settled ' +
        '(idle/awaiting-review/blocked/failed/static/gone, or timed-out). Returns the board ' +
        "id + status (+ the board's last write_result when idle). boardId is required; " +
        'optional timeoutMs (omit for the default backstop; <=0 to wait indefinitely).',
      inputSchema: {
        boardId: z.string().min(1),
        timeoutMs: z.number().optional()
      }
    },
    async (args) => {
      const results = await run([args.boardId], resolveBarrierTimeout(args.timeoutMs))
      const r = results[0] ?? { id: args.boardId, status: 'timed-out' }
      return { content: [{ type: 'text', text: JSON.stringify(r) }] }
    }
  )

  server.registerTool(
    TOOL_WAIT_FOR_ALL,
    {
      description:
        'Block until EVERY target board has left the running state, then report each one ' +
        '(same statuses as wait_for_idle) plus allIdle (true when every target settled to ' +
        'idle). boardIds is a non-empty array; optional timeoutMs (omit for the default ' +
        'backstop; <=0 to wait indefinitely).',
      inputSchema: {
        boardIds: z.array(z.string().min(1)).min(1),
        timeoutMs: z.number().optional()
      }
    },
    async (args) => {
      const boards = await run(args.boardIds, resolveBarrierTimeout(args.timeoutMs))
      const allIdle = boards.every((b) => b.status === 'idle')
      return { content: [{ type: 'text', text: JSON.stringify({ boards, allIdle }) }] }
    }
  )

  return () => {
    for (const cancel of active) cancel()
  }
}
