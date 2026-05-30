# canvas-ade-mcp — Build Roadmap (ground 0 → full)

Phased plan to build the Canvas ADE MCP layer from an empty package to a full AI-orchestrated swarm.
Mirrors the Canvas ADE roadmap conventions: **each phase ends runnable + committed**, and — the
defining rule of this project — **each phase's tools pass BOTH test layers before it closes.**

Legend: 🚦 = hard gate · ✅ = acceptance · 📏 = measured/tested · ⛓ = depends on ·
🔒 = security-critical · 🧪 = the two-layer test gate (contract + live-against-Canvas-ADE).

> **The test rule (applies to every tool/resource in every phase):**
>
> 1. **Contract test** — against a mock `CanvasOrchestrator`: schema, auth, tier gating, errors.
> 2. **Live test** — against the _real_ running Canvas ADE (`CANVAS_SMOKE=e2e`, later Playwright):
>    assert the canvas actually changed. **No tool ships without a green live test.**

---

## Phase 0 — Scaffold + transport skeleton

Stand up the empty package and the loopback MCP endpoint. No real tools yet — prove an agent can
_connect_.

- Create the **standalone package** (`package.json`, its own git repo at `Z:\canvas-ade-mcp`, TS
  config mirroring Canvas ADE's strict settings). Add `@modelcontextprotocol/sdk`. **Canvas ADE
  consumes it as a local linked / path dependency** during dev (published + pinned later) — it is a
  sibling repo, **never nested in the Canvas ADE working tree**.
- One `/mcp` endpoint on the MAIN `localServer` via `StreamableHTTPServerTransport` (POST + GET-SSE +
  DELETE). 🔒 bind `127.0.0.1`, validate `Origin` (403 on bad), do **not** serve OAuth discovery.
- Health/`initialize` handshake; `Mcp-Session-Id` issued at init, `transports[]` map keyed by it.
- 🧪 **Contract:** transport accepts an `initialize`, returns capabilities, rejects bad `Origin`.
- 🧪 **Live:** boot Canvas ADE with the server on; a real MCP client (or a scripted client) connects
  over loopback and completes the handshake; `tools/list` returns empty.
- ✅📏 client connects + handshakes against the running app; bad-origin request gets 403; session id
  round-trips. ⛓ none.

---

## Phase 1 — Auth + capability tier-factory 🔒

> **Status:** ✅ shipped (2026-05-30, pre-MAIN). Capability split proven at
> `tools/list` + `tools/call`; invalid/expired/revoked/cross-board all 401; scope
> model + mint helper + `.mcp.json` writer landed and tested. Live tests run their
> own loopback HTTP server (the drive-the-real-Canvas-ADE form activates at the
> MAIN-wiring milestone). See ADR 0002.

The spine of the whole security model: prove that **what an agent can call is decided by its token,
server-side.**

- Per-board **bearer token** verifier map in MAIN (`token → { boardId, tier, scopes }`).
- `requireBearerAuth` on **every** request; re-derive tier from token each call (session-id =
  routing only, never authority).
- **Tier-factory:** build a fresh `McpServer` per session that registers **only** the allowed tier's
  tools (orchestrator vs worker). Never register-all-then-filter.
- Enforce required scope at **both** `tools/list` and `tools/call`.
- Project-scoped `.mcp.json` written into each board's worktree with its token (short-lived preferred
  over static-embedded).
- 🧪 **Contract:** orchestrator token lists orchestrator tools; worker token does NOT see/call them;
  wrong/expired token → hard 401; reused/cross-board token → reject.
- 🧪 **Live:** spawn two Terminal boards in Canvas ADE, mint a command-board token + a worker token;
  the worker client is denied a dispatch tool, the command-board client is allowed.
- ✅📏 capability split is enforced server-side and cannot be bypassed by prompt or annotation.
  🔒🚦 **gate:** a worker can NEVER reach a dispatch/git-write tool. ⛓ Phase 0.

---

## Phase 2 — Observation resources (read-only, lowest risk)

Give agents _eyes_ before _hands_. All read-only, so safest to ship first.

- Resources: `canvas://boards`, `canvas://board/{id}/status`, `canvas://board-states` (bucketed
  idle/running/awaiting-review/blocked/failed), `canvas://attention`.
- Read tools→resources done right: `canvas://board/{id}/output` (size-capped/paginated — 🔒 never
  dump raw scrollback; respect the 25k MCP output cap), and a structured `canvas://board/{id}/result`.
- 🧪 **Contract:** resource shapes validate; output resource paginates + caps size.
- 🧪 **Live:** spawn boards of each type in Canvas ADE; agent reads `canvas://boards` and sees them;
  drive a board to idle → `canvas://board/{id}/status` reflects it.
- ✅📏 an agent can enumerate + read live board state; large output is capped, not truncated-blind.
  ⛓ Phase 1.

---

## Phase 3 — Lifecycle tools (orchestrator)

First _write_ tools — but creation only, no cross-agent influence yet.

- `spawn_board(type, prompt?, cwd?)`, `close_board(id)` (graceful drain, not immediate kill),
  `configure_board(id, …)`. 🔒 hard concurrency cap + idle-reaping (the runaway-swarm guard).
- `spawn_fanout(spec, N, mode: 'best-of-n' | 'split')` — **deferred to Phase 8** (needs worktrees);
  define the schema now, gate the impl.
- 🧪 **Contract:** spawn validates type + caps N; close drains; concurrency cap rejects over-limit.
- 🧪 **Live:** orchestrator agent calls `spawn_board('terminal', …)` → a Terminal board **appears on
  the real canvas** and starts a shell; `close_board` removes it (honoring the dirty-worktree prompt).
- ✅📏 an agent can create/destroy real boards within the concurrency cap. ⛓ Phase 1.

---

## Phase 4 — Dispatch (the first dangerous tool) 🔒

The orchestrator gains a _voice into another agent's shell_. Maximum care.

- Split the conflated `send_prompt` into **`handoff_prompt`** (blocking — send, await idle, return
  result) and **`assign_prompt`** (fire-and-forget, worker reports via `write_result`). Plus
  `interrupt(id)`.
- 🔒 every dispatch: **provenance-tag wrapping** (unspoofable "from orchestrator, not your operator")
  - single-use **nonce** + monotonic sequence + **human-confirm** + **audit_log** (resolved target +
    full prompt text + outputs).
- 🔒 bind to **opaque server-issued board id**, never agent-chosen label.
- 🔒 enforce the locked invariant: Browser content never reaches PTY; dispatched text is
  trusted-user-only.
- **Defer** `broadcast_prompt` to Phase 8 (it's N targeted sends + needs cost-confirm).
- 🧪 **Contract:** dispatch without confirm is blocked; replayed nonce rejected; label-targeting
  rejected; audit entry written.
- 🧪 **Live:** orchestrator `handoff_prompt(workerBoard, "echo hi")` → the text **lands in the worker
  board's real PTY**, the worker runs it, the result returns; audit_log shows the full exchange.
- ✅📏 a prompt dispatched by the orchestrator executes in the target board and returns; every
  dispatch is confirmed + audited. 🔒🚦 **gate:** no auto-dispatch from worker-originated (tainted)
  content. ⛓ Phase 1, 3.

---

## Phase 5 — Barriers + event-driven attention

Make the orchestrator able to _wait_ efficiently — the backbone of sequenced swarms.

- `wait_for_idle(id)` / `wait_for_all(ids[])` implemented via **resource subscription** on
  `canvas://attention` (`notifications/resources/updated` over the GET-SSE stream) — NOT polling.
- Attention distinguishes **idle-done vs blocked-on-permission vs error/crashed**.
- 🧪 **Contract:** subscribe → mutate status → subscriber woken; states distinguished.
- 🧪 **Live:** orchestrator dispatches to a worker + `wait_for_idle` → resolves exactly when the real
  board goes idle (not on a timer); a blocked worker surfaces as `blocked`, not `idle`.
- ✅📏 barriers resolve event-driven off real board state; no busy-poll. ⛓ Phase 2, 4.

---

## Phase 6 — Git tools (board-scoped) 🔒 ⛓ Canvas ADE Phase 3

Review + integrate worker output. **Blocked until Canvas ADE ships git-worktrees-per-board.**

- Resources: `canvas://board/{id}/diff` (paginated), `get_changed_files` (resource).
- Tools: `commit(id, msg)`, `merge(id, into?)` — 🔒 each **scoped to the board's own
  `canvas-ade/<board-id>` worktree**, server-enforced; destructive ops carry `destructiveHint` +
  confirmation flag + human-confirm + audit; never silent `--force`.
- 🧪 **Contract:** git ops outside the board's worktree path are rejected; merge conflict is flagged
  not auto-resolved; destructive op without confirm blocked.
- 🧪 **Live:** a worker agent edits files in its real worktree → orchestrator reads
  `canvas://board/{id}/diff` and sees the correct hunks; `commit` advances that branch only; a
  cross-worktree path is refused.
- ✅📏 orchestrator reads + commits a worker's real worktree, scoped + confirmed + audited.
  🔒🚦 **gate:** no tool can touch a tree other than its own board's. ⛓ Phase 1; Canvas ADE Phase 3.

---

## Phase 7 — answer_permission (the sharpest tool) 🔒

The headline command-board capability — and the most dangerous single tool.

- `answer_permission(id, yes|no)` — approves/denies a permission prompt inside _another_ agent's
  shell. 🔒 **UNCONDITIONAL human-confirm, no orchestrator auto-answer, ever.** Full audit.
- 🧪 **Contract:** any auto-answer path is impossible by construction; every call requires the human
  gate; denied calls are audited.
- 🧪 **Live:** drive a worker agent to a real permission prompt → it surfaces as `blocked` in
  `canvas://attention` → orchestrator requests approval → **human confirms** → the worker's shell
  receives the answer and proceeds.
- ✅📏 a blocked worker becomes unblockable _through the human_, never silently by the orchestrator.
  🔒🚦 **gate:** zero code paths allow an unconfirmed permission answer. ⛓ Phase 4, 5.

---

## Phase 8 — Best-of-N + integration queue ⛓ Canvas ADE Phase 3

The swarm payoff: run N attempts, judge, land the winner — without same-file collisions.

- `spawn_fanout(spec, N, mode)` enabled: `best-of-n` (same prompt, N worktrees) vs `split`
  (different task each — 🔒 **requires disjoint file/worktree ownership**). Cost estimate +
  human-confirm (parallel cost is linear; recommend 3–5, not "literally all").
- `broadcast_prompt(ids[])` — app-level loop of N targeted sends (spec forbids transport broadcast);
  Last-Event-ID resumability so a flaky connection can't drop a dispatch.
- `compare_diffs(ids[])` / `canvas://diffs` — aggregate N-worktree diff (the command board's primary
  judge input).
- `judge_outputs(ids[], rubric)` (best-of-N over results, rubric'd to avoid voting bias) +
  `register_gate(taskId, cmd)` (deterministic lint/typecheck/test gate, blocks on non-zero exit) +
  `promote_winner(id)`.
- `merge_queue` — serialized rebase-and-test land behind the pre-merge gate (integration, not
  spawning, is the real bottleneck).
- 🧪 **Contract:** fanout caps N + enforces disjoint ownership in split mode; gate blocks on non-zero
  exit; merge_queue serializes.
- 🧪 **Live:** fan a task out 3 ways on the real canvas → 3 worktree boards appear → `compare_diffs`
  returns all three → `judge_outputs` ranks → `promote_winner` + `merge_queue` lands one, discards
  the rest (with dirty prompts).
- ✅📏 a real best-of-N run completes end-to-end on the canvas and lands exactly one winner.
  ⛓ Phase 6; Canvas ADE Phase 3 (worktrees + Duplicate/fan-out).

---

## Phase 9 — Hardening + coordination layer + packaging 🔒

Make the swarm safe, observable, and shippable.

- **Coordination primitives** (the biggest gap vs prior art): shared self-claiming task graph —
  `canvas://tasks` + `create_task`/`claim_task`/`update_status`/`add_dependency` (file-locked
  claiming + auto-unblock of dependents); `send_message(boardId)` worker↔worker mailbox;
  `write_result`/`canvas://board/{id}/result` (references, not raw logs).
- **Control quality:** `require_plan_approval` (worker plans read-only until approved), `effort`
  param on dispatch (per-worker turn ceiling), stall-guard auto-interrupt, `budget_guard`.
- 🔒 **Safety hardening:** injection provenance-tagging + worker instruction-hardening verified
  together (tagging alone ≈ 5% effective); network-egress restriction (cuts the trifecta's external
  leg); **session revocation** on `close_board`/`discard_worktree` (HTTP 404 the session so a killed
  board's agent can't call tools); confused-deputy controls (token bound to board + single loopback
  session).
- Spec primitives where supported (with fallbacks): **Elicitation** for human-confirm,
  **Sampling** so MAIN can judge using a connected agent's model with no server-side API key.
- Packaging: version the contract, `list_changed` on tier promotion (no forced reconnect), stateless
  tools (re-derive from token + `canvas.json` so a MAIN restart survives).
- 🧪 **Live:** full swarm scenario — orchestrator spawns a task graph, workers self-claim + message +
  write results, a compromised-worker injection attempt is contained (does not auto-drive the
  orchestrator), killing a board revokes its session mid-call.
- ✅📏 a multi-worker, task-graph-coordinated run completes; documented injection attempt is blocked;
  revocation works. 🔒🚦 **final gate:** the lethal-trifecta path (orchestrator consuming tainted
  worker output) cannot trigger any action without human-confirm. ⛓ all prior phases.

---

## Cross-cutting (every phase)

- **The two-layer test gate is mandatory** — a phase is not done until its tools pass contract +
  live-against-Canvas-ADE. This is the project's reason to exist.
- Never weaken Canvas ADE's security model (contextIsolation/sandbox/no-nodeIntegration; Browser
  content never to PTY; loopback-only; capability split server-side by token).
- Add an MCP-layer ADR when a load-bearing decision lands (transport, auth, safety-tier).
- Keep the contract versioned; agents connect across MAIN restarts via fresh sessions.

## Deferred (not now)

Multi-level orchestration (workers spawning sub-workers — Claude Code forbids it anyway) ·
non-loopback/remote MCP access · OAuth-based auth (static per-board tokens suffice for a local
trusted server) · cross-machine swarms.

---

## Provenance

Phase plan + decisions validated by two research workflows (2026-05-30) against: MCP spec
(2025-03-26 / 2025-06-18), Anthropic multi-agent research system, Claude Code Agent Teams + subagents
docs, Cursor 3 (`/best-of-n`), Warp Code Review, Vibe Kanban / Conductor / Crystal / Sculptor,
`git-mcp-server`, and the multi-agent prompt-injection literature. See the sibling Canvas ADE repo's
`docs/feature-proposals.md` for the feature-level context this MCP layer serves.
