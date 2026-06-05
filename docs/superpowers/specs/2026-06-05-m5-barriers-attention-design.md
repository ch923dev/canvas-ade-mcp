# M5 — Barriers + event-driven attention — design spec

**Date:** 2026-06-05 · **Roadmap phase:** canvas-ade-mcp Phase 5 (`docs/roadmap.md` › "Barriers +
event-driven attention") · **Status:** approved design, pre-implementation.

**Spans two repos:** the server package `@ch923dev/canvas-ade-mcp` (this repo) **and** the Canvas ADE
desktop app MAIN process (`Z:\Canvas ADE\src\main`), which owns the live board state. The app-side
change is the **enabling half** — it must land first so the pkg's live tests have a real event source.

---

## 1. Goal

Let an orchestrator agent **wait** on worker boards efficiently and **event-driven**, never by polling.
Two new orchestrator-tier tools — `wait_for_idle(boardId)` and `wait_for_all(boardIds[])` — resolve the
moment the target board(s) stop working, and report *how* they stopped (done vs needs-a-human vs
crashed). The same status-change stream makes the read-only `canvas://attention` resource **push** to
subscribed clients (`notifications/resources/updated`) and **retires the last busy-poll** in the
codebase (the handoff await-idle loop).

### Acceptance (from the roadmap)

- ✅ Barriers resolve **event-driven off real board state; no busy-poll.**
- 🧪 Contract: subscribe → mutate status → subscriber woken; states distinguished.
- 🧪 Live: orchestrator dispatches to a worker + `wait_for_idle` resolves **exactly** when the real
  board goes idle (not on a timer); a blocked worker surfaces as `blocked`, not `idle`.

---

## 2. Decisions (locked during brainstorm)

| # | Fork | Decision | Why |
|---|------|----------|-----|
| D1 | Barrier API shape | **Hybrid** — blocking tools `wait_for_idle`/`wait_for_all` (primary agent ergonomic, internally event-driven) **plus** `notifications/resources/updated` on `canvas://attention` for the human "needs-you" queue + passive subscribers. | One tool call for the agent (mirrors `handoff_prompt`); Claude Code doesn't drive control flow off resource subscriptions, so the wait can't live only in the client. Notifications keep the attention resource live for subscribers. |
| D2 | Resolution semantics | **Settle-and-report** — "settled" = **any non-`running` bucket**: resolve the moment the board leaves `running` into `idle` / `static` / `awaiting-review` / `blocked` / `failed` (or `gone` if it leaves the canvas); return that status (+ last `write_result` when present). **Level-triggered** (immediate if already settled at call time). | Never hangs on a board no human unblocks; a normal "needs human" is a result, not an error. No missed-edge race. |
| D3 | Handoff poll | **Retire it** — route `handoff_prompt`'s await-idle through the same host status stream; delete the `handoffPollMs`/`handoffTimeoutMs` busy-poll (keep a timeout only as a backstop). | Fully satisfies "no busy-poll"; the app code already flags `handoffTimeoutMs` as "M5 replaces this with real attention." Unifies one wait mechanism. |
| D4 | App→pkg bridge | **Push** — the adapter hands the pkg a typed `{id,status}` delta; barriers/notifier never re-read `listBoards()` per tick. | One source of truth (the renderer's bucket); level-triggered reads only at barrier start. |

---

## 3. Architecture — the event spine

Today board status is **pull-only**: the renderer derives a coarse bucket per board and pushes a
snapshot over IPC `mcp:boards`; `boardRegistry.ts` stores the latest `mirror`; the adapter reads it;
`handoff_prompt` busy-polls `listSessions()` for idle. M5 turns the **single place a snapshot lands**
into a change emitter and threads it through to barriers + SSE.

```
renderer (derives buckets: idle/running/awaiting-review/blocked/failed/static; pushes on change)
   │  IPC  mcp:boards  { boards, connectors }
   ▼
boardRegistry.ts  ── diff new vs prev mirror ──►  fire BoardStatusChange { id, status }   [NEW emitter]
   │   subscribeBoardStatus(cb): () => void           (id dropped from snapshot → status 'gone')
   ▼
mcpOrchestrator.ts  implements Orchestrator.subscribeStatus(cb)                            [NEW iface]
   │       └── handoff await-idle now LISTENS on this (poll deleted; timeout = backstop only)
   ▼  injected as the Orchestrator the pkg consumes
canvas-ade-mcp  ServerFactory (per session)
   ├── wait_for_idle / wait_for_all  ── BarrierWaiter resolves off the subscription (no poll)
   └── AttentionNotifier ── on attention-set delta ──►  server.sendResourceUpdated('canvas://attention')
                                                         → only to clients that resources/subscribe'd
```

The bridge is **entirely through the `Orchestrator` interface** — the pkg stays Electron-free and
standalone-testable against the mock.

---

## 4. App side — Canvas ADE MAIN (lands first)

### 4.1 `boardRegistry.ts` — become a change emitter
- Keep `prevStatus: Map<id, string>` across `mcp:boards` pushes.
- After `sanitizeSnapshot`, diff per id: emit `{ id, status }` for any **new or changed** bucket; emit
  `{ id, status: 'gone' }` for ids that were present and dropped out of the new snapshot.
- Add `subscribeBoardStatus(cb: (c: { id: string; status: string }) => void): () => void` backed by a
  bounded listener `Set`. Fan-out wrapped per-listener in `try/catch` so one throwing listener can't
  break the push (same discipline as the existing IPC guards).
- Keep a test seam to drive a snapshot directly (extend the existing `__setMirrorForTest`).

### 4.2 `mcpOrchestrator.ts` — implement the subscription + retire the poll
- Implement `subscribeStatus` by delegating to `registry.subscribeBoardStatus`, mapping to
  `BoardStatusChange` and attaching `boardResult(id)` when a board settles to `idle` (so a barrier can
  return the last result).
- **Retire the handoff poll:** replace the `sleep`/`handoffPollMs` loop with a one-shot status listener
  that resolves when the target leaves `running` (shared "settled?" predicate). `handoffTimeoutMs`
  stays **only** as a backstop deadline. **The security sequence is unchanged** — opaque-id resolve →
  terminal-only → `sanitizeDispatchText` → single-use nonce → mandatory human `confirm` → audit → PTY
  write all stay byte-for-byte; only the "wait until idle" *after* the write changes.
- Delete the now-unused `handoffPollMs`/`sleep` poll seam (or keep `sleep` only if another caller needs
  it — check at impl time).

### 4.3 `mcp.ts` — no new wiring
The adapter it already constructs simply gains `subscribeStatus`; the pkg consumes it through the
interface. No new IPC channel.

---

## 5. Pkg side — `canvas-ade-mcp`

### 5.1 `orchestrator/Orchestrator.ts` — extend the interface
```ts
export interface BoardStatusChange {
  id: BoardId
  status: string                 // a STATUS_BUCKETS value, or 'gone'
  result?: BoardResult           // attached when status === 'idle' and a write_result exists
}
// added to Orchestrator:
subscribeStatus(listener: (change: BoardStatusChange) => void): () => void  // returns unsubscribe
```
`orchestrator/mock.ts` — add an internal emitter + a `__emitStatus(change)` test seam.

### 5.2 `src/server/tools/barriers.ts` — the two tools
- `wait_for_idle` and `wait_for_all`, registered in `factory.ts` **inside the `tier==='orchestrator'`
  block** (structural capability split — a worker's `tools/list` never contains them).
- Constants `TOOL_WAIT_FOR_IDLE` / `TOOL_WAIT_FOR_ALL` in `constants.ts`.
- Thin tools over a shared **`BarrierWaiter`** (own module, pure-ish, unit-testable): given a target id
  set + the orchestrator subscription + a timeout, it reads current statuses **once** (level-trigger →
  resolve immediately if already settled), otherwise subscribes and resolves when the whole set has
  settled or the timeout fires. Unsubscribes on resolve.

### 5.3 `AttentionNotifier` — push the resource
- Per session, wired in `factory.ts`: subscribe to `orchestrator.subscribeStatus`; when the
  **attention-bucket membership** (`blocked` / `awaiting-review` / `failed`, per `ATTENTION_BUCKETS`)
  changes, call `server.server.sendResourceUpdated({ uri: 'canvas://attention' })`.
- The SDK's high-level `McpServer` does **not** auto-wire resource subscriptions (verified against
  `@modelcontextprotocol/sdk` 1.29.0 — only `sendResourceUpdated` + the notification routing exist).
  So M5 must **manually**: (a) `registerCapabilities({ resources: { subscribe: true } })`; (b) register
  `resources/subscribe` + `resources/unsubscribe` request handlers that track subscribed URIs per
  session; (c) only emit `sendResourceUpdated` to sessions that subscribed to that URI. Isolate this in
  one module so a future SDK bump is a one-file change (same pattern as `transport.ts`).

### 5.4 Cleanup / leak discipline
Unsubscribe the orchestrator listener and drop any pending `BarrierWaiter`s on server/session close
(extend `SessionManager.closeAll`). A board going `gone` mid-wait resolves the barrier rather than
leaking a waiter — same hygiene the MCP review verified for nonce eviction (BUG-020) and `closeAll`.

---

## 6. Resolution contract (the tool I/O)

**`wait_for_idle(boardId: string, timeoutMs?: number)` → `{ id, status, result? }`**
- `status` ∈ `idle | static | awaiting-review | blocked | failed | gone | timed-out`. The settled
  predicate is simply `status !== 'running'` (`static` = a non-terminal Browser/Planning board, already
  at rest → resolves immediately).
- Resolves the instant the board leaves `running`; **immediate** if already settled at call time;
  `gone` if the id leaves the mirror; `result` attached only when `idle` and a `write_result` exists.

**`wait_for_all(boardIds: string[], timeoutMs?: number)` → `{ boards: Array<{id,status,result?}>, allIdle }`**
- Resolves when **every** target has settled (or the timeout); reports each board; `allIdle` = every
  target settled to `idle`.

**Timeout** — optional `timeoutMs`; default backstop env-tunable (~30 min); `Infinity` / `≤0` opts out
(mirrors the `mcpConfirm` 10-min backstop convention). On expiry the tool **resolves** with
`status: 'timed-out'` — never throws — so an orchestrator `await` is never surprised by a rejection
(consistent with settle-and-report).

**Input validation** — `boardId` non-empty; `boardIds` non-empty array of non-empty strings; `timeoutMs`
finite-or-omitted. Mirror the existing tool zod schemas.

---

## 7. Security / tier

- **Orchestrator-tier only** (matches "the orchestrator able to wait"). A worker token never sees the
  tools (structural split in `factory.ts`).
- **Read-only wait** — no PTY write, no human `confirm`, no audit entry (consistent with the
  observation resources; audited actions are *writes*). 
- **No content exfiltration** — barriers return a coarse status bucket + the optional `write_result`
  summary the worker chose to publish; never scrollback, never page content.
- `canvas://attention` stays both-tier readable (observation is safe); the *notifications* ride the same
  read capability.

---

## 8. Testing — the two-layer gate (no tool ships without both)

### Contract (against the mock orchestrator)
- `__emitStatus` running→idle ⇒ `wait_for_idle` resolves `idle` (+ result when present).
- running→blocked ⇒ resolves `blocked`, **not** `idle`; running→failed ⇒ `failed`.
- Already-settled at call time ⇒ resolves immediately (no edge needed).
- `wait_for_all` waits for the **slowest** target; resolves once with all statuses; `allIdle` correct.
- Timeout ⇒ resolves `timed-out` (not throw); `Infinity`/`≤0` ⇒ no timeout.
- Id removed mid-wait ⇒ `gone`.
- Attention membership delta ⇒ **exactly one** `sendResourceUpdated('canvas://attention')`; a
  non-attention change (e.g. running→idle with nothing blocked) ⇒ **no** emit.
- `resources/subscribe`/`unsubscribe` tracked; no emit to a session that never subscribed.
- Worker-tier `tools/list` contains neither barrier tool.

### Live (against the real running Canvas ADE)
- Orchestrator dispatches to a worker terminal, then `wait_for_idle` resolves **exactly** when the board
  goes idle — assert it's event-timed (resolves well before any fixed backstop), not a sleep.
- A worker that blocks on a permission prompt surfaces as `blocked`.
- **Handoff regression** — `handoff_prompt` still resolves on the new stream (the poll is gone).

---

## 9. Sequencing & deliverables

1. **App event source + handoff refactor** (Canvas ADE) — `feat/*` worktree off `main`; unit-tested
   (boardRegistry diff/emit, mcpOrchestrator subscription, handoff await-idle on the listener). This is
   the dependency for the pkg live tests. → **PR 1** into Canvas ADE `main`.
2. **Pkg M5** (this repo) — `Orchestrator` iface + mock emitter + `BarrierWaiter` + the two tools +
   `AttentionNotifier` + subscribe handlers; contract-tested. Bump to **0.9.0**.
3. **Wire + live test** against the running app; publish `0.9.0`; Canvas ADE adopts the pin
   (`^0.9.0`). → **PR 2** (pkg) + the adopt commit on Canvas ADE.

Two PRs from this one spec. Implementation plan(s) follow via the writing-plans skill.

---

## 10. Out of scope (not now)

- **M-expose** (`canvas://memory` agent-readable) — separate deferred item, unblocked by M5 landing but
  not part of it.
- Per-board `canvas://board/{id}/status` push notifications — M5 emits for `canvas://attention` only
  (the roadmap's named resource); per-board push is a cheap additive follow-up if wanted.
- Git tools / Feature Workspaces (M6+).
- A richer status model than the existing six buckets — M5 consumes them as-is.
