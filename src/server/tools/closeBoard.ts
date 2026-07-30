import { z } from 'zod'
import type { McpServer } from "@modelcontextprotocol/server";
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import { TOOL_CLOSE_BOARD } from '../../constants'

/**
 * Register the `close_board` lifecycle tool (T3.2) — a WRITE tool. Gated to the
 * orchestrator tier by the CALLER (ServerFactory). The host drains the board's PTY
 * gracefully before removing it. `id` is required + non-empty (an empty id is
 * rejected by the schema before the orchestrator is called).
 */
export function registerCloseBoard(server: McpServer, orchestrator: Orchestrator): void {
  server.registerTool(
    TOOL_CLOSE_BOARD,
    {
      description:
        'Close a board by id (graceful PTY drain, then removed from the canvas). ' +
        'Idempotent — closing an already-gone board succeeds.',
      inputSchema: z.object({ id: z.string().min(1) })
    },
    async (args) => {
      await orchestrator.closeBoard(args.id)
      return { content: [{ type: 'text', text: `closed ${args.id}` }] }
    }
  )
}
