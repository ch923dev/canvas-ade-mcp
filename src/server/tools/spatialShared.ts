import { z } from 'zod'
import type { BoardId } from '../../types'
import type { SessionCtx } from '../factory'
import { GROUP_NAME_MAX, MAX_FOCUS_TARGET_ID, MAX_GROUP_MEMBERS } from '../../constants'

/**
 * Shared pieces of the C6 spatial surface (`tidy_canvas`, `focus_viewport`, `group_boards`,
 * `edit_groups`, `canvas://contexts`) — one definition of the caller binding, the id/name schemas and
 * the warn-on-skip, so the four tools cannot drift apart.
 */

/**
 * 🔒 The D1 caller binding: a LEAD or CONNECTED caller's token-derived board id, returned as a
 * spreadable `{ sourceBoardId }` (never client input — the input schemas carry no such field, so a
 * forged one is stripped by Zod before the handler runs). The host raises its human confirm when the
 * field is present. ORCHESTRATOR-tier calls spread nothing and stay un-gated host-side (the
 * `spawn_board` / `visualize_plan` binding, verbatim).
 */
export function callerSource(ctx: SessionCtx | undefined): { sourceBoardId?: BoardId } {
  return (ctx?.tier === 'connected' || ctx?.tier === 'lead') && ctx.boardId
    ? { sourceBoardId: ctx.boardId }
    : {}
}

/** An opaque board / group id echoed back from a read resource (the `focus_viewport` bound). */
export const spatialIdSchema = z.string().min(1).max(MAX_FOCUS_TARGET_ID)

/** A Named Group name on the wire. The host re-sanitizes (`sanitizeGroupName`) and re-clamps. */
export const groupNameSchema = z.string().min(1).max(GROUP_NAME_MAX)

/** The member ids of one group row / one `add` / `remove` op (1..MAX_GROUP_MEMBERS). */
export const memberIdsSchema = z.array(spatialIdSchema).min(1).max(MAX_GROUP_MEMBERS)

/**
 * Drop repeated ids, keeping first-occurrence order. Membership is a SET, so a duplicate carries no
 * meaning — the tools dedupe it rather than fail the whole batch over it. The member cap applies to
 * the list as sent (before dedupe), which can only make the wire stricter, never laxer.
 */
export function dedupeIds(ids: readonly BoardId[]): BoardId[] {
  return [...new Set(ids)]
}

/**
 * 🔒 Warn-on-skip (the `publish_findings` lesson, C6). An optional Orchestrator method that the host
 * forgot to forward makes its tool / resource silently vanish from `tools/list`. Each optional
 * `register*` calls this exactly once when it skips, and each runs once per `getServer`, so the
 * result is ONE warning per missing method per server build — loud enough that a host which never
 * wired the method sees it in its log.
 */
export function warnSkipped(surface: string, method: string): void {
  console.warn(
    `[canvas-ade-mcp] ${surface} is NOT registered: the host Orchestrator does not implement ` +
      `${method}(). Forward ${method} from the host to expose it.`
  )
}
