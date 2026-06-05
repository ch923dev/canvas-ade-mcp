# M5 PR2 — pkg barriers + event-driven attention notifier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the package half of M5: two orchestrator-tier blocking barrier tools (`wait_for_idle` / `wait_for_all`) that resolve event-driven off the host status stream, plus an `AttentionNotifier` that pushes `notifications/resources/updated` on `canvas://attention` to subscribed clients — bump to **0.9.0**.

**Architecture:** PR1 (merged, app PR #70 `3824afc`) made Canvas ADE MAIN emit per-board status changes and exposed `BoardRegistry.subscribeStatus`. PR2 extends the pkg's `Orchestrator` interface with `subscribeStatus(listener): () => void`, adds a unit-testable `waitForBoards` core that level-triggers an initial read then resolves when the target set leaves `running`, registers the two thin barrier tools inside the `tier==='orchestrator'` block in `factory.ts`, and wires a per-session `AttentionNotifier` that calls `sendResourceUpdated` on attention-bucket membership deltas. The SDK's high-level `McpServer` does NOT auto-wire `resources/subscribe`, so an isolated `resourceSubscriptions.ts` module manually registers the capability + subscribe/unsubscribe handlers. Per-session teardown (notifier unsubscribe + in-flight barrier cancel) is plumbed through `getServer` → `SessionManager`.

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`), `@modelcontextprotocol/sdk` ^1.29.0, zod ^4, vitest ^4 (two projects: `contract` in-memory + `live` real HTTP), tsup build. All work in repo `Z:\canvas-ade-mcp` on branch **`feat/m5-barriers-attention`** (already checked out, v0.8.2).

**Spec:** `docs/superpowers/specs/2026-06-05-m5-barriers-attention-design.md` (§5 pkg side, §6 resolution contract, §7 security, §8 testing). **Kickoff:** `docs/handoffs/m5-pr2-kickoff.md`.

> **Repo / branch:** modifies the **pkg** (`Z:\canvas-ade-mcp`), NOT the Canvas ADE app. The branch is already on `feat/m5-barriers-attention`; do NOT create a worktree. The app-adopt (forwarding `registry.subscribeStatus` as `Orchestrator.subscribeStatus`, pin `^0.9.0`) is a **separate small PR on a Canvas ADE worktree** after 0.9.0 publishes — see the closing note, not part of this plan.

> **Gate every task** (memory `gate-must-run-format-check` — eslint ≠ prettier; PR1 failed CI on prettier alone):
> `pnpm test` (contract) · `pnpm lint` · `pnpm typecheck` · `pnpm format:check` (added in Task 1). Live tests via `pnpm test:live`. Commit per task.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `package.json` | modify | Add `"format:check": "prettier --check ."`; bump `0.8.2`→`0.9.0` (Task 10). |
| `src/constants.ts` | modify | `TOOL_WAIT_FOR_IDLE`, `TOOL_WAIT_FOR_ALL`, `DEFAULT_BARRIER_TIMEOUT_MS`. |
| `src/orchestrator/Orchestrator.ts` | modify | `BoardStatusChange` type + `subscribeStatus(listener): () => void` on the interface. |
| `src/orchestrator/mock.ts` | modify | Internal emitter + `subscribeStatus` + `__emitStatus(change)` test seam. |
| `src/index.ts` | modify | `export type { BoardStatusChange }`. |
| `src/server/barrierWaiter.ts` | create | Pure-ish `waitForBoards({orchestrator,targets,timeoutMs}) → {promise,cancel}` (level-trigger + subscribe + settle/timeout/gone). |
| `src/server/tools/barriers.ts` | create | `registerBarrierTools(server,orchestrator) → dispose`; the two zod-validated tools + `resolveBarrierTimeout`. |
| `src/server/resourceSubscriptions.ts` | create | `installResourceSubscriptions(server) → { isSubscribed }`: manual capability + subscribe/unsubscribe handlers (isolated SDK module). |
| `src/server/attentionNotifier.ts` | create | `createAttentionNotifier({server,orchestrator,isSubscribed}) → { dispose }`: membership-delta → `sendResourceUpdated`. |
| `src/server/factory.ts` | modify | Register barriers (orch tier); install subs + notifier (both tiers); `getServer` returns `{ server, dispose }`. |
| `src/server/transport.ts` | modify | `disposers` map; call dispose on `transport.onclose` + in `closeAll`; reorder `handlePost`. |
| `test/helpers/inMemory.ts` | modify | Destructure `{ server }` from `getServer`. |
| `test/helpers/emittingOrchestrator.ts` | create | `EmittingOrchestrator` test double (settable boards/results + `emit`). |
| `test/contract/*` | create/modify | `barrierWaiter`, `barriers`, `resourceSubscriptions`, `attentionNotifier`, `attentionNotify` (integration), `sessionManagerClose` (extend). |
| `test/live/*` | create | `barriers.live`, `attentionNotify.live`. |

---

## Task 1: Setup — `format:check` script + barrier constants

**Files:**
- Modify: `Z:\canvas-ade-mcp\package.json`
- Modify: `Z:\canvas-ade-mcp\src\constants.ts`

No test (pure constants + a script). Gate = typecheck + format:check.

- [ ] **Step 1: Add the `format:check` script**

In `package.json` `scripts`, add after `"format": "prettier --write ."`:

```json
    "format": "prettier --write .",
    "format:check": "prettier --check ."
```

- [ ] **Step 2: Add the barrier constants**

Append to `src/constants.ts`:

```ts
/**
 * Phase 5 (M5) BARRIER tools — orchestrator-tier blocking waits over the host status
 * stream. READ-ONLY (no PTY write / human confirm / audit — those are for dispatch tools).
 */
export const TOOL_WAIT_FOR_IDLE = 'wait_for_idle'
export const TOOL_WAIT_FOR_ALL = 'wait_for_all'

/**
 * Default backstop deadline for a barrier wait (30 min) when the tool's `timeoutMs` is
 * omitted. Env-tunable via `CANVAS_ADE_BARRIER_TIMEOUT_MS` (finite, > 0, else ignored).
 * A per-call `timeoutMs` ≤ 0 or non-finite opts out entirely (mirrors the mcpConfirm
 * 10-min backstop convention — settle-and-report never throws on expiry).
 */
export const DEFAULT_BARRIER_TIMEOUT_MS = 30 * 60_000
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm format:check`
Expected: typecheck clean; format:check passes (or run `pnpm format` once if prettier reports drift, then re-check).

- [ ] **Step 4: Commit**

```bash
git add package.json src/constants.ts
git commit -m "chore(m5): format:check script + barrier constants (PR2)"
```

---

## Task 2: `Orchestrator.subscribeStatus` + `BoardStatusChange` + mock emitter

**Files:**
- Modify: `Z:\canvas-ade-mcp\src\orchestrator\Orchestrator.ts`
- Modify: `Z:\canvas-ade-mcp\src\orchestrator\mock.ts`
- Modify: `Z:\canvas-ade-mcp\src\index.ts`
- Test: `Z:\canvas-ade-mcp\test\contract\mockEmitter.contract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/contract/mockEmitter.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardStatusChange } from '../../src/orchestrator/Orchestrator'

describe('MockOrchestrator.subscribeStatus / __emitStatus', () => {
  it('delivers emitted changes to subscribers and stops after unsubscribe', () => {
    const orch = new MockOrchestrator()
    const seen: BoardStatusChange[] = []
    const unsub = orch.subscribeStatus((c) => seen.push(c))

    orch.__emitStatus({ id: 'a', status: 'running' })
    orch.__emitStatus({ id: 'a', status: 'idle' })
    unsub()
    orch.__emitStatus({ id: 'a', status: 'running' }) // ignored

    expect(seen).toEqual([
      { id: 'a', status: 'running' },
      { id: 'a', status: 'idle' }
    ])
  })

  it('isolates a throwing listener from the others', () => {
    const orch = new MockOrchestrator()
    const seen: BoardStatusChange[] = []
    orch.subscribeStatus(() => {
      throw new Error('boom')
    })
    orch.subscribeStatus((c) => seen.push(c))
    expect(() => orch.__emitStatus({ id: 'a', status: 'idle' })).not.toThrow()
    expect(seen).toEqual([{ id: 'a', status: 'idle' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- mockEmitter`
Expected: FAIL — `subscribeStatus` / `__emitStatus` not on `MockOrchestrator`.

- [ ] **Step 3: Extend the `Orchestrator` interface**

In `src/orchestrator/Orchestrator.ts`, add the type after the `BoardResult` interface (it references `BoardResult`, already defined above it), and the method on the `Orchestrator` interface after `boardSummary(...)`:

```ts
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
}
```

Add to the `Orchestrator` interface (after the `boardSummary(...)` member):

```ts
  /**
   * Subscribe to per-board coarse status changes (M5). MAIN forwards
   * `boardRegistry.ts`'s `subscribeBoardStatus`, attaching the last result when a board
   * settles to `idle`. Returns an unsubscribe fn. Barriers + the attention notifier wake
   * on this instead of polling. SYNCHRONOUS (returns the unsubscribe directly, not a Promise).
   */
  subscribeStatus(listener: (change: BoardStatusChange) => void): () => void
```

- [ ] **Step 4: Implement the mock emitter**

In `src/orchestrator/mock.ts`, add `BoardStatusChange` to the type import, then add the emitter members to the class. Update the import block:

```ts
import type {
  BoardConfig,
  BoardOutput,
  BoardResult,
  BoardResultInput,
  BoardStatusChange,
  BoardSummary,
  MemoryDoc,
  Orchestrator
} from './Orchestrator'
```

Add inside the class (e.g. after `boardSummary`):

```ts
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
```

- [ ] **Step 5: Export the type from the package entry**

In `src/index.ts`, add `BoardStatusChange` to the `export type { … } from './orchestrator/Orchestrator'` block:

```ts
export type {
  Orchestrator,
  BoardSummary,
  BoardOutput,
  BoardResult,
  BoardResultInput,
  BoardStatusChange,
  MemoryDoc
} from './orchestrator/Orchestrator'
```

- [ ] **Step 6: Run + gate + commit**

Run: `pnpm test -- mockEmitter` → PASS (2). Then `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`.

```bash
git add src/orchestrator/Orchestrator.ts src/orchestrator/mock.ts src/index.ts test/contract/mockEmitter.contract.test.ts
git commit -m "feat(m5): Orchestrator.subscribeStatus + BoardStatusChange + mock emitter (PR2)"
```

---

## Task 3: `barrierWaiter.ts` core + `EmittingOrchestrator` test double

**Files:**
- Create: `Z:\canvas-ade-mcp\test\helpers\emittingOrchestrator.ts`
- Create: `Z:\canvas-ade-mcp\src\server\barrierWaiter.ts`
- Test: `Z:\canvas-ade-mcp\test\contract\barrierWaiter.contract.test.ts`

- [ ] **Step 1: Create the shared test double**

Create `test/helpers/emittingOrchestrator.ts`:

```ts
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
      else this.boards.push({ id: change.id, type: 'terminal', title: change.id, status: change.status })
    }
    if (change.result) this.results.set(change.id, change.result)
    this.__emitStatus(change)
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `test/contract/barrierWaiter.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { waitForBoards } from '../../src/server/barrierWaiter'
import { EmittingOrchestrator } from '../helpers/emittingOrchestrator'

const NO_TIMEOUT = 0 // ≤ 0 opts out

describe('waitForBoards', () => {
  it('resolves immediately when the target is already settled (idle + result)', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'idle' }]
    orch.setResult('t1', { present: true, status: 'success', summary: 'ok' })
    const { promise } = waitForBoards({ orchestrator: orch, targets: ['t1'], timeoutMs: NO_TIMEOUT })
    expect(await promise).toEqual([
      { id: 't1', status: 'idle', result: { present: true, status: 'success', summary: 'ok' } }
    ])
  })

  it('resolves on the idle event for a running target (event-driven, no timer)', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    const { promise } = waitForBoards({ orchestrator: orch, targets: ['t1'], timeoutMs: NO_TIMEOUT })
    queueMicrotask(() => orch.emit({ id: 't1', status: 'idle' }))
    expect(await promise).toEqual([{ id: 't1', status: 'idle' }])
  })

  it('resolves blocked (not idle) for a running→blocked target', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    const { promise } = waitForBoards({ orchestrator: orch, targets: ['t1'], timeoutMs: NO_TIMEOUT })
    queueMicrotask(() => orch.emit({ id: 't1', status: 'blocked' }))
    expect(await promise).toEqual([{ id: 't1', status: 'blocked' }])
  })

  it('wait-for-all waits for the SLOWEST and preserves input order', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [
      { id: 'a', type: 'terminal', title: 'A', status: 'running' },
      { id: 'b', type: 'terminal', title: 'B', status: 'running' }
    ]
    const { promise } = waitForBoards({ orchestrator: orch, targets: ['a', 'b'], timeoutMs: NO_TIMEOUT })
    queueMicrotask(() => orch.emit({ id: 'b', status: 'idle' }))
    queueMicrotask(() => orch.emit({ id: 'a', status: 'failed' }))
    expect(await promise).toEqual([
      { id: 'a', status: 'failed' },
      { id: 'b', status: 'idle' }
    ])
  })

  it('resolves `gone` for an id absent at call time', async () => {
    const orch = new EmittingOrchestrator()
    const { promise } = waitForBoards({ orchestrator: orch, targets: ['ghost'], timeoutMs: NO_TIMEOUT })
    expect(await promise).toEqual([{ id: 'ghost', status: 'gone' }])
  })

  it('resolves `gone` when a target vanishes mid-wait', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    const { promise } = waitForBoards({ orchestrator: orch, targets: ['t1'], timeoutMs: NO_TIMEOUT })
    queueMicrotask(() => orch.emit({ id: 't1', status: 'gone' }))
    expect(await promise).toEqual([{ id: 't1', status: 'gone' }])
  })

  it('resolves `timed-out` (never throws) when the backstop fires before settle', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    const { promise } = waitForBoards({ orchestrator: orch, targets: ['t1'], timeoutMs: 10 })
    expect(await promise).toEqual([{ id: 't1', status: 'timed-out' }])
  })

  it('with timeout opted out, stays pending until the event (no premature resolve)', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    const { promise } = waitForBoards({ orchestrator: orch, targets: ['t1'], timeoutMs: NO_TIMEOUT })
    const race = await Promise.race([promise, new Promise((r) => setTimeout(() => r('pending'), 30))])
    expect(race).toBe('pending')
    orch.emit({ id: 't1', status: 'idle' })
    expect(await promise).toEqual([{ id: 't1', status: 'idle' }])
  })

  it('cancel() unsubscribes and resolves the pending targets as gone', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    const { promise, cancel } = waitForBoards({ orchestrator: orch, targets: ['t1'], timeoutMs: NO_TIMEOUT })
    cancel()
    expect(await promise).toEqual([{ id: 't1', status: 'gone' }])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- barrierWaiter`
Expected: FAIL — `waitForBoards` not found.

- [ ] **Step 4: Implement `barrierWaiter.ts`**

Create `src/server/barrierWaiter.ts`:

```ts
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
```

> **Note on `'gone'` resolution:** `subscribeStatus` delivers `status: 'gone'` from MAIN when a board leaves the canvas; `isSettled('gone')` is true so `recordSettle` settles it as `gone` (the `boardResult` branch is skipped — only `idle` reads a result). The initial-read absent case is settled `gone` directly.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- barrierWaiter`
Expected: PASS (9).

- [ ] **Step 6: Gate + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`

```bash
git add src/server/barrierWaiter.ts test/helpers/emittingOrchestrator.ts test/contract/barrierWaiter.contract.test.ts
git commit -m "feat(m5): barrierWaiter core — level-trigger + event-driven settle (PR2)"
```

---

## Task 4: `barriers.ts` tools + factory registration (orchestrator tier)

**Files:**
- Create: `Z:\canvas-ade-mcp\src\server\tools\barriers.ts`
- Modify: `Z:\canvas-ade-mcp\src\server\factory.ts`
- Test: `Z:\canvas-ade-mcp\test\contract\barriers.contract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/contract/barriers.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { EmittingOrchestrator } from '../helpers/emittingOrchestrator'
import { TOOL_WAIT_FOR_IDLE, TOOL_WAIT_FOR_ALL } from '../../src/constants'

function readText(content: unknown): string {
  return (content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
}

describe('barrier tools (M5, orchestrator-tier)', () => {
  it('worker tools/list OMITS both barrier tools (capability split)', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL_WAIT_FOR_IDLE)
    expect(names).not.toContain(TOOL_WAIT_FOR_ALL)
    await client.close()
  })

  it('orchestrator tools/list INCLUDES both barrier tools', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL_WAIT_FOR_IDLE)
    expect(names).toContain(TOOL_WAIT_FOR_ALL)
    await client.close()
  })

  it('wait_for_idle resolves the settled status as JSON', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'idle' }]
    orch.setResult('t1', { present: true, status: 'success' })
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL_WAIT_FOR_IDLE, arguments: { boardId: 't1', timeoutMs: 0 } })
    expect(JSON.parse(readText(res.content))).toEqual({
      id: 't1',
      status: 'idle',
      result: { present: true, status: 'success' }
    })
    await client.close()
  })

  it('wait_for_all reports each board + allIdle', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [
      { id: 'a', type: 'terminal', title: 'A', status: 'idle' },
      { id: 'b', type: 'terminal', title: 'B', status: 'blocked' }
    ]
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL_WAIT_FOR_ALL, arguments: { boardIds: ['a', 'b'], timeoutMs: 0 } })
    expect(JSON.parse(readText(res.content))).toEqual({
      boards: [
        { id: 'a', status: 'idle' },
        { id: 'b', status: 'blocked' }
      ],
      allIdle: false
    })
    await client.close()
  })

  it('wait_for_idle backstop resolves timed-out (never errors)', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL_WAIT_FOR_IDLE, arguments: { boardId: 't1', timeoutMs: 10 } })
    expect(res.isError).toBeFalsy()
    expect(JSON.parse(readText(res.content))).toEqual({ id: 't1', status: 'timed-out' })
    await client.close()
  })

  it('rejects an empty boardId / empty boardIds at the schema', async () => {
    const client = await connectInMemory('orchestrator')
    const a = await client.callTool({ name: TOOL_WAIT_FOR_IDLE, arguments: { boardId: '' } })
    const b = await client.callTool({ name: TOOL_WAIT_FOR_ALL, arguments: { boardIds: [] } })
    expect(a.isError).toBe(true)
    expect(b.isError).toBe(true)
    await client.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- barriers.contract`
Expected: FAIL — barrier tools absent from `tools/list`.

- [ ] **Step 3: Implement `barriers.ts`**

Create `src/server/tools/barriers.ts`:

```ts
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import { DEFAULT_BARRIER_TIMEOUT_MS, TOOL_WAIT_FOR_ALL, TOOL_WAIT_FOR_IDLE } from '../../constants'
import { waitForBoards, type BarrierBoardResult } from '../barrierWaiter'

/**
 * Resolve the effective backstop: an explicit per-call `timeoutMs` wins (≤ 0 / non-finite
 * opts out, handled downstream by waitForBoards), else the validated env override, else the
 * 30-min default. (env validation mirrors BUG-023: reject non-positive / non-finite.)
 */
export function resolveBarrierTimeout(arg?: number): number {
  if (arg !== undefined) return arg
  const env = process.env.CANVAS_ADE_BARRIER_TIMEOUT_MS
  if (env !== undefined) {
    const n = Number(env)
    if (Number.isFinite(n) && n > 0) return n
  }
  return DEFAULT_BARRIER_TIMEOUT_MS
}

/**
 * Register the M5 BARRIER tools — orchestrator-tier blocking waits over the host status
 * stream. The CALLER (ServerFactory) gates them to the orchestrator tier (registered only in
 * that block); a worker's tools/list never contains them (structural split). READ-ONLY: no
 * PTY write, no human confirm, no audit (those are dispatch-tool concerns). Returns a
 * `dispose()` that cancels any in-flight waits (called on session close to avoid a leaked
 * orchestrator subscription).
 */
export function registerBarrierTools(server: McpServer, orchestrator: Orchestrator): () => void {
  const active = new Set<() => void>()

  const run = async (targets: string[], timeoutMs: number): Promise<BarrierBoardResult[]> => {
    const handle = waitForBoards({ orchestrator, targets, timeoutMs })
    active.add(handle.cancel)
    try {
      return await handle.promise
    } finally {
      active.delete(handle.cancel)
    }
  }

  server.registerTool(
    TOOL_WAIT_FOR_IDLE,
    {
      description:
        'Block until a target board leaves the running state, then report how it settled ' +
        '(idle/awaiting-review/blocked/failed/static/gone, or timed-out). Returns the board ' +
        "id + status (+ the board's last write_result when idle). boardId is required; " +
        'optional timeoutMs (omit for the default backstop; <=0 to wait indefinitely).',
      inputSchema: {
        boardId: z.string().min(1),
        timeoutMs: z.number().optional()
      }
    },
    async (args) => {
      const results = await run([args.boardId], resolveBarrierTimeout(args.timeoutMs))
      const r = results[0] ?? { id: args.boardId, status: 'timed-out' }
      return { content: [{ type: 'text', text: JSON.stringify(r) }] }
    }
  )

  server.registerTool(
    TOOL_WAIT_FOR_ALL,
    {
      description:
        'Block until EVERY target board has left the running state, then report each one ' +
        '(same statuses as wait_for_idle) plus allIdle (true when every target settled to ' +
        'idle). boardIds is a non-empty array; optional timeoutMs (omit for the default ' +
        'backstop; <=0 to wait indefinitely).',
      inputSchema: {
        boardIds: z.array(z.string().min(1)).min(1),
        timeoutMs: z.number().optional()
      }
    },
    async (args) => {
      const boards = await run(args.boardIds, resolveBarrierTimeout(args.timeoutMs))
      const allIdle = boards.every((b) => b.status === 'idle')
      return { content: [{ type: 'text', text: JSON.stringify({ boards, allIdle }) }] }
    }
  )

  return () => {
    for (const cancel of active) cancel()
  }
}
```

- [ ] **Step 4: Register in the factory (orchestrator block)**

In `src/server/factory.ts`, add the import and register the tools inside the `if (ctx.tier === 'orchestrator')` block. Add to the imports:

```ts
import { registerRelayPrompt } from './tools/relayPrompt'
import { registerBarrierTools } from './tools/barriers'
```

Inside the orchestrator block, after `registerRelayPrompt(...)`:

```ts
      // relay_prompt is bound to the designated command orchestrator when one is set (BUG-021).
      registerRelayPrompt(server, this.orchestrator, ctx, this.commandBoardId)
      // M5 barrier tools — orchestrator-tier blocking waits (read-only; no PTY write/confirm/audit).
      // (dispose is collected when getServer's return shape changes in the session-teardown task.)
      registerBarrierTools(server, this.orchestrator)
```

> The returned `dispose` is intentionally ignored HERE (expression statement — no unused-var). The session-teardown task (Task 7) collects it.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- barriers.contract`
Expected: PASS (6).

- [ ] **Step 6: Gate + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`

```bash
git add src/server/tools/barriers.ts src/server/factory.ts test/contract/barriers.contract.test.ts
git commit -m "feat(m5): wait_for_idle / wait_for_all barrier tools, orchestrator-tier (PR2)"
```

---

## Task 5: `resourceSubscriptions.ts` — manual subscribe wiring

**Files:**
- Create: `Z:\canvas-ade-mcp\src\server\resourceSubscriptions.ts`
- Test: `Z:\canvas-ade-mcp\test\contract\resourceSubscriptions.contract.test.ts`

> **SDK fact (verified at runtime, sdk 1.29.0):** the high-level `McpServer` does NOT auto-wire `resources/subscribe`. `server.server.registerCapabilities({ resources: { subscribe: true } })` merges cleanly even after `registerResource`, and `server.server.setRequestHandler(SubscribeRequestSchema, …)` works. Isolating this in one module keeps a future SDK bump a one-file change (same discipline as `transport.ts`).

- [ ] **Step 1: Write the failing test**

Create `test/contract/resourceSubscriptions.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { installResourceSubscriptions } from '../../src/server/resourceSubscriptions'

async function wired(): Promise<{ client: Client; isSubscribed: (u: string) => boolean }> {
  const server = new McpServer({ name: 'subs-test', version: '0.0.0' })
  // a resource must exist so the SDK advertises the resources capability
  server.registerResource(
    'attention',
    'canvas://attention',
    { description: 'd', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, text: '[]' }] })
  )
  const { isSubscribed } = installResourceSubscriptions(server)
  const [ct, st] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'c', version: '0.0.0' })
  await server.connect(st)
  await client.connect(ct)
  return { client, isSubscribed }
}

describe('installResourceSubscriptions', () => {
  it('tracks subscribe then unsubscribe for a URI', async () => {
    const { client, isSubscribed } = await wired()
    expect(isSubscribed('canvas://attention')).toBe(false)
    await client.subscribeResource({ uri: 'canvas://attention' })
    expect(isSubscribed('canvas://attention')).toBe(true)
    await client.unsubscribeResource({ uri: 'canvas://attention' })
    expect(isSubscribed('canvas://attention')).toBe(false)
    await client.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- resourceSubscriptions`
Expected: FAIL — `installResourceSubscriptions` not found.

- [ ] **Step 3: Implement `resourceSubscriptions.ts`**

Create `src/server/resourceSubscriptions.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js'

export interface ResourceSubscriptions {
  /** True when a client has an active `resources/subscribe` for this exact URI. */
  isSubscribed(uri: string): boolean
}

/**
 * Manually wire `resources/subscribe` / `resources/unsubscribe` for one session — the SDK's
 * high-level McpServer does NOT do this (sdk 1.29.0). Registers the `resources.subscribe`
 * capability + the two request handlers, tracking the subscribed URIs in a per-session Set.
 * The AttentionNotifier consults `isSubscribed` so it only pushes to clients that asked.
 * MUST be called BEFORE `server.connect(transport)` (registerCapabilities is connect-gated).
 */
export function installResourceSubscriptions(server: McpServer): ResourceSubscriptions {
  const uris = new Set<string>()
  server.server.registerCapabilities({ resources: { subscribe: true } })
  server.server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    uris.add(req.params.uri)
    return {}
  })
  server.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    uris.delete(req.params.uri)
    return {}
  })
  return { isSubscribed: (uri) => uris.has(uri) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- resourceSubscriptions`
Expected: PASS (1).

- [ ] **Step 5: Gate + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`

```bash
git add src/server/resourceSubscriptions.ts test/contract/resourceSubscriptions.contract.test.ts
git commit -m "feat(m5): manual resources/subscribe wiring (isolated SDK module) (PR2)"
```

---

## Task 6: `attentionNotifier.ts` — membership-delta → `sendResourceUpdated`

**Files:**
- Create: `Z:\canvas-ade-mcp\src\server\attentionNotifier.ts`
- Test: `Z:\canvas-ade-mcp\test\contract\attentionNotifier.contract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/contract/attentionNotifier.contract.test.ts` (unit — a spy `server` + the `EmittingOrchestrator`, no real McpServer):

```ts
import { describe, expect, it } from 'vitest'
import { createAttentionNotifier } from '../../src/server/attentionNotifier'
import { EmittingOrchestrator } from '../helpers/emittingOrchestrator'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/** Minimal fake exposing only what the notifier touches: `server.server.sendResourceUpdated`. */
function fakeServer(): { server: McpServer; updates: string[] } {
  const updates: string[] = []
  const server = {
    server: { sendResourceUpdated: (p: { uri: string }) => updates.push(p.uri) }
  } as unknown as McpServer
  return { server, updates }
}

describe('createAttentionNotifier', () => {
  it('emits once when a board ENTERS the attention set and once when it LEAVES', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })

    orch.emit({ id: 't1', status: 'running' }) // not attention → no emit
    orch.emit({ id: 't1', status: 'blocked' }) // enters → emit
    orch.emit({ id: 't1', status: 'idle' }) // leaves → emit
    expect(updates).toEqual(['canvas://attention', 'canvas://attention'])
  })

  it('does NOT emit while staying inside the attention set (blocked→failed)', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })
    orch.emit({ id: 't1', status: 'blocked' }) // enters → emit
    orch.emit({ id: 't1', status: 'failed' }) // still attention → no emit
    expect(updates).toEqual(['canvas://attention'])
  })

  it('does NOT emit for a non-attention change (running→idle)', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })
    orch.emit({ id: 't1', status: 'running' })
    orch.emit({ id: 't1', status: 'idle' })
    expect(updates).toEqual([])
  })

  it('does NOT emit when no client is subscribed', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => false })
    orch.emit({ id: 't1', status: 'blocked' })
    expect(updates).toEqual([])
  })

  it('emits when an attention board leaves via `gone`', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })
    orch.emit({ id: 't1', status: 'blocked' }) // enters → emit
    orch.emit({ id: 't1', status: 'gone' }) // leaves → emit
    expect(updates).toEqual(['canvas://attention', 'canvas://attention'])
  })

  it('dispose() stops further emits', () => {
    const orch = new EmittingOrchestrator()
    const { server, updates } = fakeServer()
    const n = createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })
    n.dispose()
    orch.emit({ id: 't1', status: 'blocked' })
    expect(updates).toEqual([])
  })

  it('swallows a throwing sendResourceUpdated (post-close safety)', () => {
    const orch = new EmittingOrchestrator()
    const server = {
      server: {
        sendResourceUpdated: () => {
          throw new Error('Not connected')
        }
      }
    } as unknown as McpServer
    createAttentionNotifier({ server, orchestrator: orch, isSubscribed: () => true })
    expect(() => orch.emit({ id: 't1', status: 'blocked' })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- attentionNotifier`
Expected: FAIL — `createAttentionNotifier` not found.

- [ ] **Step 3: Implement `attentionNotifier.ts`**

Create `src/server/attentionNotifier.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../orchestrator/Orchestrator'
import { ATTENTION_BUCKETS } from '../resources/attention'

const ATTENTION_URI = 'canvas://attention'

export interface AttentionNotifier {
  /** Unsubscribe from the orchestrator status stream (called on session close). */
  dispose(): void
}

/**
 * Per session: push `notifications/resources/updated` on `canvas://attention` whenever the
 * MEMBERSHIP of the attention set changes (a board enters or leaves blocked/awaiting-review/
 * failed). A change WITHIN the set (blocked→failed) or outside it (running→idle) emits
 * nothing — the resource membership is unchanged. Gated on a live `resources/subscribe` for
 * the URI; the emit is wrapped so a post-close `sendResourceUpdated` ("Not connected") can't
 * throw into the orchestrator fan-out.
 */
export function createAttentionNotifier(deps: {
  server: McpServer
  orchestrator: Orchestrator
  isSubscribed: (uri: string) => boolean
}): AttentionNotifier {
  const { server, orchestrator, isSubscribed } = deps
  const inAttention = new Set<string>()

  const unsub = orchestrator.subscribeStatus((change) => {
    const nowAttn = ATTENTION_BUCKETS.has(change.status)
    const wasAttn = inAttention.has(change.id)
    if (nowAttn === wasAttn) return // membership unchanged
    if (nowAttn) inAttention.add(change.id)
    else inAttention.delete(change.id)
    if (!isSubscribed(ATTENTION_URI)) return
    try {
      server.server.sendResourceUpdated({ uri: ATTENTION_URI })
    } catch {
      // post-close / not-connected emit — drop it; the fan-out must not throw
    }
  })

  return { dispose: unsub }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- attentionNotifier`
Expected: PASS (7).

- [ ] **Step 5: Gate + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`

```bash
git add src/server/attentionNotifier.ts test/contract/attentionNotifier.contract.test.ts
git commit -m "feat(m5): AttentionNotifier — push canvas://attention on membership delta (PR2)"
```

---

## Task 7: Session teardown — `getServer → { server, dispose }`, wire subs + notifier, `SessionManager` disposers

**Files:**
- Modify: `Z:\canvas-ade-mcp\src\server\factory.ts`
- Modify: `Z:\canvas-ade-mcp\src\server\transport.ts`
- Modify: `Z:\canvas-ade-mcp\test\helpers\inMemory.ts`
- Test: `Z:\canvas-ade-mcp\test\contract\factoryDispose.contract.test.ts`
- Test: `Z:\canvas-ade-mcp\test\contract\sessionManagerClose.contract.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Create `test/contract/factoryDispose.contract.test.ts` (asserts dispose unsubscribes the notifier — orchestrator subscribe/unsubscribe balanced):

```ts
import { describe, expect, it } from 'vitest'
import { ServerFactory } from '../../src/server/factory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardStatusChange } from '../../src/orchestrator/Orchestrator'

/** Counts live status subscriptions so we can prove dispose() unsubscribes. */
class CountingOrchestrator extends MockOrchestrator {
  live = 0
  override subscribeStatus(listener: (c: BoardStatusChange) => void): () => void {
    void listener
    this.live++
    return () => {
      this.live--
    }
  }
}

describe('ServerFactory.getServer dispose', () => {
  it('returns { server, dispose }; dispose() drops the notifier subscription', () => {
    const orch = new CountingOrchestrator()
    const factory = new ServerFactory(orch)
    const { server, dispose } = factory.getServer({ tier: 'orchestrator', scopes: [], boardId: 'b' })
    expect(server).toBeDefined()
    expect(orch.live).toBe(1) // notifier subscribed
    dispose()
    expect(orch.live).toBe(0) // notifier unsubscribed
  })
})
```

Extend `test/contract/sessionManagerClose.contract.test.ts` — add a test that `closeAll` runs registered disposers. Append inside the `describe`:

```ts
  it('runs every session disposer on closeAll (and clears them)', async () => {
    const sm = new SessionManager({} as ServerFactory)
    const disposed: string[] = []
    const map = (sm as unknown as { disposers: Map<string, () => void> }).disposers
    map.set('a', () => disposed.push('a'))
    map.set('b', () => disposed.push('b'))
    await sm.closeAll()
    expect(disposed.sort()).toEqual(['a', 'b'])
    expect(map.size).toBe(0)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- factoryDispose sessionManagerClose`
Expected: FAIL — `getServer` returns an `McpServer` (no `dispose`); `disposers` map doesn't exist.

- [ ] **Step 3: Change `getServer` to return `{ server, dispose }` and wire subs + notifier**

In `src/server/factory.ts`:

(a) Add imports:

```ts
import { registerBarrierTools } from './tools/barriers'
import { installResourceSubscriptions } from './resourceSubscriptions'
import { createAttentionNotifier } from './attentionNotifier'
```

(b) Replace the `registerBarrierTools(server, this.orchestrator)` statement (added in Task 4) and the method signature/return. The full new `getServer`:

```ts
  getServer(ctx: SessionCtx): { server: McpServer; dispose: () => void } {
    const server = new McpServer(SERVER_INFO)
    const disposers: Array<() => void> = []

    // ping — both tiers.
    server.registerTool(TOOL_PING, { description: 'Health check. Returns "pong".' }, async () => ({
      content: [{ type: 'text', text: 'pong' }]
    }))

    if (ctx.tier === 'orchestrator') {
      server.registerTool(
        TOOL_ORCHESTRATOR_PING,
        { description: 'Orchestrator-only health check. Returns "orchestrator-pong".' },
        async () => ({ content: [{ type: 'text', text: 'orchestrator-pong' }] })
      )
      registerSpawnBoard(server, this.orchestrator)
      registerCloseBoard(server, this.orchestrator)
      registerConfigureBoard(server, this.orchestrator)
      registerHandoffPrompt(server, this.orchestrator)
      registerAssignPrompt(server, this.orchestrator)
      registerInterrupt(server, this.orchestrator)
      registerRelayPrompt(server, this.orchestrator, ctx, this.commandBoardId)
      // M5 barriers — orchestrator-tier; dispose cancels any in-flight wait on session close.
      disposers.push(registerBarrierTools(server, this.orchestrator))
    }

    registerWriteResult(server, this.orchestrator, ctx)
    registerBoardResources(server, this.orchestrator)
    registerPrompts(server)

    // M5 attention push (both tiers — observation is safe). Subscribe wiring MUST precede
    // connect (registerCapabilities is connect-gated); getServer always runs before connect.
    const subs = installResourceSubscriptions(server)
    const notifier = createAttentionNotifier({
      server,
      orchestrator: this.orchestrator,
      isSubscribed: subs.isSubscribed
    })
    disposers.push(() => notifier.dispose())

    return {
      server,
      dispose: () => {
        for (const d of disposers) d()
      }
    }
  }
```

- [ ] **Step 4: Update `SessionManager` (transport.ts)**

In `src/server/transport.ts`:

(a) Add the disposers map field next to `transports`:

```ts
  private readonly transports = new Map<string, StreamableHTTPServerTransport>()
  /** Per-session teardown (M5 notifier unsubscribe + in-flight barrier cancel). */
  private readonly disposers = new Map<string, () => void>()
```

(b) Replace the new-session branch of `handlePost` (everything after the `isInitializeRequest` guard) so the server is built first and its dispose is registered/called with the session:

```ts
    const { server, dispose } = this.factory.getServer(ctx)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        this.transports.set(id, transport)
        this.disposers.set(id, dispose)
      }
    })
    transport.onclose = () => {
      const id = transport.sessionId
      if (id !== undefined) {
        this.transports.delete(id)
        this.disposers.get(id)?.()
        this.disposers.delete(id)
      }
    }

    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
```

(c) Extend `closeAll` to run any disposers not already fired by `onclose` (idempotent — notifier unsub + barrier cancel are safe to call twice):

```ts
  async closeAll(): Promise<void> {
    try {
      await Promise.allSettled([...this.transports.values()].map((t) => t.close()))
    } finally {
      for (const dispose of this.disposers.values()) {
        try {
          dispose()
        } catch {
          // a teardown throw must not abort the rest
        }
      }
      this.disposers.clear()
      this.transports.clear()
    }
  }
```

- [ ] **Step 5: Update the in-memory test helper**

In `test/helpers/inMemory.ts`, destructure the new shape:

```ts
  const factory = new ServerFactory(orchestrator, commandBoardId)
  const { server } = factory.getServer({ tier, scopes: [], boardId })
```

- [ ] **Step 6: Run the suites to verify pass**

Run: `pnpm test`
Expected: PASS — `factoryDispose` (1) + extended `sessionManagerClose` + the WHOLE contract suite (every existing test still green; `getServer` shape change ripples only through `inMemory.ts`).

- [ ] **Step 7: Gate + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`

```bash
git add src/server/factory.ts src/server/transport.ts test/helpers/inMemory.ts test/contract/factoryDispose.contract.test.ts test/contract/sessionManagerClose.contract.test.ts
git commit -m "feat(m5): per-session teardown — getServer returns dispose; wire subs + notifier (PR2)"
```

---

## Task 8: Integration contract — attention notifications over the in-memory client

**Files:**
- Test: `Z:\canvas-ade-mcp\test\contract\attentionNotify.contract.test.ts`

Validates the full wired path (Tasks 5+6+7) end-to-end over `connectInMemory`: a real SDK client `subscribeResource`s, drives the orchestrator, and receives (or doesn't) `notifications/resources/updated`.

- [ ] **Step 1: Write the test**

Create `test/contract/attentionNotify.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { connectInMemory } from '../helpers/inMemory'
import { EmittingOrchestrator } from '../helpers/emittingOrchestrator'

/** Collect resources/updated URIs the client receives. */
function collectUpdates(client: Awaited<ReturnType<typeof connectInMemory>>): string[] {
  const got: string[] = []
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
    got.push(n.params.uri)
  })
  return got
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

describe('canvas://attention notifications (wired)', () => {
  it('a subscribed client is notified on an attention membership delta', async () => {
    const orch = new EmittingOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const updates = collectUpdates(client)
    await client.subscribeResource({ uri: 'canvas://attention' })

    orch.emit({ id: 't1', status: 'blocked' }) // enters attention
    await tick()
    expect(updates).toEqual(['canvas://attention'])
    await client.close()
  })

  it('does NOT notify a client that never subscribed', async () => {
    const orch = new EmittingOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const updates = collectUpdates(client)

    orch.emit({ id: 't1', status: 'blocked' })
    await tick()
    expect(updates).toEqual([])
    await client.close()
  })

  it('does NOT notify on a non-attention change', async () => {
    const orch = new EmittingOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const updates = collectUpdates(client)
    await client.subscribeResource({ uri: 'canvas://attention' })

    orch.emit({ id: 't1', status: 'running' })
    orch.emit({ id: 't1', status: 'idle' })
    await tick()
    expect(updates).toEqual([])
    await client.close()
  })
})
```

- [ ] **Step 2: Run to verify pass**

Run: `pnpm test -- attentionNotify`
Expected: PASS (3). (If a notification race appears, the `tick()` after `emit` is the settle point — notifications flow synchronously over InMemoryTransport but the handler dispatch is async.)

- [ ] **Step 3: Gate + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`

```bash
git add test/contract/attentionNotify.contract.test.ts
git commit -m "test(m5): in-memory attention-notification integration (PR2)"
```

---

## Task 9: Live tests over real HTTP/SSE

**Files:**
- Test: `Z:\canvas-ade-mcp\test\live\barriers.live.test.ts`
- Test: `Z:\canvas-ade-mcp\test\live\attentionNotify.live.test.ts`

Proves the barrier resolution + the `sendResourceUpdated` push survive the real streamable-HTTP transport (auth + Origin + SSE), against a controllable orchestrator (the true running-Canvas-ADE integration rides the app-adopt PR — see closing note).

- [ ] **Step 1: Write the barrier live test**

Create `test/live/barriers.live.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import { EmittingOrchestrator } from '../helpers/emittingOrchestrator'
import { TOOL_WAIT_FOR_IDLE } from '../../src/constants'

let ts: TestServer | undefined
afterEach(async () => {
  await ts?.server.close()
  ts = undefined
})

async function orchClient(server: TestServer): Promise<Client> {
  mintToken(server.tokens, 'tok-orch', { tier: 'orchestrator', boardId: 'bO' })
  const client = new Client({ name: 'live', version: '0.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { Authorization: 'Bearer tok-orch' } }
    })
  )
  return client
}

describe('wait_for_idle over real HTTP', () => {
  it('resolves exactly when the board goes idle (event-timed, before the backstop)', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    ts = await startTestServer(orch)
    const client = await orchClient(ts)

    const started = Date.now()
    const call = client.callTool({
      name: TOOL_WAIT_FOR_IDLE,
      arguments: { boardId: 't1', timeoutMs: 5000 }
    })
    setTimeout(() => orch.emit({ id: 't1', status: 'idle' }), 50)
    const res = await call
    const text = (res.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')

    expect(JSON.parse(text)).toEqual({ id: 't1', status: 'idle' })
    expect(Date.now() - started).toBeLessThan(2000) // resolved on the event, not the 5s backstop
    await client.close()
  })
})
```

- [ ] **Step 2: Write the attention-notification live test**

Create `test/live/attentionNotify.live.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import { EmittingOrchestrator } from '../helpers/emittingOrchestrator'

let ts: TestServer | undefined
afterEach(async () => {
  await ts?.server.close()
  ts = undefined
})

describe('canvas://attention push over real SSE', () => {
  it('delivers resources/updated to a subscribed client on a membership delta', async () => {
    const orch = new EmittingOrchestrator()
    ts = await startTestServer(orch)
    mintToken(ts.tokens, 'tok-orch', { tier: 'orchestrator', boardId: 'bO' })

    const client = new Client({ name: 'live', version: '0.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(ts.url), {
        requestInit: { headers: { Authorization: 'Bearer tok-orch' } }
      })
    )

    const got = new Promise<string>((resolve) => {
      client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => resolve(n.params.uri))
    })
    await client.subscribeResource({ uri: 'canvas://attention' })

    orch.emit({ id: 't1', status: 'blocked' })
    expect(await got).toBe('canvas://attention')
    await client.close()
  })
})
```

- [ ] **Step 3: Run the live suite**

Run: `pnpm test:live`
Expected: PASS — the two new files + every existing live test still green.

> If `resources/updated` doesn't arrive over HTTP, confirm the client opened its standalone SSE GET stream (the SDK transport does this automatically after `initialize`); `subscribeResource` must be awaited before the `emit`. The in-memory Task-8 test isolates wiring bugs from transport bugs.

- [ ] **Step 4: Commit**

```bash
git add test/live/barriers.live.test.ts test/live/attentionNotify.live.test.ts
git commit -m "test(m5): live barrier resolve + attention SSE push over real HTTP (PR2)"
```

---

## Task 10: Bump 0.9.0, full gate, build, publish

**Files:**
- Modify: `Z:\canvas-ade-mcp\package.json`

- [ ] **Step 1: Bump the version**

In `package.json`: `"version": "0.8.2"` → `"version": "0.9.0"`.

- [ ] **Step 2: Full local gate + build**

Run each; all must pass:

```
pnpm test            # contract project
pnpm test:live       # live project
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build           # tsup → dist/ (the published surface; verify dist/index.d.ts exports BoardStatusChange)
```

Expected: every command green. (`handshake.contract.test.ts` asserts `serverInfo.version` == package.json version — it reads `pkg.version`, so the bump keeps it green automatically.)

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(m5): bump canvas-ade-mcp 0.9.0 — barriers + attention notifier (PR2)"
```

- [ ] **Step 4: Push + open the pkg PR**

```bash
git push -u origin feat/m5-barriers-attention
gh pr create --base main --title "feat(m5): barriers + event-driven attention notifier — 0.9.0" \
  --body "Pkg half of M5. Adds Orchestrator.subscribeStatus + mock emitter, the wait_for_idle/wait_for_all orchestrator-tier barrier tools (event-driven via barrierWaiter), and an AttentionNotifier that pushes notifications/resources/updated on canvas://attention to subscribed clients (manual resources/subscribe wiring, sdk 1.29.0). Per-session teardown plumbed through getServer -> SessionManager. Two-layer test gate (contract in-memory + live HTTP/SSE). Bumps 0.8.2 -> 0.9.0. Spec: docs/superpowers/specs/2026-06-05-m5-barriers-attention-design.md."
```

- [ ] **Step 5: Publish 0.9.0** (memory `mcp-publish-gating` — the app consumes the PUBLISHED pkg)

After the PR merges to `main` (or from the branch if the workflow allows), publish to GitHub Packages. **Actions billing may be blocked → local `npm publish` bypass:**

1. Create a temp `.npmrc` at repo root with a token carrying `write:packages` scope:
   ```
   @ch923dev:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${GH_PACKAGES_TOKEN}
   ```
   (export `GH_PACKAGES_TOKEN` in the shell; do NOT commit the token.)
2. `pnpm build` (ensure `dist/` is current).
3. `npm publish` (the `publishConfig.registry` already points at GitHub Packages; `files: ["dist"]`).
4. **`rm .npmrc`** immediately after (never leave the token on disk).
5. Verify: `npm view @ch923dev/canvas-ade-mcp version` → `0.9.0`.

> If using a junctioned worktree elsewhere, **de-junction `node_modules`** (`cmd /c rmdir node_modules`) before any version bump — never `rm -rf`. This pkg repo is standalone (real `node_modules`), so that caveat is for the Canvas ADE side.

---

## Self-Review

**1. Spec coverage (PR2 scope = spec §5 + §6 + §7 + §8 pkg legs):**
- §5.1 `Orchestrator.subscribeStatus` + `BoardStatusChange` + mock `__emitStatus` → Task 2. ✅
- §5.2 `barriers.ts` two tools, registered in the `tier==='orchestrator'` block, constants in `constants.ts`, thin over a shared `BarrierWaiter` (level-trigger read once → resolve immediately if settled, else subscribe; unsubscribe on resolve) → Tasks 1, 3, 4. ✅
- §5.3 `AttentionNotifier` on attention membership delta → `sendResourceUpdated`; manual `registerCapabilities({resources:{subscribe:true}})` + subscribe/unsubscribe handlers tracking per-session URIs; emit only to subscribers; isolated module → Tasks 5, 6. ✅
- §5.4 cleanup: unsubscribe + drop in-flight `BarrierWaiter`s on session close; extend `SessionManager.closeAll`; `gone` mid-wait resolves the barrier → Task 7 (disposers) + Task 3 (`gone` settle + `cancel`). ✅
- §6 resolution contract: `wait_for_idle → {id,status,result?}`; `wait_for_all → {boards,allIdle}`; settled = `status!=='running'`; immediate when already settled; `gone` on absent; `result` only when idle+present; timeout RESOLVES `timed-out` (never throws); `Infinity`/`≤0` opts out → Tasks 3, 4. ✅
- §7 security: orchestrator-tier only (worker `tools/list` omits both — tested Task 4); read-only (no PTY write/confirm/audit — the tools call only `waitForBoards`); attention both-tier readable → Tasks 4, 6, 7. ✅
- §8 contract gate: running→idle/blocked/failed; already-settled immediate; `wait_for_all` slowest; timeout; id-removed→gone; membership delta = exactly one emit; non-attention = none; subscribe/unsubscribe tracked, no emit to non-subscribers; worker omits both → Tasks 3, 4, 5, 6, 8. ✅
- §8 live gate: barrier resolves event-timed over real HTTP; attention push over real SSE → Task 9. (The "blocked worker surfaces blocked" + "handoff regression" legs are app-driven — they ride the app-adopt PR's e2e, noted below; the pkg live layer proves the transport carries barriers + notifications.) ✅ (scoped)

**2. Placeholder scan:** none — every code step has concrete code; every run step has an exact command + expected result.

**3. Type consistency:** `BoardStatusChange = { id: BoardId; status: string; result?: BoardResult }` defined in `Orchestrator.ts` (Task 2), implemented by `MockOrchestrator`/`EmittingOrchestrator`, consumed by `waitForBoards`'s `subscribeStatus` listener (Task 3) and `createAttentionNotifier` (Task 6). `BarrierBoardResult = { id; status; result? }` defined in `barrierWaiter.ts`, returned by `waitForBoards` and re-used by `barriers.ts` (`run`'s return, `wait_for_all`'s `boards`). `waitForBoards` returns `BarrierHandle { promise, cancel }` — `barriers.ts` uses both. `installResourceSubscriptions → { isSubscribed }`, `createAttentionNotifier(..., isSubscribed)` — names match. `getServer → { server, dispose }` consumed in `transport.ts` (`const { server, dispose }`) and `inMemory.ts` (`const { server }`). Constant names `TOOL_WAIT_FOR_IDLE`/`TOOL_WAIT_FOR_ALL`/`DEFAULT_BARRIER_TIMEOUT_MS` used identically across constants/barriers/tests. No drift.

**4. Risk notes (verified at plan time, not assumed):**
- `server.server.registerCapabilities({resources:{subscribe:true}})` after `registerResource` MERGES (no throw) — runtime-probed against sdk 1.29.0.
- `server.server.setRequestHandler(SubscribeRequestSchema/UnsubscribeRequestSchema, …)` works; `ResourceUpdatedNotificationSchema`/`EmptyResultSchema` exported.
- `sendResourceUpdated` THROWS "Not connected" pre-connect/post-close → the notifier wraps it in try/catch (Task 6, tested).
- `getServer` has exactly two call sites (`transport.ts:54`, `test/helpers/inMemory.ts:22`) — both updated (Task 7). `handshake.contract.test.ts` matched the grep only via `getServerVersion`; unaffected.

---

## Note on the app-adopt PR (separate, after 0.9.0 publishes)

A small **Canvas ADE** PR on a `feat/*` worktree off `main` (`main` = integration-only; CI is the green gate):
- In `buildOrchestrator` (`src/main/mcpOrchestrator.ts`), implement the pkg's new `Orchestrator.subscribeStatus` by forwarding the PR1-shipped `registry.subscribeStatus`, mapping each `{id,status}` to a `BoardStatusChange` and **attaching `boardResult(id)` when the board settles to `idle`** (so a barrier returns the last result).
- Bump the app pin `@ch923dev/canvas-ade-mcp` → `^0.9.0`.
- Add the true integration live test: a real running Canvas ADE where an orchestrator dispatches to a worker terminal and `wait_for_idle` resolves exactly when the board goes idle; a blocked worker surfaces `blocked`; the handoff regression stays green (the §8 "live against the real running Canvas ADE" legs).

This depends on 0.9.0 being published (it pins the real surface), so it is NOT part of this pkg plan.
