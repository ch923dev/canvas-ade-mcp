# canvas-ade-mcp

The **MCP (Model Context Protocol) layer** for Canvas ADE — the tool/resource/prompt contract that
lets AI coding agents running *inside* Canvas ADE boards orchestrate the canvas itself. This is what
turns the canvas from a human-driven cockpit into an **AI-orchestratable swarm environment** with a
**command board** (an orchestrator agent) driving a fleet of worker agents.

> **Status:** planning / docs only. No code yet. Build order lives in [`docs/roadmap.md`](docs/roadmap.md).

---

## What this is (and is NOT)

- **IS:** a **standalone package with its own git repo**, living at `Z:\canvas-ade-mcp` — a
  **sibling of the Canvas ADE repo, NOT nested inside it**. It owns the MCP *contract* — tool +
  resource + prompt schemas, the streamable-HTTP transport, auth (per-board bearer tokens), and the
  capability tier-factory (orchestrator vs worker).
- **IS NOT:** a standalone *app*. The MCP server has nothing to orchestrate on its own — every tool
  needs live access to PTYs, git worktrees, `WebContentsView`s, and the canvas store, all of which
  live in **Canvas ADE's Electron MAIN process**. Canvas ADE **consumes this package as a dependency**
  (a local linked / path dependency during dev; published + pinned later) and MAIN binds the contract
  to the real implementations.

```
Z:\
├─ Canvas ADE\        ← the Electron app (its own git repo) — CONSUMES canvas-ade-mcp as a dep
└─ canvas-ade-mcp\    ← THIS repo (separate git repo, sibling — never nested in Canvas ADE)
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

| Decision | Why |
|---|---|
| **Transport = streamable-HTTP on a loopback `localServer` in MAIN** | stdio is process-per-client; we need ONE shared bus for many board-agents → one MAIN. Spec defines streamable-HTTP exactly for this. |
| **Control plane only — PTY data stays on MessagePort** | MessagePort isn't reachable on `127.0.0.1`; avoids head-of-line blocking of high-volume terminal bytes on shared SSE. |
| **Capability tiers enforced SERVER-SIDE by token, never by annotation/prompt** | Tool annotations "don't enforce anything." Build a fresh `McpServer` per session from a **factory that registers only the allowed tier's tools** (orchestrator vs worker), decided from the bearer token at `initialize`. |
| **Command board = orchestrator (elevated tools); other boards = workers (read-only/scoped)** | Canonical lead/subagent pattern. Workers cannot dispatch, spawn, or do git writes. |
| **Read-only context = resources; mutating actions = tools** | Spec-correct. `boards/status/attention/diff/output/console` are resources; `spawn/send_prompt/commit/merge` are tools with accurate destructive/openWorld annotations. |
| **Risky tools gated: human-confirm + nonce + audit_log** | `send_prompt`/`answer_permission`/git-writes can write into another agent's shell or touch git. Human-in-the-loop is a MUST, not a SHOULD. |
| **No OAuth discovery endpoints** | We're a trusted local server with static per-board tokens; advertising `/.well-known/oauth-*` makes Claude Code falsely flag "needs authentication." |

### Security model (inherited + extended)

The orchestrator board **is the lethal trifecta** at the system level: it reads untrusted worker
output + holds dispatch power + has external comms (commit/PR/navigate). Therefore:

- **Treat all worker-originated resources as TAINTED.** Never let worker output *auto-trigger*
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

## Dependency on Canvas ADE phases

The MCP build can **start now** for the transport/auth/observation layers, but the dispatch + git
layers bind to features still on the Canvas ADE roadmap:

| MCP phase | Needs from Canvas ADE |
|---|---|
| 0–3 (transport, auth, observation, lifecycle) | nothing hard — board state + spawn exist today |
| 4 (dispatch) | the `pty.write` channel (exists); persistence for audit (Phase 3) |
| 6 (git tools) | **git-worktrees-per-board + per-board ports (Canvas ADE Phase 3)** |
| 8 (best-of-N + merge queue) | worktrees + Duplicate/fan-out (Canvas ADE Phase 3) |

See [`docs/roadmap.md`](docs/roadmap.md) for the full phase-by-phase plan.

---

## Layout (planned)

```
Z:\canvas-ade-mcp\          ← its own git repo (sibling of Z:\Canvas ADE)
  README.md              ← this file
  docs/
    roadmap.md           ← phased build plan (0 → full), per-phase test gate
    decisions/           ← ADRs specific to the MCP layer (transport, auth, safety)
  src/                   ← (added Phase 0) schemas · transport · auth · tier-factory
  test/
    contract/            ← tool-vs-mock-orchestrator tests
    live/                ← tool-vs-real-Canvas-ADE tests (drives Z:\Canvas ADE: CANVAS_SMOKE=e2e / Playwright)
  package.json           ← (added Phase 0) standalone package, MCP SDK dep
```
