import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import type { SessionCtx } from '../factory'
import { MAX_FOCUS_TARGET_ID, TOOL_FOCUS_VIEWPORT } from '../../constants'
import { callerSource } from './spatialShared'

/**
 * Register the `focus_viewport` tool (H1 / Lane H) — move the user's CAMERA to a board, a Named
 * Group, or the whole canvas. The CALLER (ServerFactory) registers it for the ORCHESTRATOR, LEAD and
 * CONNECTED tiers (D1, 0.27.0); a worker `tools/list` never contains it.
 *
 * 🔒 Content-less + viewport-only: the host only MOVES THE CAMERA (never a board — no create, move,
 * resize, or delete), so it carries no exec vector and no text. Gate (D1): the tool binds a
 * lead/connected caller's token-derived board id as `sourceBoardId` and the HOST raises ONE
 * approve/deny confirm before the camera moves — a terminal must not yank the user's view unasked.
 * Orchestrator-tier calls carry no `sourceBoardId` and stay un-gated. This tool is the thin
 * transport: validate the target shape, forward to {@link Orchestrator.focusViewport}, surface the
 * host's outcome as JSON (`{ focused: 'board' | 'group' | 'all', id? }`).
 */
export function registerFocusViewport(
  server: McpServer,
  orchestrator: Orchestrator,
  opts: { ctx?: SessionCtx } = {}
): void {
  server.registerTool(
    TOOL_FOCUS_VIEWPORT,
    {
      description:
        "Move the USER'S CAMERA (the canvas viewport — never a board): fit the view to one " +
        'board (`boardId`), one Named Group (`groupId`), or the whole canvas (neither). Pass at ' +
        'most ONE of boardId / groupId — ids come from canvas://boards, canvas://layout, ' +
        'canvas://contexts, or canvas://app-model. Viewport-only and content-less: nothing is ' +
        'created, moved, resized, or deleted, and the user can scroll back at any time. Use it when ' +
        'canvas://layout reports fit.readable false and one group matters more than the whole ' +
        'canvas. From a lead or connected terminal the user approves the camera move first. ' +
        'Returns { focused: "board" | "group" | "all", id? }. Errors on an unknown id.',
      inputSchema: z.object({
        boardId: z.string().min(1).max(MAX_FOCUS_TARGET_ID).optional(),
        groupId: z.string().min(1).max(MAX_FOCUS_TARGET_ID).optional()
      })
    },
    async (args) => {
      // Exactly-one-or-none: both targets in one call is ambiguous — reject at the wire so the
      // host never has to pick a winner (defence in depth; the host re-validates too).
      if (args.boardId !== undefined && args.groupId !== undefined) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'focus_viewport: pass at most one of boardId / groupId' }]
        }
      }
      const result = await orchestrator.focusViewport({
        boardId: args.boardId,
        groupId: args.groupId,
        ...callerSource(opts.ctx)
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  )
}
