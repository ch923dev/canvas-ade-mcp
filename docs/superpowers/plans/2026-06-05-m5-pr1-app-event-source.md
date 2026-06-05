# M5 PR1 — App-side status-change event source + handoff-poll retirement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single place a board snapshot lands in Canvas ADE MAIN into a per-board
status-change emitter, and rewire `handoff_prompt`'s await-idle to wake on it event-driven — deleting the
last busy-poll. Pure app-internal change; no `@ch923dev/canvas-ade-mcp` contract change (that is PR2).

**Architecture:** The renderer already pushes a coarse board-status snapshot over IPC `mcp:boards` to
`boardRegistry.ts` (which stores it as `mirror`). This PR diffs each incoming snapshot against the prior
one and fans the per-board deltas out to subscribers (`subscribeBoardStatus`). The `BoardRegistry`
interface the MCP adapter consumes gains a `subscribeStatus` method (wired to that emitter), and
`buildOrchestrator`'s handoff await-idle parks on a single status event (re-resolving the live derived
status on wake) with the existing timeout as a one-shot backstop — no interval poll.

**Tech Stack:** TypeScript (strict), Electron MAIN process, Vitest. All work in repo `Z:\Canvas ADE`.

> **Repo / branch:** This plan modifies the **Canvas ADE app** (`Z:\Canvas ADE`), NOT this `canvas-ade-mcp`
> repo (the plan lives here because `canvas-ade-mcp` is M5's home; the spec is its sibling). Execute on a
> **`feat/m5-app-event-source` worktree off `Z:\Canvas ADE` `main`** (create it with
> `.claude/tools/new-worktree.ps1` at execution start — it junctions `node_modules`). `main` is
> integration-only. Local gate in a junctioned worktree = `pnpm vitest run` + `pnpm lint` + web/preload
> typecheck; the full `typecheck`/`build`/e2e need the provisioned token'd env (see CLAUDE.md Status).
> Commit with `--no-verify` if the pre-commit e2e matrix can't build in the junctioned worktree.

**Spec:** `Z:\canvas-ade-mcp\docs\superpowers\specs\2026-06-05-m5-barriers-attention-design.md` (§3, §4, D3).

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/main/boardRegistry.ts` | modify | Add `BoardStatusChange`, pure `diffStatus`, a listener set, `subscribeBoardStatus`, and an `applySnapshot` that emits diffs; route the `mcp:boards` handler through it. |
| `src/main/boardRegistry.test.ts` | modify | Unit-test `diffStatus` (pure) + the subscribe/emit/unsubscribe/isolation path. |
| `src/main/mcpOrchestrator.ts` | modify | `BoardRegistry` interface += `subscribeStatus`; `OrchestratorOpts` drop `handoffPollMs`; replace the handoff await-idle poll with an event-driven `awaitHandoffSettled` helper. |
| `src/main/mcpOrchestrator.test.ts` | modify | Add `subscribeStatus` to all 7 registry build-sites; rewrite the 4 await-idle handoff tests to drive settle via the status emitter. |
| `src/main/index.ts` | modify | Wire `subscribeStatus: subscribeBoardStatus` into the production `BoardRegistry` literal. |

---

## Task 1: Pure `diffStatus` differ in boardRegistry.ts

**Files:**
- Modify: `Z:\Canvas ADE\src\main\boardRegistry.ts`
- Test: `Z:\Canvas ADE\src\main\boardRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `boardRegistry.test.ts` — extend the import on line 2-9 to include `diffStatus` and the new type,
then add a `describe` block:

```ts
// add to the existing import from './boardRegistry':
//   diffStatus,
//   type BoardStatusChange,

describe('diffStatus', () => {
  it('emits changed + new-with-bucket, skips unchanged + bucketless-new, emits gone for any vanished id', () => {
    const prev = [
      { id: 'a', type: 'terminal', title: 'A', status: 'running' },
      { id: 'b', type: 'browser', title: 'B', status: 'idle' },
      { id: 'c', type: 'planning', title: 'C' } // bucketless
    ]
    const next = [
      { id: 'a', type: 'terminal', title: 'A', status: 'idle' }, // changed
      { id: 'b', type: 'browser', title: 'B', status: 'idle' }, // unchanged
      { id: 'd', type: 'terminal', title: 'D', status: 'running' } // new, bucketed
      // c vanished
    ]
    expect(diffStatus(prev, next)).toEqual([
      { id: 'a', status: 'idle' },
      { id: 'd', status: 'running' },
      { id: 'c', status: 'gone' }
    ])
  })

  it('emits nothing for an identical snapshot', () => {
    const s = [{ id: 'a', type: 'terminal', title: 'A', status: 'running' }]
    expect(diffStatus(s, s)).toEqual([])
  })

  it('skips a board that newly appears WITHOUT a bucket', () => {
    expect(diffStatus([], [{ id: 'x', type: 'planning', title: 'X' }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/boardRegistry.test.ts -t diffStatus`
Expected: FAIL — `diffStatus is not a function` / no export.

- [ ] **Step 3: Write the implementation**

In `boardRegistry.ts`, after the `ConnectorMirror` interface / `STATUS_BUCKETS` block (before
`let mirror`), add:

```ts
/** A coarse per-board status change (M5). `status` is a STATUS_BUCKETS value, or 'gone'. */
export interface BoardStatusChange {
  id: string
  status: string
}

/**
 * Pure differ: the per-board status changes between two snapshots (M5 event-driven attention).
 * Emits a change for any board whose known bucket changed or first appeared WITH a bucket, and a
 * `{ status: 'gone' }` for any id present before and now absent. A board newly appearing WITHOUT a
 * bucket is skipped (the renderer always buckets now; the bucketless fallback is legacy).
 */
export function diffStatus(prev: BoardMirror[], next: BoardMirror[]): BoardStatusChange[] {
  const prevById = new Map(prev.map((b) => [b.id, b.status]))
  const nextIds = new Set(next.map((b) => b.id))
  const changes: BoardStatusChange[] = []
  for (const b of next) {
    if (b.status !== undefined && b.status !== prevById.get(b.id)) {
      changes.push({ id: b.id, status: b.status })
    }
  }
  for (const b of prev) {
    if (!nextIds.has(b.id)) changes.push({ id: b.id, status: 'gone' })
  }
  return changes
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/boardRegistry.test.ts -t diffStatus`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/boardRegistry.ts src/main/boardRegistry.test.ts
git commit -m "feat(mcp): pure diffStatus differ for board status changes (M5 PR1)" --no-verify
```

---

## Task 2: `subscribeBoardStatus` emitter wired into snapshot apply

**Files:**
- Modify: `Z:\Canvas ADE\src\main\boardRegistry.ts`
- Test: `Z:\Canvas ADE\src\main\boardRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `boardRegistry.test.ts` (extend the import to add `subscribeBoardStatus`,
`__applySnapshotForTest`):

```ts
describe('subscribeBoardStatus', () => {
  it('emits per-board changes on each snapshot apply, including gone; unsub stops delivery', () => {
    __setMirrorForTest([]) // reset the module baseline
    const seen: BoardStatusChange[] = []
    const unsub = subscribeBoardStatus((c) => seen.push(c))

    __applySnapshotForTest([
      { id: 'a', type: 'terminal', title: 'A', status: 'running' },
      { id: 'b', type: 'browser', title: 'B', status: 'idle' }
    ])
    __applySnapshotForTest([{ id: 'a', type: 'terminal', title: 'A', status: 'idle' }]) // a changed; b gone

    unsub()
    __applySnapshotForTest([{ id: 'a', type: 'terminal', title: 'A', status: 'running' }]) // ignored

    expect(seen).toEqual([
      { id: 'a', status: 'running' },
      { id: 'b', status: 'idle' },
      { id: 'a', status: 'idle' },
      { id: 'b', status: 'gone' }
    ])
  })

  it('isolates a throwing listener from the others', () => {
    __setMirrorForTest([])
    const seen: BoardStatusChange[] = []
    const unsubBad = subscribeBoardStatus(() => {
      throw new Error('boom')
    })
    const unsubGood = subscribeBoardStatus((c) => seen.push(c))
    expect(() =>
      __applySnapshotForTest([{ id: 'a', type: 'terminal', title: 'A', status: 'idle' }])
    ).not.toThrow()
    expect(seen).toEqual([{ id: 'a', status: 'idle' }])
    unsubBad()
    unsubGood()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/boardRegistry.test.ts -t subscribeBoardStatus`
Expected: FAIL — `subscribeBoardStatus` / `__applySnapshotForTest` not exported.

- [ ] **Step 3: Write the implementation**

In `boardRegistry.ts`:

(a) After `let connectorMirror: ConnectorMirror[] = []` add the listener set + emit helper:

```ts
/** Listeners notified on each per-board status change (M5 event-driven attention). */
const statusListeners = new Set<(change: BoardStatusChange) => void>()

function emitStatus(change: BoardStatusChange): void {
  for (const cb of statusListeners) {
    try {
      cb(change)
    } catch {
      // 🔒 Isolate a throwing listener so one bad subscriber can't break the push fan-out.
    }
  }
}

/** Replace the stored snapshot and emit the per-board status diffs (M5). */
function applySnapshot(nextBoards: BoardMirror[], nextConnectors: ConnectorMirror[]): void {
  const changes = diffStatus(mirror, nextBoards)
  mirror = nextBoards
  connectorMirror = nextConnectors
  for (const c of changes) emitStatus(c)
}

/**
 * Subscribe to per-board status changes (M5). Returns an unsubscribe fn. The MCP adapter forwards
 * these so the handoff await-idle (and, in PR2, the barriers + canvas://attention notifier) wakes
 * on real board state instead of polling.
 */
export function subscribeBoardStatus(listener: (change: BoardStatusChange) => void): () => void {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

/** Test seam — apply a snapshot through the diff/emit path (unit tests only). */
export function __applySnapshotForTest(
  boards: BoardMirror[],
  connectors: ConnectorMirror[] = []
): void {
  applySnapshot(boards, connectors)
}
```

(b) Route the `mcp:boards` handler through `applySnapshot`. Replace the body of the
`ipcMain.on('mcp:boards', …)` callback's payload branch:

```ts
    if (Array.isArray(payload)) {
      // Legacy / version-skew only: a renderer predating T4.6 sends a bare boards array.
      applySnapshot(sanitizeSnapshot(payload), [])
    } else if (payload && typeof payload === 'object') {
      const { boards, connectors } = payload as { boards?: unknown; connectors?: unknown }
      applySnapshot(sanitizeSnapshot(boards), sanitizeConnectors(connectors))
    }
```

- [ ] **Step 4: Run the full registry test file to verify pass**

Run: `pnpm vitest run src/main/boardRegistry.test.ts`
Expected: PASS (all existing + the new `subscribeBoardStatus` tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/boardRegistry.ts src/main/boardRegistry.test.ts
git commit -m "feat(mcp): subscribeBoardStatus emitter on snapshot apply (M5 PR1)" --no-verify
```

---

## Task 3: `BoardRegistry.subscribeStatus` interface + production wiring + test-fake plumbing

**Files:**
- Modify: `Z:\Canvas ADE\src\main\mcpOrchestrator.ts` (interface)
- Modify: `Z:\Canvas ADE\src\main\index.ts` (production wiring)
- Modify: `Z:\Canvas ADE\src\main\mcpOrchestrator.test.ts` (test fakes compile)

This task adds the method everywhere it must exist so the tree typechecks; **no behavior change yet**
(handoff still uses the old poll until Task 4). Its "test" is the full suite + typecheck staying green.

- [ ] **Step 1: Add the method to the `BoardRegistry` interface**

In `mcpOrchestrator.ts`, inside `export interface BoardRegistry`, after the `listSessions(): …` member,
add:

```ts
  /**
   * Subscribe to per-board coarse status changes (M5 event-driven attention). MAIN injects
   * `boardRegistry.ts`'s `subscribeBoardStatus`. Emits `{ id, status }` on each change
   * (`status: 'gone'` when a board leaves the canvas); returns an unsubscribe fn. The handoff
   * await-idle wakes on these instead of polling.
   */
  subscribeStatus(listener: (change: { id: string; status: string }) => void): () => void
```

- [ ] **Step 2: Wire the production registry**

In `index.ts`:
- Add `subscribeBoardStatus` to the existing `import { … } from './boardRegistry'`.
- In the `startMcpServer({ … })` registry literal, add the line directly after `listSessions: listPtySessions,`:

```ts
    subscribeStatus: subscribeBoardStatus,
```

- [ ] **Step 3: Add the method to every test-fake registry**

In `mcpOrchestrator.test.ts`, add `subscribeStatus: () => () => {}` to **each** `BoardRegistry`
build-site. There are 7 — find them with:

Run: `grep -n "listSessions:" src/main/mcpOrchestrator.test.ts`

For each literal (the `reg()` helper's returned object near L61, and the inline literals near L141,
L310, L453 `dispatchReg`, L723 `assignReg`, L906 interrupt, L1033 relay), add the no-op member, e.g.:

```ts
        listSessions: () => [],
        subscribeStatus: () => () => {},
```

(Task 4 replaces the `dispatchReg` one with a controllable emitter; a no-op is fine for now.)

- [ ] **Step 4: Verify the tree typechecks + the suite is green**

Run: `pnpm vitest run src/main/mcpOrchestrator.test.ts src/main/boardRegistry.test.ts`
Expected: PASS (unchanged behavior).
Run: `npx tsc -p tsconfig.node.json --noEmit` (or `pnpm typecheck` in a provisioned env)
Expected: no errors from these files. (In a junctioned worktree the node leg may report the pre-existing
MCP `TS2307` only — unrelated; web/preload legs must be clean.)

- [ ] **Step 5: Commit**

```bash
git add src/main/mcpOrchestrator.ts src/main/index.ts src/main/mcpOrchestrator.test.ts
git commit -m "feat(mcp): BoardRegistry.subscribeStatus interface + wiring (M5 PR1)" --no-verify
```

---

## Task 4: Event-driven handoff await-idle (retire the poll)

**Files:**
- Modify: `Z:\Canvas ADE\src\main\mcpOrchestrator.ts`
- Modify: `Z:\Canvas ADE\src\main\mcpOrchestrator.test.ts`

- [ ] **Step 1: Rewrite the `dispatchReg` test helper to expose a status emitter**

In `mcpOrchestrator.test.ts`, in the `handoffPrompt` describe block, change `dispatchReg` to capture the
subscribed listener and return `emitStatus` + `hasListener`. Replace the `subscribeStatus: () => () => {}`
member added in Task 3 with a capturing one, and extend the return:

```ts
    function dispatchReg(opts: {
      boards: Board[]
      sessions?: Array<{ id: string; status: string }>
      result?: BoardResult
      confirm?: (req: { title: string; body: string }) => Promise<{ approved: boolean }>
      writeToPty?: (id: string, text: string) => boolean
    }): {
      registry: BoardRegistry
      audits: AuditInput[]
      writes: Array<{ id: string; text: string }>
      confirms: Array<{ title: string; body: string }>
      emitStatus: (change: { id: string; status: string }) => void
      hasListener: () => boolean
    } {
      const audits: AuditInput[] = []
      const writes: Array<{ id: string; text: string }> = []
      const confirms: Array<{ title: string; body: string }> = []
      let statusListener: ((c: { id: string; status: string }) => void) | null = null
      const registry: BoardRegistry = {
        listBoards: () => opts.boards,
        listConnectors: () => [],
        listSessions: () => opts.sessions ?? [],
        subscribeStatus: (l) => {
          statusListener = l
          return () => {
            statusListener = null
          }
        },
        readOutput: () => EMPTY_OUTPUT,
        readResult: () => opts.result ?? EMPTY_RESULT,
        readMemory: () => EMPTY_MEMORY,
        readSummary: () => EMPTY_MEMORY,
        sendCommand: async (cmd) => ({ ok: true, type: cmd.type }),
        drainPty: async () => {},
        writeToPty: (id, text) => {
          writes.push({ id, text })
          return opts.writeToPty ? opts.writeToPty(id, text) : true
        },
        confirm: async (req) => {
          confirms.push(req)
          return opts.confirm ? opts.confirm(req) : { approved: true }
        },
        audit: async (input) => {
          audits.push(input)
        },
        recordResult: () => {}
      }
      return {
        registry,
        audits,
        writes,
        confirms,
        emitStatus: (change) => statusListener?.(change),
        hasListener: () => statusListener !== null
      }
    }
```

- [ ] **Step 2: Rewrite the 4 await-idle tests to drive settle via the emitter**

Replace the four tests (current L566, L595, L614, L641 — the ones using `sleep` + `handoffPollMs`) with:

```ts
    it('🔒 audits `dispatched` at write time — BEFORE await-idle resolves (crash-durable trail)', async () => {
      const board: Board = { id: 't1', type: 'terminal', title: 'Term', status: 'running' }
      const { registry, audits, emitStatus, hasListener } = dispatchReg({
        boards: [board],
        result: { present: true }
      })
      // Backstop sleep never resolves → the ONLY way to settle is the status event.
      const orch = buildOrchestrator(registry, { sleep: () => new Promise<void>(() => {}) })
      const p = orch.handoffPrompt('t1', 'x')
      while (!hasListener()) await Promise.resolve() // the await-idle has parked on the stream
      const dispatchedBeforeWait = audits.some((a) => a.status === 'dispatched')
      board.status = 'idle'
      emitStatus({ id: 't1', status: 'idle' })
      await p
      expect(dispatchedBeforeWait).toBe(true)
      expect(audits.some((a) => a.status === 'completed')).toBe(true)
    })

    it('await-idle: parks on the status stream while running, resolves on the idle event', async () => {
      const result: BoardResult = { present: true, status: 'success', summary: 'ok' }
      const board: Board = { id: 't1', type: 'terminal', title: 'Term', status: 'running' }
      const { registry, writes, emitStatus, hasListener } = dispatchReg({ boards: [board], result })
      // No poll, no backstop: a never-resolving sleep proves resolution is event-driven.
      const orch = buildOrchestrator(registry, { sleep: () => new Promise<void>(() => {}) })
      const p = orch.handoffPrompt('t1', 'x')
      while (!hasListener()) await Promise.resolve()
      board.status = 'idle'
      emitStatus({ id: 't1', status: 'idle' })
      const res = await p
      expect(writes).toEqual([{ id: 't1', text: 'x\r' }])
      expect(res).toEqual(result)
    })

    it('BUG-008: a board that vanishes mid await-idle resolves `closed` (no stale-snapshot stall)', async () => {
      const boards: Board[] = [{ id: 't1', type: 'terminal', title: 'Term', status: 'running' }]
      const { registry, audits, emitStatus, hasListener } = dispatchReg({ boards })
      const orch = buildOrchestrator(registry, { sleep: () => new Promise<void>(() => {}) })
      const p = orch.handoffPrompt('t1', 'x')
      while (!hasListener()) await Promise.resolve()
      boards.splice(0, boards.length) // user-closed / reaped
      emitStatus({ id: 't1', status: 'gone' })
      await p
      expect(audits.some((a) => a.status === 'closed')).toBe(true)
      expect(audits.some((a) => a.status === 'completed')).toBe(false)
    })

    it('BUG-008: a board stuck `running` past the deadline resolves `timed_out`, not `completed`', async () => {
      const board: Board = { id: 't1', type: 'terminal', title: 'Term', status: 'running' }
      const { registry, audits } = dispatchReg({ boards: [board] })
      // Backstop fires immediately and no idle event ever arrives → timed_out.
      const orch = buildOrchestrator(registry, { sleep: async () => {} })
      await orch.handoffPrompt('t1', 'x')
      expect(audits.some((a) => a.status === 'timed_out')).toBe(true)
      expect(audits.some((a) => a.status === 'completed')).toBe(false)
    })
```

- [ ] **Step 3: Run the rewritten tests to verify they FAIL against the current poll impl**

Run: `pnpm vitest run src/main/mcpOrchestrator.test.ts -t "await-idle"` and
`pnpm vitest run src/main/mcpOrchestrator.test.ts -t "BUG-008"` and `… -t "crash-durable"`
Expected: FAIL/HANG — the current poll impl ignores `subscribeStatus` and awaits `sleep` (which now
never resolves), so the running-board tests time out. (This proves the tests exercise the new path.)

- [ ] **Step 4: Implement the event-driven await-idle**

In `mcpOrchestrator.ts`:

(a) In `OrchestratorOpts`, **delete** the `handoffPollMs?: number` member and its comment; update the
two neighbouring comments:

```ts
  /** Backstop timer seam for the handoff await-idle deadline (injected by tests to avoid real timers). */
  sleep?: (ms: number) => Promise<void>
  /** Backstop deadline for the handoff await-idle (M5: the await is event-driven via subscribeStatus). */
  handoffTimeoutMs?: number
```

(b) In `buildOrchestrator`, **delete** `const handoffPollMs = opts.handoffPollMs ?? 250`. Keep `sleep`
and `handoffTimeoutMs`.

(c) After the `reconcile` helper (before `return {`), add the settle helper:

```ts
  /**
   * Await the dispatched board leaving `running`, event-driven off the status stream (M5 — replaces
   * the old busy-poll). Resolves 'idle' when it settles, 'closed' when it leaves the canvas, or
   * 'timed_out' at the backstop deadline. Re-resolves the LIVE derived status on each wake so a stale
   * pre-write 'running' snapshot can't stall it (BUG-008 discipline).
   */
  const awaitHandoffSettled = (boardId: string): Promise<'idle' | 'closed' | 'timed_out'> => {
    const check = (): 'idle' | 'closed' | null => {
      const live = registry.listBoards().find((b) => b.id === boardId)
      if (!live) return 'closed'
      return deriveStatus(live, sessionMap()) !== 'running' ? 'idle' : null
    }
    const immediate = check()
    if (immediate) return Promise.resolve(immediate)
    return new Promise<'idle' | 'closed' | 'timed_out'>((resolve) => {
      let settled = false
      let unsub = (): void => {}
      const finish = (exit: 'idle' | 'closed' | 'timed_out'): void => {
        if (settled) return
        settled = true
        unsub()
        resolve(exit)
      }
      unsub = registry.subscribeStatus((change) => {
        if (change.id !== boardId) return
        const c = check()
        if (c) finish(c)
      })
      // One-shot backstop (NOT a poll): a single deadline timer via the injected `sleep` seam.
      void sleep(handoffTimeoutMs).then(() => finish('timed_out'))
    })
  }
```

(d) In `handoffPrompt`, replace the entire step-(7) `while (now() < deadline) { … }` loop (the
`const deadline = …` through the `}` after `await sleep(handoffPollMs)`) and its preceding `let exit`
line with:

```ts
      // (7) Await idle — event-driven off the status stream (M5). No busy-poll: park on the first
      // status change for this board (re-resolving the live derived status on wake), bounded by a
      // one-shot backstop deadline.
      const exit = await awaitHandoffSettled(boardId)
      const result = registry.readResult(boardId)
```

(Leave step (8) — the outcome audit `status: exit === 'idle' ? 'completed' : exit` — unchanged.)

- [ ] **Step 5: Run the handoff suite to verify it now passes**

Run: `pnpm vitest run src/main/mcpOrchestrator.test.ts`
Expected: PASS (all handoff tests, incl. the 4 rewritten + the unchanged reject/deny/nonce ones, and the
whole file).

- [ ] **Step 6: Commit**

```bash
git add src/main/mcpOrchestrator.ts src/main/mcpOrchestrator.test.ts
git commit -m "refactor(mcp): handoff await-idle is event-driven, poll retired (M5 PR1)" --no-verify
```

---

## Task 5: Full local gate + PR

**Files:** none (verification only)

- [ ] **Step 1: Run the MAIN unit + integration suite**

Run: `pnpm vitest run src/main`
Expected: PASS (no regressions; `boardRegistry` + `mcpOrchestrator` green).

- [ ] **Step 2: Lint + web/preload typecheck**

Run: `pnpm lint`
Expected: 0 errors.
Run: `npx tsc -p tsconfig.web.json --noEmit && npx tsc -p tsconfig.preload.json --noEmit`
Expected: clean. (Node leg / full `pnpm typecheck` + `pnpm build` + `pnpm test:e2e:matrix` need the
provisioned token'd env — run there before opening the PR if available; otherwise note it in the PR.)

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/m5-app-event-source
gh pr create --base main --title "feat(mcp): M5 PR1 — board status event source + event-driven handoff await-idle" \
  --body "App-side half of canvas-ade-mcp M5. Adds a per-board status-change emitter (boardRegistry diffStatus + subscribeBoardStatus), wires it into the BoardRegistry interface, and retires the handoff await-idle busy-poll in favour of an event-driven wait. No package contract change (that is PR2). Spec: canvas-ade-mcp docs/superpowers/specs/2026-06-05-m5-barriers-attention-design.md."
```

---

## Self-Review

**1. Spec coverage (PR1 scope = spec §4 + D3):**
- §4.1 boardRegistry emitter (diff + subscribe + 'gone' + listener isolation) → Tasks 1, 2. ✅
- §4.2 retire the handoff poll, keep timeout as backstop, security sequence unchanged → Task 4 (the
  nonce → confirm → audit → write path in `handoffPrompt` is untouched; only step 7 changes). ✅
- §4.3 mcp.ts "no new wiring" → confirmed: only the `BoardRegistry` literal in `index.ts` gains one line
  (Task 3); `mcp.ts` itself is unchanged. ✅
- D4 push bridge (typed `{id,status}` delta, no per-tick re-read) → `subscribeStatus` carries the delta;
  `awaitHandoffSettled` re-resolves only on a real event, not on an interval. ✅
- **Out of PR1 scope (PR2):** `Orchestrator.subscribeStatus` (pkg contract), `wait_for_*` tools,
  `AttentionNotifier`, `resources/subscribe`. Not implemented here by design. The `reapIdle` 60s sweep is
  a periodic reaper, not a busy-poll, and is intentionally untouched.

**2. Placeholder scan:** none — every step has concrete code/commands.

**3. Type consistency:** `BoardStatusChange = { id: string; status: string }` is used identically in
`boardRegistry.ts` (exported), the `BoardRegistry.subscribeStatus` listener param, the production
`subscribeBoardStatus` (structurally identical shape), and the test emitter. `awaitHandoffSettled`
returns `'idle' | 'closed' | 'timed_out'`, matching the `exit` consumed by the unchanged step-(8) audit.
`diffStatus`/`subscribeBoardStatus`/`__applySnapshotForTest`/`applySnapshot`/`emitStatus` names are used
consistently across Tasks 1–3.

---

## Note on PR2 (separate plan, after PR1 merges + publishes)

PR2 (`canvas-ade-mcp`): add `Orchestrator.subscribeStatus` + mock emitter, `BarrierWaiter` +
`wait_for_idle`/`wait_for_all` tools, the `AttentionNotifier` + manual `resources/subscribe` handlers,
bump `0.9.0`, publish; then a Canvas ADE adopt commit forwards `registry.subscribeStatus` (attaching
`readResult` on idle) through `buildOrchestrator` as the pkg `Orchestrator.subscribeStatus`. Its plan is
written once PR1 is on `main` and `0.9.0` is published, so it can pin to the real published surface and
add the live test against the running app.
