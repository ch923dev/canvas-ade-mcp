/** The single MCP endpoint path. */
export const MCP_PATH = '/mcp'

/** Session-id header (MCP spec; routing only — authority is the bearer token). */
export const HEADER_SESSION_ID = 'mcp-session-id'

/** Phase 0 proof tools. */
export const TOOL_PING = 'ping'
export const TOOL_ORCHESTRATOR_PING = 'orchestrator_ping'

/** Phase 3 lifecycle tools (write path). Orchestrator-tier only. */
export const TOOL_SPAWN_BOARD = 'spawn_board'

/**
 * Board types an orchestrator may spawn (T3.1). A closed allowlist — spawn is a
 * WRITE, so an unknown/forward type is rejected, never forwarded to the host.
 * (Read surfaces like `canvas://boards` keep `type` an open string for forward
 * compatibility; the write path is deliberately stricter.)
 */
export const SPAWNABLE_BOARD_TYPES = ['terminal', 'browser', 'planning'] as const

/**
 * Hard cap on the chars returned by ONE `canvas://board/{id}/output` page (T1.4 🔒).
 * The MCP output budget is ~25k; we never emit a larger page even if the host
 * over-returns. MUST match the app accessor's page size (`MAX_OUTPUT_PAGE` in
 * `src/main/ptyOutput.ts`) so the tail-anchored cursor math lines up across the
 * two repos. Unit = UTF-16 code units (JS `String.length`), matching the host ring.
 */
export const MAX_OUTPUT_PAGE = 25_000
