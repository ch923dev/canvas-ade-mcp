# ADR 0002 — Phase 1: scope model + token-auth policy

- **Status:** Accepted (2026-05-30)
- **Context:** Phase 1 hardens the auth spine from Phase 0 (ADR 0001). It locks the
  capability-split guarantees with tests, formalizes the scope model, and ships the
  MAIN-agnostic token mint helper + `.mcp.json` writer. These decisions are
  load-bearing for every later phase (dispatch, git, answer_permission).

## Decisions

- **D1 — No cross-tier runtime guard; registration is the gate.** A worker's
  `McpServer` never registers an orchestrator tool, so the tool callback cannot run.
  A belt-and-suspenders guard inside that callback is dead code for the cross-tier
  case. Enforcement is proven at BOTH `tools/list` (Phase 0 contract test) and
  `tools/call` (Phase 1 live test — a worker's call returns an `isError` result,
  `"Tool orchestrator_ping not found"`, never executing). Per-tool _scope_ gating
  (finer-grained, within a tier) is deferred to Phase 3, which consumes the scope
  model below.
- **D2 — Scope vocabulary.** `read`, `dispatch`, `spawn`, `git:write`,
  `answer_permission`. `worker → [read]`; `orchestrator → all five`. Scopes are data
  carried by the token (`AuthInfo.scopes`), not yet a runtime gate.
- **D3 — Token expiry.** `mintBoardToken` sets no `expiresAt` by default: a token
  lives for the board's lifetime and is dropped by `TokenStore.revoke` on board
  close. A short TTL would expire a long agent run mid-session. An optional
  `ttlSeconds` exists for deliberately short-lived tokens; `requireBearerAuth`
  enforces expiry when set.
- **D4 — `requiredScopes` middleware arg is NOT used for tier separation.** It is
  one coarse value per mount; the register-only factory is the real gate. Left unset.
- **D5 — Board binding.** `ctxFromAuth` derives `tier`/`boardId`/`scopes` solely
  from the verified token's `extra`, never an agent-supplied value. A non-string
  `boardId` falls back to empty. Exported + contract-locked against regression.
  Forward: Phase 4 dispatch binds to opaque server-issued board ids, never
  agent-chosen labels.

## Consequences

- The scope model is intentionally minimal — Phases 3/4/6 wire per-tool scope checks
  on top of it.
- Tokens are crypto-random (`randomBytes(32)` hex) and in-memory; sessions die on
  MAIN restart (correct for a single-user desktop app).
- `.mcp.json` references only the loopback bearer endpoint — no OAuth discovery
  (ADR 0001), so Claude Code does not false-flag "needs authentication."
