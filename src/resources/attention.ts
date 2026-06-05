import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BoardSummary, Orchestrator } from '../orchestrator/Orchestrator'

/** The canonical URI of the read-only attention resource (M5 notifier pushes updates here). */
export const ATTENTION_URI = 'canvas://attention'

/**
 * Status buckets that mean "a human's attention is needed": a worker waiting on a
 * review/decision, blocked on a permission prompt, or failed. (`running`/`idle`/
 * `static` do not need a human.) Buckets are emitted host-side: `failed` already
 * flows today (a browser that fails to load); `blocked`/`awaiting-review` start
 * flowing when their detection lands (M8 permission detection + the terminal
 * awaiting-input wire) — this resource already surfaces them once they do.
 */
export const ATTENTION_BUCKETS: ReadonlySet<string> = new Set([
  'blocked',
  'awaiting-review',
  'failed'
])

/** The subset of boards currently in an attention bucket (order preserved). */
export function selectAttention(boards: BoardSummary[]): BoardSummary[] {
  return boards.filter((b) => ATTENTION_BUCKETS.has(b.status))
}

/**
 * Registers the read-only `canvas://attention` resource (both tiers — observation is
 * safe): the boards needing a human, with full detail so the agent knows which board
 * and why. The on-canvas "needs-you" queue (M5 / SB-1) is the human-visible twin.
 */
export function registerAttentionResource(server: McpServer, orchestrator: Orchestrator): void {
  server.registerResource(
    'attention',
    ATTENTION_URI,
    {
      description: 'Boards needing a human (blocked / awaiting-review / failed).',
      mimeType: 'application/json'
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, text: JSON.stringify(selectAttention(await orchestrator.listBoards())) }
      ]
    })
  )
}
