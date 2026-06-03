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
 * The canvas control surface injected by Canvas ADE MAIN. Phase 0 defines the
 * shape; tools wire to it in later phases. Keeping it an interface (with a mock)
 * lets canvas-ade-mcp build + test standalone, with no Electron dependency.
 */
export interface Orchestrator {
  listBoards(): Promise<BoardSummary[]>
  spawnBoard(input: { type: string; prompt?: string; cwd?: string }): Promise<{ id: BoardId }>
  dispatchPrompt(boardId: BoardId, text: string): Promise<void>
  gitDiff(boardId: BoardId): Promise<string>
  boardStatus(boardId: BoardId): Promise<string>
  /**
   * Read one capped page of a board's scrollback (T1.4, read-only). `cursor` is the
   * tail-anchored offset from a prior page's `nextCursor`; omit for the newest tail.
   */
  boardOutput(boardId: BoardId, opts?: { cursor?: number }): Promise<BoardOutput>
}
