import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import type { BoardId } from '../../types'
import type { SessionCtx } from '../factory'
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
 *
 * 🔒 Caller-identity binding (BUG-021 part 2): `sourceId` is caller-supplied and the cable
 * (not the caller) is the only authorization the host checks, so ANY orchestrator-tier token
 * could exploit ANY existing cable — fine while exactly one orchestrator token exists, a hole
 * the moment multiple are minted. The binding is TIER-AWARE:
 *
 * - **`orchestrator`** — when the host designates a single command board via `commandBoardId`,
 *   relay is restricted to that one token-bound identity (the in-process `'app'` orchestrator,
 *   which may relay from ANY source board). Left `undefined`, behaviour is unchanged (open to
 *   any orchestrator-tier caller) so existing single-token deployments keep working.
 * - **`connected`** (Agent Orchestration v1) — a consented Terminal board may relay ONLY from
 *   its OWN board (`sourceId === ctx.boardId`); the orchestration cable graph (host-checked)
 *   authorizes the target. STRICTER than `'app'` — it is scoped to its own outgoing cables and
 *   ignores `commandBoardId`. `ctx.boardId` is token-derived, so `sourceId` can't be spoofed to
 *   another board.
 */
export function registerRelayPrompt(
  server: McpServer,
  orchestrator: Orchestrator,
  ctx: SessionCtx,
  commandBoardId?: BoardId
): void {
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
      if (ctx.tier === 'connected') {
        // 🔒 A connected Terminal board may relay ONLY from its own board (scoped to its own
        // outgoing cables); the cable graph (host-checked) authorizes the target. ctx.boardId is
        // token-derived, so a client can't spoof sourceId to drive another board's cables.
        if (args.sourceId !== ctx.boardId) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'relay_prompt: a connected terminal may only relay from its own board'
              }
            ]
          }
        }
      } else if (commandBoardId !== undefined && ctx.boardId !== commandBoardId) {
        // 🔒 BUG-021: when a command board is designated, only that token-bound identity may
        // relay — a second orchestrator token (bound to another board) can't exploit a cable
        // it doesn't own. ctx.boardId comes from the verified token, so it can't be forged.
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'relay_prompt: caller is not the designated command orchestrator'
            }
          ]
        }
      }
      await orchestrator.relayPrompt(args.sourceId, args.targetId, args.prompt)
      return { content: [{ type: 'text', text: `relayed ${args.sourceId} → ${args.targetId}` }] }
    }
  )
}
