import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator, RelayResult } from '../../orchestrator/Orchestrator'
import type { BoardId } from '../../types'
import type { SessionCtx } from '../factory'
import { MAX_RELAY_BATCH, TOOL_RELAY_PROMPTS } from '../../constants'
import { dispatchPromptSchema } from './promptSchema'

/**
 * Register the `relay_prompts` BATCH agent-to-agent dispatch tool — the plural of `relay_prompt`
 * (see relayPrompt.ts). It carries up to {@link MAX_RELAY_BATCH} `{sourceId, targetId, prompt}`
 * items in ONE call so the host can surface them in ONE human-confirm modal (the human approves
 * per row). The CALLER (ServerFactory) gates it to the orchestrator + connected tiers, exactly
 * like `relay_prompt`.
 *
 * 🔒 The batch is ONLY a UI / round-trip convenience — it never weakens the M4 gate. Host-side,
 * every item is still an INDEPENDENT dispatch: its own directed-cable check (`sourceId → targetId`,
 * terminal → terminal), its own single-use nonce, its own audit row, and its own single sanitized
 * command line. One approval does NOT become N commands; a denied/rejected row changes nothing for
 * the others. The host returns a per-item {@link RelayResult} (positionally 1:1 with `items`).
 *
 * 🔒 Caller-identity binding (BUG-021) is IDENTICAL to `relay_prompt`, applied to EVERY item:
 * - **`connected`** — every item's `sourceId` must equal `ctx.boardId` (a connected terminal may
 *   relay ONLY from its own board). A single item naming a board it does not own fails the WHOLE
 *   batch (a non-owned source is a spoof attempt, not a soft per-item content issue) — nothing is
 *   forwarded. `ctx.boardId` is token-derived, so `sourceId` can't be spoofed.
 * - **`orchestrator`** — when the host designates a command board via `commandBoardId`, only that
 *   token-bound identity may relay; left `undefined`, relay stays open to any orchestrator (the
 *   prior single-token behaviour).
 */
export function registerRelayPrompts(
  server: McpServer,
  orchestrator: Orchestrator,
  ctx: SessionCtx,
  commandBoardId?: BoardId
): void {
  server.registerTool(
    TOOL_RELAY_PROMPTS,
    {
      description:
        'Relay MULTIPLE prompts along orchestration connectors in ONE human-confirmed batch ' +
        `(up to ${MAX_RELAY_BATCH}). Each item is { sourceId, targetId, prompt }; every cable must ` +
        'already exist and both ends be terminals. The human approves per row and each approved ' +
        `item runs as a single command line. items required (1..${MAX_RELAY_BATCH}).`,
      inputSchema: {
        items: z
          .array(
            z.object({
              sourceId: z.string().min(1),
              targetId: z.string().min(1),
              prompt: dispatchPromptSchema
            })
          )
          .min(1)
          .max(MAX_RELAY_BATCH)
      }
    },
    async (args) => {
      // 🔒 Tier-aware caller-identity binding, applied to EVERY item (mirrors relay_prompt). A
      // single violating item fails the whole batch — nothing is forwarded to the orchestrator.
      if (ctx.tier === 'connected' || ctx.tier === 'lead') {
        // Lead (precondition X) binds every item to the caller's own board exactly like
        // connected — commandBoardId is ignored at this tier (it designates the 'app' path only).
        const foreign = args.items.some((it) => it.sourceId !== ctx.boardId)
        if (foreign) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `relay_prompts: a ${ctx.tier} terminal may only relay from its own board`
              }
            ]
          }
        }
      } else if (commandBoardId !== undefined && ctx.boardId !== commandBoardId) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'relay_prompts: caller is not the designated command orchestrator'
            }
          ]
        }
      }

      const results = await orchestrator.relayPrompts(
        args.items.map((it) => ({ sourceId: it.sourceId, targetId: it.targetId, text: it.prompt }))
      )
      return { content: [{ type: 'text', text: summarize(results) }] }
    }
  )
}

/**
 * A `relayed N/M` headline plus one detail line per item — so the caller sees exactly which rows
 * the human approved, which were declined, and which failed validation (and any unconfirmed
 * delivery, which mirrors relay_prompt's single-item WARNING).
 */
function summarize(results: RelayResult[]): string {
  const relayed = results.filter((r) => r.status === 'relayed').length
  const lines = results.map((r) => {
    const route = `${r.sourceId} → ${r.targetId}`
    if (r.status === 'relayed') {
      return r.delivery === 'unconfirmed'
        ? `${route}: relayed — WARNING: delivery unconfirmed (verify via the board output)`
        : `${route}: relayed`
    }
    return `${route}: ${r.status}${r.detail ? ` (${r.detail})` : ''}`
  })
  return `relay_prompts: relayed ${relayed}/${results.length}\n${lines.join('\n')}`
}
