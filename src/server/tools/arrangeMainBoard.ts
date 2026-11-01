import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import type { SessionCtx } from '../factory'
import { MAIN_SIDES, TOOL_ARRANGE_MAIN_BOARD } from '../../constants'
import { callerSource, spatialIdSchema, warnSkipped } from './spatialShared'

/**
 * The `arrange_main_board` wire schema (0.28.0). `boardId` is REQUIRED — the intent is meaningless
 * without its target. Every optional field is `.optional()` and NEVER `.default()`ed: an omitted
 * `side` / `scope` / `fit` reaches the host as `undefined` and the host owns the default (the
 * `tidy_canvas` D8 (a) discipline). `scope` is the same union `tidy_canvas` accepts.
 */
const arrangeMainBoardInputSchema = z.object({
  boardId: spatialIdSchema,
  side: z.enum(MAIN_SIDES).optional(),
  scope: z.union([z.enum(['all', 'visible']), z.object({ groupId: spatialIdSchema })]).optional(),
  fit: z.boolean().optional()
})

const DESCRIPTION =
  'Make ONE board the MAIN board: it takes the big slot and EVERY other board (in scope; default the ' +
  'whole canvas, except workers docked in a swarm board) moves into a sidebar beside it, fitted to ' +
  "the user's screen — sidebar to the right on a wide screen, below on a tall one, or pinned with " +
  'side. Use for "make the browser the main one", "focus on the plan and put the rest on the side", ' +
  '"make the api terminal the big one". For a general clean-up with no main board use tidy_canvas. ' +
  'boardId (required): the main board, from canvas://boards or canvas://layout. ' +
  `side: ${MAIN_SIDES.map((s) => `"${s}"`).join(' | ')} (omitted ⇒ "auto"). ` +
  'scope: "all" (omitted ⇒ the whole canvas) | "visible" (only what is on screen) | { groupId } (one ' +
  'Named Group). fit: reframe the camera on the result (default true). ' +
  'WHAT CHANGES — sidebar terminals may be resized to their slot; browser previews keep their device ' +
  'aspect; planning, kanban and file boards keep their size. Nothing is created or deleted; the whole ' +
  'arrangement is ONE undo step. From a lead or connected terminal the user approves it first; a ' +
  'declined call changes nothing. ' +
  'RETURNS { moved, fitZoom, readable, units? } — moved = boards repositioned; readable = everything ' +
  'is legible at fitZoom.'

/**
 * Register the `arrange_main_board` tool (0.28.0) — the MAIN + SIDEBAR intent ("make the browser the
 * main one"). The CALLER (ServerFactory, `registerSpatialSurface`) registers it for the ORCHESTRATOR,
 * LEAD and CONNECTED tiers (D1); a worker `tools/list` never contains it.
 *
 * 🔒 Gate (D1): the tool binds a lead/connected caller's token-derived board id as `sourceBoardId`
 * ({@link callerSource}, fail-closed); the HOST raises ONE approve/deny confirm when it is present.
 * Orchestrator-tier calls carry no `sourceBoardId` and stay un-gated. The host maps the call onto its
 * tidy engine with `primary = boardId` — ONE undo step.
 *
 * Thin transport: validate, forward every supplied field verbatim — never inventing a default — and
 * surface the host's result as JSON.
 *
 * OPTIONAL host method: a host without `arrangeMainBoard` does not get the tool, and one
 * `console.warn` names the gap ({@link warnSkipped}).
 */
export function registerArrangeMainBoard(
  server: McpServer,
  orchestrator: Orchestrator,
  opts: { ctx?: SessionCtx } = {}
): void {
  const arrangeMainBoard = orchestrator.arrangeMainBoard
  if (typeof arrangeMainBoard !== 'function') {
    warnSkipped(`tool ${TOOL_ARRANGE_MAIN_BOARD}`, 'arrangeMainBoard')
    return
  }
  server.registerTool(
    TOOL_ARRANGE_MAIN_BOARD,
    { description: DESCRIPTION, inputSchema: arrangeMainBoardInputSchema },
    async (args) => {
      const result = await arrangeMainBoard.call(orchestrator, {
        ...args,
        ...callerSource(opts.ctx, TOOL_ARRANGE_MAIN_BOARD)
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  )
}
