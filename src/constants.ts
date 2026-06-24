/** The single MCP endpoint path. */
export const MCP_PATH = '/mcp'

/** Session-id header (MCP spec; routing only — authority is the bearer token). */
export const HEADER_SESSION_ID = 'mcp-session-id'

/** Phase 0 proof tools. */
export const TOOL_PING = 'ping'
export const TOOL_ORCHESTRATOR_PING = 'orchestrator_ping'

/** Phase 3 lifecycle tools (write path). Orchestrator-tier only. */
export const TOOL_SPAWN_BOARD = 'spawn_board'
export const TOOL_CLOSE_BOARD = 'close_board'
export const TOOL_CONFIGURE_BOARD = 'configure_board'

/** Phase 4 dispatch tools (write into another board's PTY). Orchestrator-tier only. */
export const TOOL_HANDOFF_PROMPT = 'handoff_prompt'
export const TOOL_ASSIGN_PROMPT = 'assign_prompt'
export const TOOL_INTERRUPT = 'interrupt'
export const TOOL_RELAY_PROMPT = 'relay_prompt'

/**
 * Phase 4 worker-tier WRITE tool (T4.4) — the FIRST tool a worker may call to mutate
 * state: a worker records its OWN board's structured result. Registered for BOTH tiers
 * and bound to the caller's `ctx.boardId` (a worker can't forge another board's result).
 */
export const TOOL_WRITE_RESULT = 'write_result'

/**
 * Protocol-layer caps for `write_result` (C3 / BUG-009). MIRROR the host's belt-and-suspenders
 * clamps (`mcpOrchestrator.ts` `WRITE_RESULT_MAX_*`) so an oversized payload is rejected by the
 * Zod schema at the wire BEFORE it reaches the orchestrator — the MAIN clamps stay as
 * defense-in-depth (both layers must agree independently). summary is a one-line human note;
 * refs is a bounded list of short reference strings (file paths / PR URLs), not raw logs.
 */
export const WRITE_RESULT_MAX_SUMMARY = 100_000
export const WRITE_RESULT_MAX_REFS = 256
export const WRITE_RESULT_MAX_REF_LEN = 256

/**
 * Feature-zone cluster spawn (C2-wire / PR-5c) — orchestrator-tier only. Spawns a terminal board
 * (always) plus an optional planning + browser member, grouped under a Named Group, in ONE
 * cap-checked step. Content-less (empty boards on spawn), so it is NOT human-gated — the gate
 * stays on content writes (handoff/assign/relay/add_planning_elements). Orchestrator-tier bounds
 * swarm growth: a connected agent must not grow the topology without the orchestrator's awareness.
 */
export const TOOL_SPAWN_GROUP = 'spawn_group'

/**
 * Caps for one `spawn_group` call. `SPAWN_GROUP_MAX_NAME` mirrors the host's `SPAWN_GROUP_MAX_NAME`
 * (`mcpLifecycle.ts`); `SPAWN_GROUP_MAX_LAUNCH` mirrors the host's 400-char launchCommand clamp.
 * The host re-sanitizes + re-clamps authoritatively (the launchCommand is an exec vector) — these
 * are the wire-level guard so a malformed payload is rejected before the host is called.
 */
export const SPAWN_GROUP_MAX_NAME = 80
export const SPAWN_GROUP_MAX_LAUNCH = 400

/**
 * Read-only working-tree diff for a terminal board (PR-2b). Orchestrator-tier: the
 * orchestrator collects each worker's diff to roll up "what changed" in the result/recap
 * zones — a worker must NOT read another board's diff (cross-worker info leak), so it is
 * registered ONLY for the orchestrator tier. Content-less write surface: the only input is
 * the target board id; the host resolves that opaque id to the board's own resolved spawn
 * cwd and runs `git diff` read-only there (never a caller-supplied path). The returned diff
 * is bounded by the host (100 KB) — this tool is the thin transport.
 */
export const TOOL_GIT_DIFF = 'git_diff'

/**
 * Planning-board content WRITE tool (S2) — orchestrator-tier, **flag-gated** (registered
 * only when the host enables `planningWrite`). It writes attacker-influenceable CONTENT
 * onto the durable canvas (the first such MCP path, ADR 0003), so the HOST gates it behind
 * a mandatory write-time human confirm that shows the full rendered content, plus
 * validate/sanitize/cap. The agent-emitted content is untrusted passive context: it
 * renders, but never auto-arms an action.
 */
export const TOOL_ADD_PLANNING_ELEMENTS = 'add_planning_elements'

/**
 * Transport-layer caps for one `add_planning_elements` call (defence in depth — the HOST
 * re-validates + re-caps authoritatively). Kept generous but bounded so a single call can
 * never balloon the canvas document. A `checklist` is one element carrying up to
 * {@link MAX_PLANNING_ITEMS} items.
 */
export const MAX_PLANNING_ELEMENTS_PER_CALL = 50
export const MAX_PLANNING_ITEMS = 100
/** Max chars for free-text fields (note/text body); titles/labels are capped shorter. */
export const MAX_PLANNING_TEXT = 4000
export const MAX_PLANNING_TITLE = 200
export const MAX_PLANNING_LABEL = 500
/** Max chars for a `diagram` element's Mermaid source (kept reviewable in the confirm modal). */
export const MAX_PLANNING_DIAGRAM = 4000
/**
 * Max chars for an element's optional `section` tag (2a) — a short column label the host groups
 * by. Single-line; the host re-sanitizes + re-caps. Kept tiny: a section is a heading, not prose.
 */
export const MAX_PLANNING_SECTION = 60

/**
 * Board types an orchestrator may spawn (T3.1). A closed allowlist — spawn is a
 * WRITE, so an unknown/forward type is rejected, never forwarded to the host.
 * (Read surfaces like `canvas://boards` keep `type` an open string for forward
 * compatibility; the write path is deliberately stricter.)
 */
export const SPAWNABLE_BOARD_TYPES = ['terminal', 'browser', 'planning'] as const

/**
 * Max chars for an optional `spawn_board` title (2b) — the agent-chosen display name the new
 * board carries instead of the per-type default ('Terminal'/'Planning'/…). Mirrors the host's
 * `SPAWN_BOARD_MAX_TITLE` clamp (`mcpLifecycle.ts`); kept at the same 80 as
 * {@link SPAWN_GROUP_MAX_NAME} (both are short canvas-chrome labels). The host re-sanitizes +
 * re-clamps authoritatively — this is the wire-level guard so an over-long title is rejected
 * before the host is called.
 */
export const SPAWN_BOARD_MAX_TITLE = 80

/**
 * Hard cap on the chars returned by ONE `canvas://board/{id}/output` page (T1.4 🔒).
 * The MCP output budget is ~25k; we never emit a larger page even if the host
 * over-returns. MUST match the app accessor's page size (`MAX_OUTPUT_PAGE` in
 * `src/main/ptyOutput.ts`) so the tail-anchored cursor math lines up across the
 * two repos. Unit = UTF-16 code units (JS `String.length`), matching the host ring.
 */
export const MAX_OUTPUT_PAGE = 25_000

/**
 * Phase 5 (M5) BARRIER tools — orchestrator-tier blocking waits over the host status
 * stream. READ-ONLY (no PTY write / human confirm / audit — those are for dispatch tools).
 */
export const TOOL_WAIT_FOR_IDLE = 'wait_for_idle'
export const TOOL_WAIT_FOR_ALL = 'wait_for_all'

/**
 * Default backstop deadline for a barrier wait (30 min) when the tool's `timeoutMs` is
 * omitted. Env-tunable via `CANVAS_ADE_BARRIER_TIMEOUT_MS` (finite, > 0, else ignored).
 * A per-call `timeoutMs` ≤ 0 or non-finite opts out entirely (mirrors the mcpConfirm
 * 10-min backstop convention — settle-and-report never throws on expiry).
 */
export const DEFAULT_BARRIER_TIMEOUT_MS = 30 * 60_000
