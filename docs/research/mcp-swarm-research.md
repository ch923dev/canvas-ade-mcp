# MCP Swarm Research — findings that shaped this repo

Captured from two multi-agent web-research workflows (2026-05-30) that validated and extended the
Canvas ADE MCP / command-board / swarm design against real-world prior art. This is the **evidence
base** behind the decisions in [`../../README.md`](../../README.md) and [`../roadmap.md`](../roadmap.md).
Preserve it — it's the "why" for every locked choice.

> Method: workflow 2 ran 6 research lenses (MCP servers in the wild · orchestrator-worker frameworks ·
> MCP protocol best practices · agent safety · parallel-dev tools · local-host patterns) + 1
> synthesis. Sources cited inline. Workflow 1 (feature-level) lives in the Canvas ADE repo's
> `docs/feature-proposals.md`.

> 🔌 **Companion doc (2026-06-02):** [`mcp-client-connection-matrix.md`](mcp-client-connection-matrix.md)
> — per-CLI wiring (Claude Code · Codex · Cursor · Gemini) for connecting an in-board agent to the
> loopback server with a per-board bearer token. **Verdict: all four connect today, no proxy shim.**
> De-risks roadmap Phase 3+.
>
> ⚠️ **Spec drift (2026-06-02):** parts of this doc cite the **stale 2025-03-26/06-18** spec. Current
> stable = **2025-11-25**; a **2026-07-28 RC** makes the protocol **stateless** (`Mcp-Session-Id`
> removed) and **deprecates Sampling**. Sampling-based judging is also unsupported by Claude Code →
> pivot to a deterministic gate + a "judge board". Human-confirm → native Electron modal (MAIN owns the
> UI), not client elicitation. **Host-header validation is mandatory** (DNS-rebind CVEs; a Browser
> board previewing a hostile localhost page is the exact vector). Full deltas: parent-repo memory
> `mcp-spec-state-2026-06`.

---

## Bottom line

**MCP is the right call.** The spec's streamable-HTTP multi-client transport, resource subscriptions,
elicitation, and sampling map almost 1:1 onto this product, and it's the interop standard agentic
CLIs already speak. Two caveats:

1. MCP gives the protocol but **"essentially zero practical guidance" on multi-agent safety** — we
   own the risk-tier / confirm / provenance design ourselves.
2. **Elicitation / sampling / tool-search behaviors vary by client** — verify our target CLIs support
   them and build fallbacks before depending on them.

Closest reference architecture = **Claude Code Agent Teams** (fixed lead + shared task list + mailbox

- file-locked claim + plan-approval + blocking hooks). Study it directly.

---

## ✅ Validated (our draft was right)

- **Orchestrator/worker two-tier split is canonical.** Matches Anthropic's lead/subagent model +
  Claude Code Agent Teams. Enforcement is at the harness, not the prompt ("an Explore agent cannot
  edit files even if the prompt suggests it"). _Evidence: Anthropic "How we built our multi-agent
  research system"; Claude Code sub-agents docs._
- **Transport = streamable-HTTP on loopback localServer in MAIN.** stdio is process-per-client and
  can't be a shared bus; the spec defines streamable-HTTP for "a server handling multiple client
  connections" — exactly many-board-agents → one MAIN. One `/mcp` endpoint (POST/GET/DELETE) via
  `StreamableHTTPServerTransport`. _Evidence: MCP spec 2025-03-26 Transports; TS SDK
  simpleStreamableHttp example._
- **MCP control-plane only; PTY data stays on MessagePort.** Security (MessagePort unreachable on
  127.0.0.1) + avoids head-of-line blocking of terminal bytes on shared SSE.
- **Human-confirm + audit on risky tools** is spec-backed ("there SHOULD always be a human in the
  loop with the ability to deny tool invocations"); practitioners treat the SHOULD as a MUST.
- **Worktree-per-board + per-board ports** is mainstream consensus (Cursor/Warp/Conductor/Claude
  Squad/Vibe Kanban/Crystal). git surface (worktree/commit/merge/diff/discard) validated by
  `cyanheads/git-mcp-server`; "never silent --force" aligns with its confirmation-on-destructive model.
- **The 5 canonical control primitives** (dispatch · fan-out · handoff · barrier · best-of-N judge)
  all have a tool in our surface. Coverage complete. _Evidence: Swarm routines/LangGraph handoff;
  parallel subagents/Send API; LangGraph join nodes; Chairman pattern._
- **Resource-vs-tool split mostly right** — boards/status/attention/diff/checklist/console/network
  correctly modeled as read-only resources (application-driven, side-effect-free per spec).
- **budget_guard + concurrency caps** validated by the runaway pattern ("200+ agent threads
  overnight, exhausting limits"); Agent-MCP hard-caps at 10 agents.
- **spawn_fanout(N) + best_of_n_judge** are first-class, not just emergent — Cursor 3 ships
  `/best-of-n` + Agent Count N (same prompt across N worktrees, competitive selection).

---

## ➕ Tools we MISSED (add these)

Concrete additions real systems expose. Tier = orchestrator / worker / either.

### Coordination (biggest gap vs prior art)

- **`canvas://tasks`** + `create_task` / `claim_task` / `update_task_status` / `add_dependency`
  (either; resource+tools) — shared task graph with **file-locked self-claiming + auto-unblock of
  dependents**. Promote the Planning checklist into the canonical work-coordination surface.
  _Evidence: Claude Code Agent Teams shared task list + file-locking; rinadelph/Agent-MCP._
- **`send_message(boardId)`** (worker; tool) — worker↔worker mailbox, distinct from orchestrator→worker
  dispatch; breaks the strict star topology. _Evidence: Agent Teams Mailbox; Agent-MCP
  send_agent_message/broadcast_message._
- **`write_result`** / **`canvas://board/{id}/result`** (worker; resource) — worker writes a
  structured summary + **path reference** instead of raw scrollback; orchestrator aggregates
  references, not 200k-token PTY logs. _Evidence: Anthropic's #1 scaling fix — "lightweight
  references back to the coordinator."_

### Dispatch (split our conflated send_prompt)

- **`handoff_prompt`** (orchestrator; tool) — **blocking** delegation: send, block until done, return
  result. _Evidence: AWS CAO Handoff; LangGraph handoff w/ payload._
- **`assign_prompt`** (orchestrator; tool) — fire-and-forget; worker reports via callback/artifact,
  no busy-polling. _Evidence: AWS CAO Assign._

### Integration (the real bottleneck)

- **`merge_queue`** (orchestrator; tool) — serialized rebase-and-test land behind a pre-merge gate.
  _Evidence: ctx.rs "Why Coding Agents Need a Merge Queue"; Augment Janitor._
- **`compare_diffs(ids[])`** / **`canvas://diffs`** (orchestrator) — side-by-side N-worktree diff;
  the most-built primitive + the command board's primary judge input. _Evidence: Warp Code Review._
- **`register_gate(taskId, cmd)`** (orchestrator; tool) — deterministic non-LLM gate
  (lint/typecheck/test) blocking a task transition on non-zero exit; stronger than LLM-only judging.
  _Evidence: Agent Teams blocking hooks (exit-code-2 blocks)._
- **`judge_outputs(ids[], rubric)`** (orchestrator; tool) — best-of-N over WORKER RESULTS (not just
  diffs); rubric'd to guard against majority-voting bias. _Evidence: Anthropic CitationAgent +
  LLM-as-judge; arxiv 2504.17087 voting-bias warning._
- **`promote_winner`** / **`select_and_merge`** (orchestrator; tool) — explicit winner-selection.
  _Evidence: Cursor 3 /best-of-n._
- **`promote_to_workspace(boardId)`** (orchestrator; tool) — pull a worker's worktree into the user's
  editable working tree for pairing/testing. _Evidence: Sculptor Pairing Mode._

### Observation + control quality

- **`canvas://board-states`** (orchestrator; resource) — boards bucketed by orchestration state
  (idle/running/awaiting-review/blocked/failed) so the orchestrator reasons over a Kanban aggregate
  without polling each board. _Evidence: Vibe Kanban / Conductor / Composio._
- **`resources/subscribe` on `canvas://attention`** (orchestrator; resource) — event-driven; replaces
  polling `wait_for_idle`/`wait_for_all` with `notifications/resources/updated` over the GET-SSE
  stream; distinguishes idle-done vs blocked-on-permission vs error/crashed. _Evidence: MCP Resources
  spec 2025-06-18 subscribe/listChanged; Warp blocked/completed notifications._
- **`effort: low|med|high`** param on spawn/dispatch (orchestrator; tool) — per-dispatch turn ceiling;
  right-size each worker at dispatch (prevents "50 subagents for a simple query"). _Evidence:
  Anthropic effort-scaling; CrewAI hierarchical per-delegation cost._
- **`spawn_fanout(spec, N, mode: 'best-of-n' | 'split')`** (orchestrator; tool) — disambiguate
  same-prompt-N-ways vs different-task-per-agent; **split mode REQUIRES disjoint file/worktree
  ownership.** _Evidence: Cursor Agent Count N; Anthropic duplicate-work failure on poor boundaries._
- **`require_plan_approval`** flag on spawn (orchestrator; tool) — worker plans in read-only mode,
  gated until orchestrator approves/rejects with feedback before any write. _Evidence: Agent Teams
  plan-approval read-only mode._
- **Stall guard / auto-interrupt** (orchestrator; tool) — MAIN-enforced per-worker max-turns /
  no-progress guard that auto-interrupts a stuck/ping-ponging worker + a structured "done" signal.
  _Evidence: AutoGen GroupChat stuck/ping-pong failure — "set max_round aggressively."_

### Spec primitives to adopt (with fallbacks)

- **Elicitation** (orchestrator; prompt) — implement human-confirm / `answer_permission` via the
  spec's Elicitation (structured server→human request, incl. URL mode) rather than bespoke — but
  implement the client side in MAIN since few CLI agents support it yet. _Evidence: MCP Elicitation
  spec 2025-06-18; WorkOS/GitHub writeups._
- **Sampling** (`sampling/createMessage`) (orchestrator; tool) — MAIN requests an LLM completion from
  a connected agent's model to power judge*diffs/best_of_n **without a server-side API key.**
  \_Evidence: WorkOS MCP features guide.*

---

## ⚠️ Contradictions (our draft was WRONG / risky here)

1. **`send_prompt` over-conflated** — real orchestrators separate synchronous (`handoff`, blocks +
   returns) from asynchronous (`assign`, fire-and-forget callback). Flat send_prompt forces
   busy-polling. **Split it.**
2. **`broadcast_prompt` + unbounded `spawn_fanout(N)` are NOT cheap/routine** — parallel agents scale
   token cost LINEARLY with diminishing returns; Claude Code recommends 3–5 teammates ("three focused
   teammates outperform five scattered ones"). Both need cost-estimate + human-confirm; fanout MUST
   assign **disjoint file/worktree ownership** or hit same-file-overwrite failures.
3. **`broadcast_prompt` is NOT a transport-level broadcast** — the spec mandates each message on
   exactly ONE SSE stream. Implement as an app-level loop of N targeted per-session sends, ideally
   with **Last-Event-ID resumability** so a flaky connection can't drop a dispatched prompt.
4. **Capability split CANNOT be enforced by tool annotations** (`readOnlyHint`/`destructiveHint`) —
   they "don't enforce anything" and "are not guaranteed to faithfully describe tool behavior."
   Enforcement MUST be server-side: validate the per-board bearer token on every `tools/call`,
   hard-reject dispatch/git tools for non-command-board sessions. **Build the per-session server from
   a factory that registers only the allowed tier's tools** — never register-all-then-filter.
5. **`get_output`/`get_changed_files` are mis-typed as tools** — pure reads → make them resources
   (`canvas://board/{id}/output`, `.../changed-files`). `screenshot` → resource (base64 blob) or at
   minimum `readOnlyHint:true`. Conversely every mutating tool MUST carry accurate annotations
   (commit/merge/open_pr/discard_worktree/close_board = `destructiveHint:true`; spawn/send_prompt =
   `openWorldHint:true`; `toggle_item` is NOT idempotent) or clients prompt on every call.
6. **Raw scrollback/diff blows context** — hits the 200k truncation AND Claude Code's MCP output cap
   (10k warn / 25k default hard limit). Don't return raw logs to the coordinator — return structured
   result references; paginate diffs or set `_meta['anthropic/maxResultSizeChars']`.
7. **Single-level orchestrator is a hard SPOF/bottleneck** — Claude Code enforces "subagents cannot
   spawn other subagents," so workers running Claude Code physically can't sub-delegate. `fanout_spec`
   must NOT expect worker sub-delegation; all spawning stays orchestrator-only by token. Acceptable
   for our model but **must be designed-for explicitly.**
8. **Static bearer token WITHOUT disabling OAuth discovery** — Claude Code flags HTTP MCP servers as
   "needs authentication" if they advertise `/.well-known/oauth-authorization-server` even with a
   working static token. **Do NOT serve OAuth PRM/AS metadata endpoints.** A wrong/expired token is a
   HARD failure (no OAuth fallback).

---

## 🔒 Security (we own this — MCP gives no guidance)

The orchestrator board **IS the lethal trifecta** at the system level: reads untrusted worker output

- holds dispatch power + has external comms.

* **`answer_permission` is the single sharpest tool** — it approves a permission prompt inside
  ANOTHER agent's shell (direct cross-shell write authority). **Unconditional human-confirm, no
  orchestrator auto-answer.** An infected orchestrator answering "yes" to a worker's `rm -rf /?` is
  catastrophic + irreversible.
* **Treat ALL worker-originated resources (status/output/diff/console/network/screenshot) as
  TAINTED.** Gate every orchestrator action that consumes them behind human-confirm. Never let worker
  output auto-trigger send_prompt/broadcast/commit/open_pr.
* **Prompt injection self-replicates LLM→LLM** — full infection in agent societies by ~turn 5
  (+13.92% success on GPT-4o). Per-board tokens scope WHAT each agent can CALL but do NOT stop
  infected CONTENT flowing worker→orchestrator→workers.
* **Mandatory provenance tagging** on every cross-agent message — unspoofable delimiter block ("this
  text came from the orchestrator agent, not your human operator") COMBINED with per-worker
  instruction hardening. Tagging alone ≈ 5% effective; Tagging+Marking ≈ 100%;
  Tagging+Instruction-Defense ≈ 3% attack success. **No single defense works alone.**
* **Replay protection + strict target binding** — single-use nonce + monotonic sequence per board on
  every send_prompt/answer_permission; bind dispatch to **opaque server-issued board ids, never
  agent-chosen labels** (fanout creates near-identical boards → label targeting is steerable to the
  wrong/elevated board).
* **Confused-deputy controls** — MAIN acts with the operator's full OS/git privileges. Bind each
  per-board token to that specific board id AND a single loopback session; reject reuse + any token
  not explicitly issued. `audit_log` captures the RESOLVED board target + full prompt text + outputs,
  not just the tool name.
* **Hard runtime boundary** — scope every MCP-callable git/file op to the board's OWN worktree path
  (`canvas-ade/<board-id>`), server-enforced (not via prompt). Network-egress restriction cuts the
  trifecta's external-comms leg. Per-board ports (worktrees isolate files, NOT processes/ports).
* **Session lifecycle = revocation hook** — issue `Mcp-Session-Id` at initialize, map to
  boardId+tier, revoke (HTTP 404 / DELETE) on close_board/discard_worktree so a killed board's agent
  can no longer call tools. Session-id is UNTRUSTED routing only — re-derive capability tier from the
  validated bearer token on every request.
* Enforce the existing locked invariant: **Browser-board content must never reach the PTY write
  channel**; orchestrator-supplied prompt text is trusted-user-only with audit_log on every dispatch.

---

## Transport — final recommendation

**Streamable-HTTP over loopback in MAIN's `localServer` — CONFIRMED.**

- ONE `/mcp` endpoint wired to `StreamableHTTPServerTransport`: **POST** (client→server JSON-RPC),
  **GET** (server→client SSE for subscriptions/notifications — powers the event-driven
  `canvas://attention`), **DELETE** (terminate session). Keep `enableJsonResponse` for pure
  request/response; keep SSE for the subscription that replaces polling.
- **Per-client scoping:** maintain a `transports[]` map keyed by `Mcp-Session-Id`; build a FRESH
  `McpServer` per session from a **factory that registers ONLY the tools the board's tier is allowed**
  (decided from the bearer token at `initialize`).
- **Authority** = per-board bearer token validated by `requireBearerAuth` on EVERY request via an
  in-MAIN verifier map (`token → {boardId, tier, scopes}`); session-id is transport routing only.
  Enforce required scope at BOTH `tools/list` and `tools/call`.
- **Security MUSTs:** validate `Origin` (403 on bad → blocks DNS-rebinding so a web page can't drive
  spawn_board/commit), bind `127.0.0.1` not `0.0.0.0`, do NOT serve OAuth discovery endpoints.
- **Client registration:** write a project-scoped `.mcp.json` into each board's worktree
  (`{type:http, url:http://127.0.0.1:PORT/mcp, headers.Authorization: Bearer ${CANVAS_ADE_BOARD_TOKEN}}`);
  prefer a `headersHelper` minting a short-lived per-board token at connect time over a static
  embedded one; pre-approve workspace-trust so headless spawned agents don't stall on the project
  approval prompt.
- **Resilience:** design tools STATELESS across sessions (re-derive board context from token +
  canvas.json) since a MAIN restart wipes `transports[]` and forces re-initialize; emit
  `list_changed` when a board's allowed-tool set changes (e.g. promotion to command board) instead of
  forcing a reconnect.

---

## v1 cut (minimal working AI command board)

1. **Transport + auth core:** loopback streamable-HTTP `/mcp`, per-board bearer-token verifier map,
   per-session `McpServer` factory by tier, Origin/127.0.0.1 validation, NO OAuth discovery.
2. **Lifecycle (orchestrator):** `spawn_board`, `close_board` (graceful drain, not immediate kill),
   `configure` — hard concurrency cap + idle-reaping.
3. **Dispatch (orchestrator, gated):** `send_prompt(boardId)` with mandatory provenance-tag wrapping +
   nonce + audit_log + human-confirm; `interrupt`. **Defer broadcast_prompt + spawn_fanout to v1.1.**
4. **`answer_permission` (orchestrator):** UNCONDITIONAL human-confirm, no auto-answer. The headline
   command-board capability — makes blocked workers unblockable.
5. **Observation as resources:** `canvas://boards`, `canvas://board/{id}/status`, event-driven
   `canvas://attention` (idle-done vs blocked-on-permission vs error) via subscription;
   `canvas://board/{id}/output` + `/diff` as paginated/size-capped resources.
6. **`wait_for_idle` / `wait_for_all`** as the barrier primitive (event-driven via the attention
   subscription).
7. **Git (orchestrator, gated, board-scoped):** `canvas://board/{id}/diff` resource,
   `get_changed_files` (resource), `commit`, `merge` — each scoped to the board's own worktree path,
   destructive ops behind confirmation flag + human-confirm + audit.
8. **`audit_log`** capturing resolved board target + full prompt text + tool outputs on every risky
   call.

---

## Competitor positioning

The swarm-coordination substance is converging across the field:

- **Claude Code Agent Teams** — the near-exact reference: fixed lead + shared task list + mailbox +
  file-locked claim + plan-approval + blocking hooks.
- **Cursor 3** — Agent Count N / `/best-of-n` competitive selection.
- **Warp** — side-by-side diff Code Review + blocked/completed notifications.
- **Vibe Kanban / Conductor** — state-grouped Kanban boards.
- **Sculptor** — the lone container-not-worktree dissenter (Pairing Mode bidirectional sync).

Our biggest gaps vs all of them: a **shared self-claiming task graph**, a **merge/integration
queue**, **result-artifact references** (not raw scrollback), and **event-driven blocked-state
attention**. Our differentiator: doing all of this **spatially** on a canvas — status as a glanceable
map, diffs scoped to the board owning the worktree, fan-out laid out side-by-side, and a persistent
ownership graph (connectors) no list/kanban tool can express.
