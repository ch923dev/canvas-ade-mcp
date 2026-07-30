# ADR 0004 — Migrate to MCP SDK v2 split packages (classic stateful line)

- **Status:** Accepted (2026-07-31)
- **Context:** ADR 0001 chose `@modelcontextprotocol/sdk` 1.29 and isolated all transport imports
  behind `src/server/transport.ts` so a future SDK v2 bump would be cheap. The Phase B spike
  (`docs/SPIKE-SDK2-REPORT.md`, branch `spike/sdk2-transport`) proved the bump: SDK v2 (2.0.0
  stable, 2026-07-28) serves today's stateful `initialize` + `Mcp-Session-Id` clients unchanged,
  and the migration is mechanical. This ADR records the Phase C execution — done ahead of the
  original trigger (Claude Code speaking spec 2026-07-28) by maintainer decision, to stay on the
  maintained SDK line while changing NOTHING on the wire for current clients.

## Decision

**Replace `@modelcontextprotocol/sdk` ^1.29 with the v2 split packages, staying on the classic
stateful streamable-HTTP transport.** Concretely:

- `@modelcontextprotocol/server` 2.0.0 — `McpServer`, `registerTool/Resource/Prompt` (signatures
  unchanged from v1), `isInitializeRequest`, auth core (`OAuthError`, `OAuthTokenVerifier`,
  `AuthInfo`).
- `@modelcontextprotocol/node` 2.0.0 — `NodeStreamableHTTPServerTransport`, the drop-in successor
  to v1's `StreamableHTTPServerTransport` (same ctor options incl. `sessionIdGenerator` /
  `onsessioninitialized`, same `handleRequest(req, res, body)`). Its `hono` peer warning is
  benign — only `@hono/node-server`'s request listener is used.
- `@modelcontextprotocol/express` 2.0.0 — `requireBearerAuth` middleware (the maintained v2 home;
  the codemod's default `@modelcontextprotocol/server-legacy` landing spot is deprecated-frozen
  and NOT used). `src/auth/verifier.ts` throws `OAuthError(OAuthErrorCode.InvalidToken)` — the v2
  middleware does not recognize the legacy `InvalidTokenError` class (500 instead of 401).
- `@modelcontextprotocol/client` 2.0.0 — test-suite client.
- `@modelcontextprotocol/sdk` 1.29 stays as a **devDependency**: `test/live/v1ClientCompat.live.
test.ts` drives the server with the REAL v1 client to regression-lock today's-client compat.
  ⚠️ The `v1-to-v2` codemod rewrites v1 imports wholesale — that lane must keep its v1 imports.

## Explicitly NOT adopted (deferred, own ADR when it happens)

The 2026-07-28 stateless core — `McpHttpHandler`/`createMcpHandler`,
`PerRequestHTTPServerTransport`, `server/discover`, `subscriptions/listen`, MRTR. We are loopback
single-instance; sessions, PKG-N1 ownership, idle sweep, `closeByBoardId`, and the GET-SSE
attention notifier all continue exactly as before (`SessionManager` unchanged but for the
transport class name). The re-expression worksheet for a future stateless adoption is
`docs/SPIKE-SDK2-REPORT.md` §Q5 column B.

## Consequences

- One observable protocol-shape change: an unregistered tool call is answered with a
  protocol-layer method-not-found ERROR (client call rejects) instead of v1's `isError` RESULT.
  Tier enforcement is unaffected (ADR 0002 D1 holds); `tierCall.live.test.ts` asserts the new
  shape.
- Wire behavior for current clients is otherwise unchanged and covered by the v1-compat lane
  (handshake echo of 2025-06-18, session reuse, GET-SSE, DELETE→404).
- Node floor unchanged (>= 20). Peers satisfied by existing `express` 5.2.1 and `zod` 4.4.3.
- The expanse-desktop `file:` consumer needs only the version bump; its MAIN-wiring smoke is the
  remaining real-app proof (this package's live suite is self-hosted loopback by design).
