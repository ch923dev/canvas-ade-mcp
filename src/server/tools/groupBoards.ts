import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import type { SessionCtx } from '../factory'
import {
  GROUP_NAME_MAX,
  MAX_GROUP_BATCH,
  MAX_GROUP_MEMBERS,
  TOOL_GROUP_BOARDS
} from '../../constants'
import {
  callerSource,
  dedupeIds,
  groupNameSchema,
  memberIdsSchema,
  warnSkipped
} from './spatialShared'

/** The `group_boards` wire schema (C6). */
const groupBoardsInputSchema = z.object({
  groups: z
    .array(z.object({ name: groupNameSchema, boardIds: memberIdsSchema }))
    .min(1)
    .max(MAX_GROUP_BATCH)
})

/**
 * Register the `group_boards` tool (C6 / D2 / D6) — create Named Groups over EXISTING boards, several
 * in one call. The CALLER (ServerFactory) registers it for the ORCHESTRATOR, LEAD and CONNECTED tiers
 * (D1); a worker `tools/list` never contains it.
 *
 * 🔒 Every call — every tier — is human BATCH-confirmed host-side (D2): ONE modal, one row per proposed
 * group; only the approved rows apply, as ONE undo step. Grouping only draws an outline (no board
 * moves). The host validates each row's ids against the live mirror (unknown / docked ⇒ that row
 * `rejected`) and re-sanitizes the name. A lead/connected caller's token-derived board id rides along
 * as `sourceBoardId` (audit + routing); orchestrator calls carry none.
 *
 * Duplicate ids inside one row are DEDUPED (order kept), not rejected — membership is a set.
 *
 * OPTIONAL host method: a host without `groupBoards` does not get the tool, and one `console.warn`
 * names the gap ({@link warnSkipped}).
 */
export function registerGroupBoards(
  server: McpServer,
  orchestrator: Orchestrator,
  opts: { ctx?: SessionCtx } = {}
): void {
  const groupBoards = orchestrator.groupBoards
  if (typeof groupBoards !== 'function') {
    warnSkipped(`tool ${TOOL_GROUP_BOARDS}`, 'groupBoards')
    return
  }
  server.registerTool(
    TOOL_GROUP_BOARDS,
    {
      description:
        'Group EXISTING boards into Named Groups — up to ' +
        `${MAX_GROUP_BATCH} groups per call, each { name (1..${GROUP_NAME_MAX} chars), boardIds ` +
        `(1..${MAX_GROUP_MEMBERS} board ids from canvas://boards, canvas://layout or canvas://contexts) }. ` +
        'Grouping only draws an outline around the boards: nothing moves, resizes or runs. EVERY call ' +
        'is shown to the user as ONE batch confirm with one row per group; only the rows they approve ' +
        'are created, together as ONE undo step. Good proposals come from canvas://contexts (contexts ' +
        'without an existingGroupId). To change an existing group use edit_groups instead. ' +
        "Returns one row per input group, in order: { status: 'created' | 'denied' | 'rejected', " +
        "groupId?, detail? } — 'denied' = the user declined it, 'rejected' = invalid (e.g. an unknown " +
        'board id) and never shown.',
      inputSchema: groupBoardsInputSchema
    },
    async (args) => {
      const result = await groupBoards.call(orchestrator, {
        groups: args.groups.map((g) => ({ name: g.name, boardIds: dedupeIds(g.boardIds) })),
        ...callerSource(opts.ctx)
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  )
}
