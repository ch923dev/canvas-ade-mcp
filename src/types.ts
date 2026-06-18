/**
 * Capability tier of a board's MCP session.
 *
 * - `orchestrator` — the in-process command board (`'app'`); drives every dispatch/lifecycle tool.
 * - `worker` — a spawned board reporting its own result (read + `write_result` only).
 * - `connected` — a CONSENTED Terminal board the user is talking to (Agent Orchestration v1):
 *   may `relay_prompt` along its OWN outgoing orchestration cables, and `spawn_board` /
 *   `configure_board` / `add_planning_elements` on the canvas — each still ConfirmModal-gated
 *   host-side. Stricter than the `'app'` orchestrator: relay is scoped to the caller's own board
 *   as source (the cable graph authorizes the target). See the Agent Orchestration umbrella.
 */
export type Tier = 'orchestrator' | 'worker' | 'connected'

/** A coarse permission scope string (refined in later phases). */
export type Scope = string

/** Opaque server-issued board id. */
export type BoardId = string

/** A row in the per-board token store: what a minted bearer token grants. */
export interface AuthRow {
  boardId: BoardId
  tier: Tier
  scopes: Scope[]
  /** Seconds since epoch. Set to board lifetime so long agent runs don't expire. */
  expiresAt?: number
}
