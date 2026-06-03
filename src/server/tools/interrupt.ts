import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import { TOOL_INTERRUPT } from '../../constants'

/**
 * Register the `interrupt` DISPATCH tool (T4.5) — send Ctrl-C to a target terminal's PTY
 * to stop a runaway/long-running command. The CALLER (ServerFactory) gates it to the
 * orchestrator tier by only invoking `registerInterrupt` for that tier; a worker's
 * `tools/list` never contains it (the capability split is structural).
 *
 * 🔒 The host (Canvas ADE MAIN) owns the real safety, identical to assign_prompt: resolve
 * the OPAQUE board id (never a label), reject any non-terminal target before any write,
 * mint a single-use nonce, BLOCK on a mandatory human confirm, and audit. Content-less —
 * the only input is the target id. This tool is the thin transport: validate, forward to
 * {@link Orchestrator.interrupt}, and surface a short ack.
 */
export function registerInterrupt(server: McpServer, orchestrator: Orchestrator): void {
  server.registerTool(
    TOOL_INTERRUPT,
    {
      description:
        'Interrupt a target terminal board by id: send Ctrl-C to stop its running ' +
        'command. Terminal targets only; requires human confirmation. boardId is required.',
      inputSchema: {
        boardId: z.string().min(1)
      }
    },
    async (args) => {
      await orchestrator.interrupt(args.boardId)
      return { content: [{ type: 'text', text: `interrupted ${args.boardId}` }] }
    }
  )
}
