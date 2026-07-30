# SPIKE-SDK2-REPORT — MCP SDK v2 behind the transport seam (Phase B)

- **Date:** 2026-07-30 · **Branch:** `spike/sdk2-transport` (worktree `.worktrees/sdk2-spike`, base `f3b36a4` / 0.24.0)
- **Status:** SPIKE COMPLETE — prototype fully green (typecheck · contract 344/344 · live 48/48 · lint · build · back-compat probe 7/7)
- **Ground rules honored:** no merge, no tag, no publish, no version bump; shared checkout untouched.

## Verdict (one paragraph)

**GO for Phase C, whenever the trigger fires — our code is not the blocker.** SDK v2 (2.0.0 stable,
published 2026-07-28) serves today's stateful `initialize` + `Mcp-Session-Id` clients unchanged
(Q1 = YES, proven empirically against the real v1.29 client). The migration is almost entirely
mechanical: the codemod converted the whole repo in one pass, typecheck was clean immediately, and
393 of 394 tests passed with zero source changes (the one failure is an error-shape assertion, not a
behavior regression). The ADR-0001 seam did its job — `transport.ts` needed only a class rename —
and the feared zod3→zod4 registration blast radius does not exist (we're already on zod4;
`registerTool/registerResource/registerPrompt` survive in v2 with the same signatures). The 2026-07
audit verdict stands: nothing forces migration until Claude Code speaks 2026-07-28; Phase C is a
~1–2 day job when it does.

---

## Q1 — Back-compat gate (the decisive question): **YES**

An SDK v2 server still serves TODAY'S clients — stateful streamable-HTTP, `initialize` handshake,
`Mcp-Session-Id` header, spec 2025-06-18.

**Mechanism.** v2's classic transports negotiate downward. At runtime:

```
SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25","2025-06-18","2025-03-26","2024-11-05","2024-10-07"]
DEFAULT_NEGOTIATED_PROTOCOL_VERSION = "2025-03-26"   LATEST (classic line) = "2025-11-25"
```

The stateful session model is intact and API-identical: `sessionIdGenerator`,
`onsessioninitialized`, `onsessionclosed`, `transport.sessionId`, `onclose`, invalid session → 404,
no-session non-init → 400, one standalone SSE stream per session → 409 on the second.

**Where 2026-07-28 actually lives.** The new stateless core (`server/discover`,
`subscriptions/listen`, MRTR) is a SEPARATE handler path in the same package —
`McpHttpHandler`/`createMcpHandler` + `PerRequestHTTPServerTransport`, with an inbound
classification ladder (`classifyInboundRequest`, `InboundModernRoute`/`InboundLegacyRoute`,
`legacyStatelessFallback`) that routes modern and legacy clients side by side. Adopting v2 does
NOT force the stateless model; it makes it available behind the same endpoint when we want it.

**Empirical proof** (`spike-proto/q1-backcompat.mjs`, committed; server = v2 `McpServer` +
`NodeStreamableHTTPServerTransport` in Express exactly like `mcpHttp.ts`; client = the REAL
`@modelcontextprotocol/sdk@1.29.0` `Client` + `StreamableHTTPClientTransport`, kept as a
devDependency for exactly this purpose):

| Check                                       | Result                                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| initialize handshake v1→v2                  | PASS (client negotiates 2025-11-25; a raw 2025-06-18 initialize is answered with 2025-06-18 verbatim)                               |
| `Mcp-Session-Id` issued + round-trips       | PASS                                                                                                                                |
| `tools/list` on reused session              | PASS                                                                                                                                |
| `tools/call` (no-schema + zod4-schema tool) | PASS                                                                                                                                |
| standalone GET-SSE                          | PASS — 200 `text/event-stream` on fresh session; second stream 409 "Only one SSE stream is allowed per session" (identical v1 rule) |
| DELETE teardown → reuse 404s                | PASS                                                                                                                                |

7/7. Claude Code's current line is served with no legacy adapter, no flags, no shim.

## Q2 — Package reality

All published **2026-07-28** as **2.0.0 stable** (beta line ran from 2026-04, `2.0.0-alpha.*` →
`2.0.0-beta.5`). All `engines.node >= 20` — matches our floor exactly; no Node cost.

| Package                               | Version              | Deps / peers                                                                                                                   | Notes                                                                                                                                                                      |
| ------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `@modelcontextprotocol/server`        | 2.0.0                | deps: `zod ^4.2.0`, `core 2.0.0`                                                                                               | `McpServer`, `registerTool/Resource/Prompt`, `WebStandardStreamableHTTPServerTransport`, auth core (`OAuthError`, `OAuthTokenVerifier`, `AuthInfo`), `isInitializeRequest` |
| `@modelcontextprotocol/node`          | 2.0.0                | dep: `@hono/node-server`; **peer: `hono ^4.11.4`** (warning-only; runtime fine without it — only `getRequestListener` is used) | `NodeStreamableHTTPServerTransport` — the drop-in for v1's `StreamableHTTPServerTransport`: same ctor options, same `handleRequest(req, res, body)`                        |
| `@modelcontextprotocol/express`       | 2.0.0                | dep: `cors`; peers: `express ^4.18                                                                                             |                                                                                                                                                                            | ^5`✓(5.2.1),`server ^2.0.0` | Middleware only (NO transport): `requireBearerAuth`, host/origin validation, `createMcpExpressApp`, metadata router |
| `@modelcontextprotocol/client`        | 2.0.0                | —                                                                                                                              | v2 client; codemod points tests here                                                                                                                                       |
| `@modelcontextprotocol/core`          | 2.0.0                | —                                                                                                                              | wire `*Schema` constants                                                                                                                                                   |
| `@modelcontextprotocol/server-legacy` | 2.0.0 **deprecated** | —                                                                                                                              | frozen v1 auth copy; codemod's default landing spot — we re-pointed off it (see Q3)                                                                                        |
| `@modelcontextprotocol/codemod`       | 2.0.0                | —                                                                                                                              | `v1-to-v2` transform (kickoff said `@beta`; stable superseded it)                                                                                                          |

## Q3 — Codemod dry-run

`pnpm dlx @modelcontextprotocol/codemod@2.0.0 v1-to-v2 .` → **55 files, +216/−242**, then
`pnpm typecheck` passed with ZERO manual fixes and contract went 344/344 immediately.

What it rewrote correctly:

- All deep `@modelcontextprotocol/sdk/*` imports → split packages (incl. every tool/resource/test).
- `StreamableHTTPServerTransport` → `NodeStreamableHTTPServerTransport` (transport.ts, type + ctor).
- Schema-first handlers → method-string: `setRequestHandler(SubscribeRequestSchema, …)` →
  `setRequestHandler('resources/subscribe', …)` (resourceSubscriptions.ts, prompts/index.ts).
- `McpError`/`ErrorCode` → `ProtocolError`/`ProtocolErrorCode`.
- 24 raw-shape `inputSchema` object literals wrapped in `z.object()` across `src/server/tools/*`.
- `package.json`: removed `sdk`, added `client` + `server-legacy`.

What it flagged for humans (2 markers, both resolved in the prototype):

1. **`mcpHttp.ts` auth** — codemod parks `requireBearerAuth` on the deprecated frozen
   `server-legacy/auth`. Re-pointed to `@modelcontextprotocol/express` (same `{ verifier }`
   options), and `verifier.ts` now throws `new OAuthError(OAuthErrorCode.InvalidToken, …)` —
   v2's middleware does not recognize the legacy `InvalidTokenError` class (would 500, not 401).
   All 401-shape contract tests still pass. `server-legacy` dropped from deps.
2. **`spawnBoard.ts`** — dynamically-spread shape (`…(planningWrite ? { seed } : {})`) couldn't be
   auto-verified; hand-wrapped in `z.object()`.

What it got WRONG (watch in Phase C):

- It rewrote the **v1-client import in our back-compat probe** to the v2 client — anything that
  deliberately uses the v1 SDK as a "today's client" test double gets converted and silently loses
  its purpose. Restored by hand; v1 sdk kept as a devDependency.
- Same effect on the whole test suite: `test/helpers/inMemory.ts` + all live tests now speak the
  **v2 client**, so the suite no longer exercises a v1 client end-to-end (see Q6).
- Leaves auth on a deprecated package by default; doesn't run prettier (told to, correctly).

## Q4 — True blast radius (file ledger)

The seam held. **No file needed logic changes for the migration itself** — the only non-mechanical
work was the 2 codemod markers above.

| File(s)                                                       | Change                                                                                 | Kind                               |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------- |
| `src/server/transport.ts`                                     | transport class rename, 2 imports — **SessionManager machinery untouched**             | mechanical (the seam, as designed) |
| `src/server/factory.ts`                                       | **1 import line.** `McpServer` + all `register*` signatures identical                  | mechanical                         |
| `src/server/mcpHttp.ts`                                       | `requireBearerAuth` → `@modelcontextprotocol/express`                                  | manual, small                      |
| `src/auth/verifier.ts`                                        | `OAuthError(OAuthErrorCode.InvalidToken)` replaces `InvalidTokenError`                 | manual, small                      |
| `src/server/resourceSubscriptions.ts`, `src/prompts/index.ts` | method-string `setRequestHandler`, `ProtocolError`                                     | mechanical (codemod)               |
| `src/server/tools/*` (19 files)                               | import renames + `z.object()` wraps (zod4 already in place — no schema-syntax changes) | mechanical (codemod)               |
| `src/resources/*` (8 files), `attentionNotifier.ts`           | import renames only                                                                    | mechanical                         |
| `test/**` (19 files)                                          | client imports → v2 client; 1 assertion updated (Q6)                                   | mechanical + 1 shape fix           |
| `package.json`                                                | deps swap; v1 sdk retained as devDep for compat probing                                | manual review                      |

**The suspected zod3→zod4 bleed does not exist** — ADR 0001's Phase-0 choice of zod4 pre-paid it.
The registration API (the other suspected radius) is unchanged in v2.

## Q5 — Session-machinery delta ledger

**Column A — after Phase C as prototyped (v2, classic stateful transport):** every row survives
unchanged; this is the whole point of Q1.

**Column B — if/when we opt into the native 2026-07-28 stateless core** (a LATER, separate
decision — not part of Phase C):

| Machinery                                     | A: v2 classic (Phase C)                 | B: native stateless 2026-07-28                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🔒 PKG-N1 ownership gate                      | survives as-is                          | Dies _as a session gate_ because sessions die — and the threat dies with them: with per-request server construction (`McpServerFactory`/`PerRequestHTTPServerTransport`), tier+boardId are re-derived from the bearer token on EVERY request; there is no longer a session frozen at the creator's tier for another token to hijack. The gate's rationale must be re-verified then, not ported blindly.      |
| Idle sweep (`CANVAS_ADE_SESSION_IDLE_TTL_MS`) | survives as-is                          | Dies for stateless requests (nothing to reap); survives only for whatever legacy-session traffic remains during the transition. `subscriptions/listen` streams need their own liveness policy.                                                                                                                                                                                                               |
| `closeByBoardId` (app v0.43.4 depends on it)  | survives as-is                          | Re-expressed: token revocation (`TokenStore.revoke`) becomes sufficient for REQUESTS (each is re-authenticated), but the host still needs "sever live streams for board X" — becomes cancel-subscriptions-by-board + abort in-flight requests. **expanse-desktop keeps calling the same host API; its implementation changes underneath — design the host call now as "revoke board" not "close sessions".** |
| Attention notifier (GET-SSE push)             | survives as-is                          | Re-expressed over `subscriptions/listen` (which replaces GET-SSE + `resources/subscribe`). Our `installResourceSubscriptions` + `createAttentionNotifier` pair maps naturally (subscribe bookkeeping → listen registry); wire format changes, concept doesn't.                                                                                                                                               |
| Blocking barriers (`wait_for_idle/all`)       | survive as-is                           | Long-held POSTs still legal but the idiomatic home is the `io.modelcontextprotocol/tasks` extension (poll/notify) or MRTR `input_required` round-trips. Keep barriers; add tasks only if Claude Code adopts them.                                                                                                                                                                                            |
| `handoff_prompt` (blocking dispatch)          | survives as-is                          | Same story as barriers — the send-await-idle-return contract holds; tasks extension is the eventual pressure-relief for very long waits.                                                                                                                                                                                                                                                                     |
| Bearer auth + tier factory                    | survives (express middleware swap done) | Survives cleanly — per-request auth is MORE natural stateless; `_meta` carries protocol/capabilities and `AuthInfo` flows per request.                                                                                                                                                                                                                                                                       |

Host-side (expanse-desktop) changes needed for Column B only: none for A beyond consuming the new
package version.

## Q6 — Test damage

**1 failure out of 392 (344 contract + 48 live), zero behavioral regressions.**

- `test/live/tierCall.live.test.ts` — "a worker calling orchestrator_ping is rejected":
  **transport-shape**, not behavior. v1 answered an unregistered tool with an `isError` RESULT;
  v2 answers protocol-layer method-not-found, so the client call REJECTS (`ProtocolError: Tool
orchestrator_ping not found`). The tier gate holds identically. Assertion updated to
  `rejects.toThrow(/not found/)`.
- Everything else passed unmodified, including all PKG-N1 session-ownership, reaping, notifier,
  barrier, and 401-shape suites.
- **Caveat:** the codemod moved the whole suite to the v2 client, so the suite now proves
  v2↔v2, and only the committed probe proves v1↔v2. **Phase C should add a small v1-client
  contract lane** (handshake + session reuse + one tool call via `@modelcontextprotocol/sdk`,
  which we kept as a devDependency) so today's-client compat stays regression-locked.
- Live suite: all 48 ran and passed against the suite's own loopback server; the
  drive-the-real-desktop-app form was NOT exercised (app not running during the spike). Phase C
  must repeat `test:live` with the app up.

## Q7 — Effort, Phase C plan, and what to do now

**Measured spike effort:** ~half a day including all research and this report. **Phase C estimate:
1–2 days** (codemod re-run ~1h; manual fixes ~1h; back-compat lane + test passes ~half day; host
bump + real-app live runs + release mechanics the rest).

**Ordered Phase C plan** (execute when Claude Code ships 2026-07-28 support — or earlier if v1
goes unmaintained):

1. Branch from fresh main; re-run `@modelcontextprotocol/codemod` `v1-to-v2` (do NOT rebase this
   spike — main will have moved; the codemod is cheap and deterministic; this report is the map).
2. Apply the two known manual fixes: auth → `@modelcontextprotocol/express` + `OAuthError`
   verifier; `spawnBoard` `z.object()` wrap. Audit codemod output for any NEW markers.
3. Revert the codemod's rewrite of v1-client imports in anything meant to stay v1; keep
   `@modelcontextprotocol/sdk` as devDependency.
4. Fix the `tierCall` assertion (or port this spike's version).
5. Add the v1-client back-compat contract lane (Q6).
6. Gates: typecheck · contract · lint · build · `test:live` twice — loopback AND with the desktop
   app running (the subset this spike could not cover).
7. Bump minor + ship per the tag-triggered publish flow; bump the `file:` consumer in
   expanse-desktop and run its MAIN-wiring smoke (watch the 401 challenge shape — ADR 0002 D3's
   expiry rejection came from the middleware; the express package preserved our contract tests
   but the app smoke is the real proof).
8. Do NOT adopt the stateless core / `McpHttpHandler` in Phase C. That's a separate decision with
   its own ADR when client support and a concrete benefit exist (we are loopback single-instance;
   Column B of Q5 is the worksheet).

**Do NOW (cheapen Phase C):** almost nothing — the spike proves Phase C is already cheap.
Specifically:

- Keep this branch + report; do not merge.
- Do NOT pre-land `z.object()` wraps on main — v1.29's `registerTool` takes raw shapes
  (`ZodRawShape`), not schema objects; the wrap is v2-only syntax. zod4 (the real pre-migration)
  is already done.
- When next touching the host's board-teardown path, shape it as "revoke board" (token + sessions
  - streams) rather than "close sessions" — that keeps `closeByBoardId`'s consumer contract stable
    across Column B (Q5).
- Watch: `@modelcontextprotocol/node`'s `hono` peer warning (benign today); Claude Code
  2026-07-28 client support (the Phase C trigger); v1 SDK maintenance status.

## Dead ends + notes (annotated, per spike discipline)

- **`@modelcontextprotocol/express` is middleware-only** — no transport class. First read of the
  migration guide suggested the Express adapter replaces the transport; it doesn't. The transport
  for Express/Node servers is `NodeStreamableHTTPServerTransport` from `…/node` (which wraps the
  web-standard transport via `@hono/node-server`'s request listener).
- **Direct `WebStandardStreamableHTTPServerTransport` use was abandoned** — it takes fetch
  `Request`/returns `Response`; bridging Express req/res by hand duplicates what `…/node` already
  ships. Not worth owning.
- **Probe's first GET-SSE check failed misleadingly** (409): the v1 client auto-opens the
  standalone stream on connect; the 409 is the one-stream rule working. The probe now asserts the
  409 as the expected outcome and the fresh-session 200 was verified raw.
- `createMcpExpressApp` was not adopted — our `mcpHttp.ts` owns Host/Origin guards (ADR 0003) and
  error middleware; the convenience app would duplicate/fight that. Re-evaluate only if we ever
  drop our own guards.
