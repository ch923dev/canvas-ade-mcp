import { z } from 'zod'
import type { BoardId } from '../../types'
import type { SessionCtx } from '../factory'
import { GROUP_NAME_MAX, MAX_FOCUS_TARGET_ID, MAX_GROUP_MEMBERS } from '../../constants'
import { CanvasToolError } from '../toolErrors'

/**
 * Shared pieces of the C6 spatial surface (`tidy_canvas`, `focus_viewport`, `group_boards`,
 * `edit_groups`, `canvas://contexts`) — one definition of the caller binding, the id/name schemas and
 * the warn-on-skip, so the four tools cannot drift apart. The caller binding is also the one
 * `spawn_board` / `spawn_group` / `visualize_plan` use.
 */

/**
 * 🔒 The D1 caller binding: a LEAD or CONNECTED caller's token-derived board id, returned as a
 * spreadable `{ sourceBoardId }` (never client input — the input schemas carry no such field, so a
 * forged one is stripped by Zod before the handler runs). The host raises its human confirm when the
 * field is present. ORCHESTRATOR-tier calls spread nothing and stay un-gated host-side.
 *
 * Fails CLOSED (0.27.1): a lead/connected session whose token carried no board id (`ctxFromAuth`
 * falls back to `''`) THROWS `unauthorized` — the `write_result` rule. Spreading nothing instead would
 * make the host read the call as an un-gated orchestrator call. `tool` prefixes the message. Call it
 * before any host method runs, so a refused call never reaches the host.
 */
export function callerSource(
  ctx: SessionCtx | undefined,
  tool: string
): { sourceBoardId?: BoardId } {
  if (ctx?.tier !== 'connected' && ctx?.tier !== 'lead') return {}
  if (!ctx.boardId) {
    throw new CanvasToolError('unauthorized', `${tool}: no board bound to this session`)
  }
  return { sourceBoardId: ctx.boardId }
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

/** The surfaces {@link warnSkipped} has already warned about in THIS process. */
const warnedSurfaces = new Set<string>()

/**
 * 🔒 Warn-on-skip (the `publish_findings` lesson, C6). An optional Orchestrator method that the host
 * forgot to forward makes its tool / resource silently vanish from `tools/list`. Each optional
 * `register*` calls this when it skips. It warns ONCE PER PROCESS PER SURFACE (0.27.1): `register*`
 * runs on every `getServer` — every MCP session — so a per-build warning repeated three lines per
 * terminal session on an unwired host. One line is still loud enough that a host which never wired
 * the method sees it in its log.
 */
export function warnSkipped(surface: string, method: string): void {
  if (warnedSurfaces.has(surface)) return
  warnedSurfaces.add(surface)
  console.warn(
    `[canvas-ade-mcp] ${surface} is NOT registered: the host Orchestrator does not implement ` +
      `${method}(). Forward ${method} from the host to expose it.`
  )
}

/** Test seam: forget every surface {@link warnSkipped} has warned about. Not a package export. */
export function resetWarnSkipped(): void {
  warnedSurfaces.clear()
}
