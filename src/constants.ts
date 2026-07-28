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
 * BATCH relay dispatch tool (rc.8) — carry several `relay_prompt` dispatches in ONE call so the
 * host can surface them in ONE human-confirm modal (per-row approve). Orchestrator + connected
 * tiers, same tier-aware source binding as `relay_prompt`. Each item stays an INDEPENDENT
 * dispatch host-side (own cable check, own single-use nonce, own audit row) — the batch shares
 * only the human confirm, never widening one approval into N commands.
 */
export const TOOL_RELAY_PROMPTS = 'relay_prompts'

/**
 * Max dispatches in ONE `relay_prompts` call (transport-layer cap — the HOST re-validates + re-caps
 * authoritatively). Kept small: the batch exists to let a human review a handful of related
 * dispatches at once, not to fan out unbounded writes from a single approval gesture.
 */
export const MAX_RELAY_BATCH = 10

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
 * Planning-element UPDATE / REMOVE tools (S6) — orchestrator + connected tiers, **flag-gated** behind
 * the SAME `planningWrite` gate as `add_planning_elements` (all mutate content on the durable canvas,
 * ADR 0003). They close the append-only gap: an agent READS `canvas://board/{id}/planning` to learn
 * each element's id, then EDITS it in place (`update_planning_element`) or deletes it
 * (`remove_planning_element`) — instead of re-adding a fresh copy (which stacks stale duplicates). Each
 * op is gated by the HOST behind a mandatory write-time human confirm + validate/sanitize/cap. Passive
 * content — an edited element renders on the board, never auto-arms an action.
 */
export const TOOL_UPDATE_PLANNING_ELEMENT = 'update_planning_element'
export const TOOL_REMOVE_PLANNING_ELEMENT = 'remove_planning_element'

/**
 * Bound on an opaque planning element / checklist-item id an agent echoes back from the read resource
 * (matched verbatim host-side against the board's `elements[]`). Mirrors {@link MAX_CARD_ID}.
 */
export const MAX_PLANNING_ELEMENT_ID = 200

/**
 * Read-projection element-count cap for the `canvas://board/{id}/planning` resource (S6) — bound one
 * board's mirrored planning projection so a forged `mcp:boards` push can't grow MAIN memory. Mirrors the
 * host's `MAX_PLANNING_BOARD_ELEMENTS` accretion cap; the HOST enforces it authoritatively (the mirror
 * sanitize can't import this package — the P1b "host does NOT import a package it predates" lesson).
 */
export const MAX_PLANNING_READ_ELEMENTS = 300

/**
 * Structured-diagram (engine:'expanse') transport caps — diagram Phase 3 (MCP contract v2).
 * NAME-FOR-NAME mirrors of the HOST's authoritative caps in expanse-desktop
 * `src/renderer/src/lib/diagramSpec.ts` (the one source of truth for the 16 KB
 * confirm-reviewability premise). Exported from the package root so the host's cross-repo
 * parity test can assert the wire caps never drift laxer than the host's (the Kanban
 * MAX_CARD_* precedent). Defence in depth only: the host re-runs `assertDiagramSpec`
 * authoritatively, including referential integrity this layer does not check.
 */
export const SPEC_MAX_NODES = 200
export const SPEC_MAX_EDGES = 400
export const SPEC_MAX_GROUPS = 50
export const SPEC_ID_MAX = 64
export const SPEC_LABEL_MAX = 200
export const SPEC_DETAIL_MAX = 300
export const SPEC_EDGE_LABEL_MAX = 120
export const SPEC_TITLE_MAX = 200
export const SPEC_ICON_MAX = 64
export const SPEC_HREF_FILE_MAX = 256
export const SPEC_THEME_MAX = 64
/**
 * Total serialized-bytes bound for ONE DiagramSpec on the wire (JSON.stringify length) — the
 * host's confirm-reviewability premise: a spec must stay reviewable in the write-time confirm
 * modal. The host re-measures authoritatively.
 */
export const MAX_DIAGRAM_SPEC_BYTES = 16 * 1024
/**
 * Max `specOps` in ONE `update_planning_element` call. One batch = one human confirm = one undo
 * step, so the bound is a reviewability cap (one diff row per op in the confirm modal), not a
 * document cap — bulk restructuring beyond it should re-emit the element instead.
 */
export const MAX_SPEC_OPS = 100

/**
 * Kanban card WRITE tools (P3) — orchestrator + connected tiers, **flag-gated** behind the SAME
 * `planningWrite` gate as `add_planning_elements` (a Kanban board is a plan surface; both write
 * attacker-influenceable CONTENT onto the durable canvas, ADR 0003). Each op is gated by the HOST
 * behind a mandatory write-time human confirm + validate/sanitize/cap. `add_card` mints + returns the
 * card id (the agent addresses it thereafter); move/update/remove take that id. Passive content — a
 * card renders on the board, never auto-arms an action.
 */
export const TOOL_ADD_CARD = 'add_card'
export const TOOL_MOVE_CARD = 'move_card'
export const TOOL_UPDATE_CARD = 'update_card'
export const TOOL_REMOVE_CARD = 'remove_card'

/**
 * `publish_findings` (orchestration P4) — the END-OF-RUN batch sibling of `add_card`.
 *
 * `add_card` adds exactly ONE card and is human-confirmed, so publishing N worker findings the
 * obvious way costs N modals: a confirm storm at exactly the fan-out scale the orchestration layer
 * exists for. This tool composes all N into ONE per-row confirm and ONE canvas write.
 *
 * 🔒 It carries NO content — only a destination board and an optional lane. The host derives every
 * card from the `write_result` data it already holds, so a caller cannot author a finding no worker
 * reported.
 */
export const TOOL_PUBLISH_FINDINGS = 'publish_findings'

/**
 * Transport-layer caps for a Kanban card write (defence in depth — the HOST re-validates + re-caps
 * authoritatively). A card carries a short title + optional single-line chips (tag/assignee/ref); ids
 * are opaque strings the host mints (card) or a column slug the agent targets.
 */
export const MAX_CARD_TITLE = 200
export const MAX_CARD_TAG = 40
export const MAX_CARD_ASSIGNEE = 40
export const MAX_CARD_REF = 80
export const MAX_CARD_ID = 200
export const MAX_COLUMN_ID = 200

/**
 * Transport caps for the v19 card-DETAIL fields (agent read/write of the fields the #345 human UI
 * added). `description` is a long-form MULTI-LINE plain-text body (unlike the single-line chips), so
 * it caps generously; `tags` is the plural label list that supersedes the singular `tag` (each entry
 * reuses {@link MAX_CARD_TAG}); `fileRefs` is a bounded list of `{path, line?, endLine?}` pointers a
 * card touches (line/endLine are positive integers; path reuses a length cap). Defence in depth — the
 * HOST (`mcpKanban.ts`) re-validates + re-caps authoritatively.
 */
export const MAX_CARD_DESCRIPTION = 4000
export const MAX_CARD_TAGS = 20
export const MAX_CARD_FILE_REFS = 50
// MUST equal the host authority (`mcpKanban.ts` MAX_CARD_FILE_REF_PATH = 256), which is itself ≤ the
// renderer→MAIN mirror-ingest cap: a path the wire accepts here has to survive the host re-validate AND
// the mirror round-trip, else a 257+-char path would ack `true` on the wire, get rejected by the host,
// and the agent burns a round-trip on a payload the transport told it was fine. Defence-in-depth requires
// the wire and host agree (not that the wire is laxer); the mirror cap is larger so human-authored real
// paths also round-trip, but AGENT content stays bounded at 256.
export const MAX_CARD_FILE_REF_PATH = 256

/**
 * The two-value COLUMN AXIS a kanban board declares (v19) — what its lanes group BY: `'flow'` =
 * ordered workflow stages a card progresses through (the classic kanban); `'category'` = unordered
 * buckets a card belongs to (subsystem/phase/owner). Set via `configure_board`. A closed enum — an
 * off-value is rejected at the Zod layer; the host also re-validates + falls back to `'flow'`.
 */
export const KANBAN_COLUMN_AXES = ['flow', 'category'] as const

/**
 * Max chars for a kanban board's `axisLabel` (v19) — the display name of the column axis (a short
 * single-line caption/field label, e.g. "Phase" / "Subsystem" / "Sprint"). Renderable content, so the
 * host collapses it to a single line + caps it authoritatively; this is the wire-level guard.
 */
export const MAX_AXIS_LABEL = 60

/**
 * Read-projection count caps for the `canvas://board/{id}/cards` resource (P3b) — bound one board's
 * mirrored kanban projection so a forged `mcp:boards` push can't grow MAIN memory. The card FIELD
 * caps reuse `MAX_CARD_*` above. The HOST (`boardRegistry.ts`) keeps its OWN local copies of these
 * numbers — the mirror sanitize can't import this package (it predates the installed version; the
 * P1b "host does NOT import from an installed package it predates" lesson) — so these are the shared
 * contract value, enforced authoritatively host-side.
 */
export const MAX_KANBAN_COLUMNS = 50
export const MAX_KANBAN_CARDS = 300

/**
 * Plan-visualization WRITE tool (P5) — orchestrator + connected tiers, **flag-gated** behind the SAME
 * `planningWrite` gate as `add_planning_elements` / the Kanban card tools (all three write
 * attacker-influenceable CONTENT onto the durable canvas, ADR 0003). The agent hands a flat plan (a
 * list of items) + a SUGGESTED shape; the HOST surfaces the upgraded human-confirm gate as a layout
 * CHOOSER (kanban / grid / checklist / columns), and on approval materializes a NEW board in the shape
 * the human picked, tidied into open canvas space. The host mints + returns the board id. Passive
 * content — the board renders, never auto-arms an action ("this only draws").
 */
export const TOOL_VISUALIZE_PLAN = 'visualize_plan'

/** The layout shapes `visualize_plan` may render a plan into (the confirm-gate chooser options). */
export const VISUALIZATIONS = ['kanban', 'grid', 'checklist', 'columns'] as const

/**
 * Transport-layer caps for one `visualize_plan` call (defence in depth — the HOST re-validates +
 * re-caps + sanitizes authoritatively before the confirm gate). A plan item carries a short title +
 * optional single-line status/tag/assignee chips + an optional multi-line note; `status` groups items
 * into kanban columns / `columns` sections. `MAX_PLAN_TITLE` bounds the new board's display name.
 */
export const MAX_PLAN_ITEMS = 100
export const MAX_PLAN_ITEM_TITLE = 200
export const MAX_PLAN_ITEM_STATUS = 60
export const MAX_PLAN_ITEM_TAG = 40
export const MAX_PLAN_ITEM_ASSIGNEE = 40
export const MAX_PLAN_ITEM_NOTE = 2000
export const MAX_PLAN_TITLE = 200

/**
 * Canvas TIDY tool (P2) — orchestrator-tier only, UN-GATED. Repositions the whole canvas into a
 * clean, non-overlapping arrangement via the app's already-built deterministic packer (`tidyLayout`
 * + `canvasStore.tidyBoards`). Content-less (it only moves boards that already exist — never resizes,
 * creates, or deletes one) and fully reversible in ONE Ctrl+Z, so — like `spawn_group` — it carries
 * no exec vector and is NOT human-gated (the write-time confirm stays on content writes). Orchestrator-
 * tier: rearranging everyone's boards is an orchestrator-scope act, not a single connected worker's.
 */
export const TOOL_TIDY_CANVAS = 'tidy_canvas'

/**
 * The tidy MODES an agent may pick — 1:1 with the app's `TidyMode`: `smart` (link-aware, the default),
 * `by-type` (terminals | browsers | planning columns), `grid` (shelf bin-pack). This IS the
 * "orientation" the epic folded into "a mode the agent picks". An off-enum value is rejected at the
 * Zod layer; the host applier also re-validates and falls back to `smart` (defence in depth).
 */
export const TIDY_MODES = ['smart', 'by-type', 'grid'] as const

/**
 * Camera FOCUS tool (H1 / Lane H) — orchestrator-tier only, UN-GATED. Moves the user's VIEWPORT
 * (never a board): fit the camera to one board, one Named Group, or the whole canvas, via the
 * host's existing renderer camera verbs (`focusBoardById` / `fitGroup` / `fitAll`). Content-less +
 * viewport-only — it repositions nothing and is trivially reversible by scrolling — so, like
 * `tidy_canvas`, it is NOT human-gated. Orchestrator-tier: yanking the user's camera is an
 * app-level helper act (the Jarvis/command-board scope), not a connected worker's.
 */
export const TOOL_FOCUS_VIEWPORT = 'focus_viewport'

/**
 * Bound on the opaque board/group id `focus_viewport` echoes back from a read resource
 * (`canvas://boards` / `canvas://layout`), matched host-side. Mirrors {@link MAX_PLANNING_ELEMENT_ID}.
 */
export const MAX_FOCUS_TARGET_ID = 200

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
 * Max chars for an optional `spawn_board` prompt (rc.6) — the single command line the new
 * TERMINAL runs as its first PTY line. Mirrors the host's shared 400-char spawn-time
 * launchCommand clamp (`mcpLifecycle.ts` SPAWN_LAUNCH_MAX, the same rule `spawn_group` pays);
 * the host re-sanitizes + re-clamps authoritatively — this is the wire-level guard so an
 * over-long prompt is rejected before the host is called.
 */
export const SPAWN_BOARD_MAX_PROMPT = 400

/**
 * Max chars for an optional `spawn_board` url (H3 / Lane H) — the initial page a new BROWSER
 * board loads instead of the host's default. http/https only, enforced at the wire AND
 * re-validated authoritatively by the host (the preview URL bar's own validation applies).
 * 2048 tracks the practical browser URL ceiling.
 */
export const SPAWN_BOARD_MAX_URL = 2048

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
