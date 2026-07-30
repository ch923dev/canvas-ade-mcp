import { z } from 'zod'
import type { McpServer } from "@modelcontextprotocol/server";
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import { TOOL_HANDOFF_PROMPT } from '../../constants'
import { dispatchPromptSchema } from './promptSchema'
import { resolveBarrierTimeout } from './barriers'

/** Race sentinel — never a value `handoffPrompt` could resolve to. */
const TIMED_OUT = Symbol('handoff-timed-out')

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
 * terminal goes idle, bounded by the SAME backstop discipline as the barriers (audit
 * Phase A): default 30 min / `CANVAS_ADE_BARRIER_TIMEOUT_MS`, per-call `timeoutMs`
 * override, ≤ 0 opts out. On expiry the tool reports timed-out (settle-and-report, an
 * isError result) — the host-side dispatch keeps running; the caller reads
 * `canvas://board/{id}/result` later.
 */
export function registerHandoffPrompt(server: McpServer, orchestrator: Orchestrator): void {
  server.registerTool(
    TOOL_HANDOFF_PROMPT,
    {
      description:
        'Hand off a prompt to a target terminal board by id: write it into that board ' +
        'and block until the board goes idle, then return its structured last result. ' +
        'Terminal targets only; requires human confirmation. boardId + prompt are required; ' +
        'optional timeoutMs (omit for the default backstop; <=0 to wait indefinitely). On ' +
        'timeout the dispatch keeps running host-side — read canvas://board/{id}/result later.',
      inputSchema: z.object({
              boardId: z.string().min(1),
              prompt: dispatchPromptSchema,
              timeoutMs: z.number().optional()
            })
    },
    async (args) => {
      const timeoutMs = resolveBarrierTimeout(args.timeoutMs)
      const call = orchestrator.handoffPrompt(args.boardId, args.prompt)

      if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
        // Explicit opt-out (≤ 0 / non-finite) — the pre-Phase-A unbounded behaviour.
        const result = await call
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      }

      let timer: ReturnType<typeof setTimeout> | undefined
      const backstop = new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs)
        // The backstop must not hold the host process open (barrier discipline).
        ;(timer as { unref?: () => void }).unref?.()
      })
      try {
        const raced = await Promise.race([call, backstop])
        if (raced === TIMED_OUT) {
          // The abandoned host promise may still reject later — detach it so an
          // eventual rejection can't surface as an unhandled rejection in MAIN.
          void call.catch(() => {})
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text:
                  `handoff_prompt: timed out after ${timeoutMs}ms waiting for board ` +
                  `${args.boardId} to go idle — the dispatch may still be running; ` +
                  `read canvas://board/${args.boardId}/result later`
              }
            ]
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify(raced) }] }
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }
  )
}
