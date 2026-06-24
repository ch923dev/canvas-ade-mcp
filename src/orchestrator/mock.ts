import type { BoardId } from '../types'
import type {
  BoardConfig,
  BoardOutput,
  BoardResult,
  BoardResultInput,
  BoardStatusChange,
  BoardSummary,
  MemoryDoc,
  Orchestrator,
  PlanningElementsSpec,
  SpawnGroupInput,
  SpawnGroupResult
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
    title?: string
  }): Promise<{ id: BoardId }> {
    return { id: 'mock-board' }
  }

  async closeBoard(_boardId: BoardId): Promise<void> {}

  async addPlanningElements(_boardId: BoardId, _spec: PlanningElementsSpec): Promise<void> {}

  async configureBoard(_boardId: BoardId, _config: BoardConfig): Promise<void> {}

  async dispatchPrompt(_boardId: BoardId, _text: string): Promise<void> {}

  async writeResult(_boardId: BoardId, _result: BoardResultInput): Promise<void> {}

  async interrupt(_boardId: BoardId): Promise<void> {}

  async relayPrompt(_sourceId: BoardId, _targetId: BoardId, _text: string): Promise<void> {}

  async handoffPrompt(_boardId: BoardId, _text: string): Promise<BoardResult> {
    return { present: false }
  }

  async gitDiff(_boardId: BoardId): Promise<string> {
    return ''
  }

  async describeApp(): Promise<unknown> {
    // A minimal AppModel-shaped object — enough for the resource read contract to assert the
    // top-level key set ({ version, boardTypes, tools, canvas, rules }). The host's real
    // describeApp injects the live canvas + the full tool catalog.
    return {
      version: 1,
      boardTypes: [],
      tools: [{ name: 'spawn_group', purpose: 'spawn a feature zone', tier: 'orchestrator' }],
      canvas: { boards: [], connectors: [], groups: [] },
      rules: { spawnCap: 8, everyWriteGated: true, idleTtlMs: 0, idleActivityMs: 0 }
    }
  }

  async spawnGroup(input: SpawnGroupInput): Promise<SpawnGroupResult> {
    return {
      groupId: 'mock-group',
      terminalId: 'mock-terminal',
      ...(input.planning ? { planningId: 'mock-planning' } : {}),
      ...(input.browser ? { browserId: 'mock-browser' } : {})
    }
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

  /** @internal subscribers for the M5 status stream. */
  private readonly statusListeners = new Set<(change: BoardStatusChange) => void>()

  subscribeStatus(listener: (change: BoardStatusChange) => void): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  /** Test seam: drive a status change through the subscription fan-out. */
  __emitStatus(change: BoardStatusChange): void {
    for (const cb of this.statusListeners) {
      try {
        cb(change)
      } catch {
        // isolate a throwing listener (same discipline as the app-side fan-out)
      }
    }
  }
}
