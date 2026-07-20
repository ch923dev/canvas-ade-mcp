# canvas-ade-mcp

The **MCP (Model Context Protocol) layer** for Canvas ADE — the tool/resource/prompt contract that
lets AI coding agents running _inside_ Canvas ADE boards orchestrate the canvas itself. This is what
turns the canvas from a human-driven cockpit into an **AI-orchestratable swarm environment** with a
**command board** (an orchestrator agent) driving a fleet of worker agents.

> **Status:** shipped + consumed. Published to npm as `@expanse-ade/mcp` (tag-push → OIDC trusted
> publishing); the app pins an exact version. 25 tools across the orchestrator/connected/worker
> tiers, contract + live test suites green. Historical build order in [`docs/roadmap.md`](docs/roadmap.md).

---

## What this is (and is NOT)

- **IS:** a **standalone package with its own git repo**, living at `M:\expanse\canvas-ade-mcp` — a
  **sibling of the Canvas ADE repo, NOT nested inside it**. It owns the MCP _contract_ — tool +
  resource + prompt schemas, the streamable-HTTP transport, auth (per-board bearer tokens), and the
  capability tier-factory (orchestrator vs worker).
- **IS NOT:** a standalone _app_. The MCP server has nothing to orchestrate on its own — every tool
  needs live access to PTYs, git worktrees, `WebContentsView`s, and the canvas store, all of which
  live in **Canvas ADE's Electron MAIN process**. Canvas ADE **consumes this package as a dependency**
  (a local linked / path dependency during dev; published + pinned later) and MAIN binds the contract
  to the real implementations.

```
M:\expanse\
├─ expanse-desktop\   ← the Electron app (its own git repo) — CONSUMES @expanse-ade/mcp as a pinned dep
└─ canvas-ade-mcp\    ← THIS repo (separate git repo, sibling — never nested in the app repo)
```

**Why separate:** keeps the MCP contract versioned + testable on its own, and avoids nesting a second
git repo inside the Canvas ADE working tree. The two repos are wired only by a dependency edge + the
live test harness.

```
┌──────────────────────────── Canvas ADE (Electron) ────────────────────────────┐
│                                                                                 │
│   MAIN process                                                                  │
│   ┌─────────────────────────┐        ┌──────────────────────────────────────┐  │
│   │  CanvasOrchestrator      │◄──────►│  canvas-ade-mcp (THIS PACKAGE)       │  │
│   │  (board state · git ·    │  binds │  · tool/resource/prompt schemas      │  │
│   │   PTY control · status)  │  impls │  · streamable-HTTP transport (/mcp)  │  │
│   └─────────────────────────┘        │  · per-board token auth + tier factory│  │
│            ▲                          └──────────────────────────────────────┘  │
│            │ IPC                                   ▲                             │
│   ┌────────┴───────────┐                           │ loopback HTTP (127.0.0.1)   │
│   │ renderer (human UI) │                           │ Bearer <per-board token>    │
│   │ glyph · queue · diff │             ┌────────────┴───────────────┐            │
│   └─────────────────────┘             │  Terminal boards' agents     │            │
│                                       │  (Claude Code / Codex / …)   │            │
│                                       │  = MCP CLIENTS               │            │
│                                       │  command board = orchestrator│            │
│                                       │  others        = workers     │            │
│                                       └──────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Two views of one core:** the same `CanvasOrchestrator` is exposed to **humans** (renderer UI over
IPC) and to **agents** (this MCP server over loopback HTTP). The MCP is the second interface.

---

## The non-negotiable rule: every tool is tested against Canvas ADE

No MCP tool/resource ships until **both** layers are green. This is the project's whole point —
it keeps the agent↔canvas connection real, not theoretical.

1. **Contract test** — the tool against a mock `CanvasOrchestrator`. Fast, isolated, validates the
   schema + auth + tier gating + error shapes.
2. **Live test** — drive the **real running Canvas ADE** (reuse the `CANVAS_SMOKE=e2e` in-process
   harness; later the planned Playwright `_electron` harness) and assert the tool actually moved the
   canvas: a board appeared, a prompt landed in a PTY, a diff came back, the camera flew.

Each phase ends **runnable + committed**, with its live-against-Canvas-ADE test passing — mirroring
the Canvas ADE roadmap convention.

---

## Core architectural decisions (locked by research, 2026-05-30)

These are validated against real prior art (Claude Code Agent Teams, Cursor 3, Warp, Anthropic's
multi-agent research system, the MCP spec). Full reasoning in the sibling Canvas ADE repo's
`docs/feature-proposals.md` research + the two research workflows that produced this.

| Decision                                                                                     | Why                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Transport = streamable-HTTP on a loopback `localServer` in MAIN**                          | stdio is process-per-client; we need ONE shared bus for many board-agents → one MAIN. Spec defines streamable-HTTP exactly for this.                                                                                      |
| **Control plane only — PTY data stays on MessagePort**                                       | MessagePort isn't reachable on `127.0.0.1`; avoids head-of-line blocking of high-volume terminal bytes on shared SSE.                                                                                                     |
| **Capability tiers enforced SERVER-SIDE by token, never by annotation/prompt**               | Tool annotations "don't enforce anything." Build a fresh `McpServer` per session from a **factory that registers only the allowed tier's tools** (orchestrator vs worker), decided from the bearer token at `initialize`. |
| **Command board = orchestrator (elevated tools); other boards = workers (read-only/scoped)** | Canonical lead/subagent pattern. Workers cannot dispatch, spawn, or do git writes.                                                                                                                                        |
| **Read-only context = resources; mutating actions = tools**                                  | Spec-correct. `boards/status/attention/diff/output/console` are resources; `spawn/send_prompt/commit/merge` are tools with accurate destructive/openWorld annotations.                                                    |
| **Risky tools gated: human-confirm + nonce + audit_log**                                     | `send_prompt`/`answer_permission`/git-writes can write into another agent's shell or touch git. Human-in-the-loop is a MUST, not a SHOULD.                                                                                |
| **No OAuth discovery endpoints**                                                             | We're a trusted local server with static per-board tokens; advertising `/.well-known/oauth-*` makes Claude Code falsely flag "needs authentication."                                                                      |

### Security model (inherited + extended)

The orchestrator board **is the lethal trifecta** at the system level: it reads untrusted worker
output + holds dispatch power + has external comms (commit/PR/navigate). Therefore:

- **Treat all worker-originated resources as TAINTED.** Never let worker output _auto-trigger_
  `send_prompt`/`broadcast`/`commit`/`open_pr` — always human-confirm.
- **`answer_permission` = unconditional human-confirm, no auto-answer.** (Approving a prompt inside
  another agent's shell is irreversible.)
- **Provenance tagging** on every cross-agent message (unspoofable "this came from the orchestrator,
  not your operator") + worker instruction hardening. No single defense suffices.
- **Replay protection:** single-use nonce + monotonic sequence per dispatch; bind to **opaque
  server-issued board ids, never agent-chosen labels.**
- **Hard runtime boundary:** every git/file op scoped to the board's own `canvas-ade/<board-id>`
  worktree, server-enforced. Validate `Origin` (403 on bad → blocks DNS-rebinding); bind
  `127.0.0.1`, never `0.0.0.0`.
- Preserves Canvas ADE's locked invariant: **Browser-board content must never reach the PTY write
  channel**; orchestrator prompt text is trusted-user-only and fully audit-logged.

---

## Structured diagrams — the handoff bundle (diagram Phase 3)

A planning-board diagram now carries one of two content forms, and the distinction is the point:

- **`engine:'expanse'` + `spec`** — a structured **DiagramSpec** (typed nodes/edges/groups with
  CLOSED status/kind vocabularies). This is the **handoff artifact**: the consumer reads structured
  spec output rather than inferring intent from pixels. The enum names (`status:'done'`,
  `kind:'service'`, `flow|data|dependency`) are the **design-token vocabulary** — agents write
  MEANING; the host owns every colour, shape, and layout. **Prefer this for flow / state /
  architecture diagrams.**
- **Mermaid `source`** — the legacy/pixel path. Still first-class for the dialects the spec doesn't
  model: **sequence / gantt / ER**. Old agents keep working untouched.

The loop that makes the spec compound (the "remix" property):

1. **Read** `canvas://board/{id}/planning` — a diagram element returns its `engine` + full `spec`,
   ids and all. Any agent can read → modify → propose.
2. **Update in place** with `update_planning_element.specOps` — upserts idempotent by slug id,
   applied in order, ONE human confirm (rendered host-side as a semantic diff) + ONE undo step.
3. **Update vs rewrite rule:** a batch is capped at `MAX_SPEC_OPS` (100) as a _reviewability_
   bound, not a document bound. Ticking statuses, adding a node, rerouting an edge → `specOps`.
   Restructuring most of the diagram → re-emit the element (`add_planning_elements` with a fresh
   spec) so the human reviews one coherent artifact instead of a 100-row diff. The host snapshots
   prior specs as revisions either way — history is never the agent's job.

Validation is layered like every other content write: this package's zod schemas are transport
defence-in-depth (shape, caps, closed enums, serialized-byte bound); the HOST re-validates
authoritatively (`assertDiagramSpec`: referential integrity included) and gates every write behind
the human confirm. All spec caps are exported from the package root (`SPEC_MAX_NODES`,
`MAX_DIAGRAM_SPEC_BYTES`, `MAX_SPEC_OPS`, …) so the host's cross-repo parity test pins wire caps
to host caps name-for-name.

---

## Dependency on Canvas ADE phases

The MCP build can **start now** for the transport/auth/observation layers, but the dispatch + git
layers bind to features still on the Canvas ADE roadmap:

| MCP phase                                     | Needs from Canvas ADE                                              |
| --------------------------------------------- | ------------------------------------------------------------------ |
| 0–3 (transport, auth, observation, lifecycle) | nothing hard — board state + spawn exist today                     |
| 4 (dispatch)                                  | the `pty.write` channel (exists); persistence for audit (Phase 3)  |
| 6 (git tools)                                 | **git-worktrees-per-board + per-board ports (Canvas ADE Phase 3)** |
| 8 (best-of-N + merge queue)                   | worktrees + Duplicate/fan-out (Canvas ADE Phase 3)                 |

See [`docs/roadmap.md`](docs/roadmap.md) for the full phase-by-phase plan.

---

## Layout

```
M:\expanse\canvas-ade-mcp\  ← its own git repo (sibling of M:\expanse\expanse-desktop)
  README.md              ← this file
  docs/
    roadmap.md           ← phased build plan (0 → full), per-phase test gate
    decisions/           ← ADRs specific to the MCP layer (transport, auth, safety)
  src/
    server/              ← ServerFactory (tier-gated registration) · tools/ (one file per tool) · diagramSpec (Phase-3 zod schemas)
    orchestrator/        ← the Orchestrator contract the host binds + MockOrchestrator
    auth/ config/ prompts/ resources/
  test/
    contract/            ← tool-vs-mock-orchestrator tests (pnpm test)
    live/                ← tool-vs-real-app tests over loopback HTTP (pnpm test:live)
  package.json           ← standalone package, MCP SDK dep; publishes via tag-push → OIDC
```
