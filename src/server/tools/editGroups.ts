import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { GroupEditOp, Orchestrator } from '../../orchestrator/Orchestrator'
import type { SessionCtx } from '../factory'
import {
  GROUP_NAME_MAX,
  MAX_GROUP_BATCH,
  MAX_GROUP_MEMBERS,
  TOOL_EDIT_GROUPS
} from '../../constants'
import {
  callerSource,
  dedupeIds,
  groupNameSchema,
  memberIdsSchema,
  spatialIdSchema,
  warnSkipped
} from './spatialShared'

/** One `edit_groups` op on the wire — the C5 `GroupEditOp` union, discriminated on `op`. */
const groupEditOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rename'), groupId: spatialIdSchema, name: groupNameSchema }),
  z.object({ op: z.literal('add'), groupId: spatialIdSchema, boardIds: memberIdsSchema }),
  z.object({ op: z.literal('remove'), groupId: spatialIdSchema, boardIds: memberIdsSchema }),
  z.object({ op: z.literal('ungroup'), groupId: spatialIdSchema })
])

/** The `edit_groups` wire schema (C6). */
const editGroupsInputSchema = z.object({
  ops: z.array(groupEditOpSchema).min(1).max(MAX_GROUP_BATCH)
})

/** Dedupe an op's member ids (membership is a set); every other field passes through verbatim. */
function normalizeOp(op: GroupEditOp): GroupEditOp {
  return op.op === 'add' || op.op === 'remove' ? { ...op, boardIds: dedupeIds(op.boardIds) } : op
}

/**
 * Register the `edit_groups` tool (C6 / D2 / D6) — rename / add boards to / remove boards from /
 * ungroup EXISTING Named Groups, several ops in one call. The CALLER (ServerFactory) registers it for
 * the ORCHESTRATOR, LEAD and CONNECTED tiers (D1); a worker `tools/list` never contains it.
 *
 * 🔒 Same gate as `group_boards` (D2): every call is human BATCH-confirmed host-side, one row per op,
 * and the approved rows apply as ONE undo step. `ungroup` removes only the outline — the boards stay.
 * A lead/connected caller's token-derived board id rides along as `sourceBoardId`.
 *
 * OPTIONAL host method: a host without `editGroups` does not get the tool, and one `console.warn`
 * names the gap ({@link warnSkipped}).
 */
export function registerEditGroups(
  server: McpServer,
  orchestrator: Orchestrator,
  opts: { ctx?: SessionCtx } = {}
): void {
  const editGroups = orchestrator.editGroups
  if (typeof editGroups !== 'function') {
    warnSkipped(`tool ${TOOL_EDIT_GROUPS}`, 'editGroups')
    return
  }
  server.registerTool(
    TOOL_EDIT_GROUPS,
    {
      description:
        `Edit EXISTING Named Groups — up to ${MAX_GROUP_BATCH} ops per call, each one of: ` +
        `{ op: "rename", groupId, name (1..${GROUP_NAME_MAX} chars) } · ` +
        `{ op: "add", groupId, boardIds (1..${MAX_GROUP_MEMBERS}) } · ` +
        `{ op: "remove", groupId, boardIds (1..${MAX_GROUP_MEMBERS}) } · ` +
        '{ op: "ungroup", groupId } (removes the outline; the boards stay where they are). Group ids ' +
        'come from canvas://layout or canvas://contexts (existingGroupId — a context with addBoardIds ' +
        'is a ready-made "add" op). Only outlines change: no board moves, resizes or runs. EVERY call ' +
        'is shown to the user as ONE batch confirm with one row per op; only the rows they approve ' +
        'apply, together as ONE undo step. To create a new group use group_boards instead. ' +
        "Returns one row per op, in order: { status: 'applied' | 'denied' | 'rejected', detail? } — " +
        "'denied' = the user declined it, 'rejected' = invalid (unknown group or board id) and never " +
        'shown.',
      inputSchema: editGroupsInputSchema
    },
    async (args) => {
      const result = await editGroups.call(orchestrator, {
        ops: args.ops.map(normalizeOp),
        ...callerSource(opts.ctx)
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  )
}
