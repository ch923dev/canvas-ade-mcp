import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import { TOOL_RELAY_PROMPT } from '../../constants'
import { dispatchPromptSchema } from './promptSchema'

/**
 * Register the `relay_prompt` agent-to-agent DISPATCH tool (T4.6, the M4 gate). A dispatch
 * from board A (`sourceId`) to board B (`targetId`) is authorized by an ORCHESTRATION
 * connector A→B — the spatial cable IS the route. The CALLER (ServerFactory) gates it to
 * the orchestrator tier (a worker's `tools/list` never contains it).
 *
 * 🔒 The host (Canvas ADE MAIN) owns the real safety: it validates the directed
 * orchestration edge `sourceId → targetId` exists and both ends are terminals
 * (terminal → terminal only, one-directional, never Browser → PTY), mints a single-use
 * nonce, BLOCKS on a mandatory human confirm, and audits — then writes into the target's
 * PTY. This tool is the thin transport: validate non-empty inputs, forward to
 * {@link Orchestrator.relayPrompt}, surface a short ack.
 */
export function registerRelayPrompt(server: McpServer, orchestrator: Orchestrator): void {
  server.registerTool(
    TOOL_RELAY_PROMPT,
    {
      description:
        'Relay a prompt from one terminal board to another along an orchestration ' +
        'connector (sourceId → targetId): the cable must already exist and both boards ' +
        'must be terminals. Requires human confirmation. sourceId, targetId, prompt required.',
      inputSchema: {
        sourceId: z.string().min(1),
        targetId: z.string().min(1),
        prompt: dispatchPromptSchema
      }
    },
    async (args) => {
      await orchestrator.relayPrompt(args.sourceId, args.targetId, args.prompt)
      return { content: [{ type: 'text', text: `relayed ${args.sourceId} → ${args.targetId}` }] }
    }
  )
}
