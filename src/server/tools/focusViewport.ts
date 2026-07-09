import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import { MAX_FOCUS_TARGET_ID, TOOL_FOCUS_VIEWPORT } from '../../constants'

/**
 * Register the `focus_viewport` tool (H1 / Lane H) — move the user's CAMERA to a board, a Named
 * Group, or the whole canvas. The CALLER (ServerFactory) gates this to the ORCHESTRATOR tier by
 * only invoking `registerFocusViewport` for that tier — steering the user's viewport is an
 * app-level helper act (the Jarvis/command-board scope); a connected worker must not yank the
 * camera out from under the user.
 *
 * 🔒 Content-less + viewport-only: the host only MOVES THE CAMERA (never a board — no create,
 * move, resize, or delete), so — like `tidy_canvas` — it carries no exec vector and no text, and
 * it is NOT human-gated (the write-time confirm stays on content writes). Trivially reversible by
 * scrolling; the host animates via its existing camera verbs (`focusBoardById` / `fitGroup` /
 * `fitAll`). This tool is the thin transport: validate the target shape, forward to
 * {@link Orchestrator.focusViewport}, surface the host's outcome as JSON
 * (`{ focused: 'board' | 'group' | 'all', id? }`).
 */
export function registerFocusViewport(server: McpServer, orchestrator: Orchestrator): void {
  server.registerTool(
    TOOL_FOCUS_VIEWPORT,
    {
      description:
        'Move the USER\'S CAMERA (the canvas viewport — never a board): fit the view to one ' +
        'board (`boardId`), one Named Group (`groupId`), or the whole canvas (neither). Pass at ' +
        'most ONE of boardId / groupId — ids come from canvas://boards, canvas://layout, or ' +
        'canvas://app-model. Orchestrator-tier only. Viewport-only and content-less: nothing is ' +
        'created, moved, resized, or deleted, and the user can scroll back at any time. Returns ' +
        '{ focused: "board" | "group" | "all", id? }. Errors on an unknown id.',
      inputSchema: {
        boardId: z.string().min(1).max(MAX_FOCUS_TARGET_ID).optional(),
        groupId: z.string().min(1).max(MAX_FOCUS_TARGET_ID).optional()
      }
    },
    async (args) => {
      // Exactly-one-or-none: both targets in one call is ambiguous — reject at the wire so the
      // host never has to pick a winner (defence in depth; the host re-validates too).
      if (args.boardId !== undefined && args.groupId !== undefined) {
        return {
          isError: true,
          content: [
            { type: 'text', text: 'focus_viewport: pass at most one of boardId / groupId' }
          ]
        }
      }
      const result = await orchestrator.focusViewport({
        boardId: args.boardId,
        groupId: args.groupId
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  )
}
