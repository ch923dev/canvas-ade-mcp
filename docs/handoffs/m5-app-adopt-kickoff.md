# Kickoff — M5 App-Adopt: Canvas ADE consumes canvas-ade-mcp 0.9.0

**Date:** 2026-06-05 · **For:** the next session adopting the published `@ch923dev/canvas-ade-mcp@0.9.0` into the Canvas ADE app. This is the **final M5 step** — PR1 (app event source) and PR2 (pkg barriers + attention) are done; this wires the app to the published pkg.

**Read first (in order):**
1. This doc.
2. The plan — `docs/superpowers/plans/2026-06-05-m5-app-adopt.md` (the executable, task-by-task plan; **start here for the actual work**).
3. The spec — `docs/superpowers/specs/2026-06-05-m5-barriers-attention-design.md` §4.2 (app `subscribeStatus`), §8 (live), §9 step 3 (adopt). Locked design.

---

## ⛔ Gate: 0.9.0 must be PUBLISHED first

This work **cannot start** until `@ch923dev/canvas-ade-mcp@0.9.0` is on GitHub Packages. Verify before anything:

```
npm view @ch923dev/canvas-ade-mcp version    # must print 0.9.0
```

If it's not published yet: publish it by pushing the version tag (triggers `publish.yml`, which uses the repo's `GITHUB_TOKEN` — `packages: write`; billing is unblocked):

```
cd "Z:\canvas-ade-mcp" && git tag v0.9.0 208945f && git push origin v0.9.0
```

Watch the run; on green, `npm view …version` → `0.9.0`. Then proceed. (`208945f` = pkg `main` tip, the squash of PR #3 = 0.9.0.)

---

## Where things stand (2026-06-05)

- **Pkg `canvas-ade-mcp` 0.9.0 — MERGED to pkg `main`** (squash `208945f`, PR #3). Delivered: `Orchestrator.subscribeStatus` + `BoardStatusChange` (exported), `wait_for_idle`/`wait_for_all` barrier tools (orchestrator-tier, event-driven), `AttentionNotifier` (`canvas://attention` push), manual `resources/subscribe` wiring, per-session teardown. 127 contract + 30 live green. Built subagent-driven, fully reviewed. Memory `mcp-m5-barriers-attention`.
- **App PR1 already on Canvas ADE `main`** (squash `3824afc`, PR #70): `boardRegistry.ts` emits per-board status (`subscribeBoardStatus`), `BoardRegistry.subscribeStatus` member, event-driven handoff await-idle. So the app's event SOURCE is live; this adopt just FORWARDS it to the pkg contract.
- **App pin is `^0.8.2`** (`Z:\Canvas ADE\package.json`). This work bumps it to `^0.9.0`.

## What to build (summary — full detail in the plan)

The pkg 0.9.0 made `Orchestrator.subscribeStatus` a **required** member. The app's `buildOrchestrator` (`src/main/mcpOrchestrator.ts`) returns the object typed as that interface, so it must now provide `subscribeStatus`:

- **Task 1** — pin `^0.9.0` + install; `subscribeStatus` on the adapter: forward `registry.subscribeStatus` (PR1's `{id,status}` stream), attach `registry.readResult(id)` when `status === 'idle'` and a result is present. Unit-tested in `mcpOrchestrator.test.ts` (the `reg()` fake seeds `readResult` via its 4th arg).
- **Task 2** — integration test: the REAL `boardRegistry` emitter (`subscribeBoardStatus` + `__applySnapshotForTest`) flows a running→idle snapshot through the adapter with the result attached.
- **Task 3** — full gate + e2e matrix + PR + sequential merge.

**Zero other app wiring** — the pkg's server factory auto-registers the barrier tools + the attention notifier the moment the orchestrator satisfies the interface. The app's MCP server gains `wait_for_idle`/`wait_for_all` + the `canvas://attention` push for free.

## Process

1. **Skip brainstorming — spec locked, plan written.** Create a `feat/m5-app-adopt` worktree off Canvas ADE `main` (`.claude/tools/new-worktree.ps1`), then **`superpowers:subagent-driven-development`** to execute the plan task-by-task (fresh implementer per task + spec review then code review). Models: sonnet for the mechanical tasks, opus for the adapter/integration judgment + reviews; never haiku.
2. **CI is the real gate** (Canvas ADE Actions are green/unblocked now — memory `ci-green-2026-06-02`). Stop `--admin` merging.

## Gotchas (also in the plan)

- ⚠️ **Provisioned env needed for the `^0.9.0` install + node typecheck + e2e.** A junctioned worktree inherits MAIN's `node_modules` (still `^0.8.2`). Drop the junction → `NODE_AUTH_TOKEN=$(gh auth token) pnpm install` (resolves the private GH-Packages dep). Local junctioned gate = `pnpm vitest run` + `pnpm lint` + web/preload typecheck; node typecheck + `pnpm test:e2e:matrix` (Docker) need the token'd env. Memory `mcp-publish-gating`, `worktree-junction-stale-deps`.
- The bump makes the pkg `Orchestrator` require `subscribeStatus` → `pnpm typecheck:node` goes RED until the adapter implements it (that red is the TDD signal). If any TEST builds a bare `Orchestrator` literal directly (not via `buildOrchestrator`), add `subscribeStatus: () => () => {}` to it — grep `: Orchestrator\b` / `createMcpHttpServer(` in `src/main/*.test.ts` (the integration tests use `buildOrchestrator`, so likely none need it).
- `registry.readResult(id)` is SYNC (returns `BoardResult`); the `subscribeStatus` listener is sync — calling it directly is correct. Attach `result` ONLY on `idle` AND `present`.
- e2e: `e2e-browser-trio-flake` is a known env flake — rerun, not a regression.
- Commit messages via the Bash tool: use `git commit -F - <<'EOF' … EOF` (backticks in `-m` get shell-mangled).

## Downstream (after this merges)

**M-expose** (`canvas://memory` MCP read resource exposing `.canvas/memory/` to agents) is unblocked once the pkg surface lands on `main` — separate deferred item (CLAUDE.md / roadmap). Not part of this adopt.

## Relevant memories
`mcp-m5-barriers-attention`, `canvas-ade-mcp`, `mcp-publish-gating`, `worktree-junction-stale-deps`, `ci-green-2026-06-02`, `parallel-agent-worktrees`, `e2e-browser-trio-flake`, `bash-tool-commit-backticks`, `workflow-model-sonnet-not-haiku`.
