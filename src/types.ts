/** Capability tier of a board's MCP session. */
export type Tier = 'orchestrator' | 'worker'

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
