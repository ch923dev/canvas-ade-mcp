import type { BoardId } from '../types'

/** Minimal board projection exposed to agents. */
export interface BoardSummary {
  id: BoardId
  /** Board type — 'terminal' | 'browser' | 'planning' (open string for forward types). */
  type: string
  /** User-facing board title (trusted-user content; no page/whiteboard content). */
  title: string
  status: string
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
   * Change a board's durable config (T3.3) — shell / launchCommand / cwd. Only the
   * supplied fields change; the host filters to the board type's patchable keys.
   */
  configureBoard(boardId: BoardId, config: BoardConfig): Promise<void>
  dispatchPrompt(boardId: BoardId, text: string): Promise<void>
  /**
   * 🔒 Blocking hand-off (M4 T4.3): write `text` into the target terminal board's PTY,
   * wait until it goes idle, and return its structured last result. Orchestrator-tier
   * only. The host gates it behind a single-use nonce + a mandatory human confirm +
   * an audit entry, and rejects any non-terminal target (Browser/Planning content
   * never reaches a PTY). Resolves to the {@link BoardResult} the target produced.
   */
  handoffPrompt(boardId: BoardId, text: string): Promise<BoardResult>
  gitDiff(boardId: BoardId): Promise<string>
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
}
