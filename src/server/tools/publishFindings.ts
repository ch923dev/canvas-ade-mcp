import { z } from 'zod'
import type { McpServer } from "@modelcontextprotocol/server";
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import { MAX_COLUMN_ID, TOOL_PUBLISH_FINDINGS } from '../../constants'

/**
 * Register `publish_findings` (orchestration P4) — the END-OF-RUN durable aggregation tool.
 *
 * 🔒 WHY IT IS NOT A LOOP OVER `add_card`. Every durable content write is human-confirmed and
 * `add_card` adds exactly one card, so publishing N worker findings that way costs N modals. At the
 * fan-out scale this layer exists for that is a confirm storm, and the feature becomes unusable at
 * precisely the moment it should be most useful. This tool is the batch path: the host composes all
 * N findings into ONE per-row confirm modal and ONE canvas write.
 *
 * 🔒 THE CALLER SUPPLIES NO CONTENT. The input is a destination board and, optionally, a lane —
 * there is no findings array, no titles, no severities. The host DERIVES every card from the
 * `write_result` data its workers already reported, which is what makes the cards trustworthy: an
 * orchestrator cannot publish a finding no worker actually made. Same discipline as `write_result`
 * accepting no target board id.
 *
 * Registered for the orchestrator and lead tiers only, behind the host's `planningWrite` flag (a
 * Kanban board is a durable plan surface — ADR 0003). A host that has not wired `publishFindings`
 * does not get the tool at all, so it never appears in `tools/list` as a call that would fail.
 */
export function registerPublishFindings(server: McpServer, orchestrator: Orchestrator): void {
  const publish = orchestrator.publishFindings
  if (typeof publish !== 'function') return
  server.registerTool(
    TOOL_PUBLISH_FINDINGS,
    {
      description:
        'Publish the run\'s merged worker findings onto a KANBAN board as ONE human-confirmed batch — the end-of-run step after your workers have reported. boardId must be an existing kanban board id (from spawn_board or canvas://boards); optional lane overrides the destination column (by default each finding is routed by its severity: crit/high/med → "review", low/unknown → "backlog"). ' +
        'You supply NO findings: the host derives every card from the write_result data your workers already reported, dedupes identical claims across workers, and shows you every row in ONE confirm modal where each can be approved or declined individually. Use this INSTEAD of calling add_card once per finding — that would raise one confirmation prompt per card. ' +
        'Returns what was published, declined, merged or capped; relay that summary to the user rather than reporting a bare success.',
      inputSchema: z.object({
              boardId: z.string().min(1),
              lane: z.string().min(1).max(MAX_COLUMN_ID).optional()
            })
    },
    async (args) => {
      const r = await publish.call(
        orchestrator,
        args.boardId,
        args.lane !== undefined ? { lane: args.lane } : undefined
      )
      // A refusal is reported as a tool ERROR so the agent cannot read it as a successful publish.
      // Publishing ZERO cards is NOT a refusal: an empty batch, or a human declining every row, is
      // a legitimate answer that wrote nothing — it resolves ok with its reason in the summary.
      return r.ok
        ? { content: [{ type: 'text' as const, text: r.summary }] }
        : { isError: true, content: [{ type: 'text' as const, text: r.summary }] }
    }
  )
}
