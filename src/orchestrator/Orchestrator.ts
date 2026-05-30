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
}
