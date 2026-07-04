import type { BoardId } from '../types'
import type {
  BoardConfig,
  BoardOutput,
  BoardResult,
  BoardResultInput,
  BoardStatusChange,
  BoardSummary,
  KanbanCardPatch,
  KanbanCardSpec,
  MemoryDoc,
  Orchestrator,
  PlanningElementPatch,
  PlanningElementsSpec,
  SpawnGroupInput,
  SpawnGroupResult,
  VisualizePlanSpec
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
    sourceBoardId?: BoardId
  }): Promise<{ id: BoardId }> {
    return { id: 'mock-board' }
  }

  async closeBoard(_boardId: BoardId): Promise<void> {}

  async addPlanningElements(_boardId: BoardId, _spec: PlanningElementsSpec): Promise<void> {}

  async updatePlanningElement(
    _boardId: BoardId,
    _elementId: string,
    _patch: PlanningElementPatch
  ): Promise<void> {}

  async removePlanningElement(_boardId: BoardId, _elementId: string): Promise<void> {}

  async addCard(_boardId: BoardId, _spec: KanbanCardSpec): Promise<{ id: BoardId }> {
    return { id: 'mock-card' }
  }

  async moveCard(_boardId: BoardId, _cardId: BoardId, _toColumnId: string): Promise<void> {}

  async updateCard(_boardId: BoardId, _cardId: BoardId, _patch: KanbanCardPatch): Promise<void> {}

  async removeCard(_boardId: BoardId, _cardId: BoardId): Promise<void> {}

  async visualizePlan(_spec: VisualizePlanSpec): Promise<{ id: BoardId }> {
    return { id: 'mock-board' }
  }

  async configureBoard(_boardId: BoardId, _config: BoardConfig): Promise<void> {}

  async dispatchPrompt(
    _boardId: BoardId,
    _text: string
  ): Promise<{ delivery: 'ready' | 'unconfirmed' } | void> {}

  async writeResult(_boardId: BoardId, _result: BoardResultInput): Promise<void> {}

  async interrupt(_boardId: BoardId): Promise<void> {}

  async relayPrompt(
    _sourceId: BoardId,
    _targetId: BoardId,
    _text: string
  ): Promise<{ delivery: 'ready' | 'unconfirmed' } | void> {}

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

  async describeLayout(): Promise<unknown> {
    // A minimal LayoutDigest-shaped object — enough for the resource read contract to assert the
    // top-level key set ({ version, count, bbox, boards, overlaps, arrangement }). The host's real
    // describeLayout injects the live geometry + runs buildLayoutDigest.
    return { version: 1, count: 0, bbox: null, boards: [], overlaps: [], arrangement: 'empty' }
  }

  async spawnGroup(input: SpawnGroupInput): Promise<SpawnGroupResult> {
    return {
      groupId: 'mock-group',
      terminalId: 'mock-terminal',
      ...(input.planning ? { planningId: 'mock-planning' } : {}),
      ...(input.browser ? { browserId: 'mock-browser' } : {})
    }
  }

  async tidyCanvas(_input: { mode?: string }): Promise<unknown> {
    // A minimal { moved } fixture — enough for the tool call contract to round-trip. The host's real
    // tidyCanvas forwards a `tidyBoards` command to the renderer packer and returns the moved count.
    return { moved: 0 }
  }

  async boardStatus(_boardId: BoardId): Promise<string> {
    return 'idle'
  }

  async boardCards(boardId: BoardId): Promise<unknown> {
    // A minimal BoardCards-shaped fixture (a kanban board with one lane + one card) — enough for the
    // resource read contract to assert the grouped shape. The host's real boardCards groups the live
    // mirror; a non-kanban board would read `{ …, isKanban: false, columns: [] }`.
    return {
      boardId,
      title: 'Mock kanban',
      isKanban: true,
      columns: [{ id: 'backlog', title: 'Backlog', wip: null, cards: [{ id: 'c1', title: 'One' }] }]
    }
  }

  async boardPlanning(boardId: BoardId): Promise<unknown> {
    // A minimal BoardPlanning-shaped fixture (a planning board with one checklist carrying one item) —
    // enough for the resource read contract to assert the shape. The host's real boardPlanning projects
    // the live board elements; a non-planning board would read `{ …, isPlanning: false, elements: [] }`.
    return {
      boardId,
      title: 'Mock planning',
      isPlanning: true,
      elements: [
        {
          id: 'el-1',
          kind: 'checklist',
          title: 'Build progress',
          items: [{ id: 'it-1', label: 'Wire the read loop', done: false }]
        }
      ]
    }
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
