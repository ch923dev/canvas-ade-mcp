/** The single MCP endpoint path. */
export const MCP_PATH = '/mcp'

/** Session-id header (MCP spec; routing only — authority is the bearer token). */
export const HEADER_SESSION_ID = 'mcp-session-id'

/** Phase 0 proof tools. */
export const TOOL_PING = 'ping'
export const TOOL_ORCHESTRATOR_PING = 'orchestrator_ping'

/**
 * Hard cap on the chars returned by ONE `canvas://board/{id}/output` page (T1.4 🔒).
 * The MCP output budget is ~25k; we never emit a larger page even if the host
 * over-returns. MUST match the app accessor's page size (`MAX_OUTPUT_PAGE` in
 * `src/main/ptyOutput.ts`) so the tail-anchored cursor math lines up across the
 * two repos. Unit = UTF-16 code units (JS `String.length`), matching the host ring.
 */
export const MAX_OUTPUT_PAGE = 25_000
