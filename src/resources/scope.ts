import type { BoardSummary } from '../orchestrator/Orchestrator'
import type { BoardId, Tier } from '../types'

/**
 * 🔒 Read-scope for the board observation resources (audit Phase A, finding #1).
 *
 * A WORKER token is minted for exactly one spawned board, and its only write
 * (`write_result`) is already bound to that board. Its READS must be bound the same
 * way: a worker processing untrusted content can be prompt-injected into
 * `resources/read` on a sibling board and exfiltrate that board's raw scrollback /
 * results through its own context — the same cross-worker info leak that keeps
 * `git_diff` orchestrator-only. So a worker session reads ONLY its own board; the
 * board-list roll-ups (`canvas://boards`, `canvas://board-states`,
 * `canvas://attention`) are filtered to that board.
 *
 * `orchestrator` / `lead` / `connected` stay unrestricted: all three hold spawn +
 * dispatch caps (they may already write INTO arbitrary boards via the host-gated
 * dispatch path), so reading grants them nothing new — and the orchestration loop
 * (dispatch → observe → join) requires cross-board reads.
 *
 * A worker token with NO bound board (`boardId === ''`, the fail-closed
 * `ctxFromAuth` fallback) matches nothing: it reads empty lists and every per-board
 * read is refused.
 */
export interface ResourceScope {
  tier: Tier
  boardId: BoardId
}

/** True when `scope` may read board `id`. Non-worker tiers read everything. */
export function canReadBoard(scope: ResourceScope, id: string): boolean {
  return scope.tier !== 'worker' || (id !== '' && id === scope.boardId)
}

/**
 * Throw (→ an MCP resource-read error) when `scope` may not read board `id`.
 * `resourceLabel` names the resource in the error, mirroring the existing
 * "missing board id" throws in each handler.
 */
export function assertBoardReadable(scope: ResourceScope, id: string, resourceLabel: string): void {
  if (!canReadBoard(scope, id)) {
    throw new Error(`${resourceLabel}: forbidden — a worker session may only read its own board`)
  }
}

/** The board list a session may see: everything, or (worker) just its own board. */
export function scopeBoardList(scope: ResourceScope, boards: BoardSummary[]): BoardSummary[] {
  if (scope.tier !== 'worker') return boards
  return boards.filter((b) => b.id === scope.boardId && b.id !== '')
}
