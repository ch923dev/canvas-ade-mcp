import type { BoardId } from '../types'
import type {
  BoardConfig,
  BoardOutput,
  BoardResult,
  BoardResultInput,
  BoardSummary,
  MemoryDoc,
  Orchestrator
} from './Orchestrator'

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

  async closeBoard(_boardId: BoardId): Promise<void> {}

  async configureBoard(_boardId: BoardId, _config: BoardConfig): Promise<void> {}

  async dispatchPrompt(_boardId: BoardId, _text: string): Promise<void> {}

  async writeResult(_boardId: BoardId, _result: BoardResultInput): Promise<void> {}

  async handoffPrompt(_boardId: BoardId, _text: string): Promise<BoardResult> {
    return { present: false }
  }

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

  async projectMemory(): Promise<MemoryDoc> {
    return { present: false, text: '' }
  }

  async boardSummary(_boardId: BoardId): Promise<MemoryDoc> {
    return { present: false, text: '' }
  }
}
