# Kickoff — M5 PR2: pkg barriers + event-driven attention notifier

**Date:** 2026-06-05 · **For:** the next session continuing canvas-ade-mcp **M5** (Barriers + event-driven
attention). **PR1 is DONE** — this is the second (pkg) half.

**Read first (in order):**
1. This doc.
2. The spec — `docs/superpowers/specs/2026-06-05-m5-barriers-attention-design.md` (esp. **§2 decisions**,
   **§5 pkg side**, **§6 resolution contract**, **§7 security**, **§8 testing**). It is the locked design.
3. The PR1 plan — `docs/superpowers/plans/2026-06-05-m5-pr1-app-event-source.md` — as the **model** for
   task granularity, TDD shape, and review cadence (don't re-implement it; it's merged).

---

## Where things stand (2026-06-05)

- **PR1 MERGED → Canvas ADE `main`** (squash `3824afc`, app PR #70). The app now:
  - emits per-board status changes (`boardRegistry.ts`: `diffStatus` + `subscribeBoardStatus`),
  - exposes `BoardRegistry.subscribeStatus` (MAIN-internal interface), wired in `index.ts`,
  - has an **event-driven** `handoff_prompt` await-idle (`awaitHandoffSettled`, poll retired).
  - **The app's `buildOrchestrator` does NOT yet implement the pkg's `Orchestrator.subscribeStatus`** —
    that pkg-contract method doesn't exist yet. Adding it + forwarding `registry.subscribeStatus` is
    **PR2's app-adopt step**, gated on the pkg shipping the new `Orchestrator` member + publishing 0.9.0.
- **This pkg** (`canvas-ade-mcp`) is on branch **`feat/m5-barriers-attention`** at **v0.8.2**. The spec +
  PR1 plan are already committed here (`50ffa51`, `e733a06`).
- PR1 was built **subagent-driven** (fresh implementer per task + two-stage spec/code review). Repeat that.

---

## What PR2 builds (from spec §5)

### A. Pkg `canvas-ade-mcp` (the bulk)
1. **`src/orchestrator/Orchestrator.ts`** — add
   `subscribeStatus(listener: (change: BoardStatusChange) => void): () => void` and the
   `BoardStatusChange = { id: BoardId; status: string; result?: BoardResult }` type.
2. **`src/orchestrator/mock.ts`** — add an internal emitter + a `__emitStatus(change)` test seam.
3. **`src/server/tools/barriers.ts`** (new) — `wait_for_idle(boardId, timeoutMs?)` +
   `wait_for_all(boardIds[], timeoutMs?)`, **registered in `factory.ts` inside the
   `ctx.tier === 'orchestrator'` block** (structural capability split — a worker never sees them).
   Constants `TOOL_WAIT_FOR_IDLE` / `TOOL_WAIT_FOR_ALL` in `constants.ts`. Thin tools over a shared
   **`BarrierWaiter`** (own module, unit-testable): level-trigger read once → resolve immediately if
   already settled; else subscribe and resolve when the target set settles or timeout. **Settle =
   any non-`running` bucket** (`idle | static | awaiting-review | blocked | failed | gone | timed-out`);
   return `{ id, status, result? }` / `{ boards:[…], allIdle }`. Timeout RESOLVES `timed-out` (never
   throws); `Infinity`/`≤0` opts out (mirror `mcpConfirm`).
4. **`AttentionNotifier`** (per session, wired in `factory.ts`) — subscribe to
   `orchestrator.subscribeStatus`; on a change to the **attention-bucket membership** (`ATTENTION_BUCKETS`
   in `resources/attention.ts`: `blocked`/`awaiting-review`/`failed`) call
   `server.server.sendResourceUpdated({ uri: 'canvas://attention' })`. Unsubscribe + drop pending
   `BarrierWaiter`s on session close (extend `SessionManager.closeAll` in `transport.ts`).
   ⚠️ **SDK gotcha (verified, `@modelcontextprotocol/sdk` 1.29.0):** the high-level `McpServer` does NOT
   auto-wire `resources/subscribe`. PR2 must manually (a) `server.server.registerCapabilities({ resources:
   { subscribe: true } })`, (b) register `resources/subscribe` + `resources/unsubscribe` request handlers
   tracking subscribed URIs per session, (c) only `sendResourceUpdated` to sessions that subscribed.
   Isolate in one module (same one-file-isolation discipline as `transport.ts`). Only `sendResourceUpdated`
   + the notification routing exist out of the box.
5. **Bump to `0.9.0`** + **two-layer test gate** (no tool ships without both):
   - **Contract** (mock): emit running→idle resolves idle; running→blocked resolves blocked (not idle);
     already-settled → immediate; `wait_for_all` waits for slowest; timeout→`timed-out`; id-removed→`gone`;
     attention membership delta → exactly one `sendResourceUpdated`; non-attention change → none;
     subscribe/unsubscribe tracked, no emit to non-subscribers; worker `tools/list` has neither barrier.
   - **Live** (real running Canvas ADE on `main`): orchestrator dispatches to a worker terminal +
     `wait_for_idle` resolves **exactly** when the board goes idle (event-timed, not a fixed delay); a
     blocked worker surfaces `blocked`; handoff regression still green.

### B. Canvas ADE app adopt (small, a separate PR)
In `Z:\Canvas ADE`, on a `fix/*`/`feat/*` worktree off `main`: `buildOrchestrator` implements the pkg's
new `Orchestrator.subscribeStatus` by forwarding `registry.subscribeStatus` (the PR1-shipped
`BoardRegistry.subscribeStatus`), **attaching `boardResult(id)` when a board settles to `idle`** so a
barrier can return the last result. Bump the app's pin to `@ch923dev/canvas-ade-mcp ^0.9.0`. Add the live
test. (PR1 already shipped everything this depends on, so this is purely additive.)

---

## Locked decisions — DO NOT re-decide (spec §2)
Hybrid API (blocking tools + `resources/updated`) · **settle-and-report** (resolve on any non-`running`,
level-triggered, return status+result) · retired handoff poll (done in PR1) · **push** bridge. The
barrier resolution contract is spec §6 verbatim.

---

## Process for the next session
1. **Skip brainstorming — the spec is locked.** Go straight to **`superpowers:writing-plans`** to produce
   the PR2 implementation plan (`docs/superpowers/plans/2026-06-05-m5-pr2-pkg-barriers.md`), reading the
   actual current pkg files first so code is exact (`Orchestrator.ts`, `mock.ts`, `factory.ts`,
   `transport.ts`, `resources/attention.ts`, `resources/boards.ts`, `constants.ts`, `server/tools/*`).
2. Then **`superpowers:subagent-driven-development`** (fresh implementer per task + spec review then code
   review). Models: sonnet for mechanical, opus for the notifier/subscribe-wiring + the security-adjacent
   bits + reviews; never haiku.
3. **Gate every task:** the pkg's `pnpm test` (vitest) + lint + **`pnpm format:check`** (memory
   `gate-must-run-format-check` — eslint ≠ prettier; PR1 failed CI on prettier alone) + typecheck.
   Commit per task; `--no-verify` only if a hook can't run.
4. **Publish 0.9.0** (memory `mcp-publish-gating`): app consumes the PUBLISHED pkg. Actions billing may be
   blocked → local `npm publish` bypass (needs `write:packages` scope; temp `.npmrc` with token, **rm
   after**). If using a junctioned worktree, **de-junction node_modules** (`cmd /c rmdir node_modules`)
   before the bump — never `rm -rf`.
5. The **app-adopt PR** lands after 0.9.0 is published, on a Canvas ADE worktree off `main` (CLAUDE.md:
   `main` = integration-only; CI is the green gate; merge sequentially).

## Pitfalls / pointers
- **Dispatch path is the trust boundary** — barriers are READ-ONLY waits (orchestrator-tier, no PTY write,
  no human confirm, no audit). Don't add any of those; they belong to dispatch tools only (spec §7).
- The 3 known LOW/INFO MCP items (APP-N1/N2, PKG-N1 from `docs/reviews/2026-06-05-mcp-indepth-review.md` in
  the Canvas ADE repo) are independent of M5 — optional opportunistic batch, not part of PR2.
- M5 unblocks **M-expose** (`canvas://memory`) once the pkg surface lands.
- Spec/PR1-plan branch: `feat/m5-barriers-attention` (`e733a06`). PR1 squash on app main: `3824afc`.
