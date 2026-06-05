import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardId } from '../../src/types'
import type {
  BoardResult,
  BoardStatusChange,
  BoardSummary
} from '../../src/orchestrator/Orchestrator'

/**
 * A controllable orchestrator for barrier/notifier tests: a settable board snapshot +
 * recorded results, and an `emit()` that updates the snapshot AND fans the change out to
 * `subscribeStatus` listeners (so a level-trigger initial read and the live stream agree).
 */
export class EmittingOrchestrator extends MockOrchestrator {
  boards: BoardSummary[] = []
  private readonly results = new Map<string, BoardResult>()

  override async listBoards(): Promise<BoardSummary[]> {
    return this.boards
  }

  override async boardResult(id: BoardId): Promise<BoardResult> {
    return this.results.get(id) ?? { present: false }
  }

  setResult(id: string, result: BoardResult): void {
    this.results.set(id, result)
  }

  /** Drive a status change: reconcile the snapshot, then fan out via __emitStatus. */
  emit(change: BoardStatusChange): void {
    if (change.status === 'gone') {
      this.boards = this.boards.filter((b) => b.id !== change.id)
    } else {
      const existing = this.boards.find((b) => b.id === change.id)
      if (existing) existing.status = change.status
      else
        this.boards.push({
          id: change.id,
          type: 'terminal',
          title: change.id,
          status: change.status
        })
    }
    if (change.result) this.results.set(change.id, change.result)
    this.__emitStatus(change)
  }
}
