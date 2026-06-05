import type { BoardResult, BoardStatusChange, Orchestrator } from '../orchestrator/Orchestrator'

/** One target's settled outcome. `status` is a bucket, `'gone'`, or `'timed-out'`. */
export interface BarrierBoardResult {
  id: string
  status: string
  result?: BoardResult
}

/** Settled = anything that is not actively `running`. */
const isSettled = (status: string): boolean => status !== 'running'

export interface BarrierHandle {
  promise: Promise<BarrierBoardResult[]>
  /** Force teardown (session close): unsubscribe + resolve unsettled targets as `gone`. */
  cancel: () => void
}

/**
 * Wait until every `targets` board has left `running`, event-driven off
 * `orchestrator.subscribeStatus` — never a poll. Level-triggered: an already-settled (or
 * absent → `gone`) target resolves on the initial read with no edge needed. On the backstop
 * deadline, unsettled targets resolve `timed-out` (the promise NEVER rejects — settle-and-report).
 * A `timeoutMs` ≤ 0 or non-finite opts out of the backstop. Output preserves `targets` order.
 */
export function waitForBoards(opts: {
  orchestrator: Pick<Orchestrator, 'listBoards' | 'subscribeStatus' | 'boardResult'>
  targets: string[]
  timeoutMs: number
}): BarrierHandle {
  const { orchestrator, targets, timeoutMs } = opts
  const order = targets.slice()
  const pending = new Set(targets)
  const settled = new Map<string, BarrierBoardResult>()
  let done = false
  let unsub: () => void = () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  let resolveFn!: (r: BarrierBoardResult[]) => void
  const promise = new Promise<BarrierBoardResult[]>((resolve) => {
    resolveFn = resolve
  })

  const finish = (fillStatus: string): void => {
    if (done) return
    done = true
    unsub()
    if (timer) clearTimeout(timer)
    resolveFn(order.map((id) => settled.get(id) ?? { id, status: fillStatus }))
  }

  const recordSettle = async (id: string, status: string): Promise<void> => {
    if (done || !pending.has(id)) return
    let entry: BarrierBoardResult = { id, status }
    if (status === 'idle') {
      const r = await orchestrator.boardResult(id)
      if (r.present) entry = { id, status, result: r }
    }
    if (done || !pending.has(id)) return // a concurrent finish/duplicate edge won the race
    settled.set(id, entry)
    pending.delete(id)
    if (pending.size === 0) finish('timed-out')
  }

  // Subscribe FIRST so no edge between the initial read and subscription is missed.
  unsub = orchestrator.subscribeStatus((change: BoardStatusChange) => {
    if (isSettled(change.status)) void recordSettle(change.id, change.status)
  })

  // Level-trigger: read current state once; settle already-settled / absent targets.
  void (async () => {
    const boards = await orchestrator.listBoards()
    if (done) return
    const current = new Map(boards.map((b) => [b.id, b.status]))
    for (const id of order) {
      if (done) return
      const st = current.get(id)
      if (st === undefined) await recordSettle(id, 'gone')
      else if (isSettled(st)) await recordSettle(id, st)
    }
  })()

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => finish('timed-out'), timeoutMs)
    // Don't let the backstop hold the event loop open (best-effort; not present in all envs).
    ;(timer as { unref?: () => void }).unref?.()
  }

  return { promise, cancel: () => finish('gone') }
}
