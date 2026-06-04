import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import type { SessionCtx } from '../factory'
import { TOOL_WRITE_RESULT } from '../../constants'

/**
 * Register the `write_result` tool (T4.4) — the FIRST worker-tier WRITE tool. A worker
 * records its OWN board's structured result (verdict + summary + references), which feeds
 * the `canvas://board/{id}/result` resource (T1.5). Registered for BOTH tiers (the caller
 * — ServerFactory — invokes this OUTSIDE the orchestrator-only block).
 *
 * 🔒 The target board is BOUND to the caller's `ctx.boardId` (derived from the verified
 * token), and there is NO client-supplied boardId input — so a worker can only write its
 * OWN result and can never forge another board's. Unlike the dispatch tools this performs
 * no PTY write and needs no human confirm: the agent is reporting its own outcome, not
 * dispatching into another shell.
 */
export function registerWriteResult(
  server: McpServer,
  orchestrator: Orchestrator,
  ctx: SessionCtx
): void {
  server.registerTool(
    TOOL_WRITE_RESULT,
    {
      description:
        "Record THIS board's structured last result (status / summary / references). " +
        'All fields optional. Writes only the calling board (no target id is accepted).',
      inputSchema: {
        status: z.string().optional(),
        summary: z.string().optional(),
        refs: z.array(z.string()).optional()
      }
    },
    async (args) => {
      // 🔒 ctx.boardId is derived from the token (no client input). If the token
      // carried no boardId it falls back to '' — writing to board '' would silently
      // no-op or hit a sentinel while the agent believes its result was recorded.
      // Refuse loudly instead of writing to an unbound board.
      if (!ctx.boardId) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'write_result: no board bound to this session' }]
        }
      }
      await orchestrator.writeResult(ctx.boardId, {
        status: args.status,
        summary: args.summary,
        refs: args.refs
      })
      return { content: [{ type: 'text', text: 'result recorded' }] }
    }
  )
}
