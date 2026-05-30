# Handoff — canvas-ade-mcp Phase 1: Auth + capability tier-factory (hardening)

> For a fresh session. Self-contained. **Phase 0 is shipped + pushed** (commit `9f53ec3`, all gates
> green). This repo (`Z:\canvas-ade-mcp`) is a **standalone git repo, a sibling of `Z:\Canvas ADE`**
> — NOT nested. Remote: `https://github.com/ch923dev/canvas-ade-mcp` (private), `main` tracks
> `origin/main`.

## First 15 minutes (orientation)

Read, in order:

1. `README.md` — what this is (MCP layer for Canvas ADE; command-board orchestrator vs worker tiers),
   the architecture diagram, and **the non-negotiable two-layer test rule**.
2. `docs/decisions/0001-mcp-implementation.md` — the locked impl decisions (official SDK 1.29.0, no
   framework; stateful streamable-HTTP; tiers enforced **server-side by token via a register-only
   factory**, never annotation/prompt; no OAuth discovery; `Bundler` module resolution).
3. `docs/implementation.md` — how Phase 0 is built (transport pattern, the **auth + tier decision
   flow** diagram, file tree, gotchas).
4. `docs/roadmap.md` → **Phase 1** + **Phase 2** (Phase 1's job feeds Phase 2's observation resources).
5. `docs/research/mcp-swarm-research.md` → the **Security** section (lethal trifecta, per-board
   tokens, replay/provenance) — Phase 1 lays the auth groundwork those later phases depend on.

Then skim the code (small — ~13 source files): `src/auth/{verifier,tokens}.ts`,
`src/server/{factory,transport,mcpHttp}.ts`, `src/security/origin.ts`, `src/types.ts`,
`src/constants.ts`, and the tests in `test/{contract,live}/`.

## Commands (sanity-check before changing anything)

```
cd Z:\canvas-ade-mcp        # or use pnpm -C "Z:\canvas-ade-mcp" ...
corepack pnpm install       # if node_modules missing
corepack pnpm typecheck     # tsc --noEmit
corepack pnpm build         # tsup → dist/index.js + index.d.ts
corepack pnpm test          # vitest contract project (3 tests)
corepack pnpm test:live     # vitest live project (5 tests, real HTTP)
corepack pnpm lint          # eslint
corepack pnpm exec prettier --check .
```

All should be green on a clean checkout. **Toolchain note (this machine):** TypeScript `6.0.3`
(needs `ignoreDeprecations: "6.0"` in tsconfig — already set), ESLint `10`, Vitest `4`. Runtime:
`@modelcontextprotocol/sdk@1.29.0`, `express@5.2.1`, `zod@4.4.3`.

---

## What Phase 0 ALREADY proves toward Phase 1 (do NOT redo)

Phase 1 is **hardening**, not a from-scratch build — Phase 0 already stood up the auth spine:

- **Bearer verifier + token store** — `src/auth/verifier.ts` (`OAuthTokenVerifier.verifyAccessToken`
  → `AuthInfo` with `extra:{tier,boardId}`; throws `InvalidTokenError` → 401) over
  `src/auth/tokens.ts` (`TokenStore` mint/revoke/get).
- **`requireBearerAuth` on every `/mcp` request** — `src/server/mcpHttp.ts`. Tier is **re-derived
  from the verified token on every request** via `ctxFromAuth(req.auth)` (session-id is routing only).
- **Register-only tier factory** — `src/server/factory.ts` `getServer(ctx)` registers `ping` for both
  tiers and `orchestrator_ping` ONLY for orchestrator. A worker's `tools/list` never contains it.
- **Already-green tests:**
  - contract `tierSplit.contract.test.ts` — worker `tools/list` omits `orchestrator_ping`; orchestrator
    includes it.
  - live `handshake.live.test.ts` — valid bearer initializes; **missing token → 401**, **unknown
    session → 404**, **no-session non-init → 400**, bad Origin → 403.

So the _structural_ capability split + the basic auth rejections exist. Phase 1 closes the gaps.

---

## Phase 1 goal

**Prove that what an agent can call is decided solely by its token, server-side, and that the token
lifecycle (invalid / expired / revoked / cross-board) is airtight.** This is the security foundation
every later phase (dispatch, git, answer_permission) relies on.

### Tasks (ordered; each ends green on both test layers)

1. **`tools/call` enforcement (defense-in-depth) + test.** Registration already hides other-tier
   tools, so a worker calling `orchestrator_ping` gets a method-not-found from the SDK. **Add a live
   test asserting this** (worker token → `callTool('orchestrator_ping')` rejects). Decide whether to
   also add an explicit per-tool scope guard inside the tool callback (belt-and-suspenders) — document
   the decision either way. The roadmap requires enforcement "at BOTH `tools/list` and `tools/call`."

2. **Token-lifecycle tests (the key risk surface).** Add live tests:
   - **invalid token → 401** (a token never minted).
   - **expired token → 401** — mint with `expiresAt` in the past; `requireBearerAuth` enforces expiry.
     (This is the carry-forward risk from the research: a too-short `expiresAt` would kill a live
     agent session — prove the enforcement works, then ensure real tokens get a board-lifetime expiry.)
   - **revoked token → 401** — mint, `TokenStore.revoke`, then a call fails.
   - **cross-board / reused token** — assert a token bound to board A cannot act as board B (see task 4).

3. **Formalize the scope model.** `Scope` exists in `src/types.ts` but is unused. Define the scope
   strings (e.g. `read`, `dispatch`, `git:write`, `spawn`) and a **tier → default-scopes** mapping.
   Decide where scopes are checked (factory registration by tier is the primary gate; scopes are the
   finer-grained future lever for per-tool gating in Phases 3/4/6). Add a contract test asserting a
   worker token's scopes exclude orchestrator scopes. Keep it minimal — don't over-build; Phases 3+
   will consume it.

4. **Strict token→board binding.** Bind each token to its `boardId` and (later) a single session.
   `AuthInfo.clientId` already carries `boardId`. Ensure `ctxFromAuth` uses the **token's** boardId,
   never an agent-supplied value (it already does — add a test locking this in so a future change
   can't regress it). Bind dispatch (Phase 4) to **opaque server-issued board ids, never
   agent-chosen labels** — note this forward.

5. **Token minting + `.mcp.json` writer (lib utilities, MAIN-agnostic).**
   - Add a crypto-random token mint helper (`node:crypto randomUUID`/`randomBytes`) — `mintBoardToken(boardId, tier)` →
     `{ token, row }`, stored via `TokenStore`. Prefer **short-lived tokens minted at board spawn**.
   - Add a pure function that writes a **project-scoped `.mcp.json`** for a board's worktree:
     `{ mcpServers: { "canvas-ade": { type: "http", url: "http://127.0.0.1:<port>/mcp",
headers: { Authorization: "Bearer <token>" } } } }`. Keep it a pure
     `buildMcpJson(port, token)` + a thin writer so it's unit-testable without Electron. **Do NOT
     mount any OAuth discovery route** (Claude Code false-flag — see ADR).
   - These are consumed by Canvas ADE MAIN later; Phase 1 ships + tests them in isolation.

6. **Scope at the middleware vs per-session decision.** `requireBearerAuth` accepts `requiredScopes`,
   but that's coarse (one mount). Keep the **register-only factory as the real gate**; document that
   `requiredScopes` is not used for tier separation. Make sure a wrong/expired token is rejected
   **before** any session/tool logic runs (it is — `requireBearerAuth` runs first; add a test).

### The two-layer test rule (and the pre-MAIN caveat)

Every change ships with a **contract test** (in-memory, mock orchestrator) AND a **live test** (real
HTTP). **Important:** Phase 1 live tests still spin their **own in-process HTTP server on an
ephemeral 127.0.0.1 port** — they do **NOT** boot the Electron app. Canvas ADE does not host the MCP
server yet; the "drive the _real running Canvas ADE_" version of the rule activates at the
**MAIN-wiring milestone** (after Phase 1, when `createMcpHttpServer(deps)` is mounted in MAIN with a
real `Orchestrator`). Until then, "live" = real HTTP + real SDK `Client`, multi-token, multi-client.

The headline Phase 1 live scenario (adapted, pre-MAIN): start one server, mint a **command-board
token** + a **worker token**, connect two `Client`s — assert the worker is denied an orchestrator
tool (call rejects + `tools/list` omits it) and the command board is allowed. (The real
two-Terminal-boards version lands with MAIN wiring.)

---

## Gotchas / invariants (do not regress)

- **Register-only, never register-all-then-gate** — `tools/list` itself must hide other-tier tools.
- **Tier from the token, every request** — session-id is routing only, never authority.
- **`AuthInfo.expiresAt`** — real per-board tokens must use a board-lifetime (far-future) expiry, or
  `requireBearerAuth` kills the session mid-run. Tests prove the _enforcement_; production mints long.
- **No OAuth discovery** — never mount `mcpAuthMetadataRouter` / `/.well-known/oauth-*`, leave
  `resourceMetadataUrl` unset.
- **SDK transport imports stay in `src/server/transport.ts`; auth imports in `src/auth/`** — for the
  one-file v2 bump.
- **`Bundler` module resolution + extensionless relative imports**; SDK subpath imports keep the
  `.js` suffix (e.g. `@modelcontextprotocol/sdk/server/auth/errors.js`).
- **Control plane only** — never route PTY data through MCP (MessagePort owns that).
- **InMemory contract tests bypass HTTP** — anything auth/Origin/session-related MUST be covered in
  `test/live`, not just contract.

## Definition of done (Phase 1 gate)

- 🔒🚦 A worker token can NEVER list or call an orchestrator tool — proven on **both** layers.
- Invalid / expired / revoked / cross-board tokens are all rejected (401), with live tests.
- Scope model defined + tier→scopes mapping + a test; `.mcp.json` writer + mint helper exist + tested.
- All gates green: `typecheck · build · test · test:live · lint · prettier --check`.
- Commit on `main`, push to `origin`. Update `docs/roadmap.md` Phase 1 status + this repo's memory
  pointer if one exists.

## Start here

1. Run the command block above — confirm a clean green baseline.
2. Task 1 (the `tools/call` live test) is the smallest first slice — it mostly documents existing
   behavior and warms you up on the test harness (`test/helpers/{inMemory,httpServer}.ts`).
3. Then tasks 2 → 6. Keep slices small + green; commit per slice.

> After Phase 1: the **MAIN-wiring milestone** (mount `createMcpHttpServer` in Canvas ADE MAIN with a
> real `Orchestrator`, write `.mcp.json` into board worktrees, flip the live tests to drive the real
> app) → then **Phase 2** (observation resources).
