import type { BoardId } from '../types'

/** Minimal board projection exposed to agents. */
export interface BoardSummary {
  id: BoardId
  /** Board type — 'terminal' | 'browser' | 'planning' (open string for forward types). */
  type: string
  /** User-facing board title (trusted-user content; no page/whiteboard content). */
  title: string
  status: string
  /**
   * Terminal agent-preset id the human chose in the New Terminal dialog (`'claude'`,
   * `'codex'`, …) so an orchestrator can route by capability. Open string (forward
   * presets allowed); absent on non-terminal boards and on terminals predating the
   * preset dialog (app schema v10).
   */
  agentKind?: string
  /**
   * Whether this terminal participates in activity monitoring. Absent ⇒ monitored
   * (opt-out, not opt-in). `false` keeps a plain shell out of the {@link selectAttention}
   * queue and the attention notifier — it never nags the orchestrator about a shell that
   * isn't an agent.
   */
  monitorActivity?: boolean
}

/**
 * One capped, tail-anchored page of a board's plain-text scrollback (T1.4). The
 * host strips ANSI escape codes server-side (control-sequence injection surface)
 * and slices the last `MAX_OUTPUT_PAGE` chars; older content is reached by passing
 * the returned `nextCursor` back as the next read's cursor. NEVER the raw ring.
 */
export interface BoardOutput {
  /** ANSI-stripped scrollback for this page, in chronological order. */
  text: string
  /** Total chars currently available (the full clean ring length). */
  total: number
  /** Chars in this page (`text.length`; always ≤ `MAX_OUTPUT_PAGE`). */
  returned: number
  /**
   * Tail-anchored cursor (chars-from-end already consumed) for the NEXT, OLDER
   * page; absent once the oldest available char has been returned.
   */
  nextCursor?: number
  /**
   * True when older output has been discarded by the host's capped ring (honest
   * truncation — the buffer was saturated, so the head is gone for good).
   */
  droppedOlder: boolean
}

/**
 * A board's structured last result (T1.5) — references and a verdict, NOT raw logs
 * (raw scrollback is `BoardOutput`). v1 is an observational shell: until M4's
 * `write_result` tool lets a worker record one, every board reads `{ present: false }`.
 * Designed so M4 fills the optional fields without changing the contract.
 */
export interface BoardResult {
  /** Whether a result has been recorded for this board (false until M4 writes one). */
  present: boolean
  /** Verdict of the last completed task, e.g. 'success' | 'failure' (open string). */
  status?: string
  /** One-line human summary (references, not raw logs). */
  summary?: string
  /** Structured references the worker produced — file paths, PR/issue URLs, etc. */
  refs?: string[]
  /** ISO-8601 timestamp when the result was recorded. */
  at?: string
}

/**
 * A coarse per-board status change (M5 event-driven attention). `status` is a status
 * bucket value (`idle`/`running`/`awaiting-review`/`blocked`/`failed`/`static`) or
 * `'gone'` when the board left the canvas. `result` is attached by the host when the
 * board settles to `idle` and a `write_result` exists (so a barrier can return it).
 */
export interface BoardStatusChange {
  id: BoardId
  status: string
  result?: BoardResult
  /**
   * Whether the changed board participates in activity monitoring (mirror of
   * {@link BoardSummary.monitorActivity}; absent ⇒ monitored). The attention notifier
   * gates membership on this so a `monitorActivity:false` board entering an attention
   * bucket raises no `resources/updated` push. The host re-emits a change when this flag
   * flips so a mid-session opt-out/opt-in still pushes the corresponding leave/enter.
   */
  monitorActivity?: boolean
}

/**
 * The fields a worker may record for its OWN board via `write_result` (T4.4) — a verdict,
 * a one-line summary, and structured references (NOT raw logs). All optional. The host
 * stamps `present: true` + `at` and binds the board id to the caller's token, producing
 * the {@link BoardResult} the `canvas://board/{id}/result` resource then serves.
 */
export interface BoardResultInput {
  /** Verdict of the last completed task, e.g. 'success' | 'failure' (open string). */
  status?: string
  /** One-line human summary (references, not raw logs). */
  summary?: string
  /** Structured references the worker produced — file paths, PR/issue URLs, etc. */
  refs?: string[]
}

/**
 * A read-only slice of the project's persistent memory (T1.7) — the project index
 * (`canvas://memory`) or a per-board summary (`canvas://board/{id}/summary`). It is
 * produced by the sibling Brain/Memory engine's `.canvas/memory/`; 🔒 PASSIVE context
 * only — it grants no action. When that subsystem hasn't written anything (it ships on
 * a separate track), the doc is the empty shell `{ present: false, text: '' }` — the
 * resource gracefully empties, never errors.
 */
export interface MemoryDoc {
  /** Whether the memory engine has produced this document. */
  present: boolean
  /** The markdown content (empty when absent). */
  text: string
}

/**
 * Durable per-type config an orchestrator may change on a board (T3.3). All optional —
 * only the supplied fields are applied. Host-side, off-type/identity keys are dropped
 * (the canvas patch is filtered by the board's patchable keys), so this is the safe set.
 */
export interface BoardConfig {
  /** Terminal shell (Win: pwsh|powershell|cmd; *nix: $SHELL/zsh/bash). */
  shell?: string
  /** First PTY line written after the shell starts (the agentic CLI / command). */
  launchCommand?: string
  /** Working directory for the board. */
  cwd?: string
}

/** Note tints an agent may pick (mirrors the app's `NoteTint`; absent ⇒ host default). */
export type PlanningNoteTint = 'yellow' | 'blue' | 'green' | 'plain'

/**
 * One structured planning element an agent emits via `add_planning_elements` (S2) — CONTENT
 * only. The host mints ids, positions (stacked below existing content), and default sizes,
 * sanitizes every text field, and re-validates against the canvas schema before it lands.
 * Discriminated on `kind`: note · checklist · text · arrow (S2) · diagram (a Mermaid `source`
 * the host renders to a themed SVG in a sandboxed worker — requires host schema v11). 🔒
 * Untrusted passive content: it renders but never auto-arms an action.
 */
export type PlanningElementSpec =
  | { kind: 'note'; text: string; tint?: PlanningNoteTint }
  | { kind: 'checklist'; title: string; items: Array<{ label: string; done?: boolean }> }
  | { kind: 'text'; text: string }
  | { kind: 'arrow'; dx: number; dy: number }
  | { kind: 'diagram'; source: string }

/** The batch an agent writes to a planning board in one confirmed call. */
export interface PlanningElementsSpec {
  elements: PlanningElementSpec[]
}

/**
 * The members a {@link Orchestrator.spawnGroup} cluster may carry (terminal is always present).
 * STRUCTURAL MIRROR of the host's `SpawnGroupInput` (`src/main/mcpLifecycle.ts`) — the host owns the
 * authoritative validation; this is the wire shape the `spawn_group` tool forwards.
 */
export interface SpawnGroupInput {
  /** Display name for the Named Group over the cluster (host collapses whitespace + clamps). */
  name: string
  /** Add a Planning member to the zone (the decomposed-subtask checklist surface). */
  planning?: boolean
  /** Add a Browser member, pre-wired to the terminal via `previewSourceId`. */
  browser?: boolean
  /**
   * 🔒 Agentic CLI the terminal member boots as its FIRST PTY line (e.g. `claude`). This is an
   * EXEC VECTOR: the host sanitizes it to a single PTY-safe line (strips C0/DEL/C1, rejects
   * embedded CR/LF — F5/SPEC-W1-B) and clamps it before writing. Treat as trusted-user input.
   */
  launchCommand?: string
}

/** The minted ids a {@link Orchestrator.spawnGroup} returns so the orchestrator can address the zone. */
export interface SpawnGroupResult {
  groupId: BoardId
  terminalId: BoardId
  planningId?: BoardId
  browserId?: BoardId
}

/**
 * The canvas control surface injected by Canvas ADE MAIN. Phase 0 defines the
 * shape; tools wire to it in later phases. Keeping it an interface (with a mock)
 * lets canvas-ade-mcp build + test standalone, with no Electron dependency.
 */
export interface Orchestrator {
  listBoards(): Promise<BoardSummary[]>
  spawnBoard(input: { type: string; prompt?: string; cwd?: string }): Promise<{ id: BoardId }>
  /**
   * Close a board (T3.2). The host drains the board's PTY gracefully (not an abrupt
   * SIGKILL) before removing it from the canvas. Idempotent: closing an absent board
   * resolves. The dirty-worktree prompt arrives with Feature Workspaces (M6).
   */
  closeBoard(boardId: BoardId): Promise<void>
  /**
   * 🔒 Populate a PLANNING board with structured content — notes / checklists / text /
   * arrows (S2). Orchestrator-tier, flag-gated. The host validates + sanitizes + caps every
   * element, shows the FULL rendered content in a mandatory write-time human confirm, and
   * only on approval appends them to the board (via the command channel) as discrete,
   * undoable edits. Rejects a non-planning target. The content is untrusted passive context
   * — it renders, never auto-arms an action ("Run"-wiring is a separate, out-of-scope path).
   */
  addPlanningElements(boardId: BoardId, spec: PlanningElementsSpec): Promise<void>
  /**
   * Change a board's durable config (T3.3) — shell / launchCommand / cwd. Only the
   * supplied fields change; the host filters to the board type's patchable keys.
   */
  configureBoard(boardId: BoardId, config: BoardConfig): Promise<void>
  dispatchPrompt(boardId: BoardId, text: string): Promise<void>
  /**
   * 🔒 Record the calling worker's OWN board result (M4 T4.4, worker-tier WRITE). The
   * `boardId` is the caller's token-bound board (never client-supplied), so a worker can
   * only write its own result. Feeds the `canvas://board/{id}/result` resource (T1.5).
   */
  writeResult(boardId: BoardId, result: BoardResultInput): Promise<void>
  /**
   * 🔒 Interrupt the target terminal board (M4 T4.5) — send Ctrl-C (`\x03`) to its PTY to
   * stop a runaway/long-running command. Orchestrator-tier only. The host gates it behind
   * a single-use nonce + a mandatory human confirm + an audit entry, and rejects any
   * non-terminal target (Browser/Planning never reach a PTY). Content-less.
   */
  interrupt(boardId: BoardId): Promise<void>
  /**
   * 🔒 Agent-to-agent relay (M4 T4.6) — dispatch `text` from board `sourceId` to board
   * `targetId`, expressed by an ORCHESTRATION connector `sourceId → targetId` (the cable
   * is the route + intent). Orchestrator-tier only. The host validates the directed edge
   * exists and is **terminal → terminal** (never Browser → PTY), then gates the write
   * behind a single-use nonce + a mandatory human confirm + an audit entry. Fire-and-forget.
   */
  relayPrompt(sourceId: BoardId, targetId: BoardId, text: string): Promise<void>
  /**
   * 🔒 Blocking hand-off (M4 T4.3): write `text` into the target terminal board's PTY,
   * wait until it goes idle, and return its structured last result. Orchestrator-tier
   * only. The host gates it behind a single-use nonce + a mandatory human confirm +
   * an audit entry, and rejects any non-terminal target (Browser/Planning content
   * never reaches a PTY). Resolves to the {@link BoardResult} the target produced.
   */
  handoffPrompt(boardId: BoardId, text: string): Promise<BoardResult>
  gitDiff(boardId: BoardId): Promise<string>
  /**
   * Assemble the read-only app self-model (C1) — board types, the tool catalog, the live canvas
   * (boards/connectors/groups), and the orchestration rules — so an orchestrator agent can reason
   * over the actual app instead of a hardcoded recipe. Orchestrator-tier, read-only. Wraps the
   * host's `buildAppModel` over the loopback wire; serialized as JSON by the `canvas://app-model`
   * resource. Typed `unknown` here: the `AppModel` shape is host-owned (the package does not model
   * it) and the JSON serialization needs no compile-time dependency on it.
   */
  describeApp(): Promise<unknown>
  /**
   * 🔒 Spawn a feature-zone CLUSTER (C2-wire / PR-5c) — a terminal board (always) plus an optional
   * planning + browser member, grouped under a Named Group, in ONE cap-checked step. Orchestrator-
   * tier only (bounds swarm growth). Content-less (empty boards), so it is cap-checked, NOT human-
   * gated — the gate stays on content writes. The host mints + returns every member id. The
   * `launchCommand` is an exec vector the host sanitizes before the PTY write (F5/SPEC-W1-B).
   */
  spawnGroup(input: SpawnGroupInput): Promise<SpawnGroupResult>
  boardStatus(boardId: BoardId): Promise<string>
  /**
   * Read one capped page of a board's scrollback (T1.4, read-only). `cursor` is the
   * tail-anchored offset from a prior page's `nextCursor`; omit for the newest tail.
   */
  boardOutput(boardId: BoardId, opts?: { cursor?: number }): Promise<BoardOutput>
  /**
   * Read a board's structured last result (T1.5, read-only). Returns the empty shell
   * `{ present: false }` until a result has been recorded (M4 `write_result`).
   */
  boardResult(boardId: BoardId): Promise<BoardResult>
  /**
   * Read the project memory index (T1.7, 🔒 read-only passive context). Empty shell
   * when the memory engine is absent — graceful, never an error.
   */
  projectMemory(): Promise<MemoryDoc>
  /**
   * Read a board's memory summary (T1.7, 🔒 read-only passive context). Empty shell
   * when absent.
   */
  boardSummary(boardId: BoardId): Promise<MemoryDoc>
  /**
   * Subscribe to per-board coarse status changes (M5). MAIN forwards
   * `boardRegistry.ts`'s `subscribeBoardStatus`, attaching the last result when a board
   * settles to `idle`. Returns an unsubscribe fn. Barriers + the attention notifier wake
   * on this instead of polling. SYNCHRONOUS (returns the unsubscribe directly, not a Promise).
   */
  subscribeStatus(listener: (change: BoardStatusChange) => void): () => void
}
