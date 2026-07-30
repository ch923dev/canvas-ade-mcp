import { z } from 'zod'
import type { McpServer } from "@modelcontextprotocol/server";
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import type { SessionCtx } from '../factory'
import { TOOL_ASSIGN_PROMPT } from '../../constants'
import { dispatchPromptSchema } from './promptSchema'

/**
 * Register the `assign_prompt` DISPATCH tool (T4.4) — the FIRE-AND-FORGET sibling of
 * `handoff_prompt`. The CALLER (ServerFactory) gates it to the orchestrator + lead tiers by only
 * invoking `registerAssignPrompt` for those tiers; a worker's `tools/list` never contains
 * it (the capability split is structural, never a per-handler check).
 *
 * 🔒 The host (Canvas ADE MAIN) owns the real safety, identical to handoff_prompt: it
 * resolves the OPAQUE board id (never a label), rejects any non-terminal target before
 * any write, mints a single-use nonce, BLOCKS on a mandatory human confirm, and audits
 * the action. The ONLY difference from handoff is that this returns the moment the write
 * lands — it does NOT block on await-idle or return a structured result. This tool is the
 * thin transport: validate non-empty inputs, forward to {@link Orchestrator.dispatchPrompt},
 * and surface a short ack.
 *
 * 🔒 Lead tier (orchestration Phase 1, precondition X): a lead caller's assign is routed
 * through {@link Orchestrator.relayPrompt} with the caller's OWN token-derived board id as
 * the source — so the host's directed-cable check (`lead → target`) is the authorization,
 * exactly like `relay_prompt`. A lead terminal can therefore only assign into boards it is
 * cabled to (the boards it spawned auto-cable on spawn), never into an arbitrary board the
 * way the `'app'` orchestrator can. Same fire-and-forget ack semantics either way.
 */
export function registerAssignPrompt(
  server: McpServer,
  orchestrator: Orchestrator,
  ctx?: SessionCtx
): void {
  const lead = ctx?.tier === 'lead'
  server.registerTool(
    TOOL_ASSIGN_PROMPT,
    {
      description:
        'Assign a prompt to a target terminal board by id: write it into that board ' +
        'and return immediately (fire-and-forget — no waiting for the board to finish). ' +
        'Terminal targets only; requires human confirmation. boardId + prompt are required.' +
        (lead
          ? ' Lead tier: the dispatch runs along YOUR outgoing orchestration cable to the ' +
            'target (boards you spawned are auto-cabled); a target you are not cabled to is ' +
            'rejected.'
          : ''),
      inputSchema: z.object({
              boardId: z.string().min(1),
              prompt: dispatchPromptSchema
            })
    },
    async (args) => {
      // rc.6 honest ack: a readiness-gated host resolves { delivery }; a pre-rc.6 host resolves
      // undefined (treated as the legacy confirmed path). 'unconfirmed' = the write landed but
      // the target never showed boot-quiet before the host's readiness backstop.
      const ack =
        lead && ctx
          ? // 🔒 Lead: the caller's own board id (token-derived, unforgeable) is the source —
            // the host's cable check authorizes the route, mirroring relay_prompt.
            await orchestrator.relayPrompt(ctx.boardId, args.boardId, args.prompt)
          : await orchestrator.dispatchPrompt(args.boardId, args.prompt)
      const text =
        ack?.delivery === 'unconfirmed'
          ? `assigned prompt to ${args.boardId} — WARNING: delivery unconfirmed (the target may still be booting; verify via the board output before assuming the task started)`
          : `assigned prompt to ${args.boardId}`
      return { content: [{ type: 'text', text }] }
    }
  )
}
