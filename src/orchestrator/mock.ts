import type { BoardId } from '../types'
import type { BoardOutput, BoardResult, BoardSummary, Orchestrator } from './Orchestrator'

/** A no-op Orchestrator for contract tests and standalone runs. */
export class MockOrchestrator implements Orchestrator {
  async listBoards(): Promise<BoardSummary[]> {
    return []
  }

  async spawnBoard(_input: {
    type: string
    prompt?: string
    cwd?: string
  }): Promise<{ id: BoardId }> {
    return { id: 'mock-board' }
  }

  async dispatchPrompt(_boardId: BoardId, _text: string): Promise<void> {}

  async gitDiff(_boardId: BoardId): Promise<string> {
    return ''
  }

  async boardStatus(_boardId: BoardId): Promise<string> {
    return 'idle'
  }

  async boardOutput(_boardId: BoardId, _opts?: { cursor?: number }): Promise<BoardOutput> {
    return { text: '', total: 0, returned: 0, droppedOlder: false }
  }

  async boardResult(_boardId: BoardId): Promise<BoardResult> {
    return { present: false }
  }
}
