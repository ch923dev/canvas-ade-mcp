import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import type { SessionCtx } from '../factory'
import {
  TOOL_WRITE_RESULT,
  WRITE_RESULT_MAX_REF_LEN,
  WRITE_RESULT_MAX_REFS,
  WRITE_RESULT_MAX_SUMMARY
} from '../../constants'

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
        // 🔒 C3 / BUG-009: cap at the protocol layer (mirrors the host's WRITE_RESULT_MAX_* clamps).
        // An oversized payload is rejected here by Zod before it reaches the orchestrator; the MAIN
        // clamps remain as independent defense-in-depth.
        summary: z.string().max(WRITE_RESULT_MAX_SUMMARY).optional(),
        refs: z.array(z.string().max(WRITE_RESULT_MAX_REF_LEN)).max(WRITE_RESULT_MAX_REFS).optional()
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
