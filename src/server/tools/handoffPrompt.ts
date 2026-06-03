import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import { TOOL_HANDOFF_PROMPT } from '../../constants'

/**
 * Register the `handoff_prompt` DISPATCH tool (T4.3) — the first tool that writes into
 * another agent's PTY. The CALLER (ServerFactory) gates it to the orchestrator tier by
 * only invoking `registerHandoffPrompt` for that tier; a worker's `tools/list` never
 * contains it (the capability split is structural, never a per-handler check).
 *
 * 🔒 The host (Canvas ADE MAIN) owns the real safety: it resolves the OPAQUE board id
 * (never a label), rejects any non-terminal target before any write, mints a single-use
 * nonce, BLOCKS on a mandatory human confirm, and audits the action. This tool is the
 * thin transport: validate non-empty inputs, forward to the orchestrator, and surface
 * the returned {@link BoardResult} as text. Blocking — it resolves only after the target
 * terminal goes idle.
 */
export function registerHandoffPrompt(server: McpServer, orchestrator: Orchestrator): void {
  server.registerTool(
    TOOL_HANDOFF_PROMPT,
    {
      description:
        'Hand off a prompt to a target terminal board by id: write it into that board ' +
        'and block until the board goes idle, then return its structured last result. ' +
        'Terminal targets only; requires human confirmation. boardId + prompt are required.',
      inputSchema: {
        boardId: z.string().min(1),
        prompt: z.string().min(1)
      }
    },
    async (args) => {
      const result = await orchestrator.handoffPrompt(args.boardId, args.prompt)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  )
}
