# canvas-ade-mcp — Implementation Guide

How the server is built. Pairs with [`decisions/0001-mcp-implementation.md`](decisions/0001-mcp-implementation.md)
(the why), [`roadmap.md`](roadmap.md) (the phase order), and
[`research/mcp-swarm-research.md`](research/mcp-swarm-research.md) (the evidence base). Reflects what
Phase 0 actually shipped — all five gates green.

## Stack (as installed)

- **Runtime:** `@modelcontextprotocol/sdk@1.29.0`, `express@5.2.1`, `zod@4.4.3`.
- **Toolchain:** `typescript@6.0.3`, `tsup@8` (build), `vitest@4` (test), `eslint@10` flat +
  `typescript-eslint@8` + `prettier@3`. pnpm 9.15.
- **Module resolution:** `Bundler` + extensionless relative imports (see ADR 0001). SDK subpath
  imports keep the `.js` suffix the SDK's own `exports` map expects (e.g.
  `@modelcontextprotocol/sdk/server/mcp.js`).

## Transport pattern (stateful streamable-HTTP)

One `/mcp` endpoint; one transport + `McpServer` per session; a `Map<sessionId, transport>`
(`src/server/transport.ts`, the **only** file importing the SDK transport).

- **POST** — if `mcp-session-id` present: reuse that transport (404 if unknown). If absent +
  `isInitializeRequest(body)`: create a new transport (`sessionIdGenerator: () => randomUUID()`,
  `onsessioninitialized` registers it in the map, `onclose` deletes it), build the per-session server
  via the tier factory, `server.connect(transport)`, then `transport.handleRequest(req, res,
req.body)`. Otherwise 400. **400 (missing/no-init) vs 404 (unknown session) are kept distinct** so
  clients can tell "fix request" from "restart session."
- **GET** (SSE) / **DELETE** — look up by `mcp-session-id` (400 missing / 404 unknown), then
  `handleRequest`. SSE default (`enableJsonResponse` unset) so server→agent notifications work later.
- **Shutdown** — `closeAll()` iterates the map calling `transport.close()`, then the HTTP server
  closes (mirrors Canvas ADE's PTY/WebContentsView teardown discipline).
- `handleRequest(req, res, parsedBody)` — Express's `express.json()` pre-parses `req.body`; pass it
  as the 3rd arg so the stream isn't read twice.

## Auth + the tier decision flow (the security core)

```
express.json()  ->  originGuard(allowlist)  ->  requireBearerAuth({ verifier })  ->  /mcp handler
                          │                            │                                 │
                   Origin not allowed → 403     bad/absent token → 401          ctxFromAuth(req.auth)
                                                  sets req.auth from verifier      → factory.getServer(tier)
                                                  (extra:{tier,boardId})           registers ONLY tier's tools
```

- `src/auth/verifier.ts` — `OAuthTokenVerifier.verifyAccessToken(token)` looks the token up in the
  store, throws `InvalidTokenError` (→ 401) on miss, else returns `AuthInfo` carrying
  `extra:{tier,boardId}`. `src/auth/tokens.ts` — in-memory mint/revoke `Map`. Both isolate SDK auth.
- `AuthInfo.expiresAt` is set far out (board lifetime) — `requireBearerAuth` enforces expiry, so a
  short value would kill a long agent session mid-run.
- `src/server/factory.ts` — `getServer({tier,...})` registers `ping` for both tiers and
  `orchestrator_ping` ONLY for orchestrator. **Capability split is structural (by registration).**
- `src/security/origin.ts` — Origin allowlist (both `127.0.0.1` and `localhost` spellings), computed
  AFTER `listen(0)` resolves the ephemeral port; requests with NO Origin (CLI clients) pass (token is
  the authority). **No OAuth discovery route is ever mounted.**

## File tree (Phase 0)

```
src/
  index.ts                public entry: createMcpHttpServer + public types
  types.ts                Tier · Scope · BoardId · AuthRow
  constants.ts            MCP_PATH · HEADER_SESSION_ID · tool names
  server/
    mcpHttp.ts            createMcpHttpServer(deps): Express → guards → /mcp; listen(0,'127.0.0.1')
    transport.ts          SessionManager: session map + create/reuse/close (ONLY SDK-transport import)
    factory.ts            ServerFactory.getServer(ctx): tier-gated registerTool
  auth/
    verifier.ts           OAuthTokenVerifier over the token store
    tokens.ts             TokenStore (mint/revoke/get)
  security/origin.ts      originGuard middleware (403)
  orchestrator/
    Orchestrator.ts       injected interface (listBoards/spawnBoard/dispatchPrompt/gitDiff/boardStatus)
    mock.ts               MockOrchestrator for tests
  resources/boards.ts     canvas://boards read-only resource
  prompts/index.ts        placeholder (templates land later)
test/
  helpers/inMemory.ts     Client ⇄ factory server over InMemoryTransport
  helpers/httpServer.ts   real loopback server on ephemeral port + mintToken
  contract/*.test.ts      handshake + tierSplit (fast, no HTTP)
  live/*.test.ts          real HTTP: handshake + Origin 403 + 401 + 404 + 400
```

## Build tooling

- **`tsup`** → single ESM `dist/index.js` + `dist/index.d.ts`; SDK/express/zod externalized.
  `tsconfig.json` needs `"ignoreDeprecations": "6.0"` (TS 6 errors on a `baseUrl` the tsup dts build
  injects).
- **`tsc --noEmit`** type-checks (esbuild/tsup do not).
- **`vitest`** with two `projects`: `contract` (`pnpm test`) and `live` (`pnpm test:live`).
- **`eslint`** flat config; `@typescript-eslint/no-unused-vars` set with `argsIgnorePattern: '^_'`.
- `package.json`: `type:module`, `exports` → `dist`, `files:["dist"]`, `engines.node>=20`.

## Electron integration (later phase — not wired in Phase 0)

- The package exports `createMcpHttpServer(deps)` — a **library, never a CLI**. MAIN imports it in
  `app.whenReady()`, supplies the real `Orchestrator` (PtyManager/PreviewManager/simple-git by
  closure) + a `TokenStore`, gets back `{ port, close, setAllowedOrigins }`.
- `listen(0, '127.0.0.1')` → ephemeral port (avoids dev-localhost + per-board-port collisions). Mint
  a per-board token on board spawn; inject into that board's CLI MCP-client config out-of-band.
- Consume as `file:../canvas-ade-mcp` (NOT `pnpm link`). Keep it + its deps in the app's
  `dependencies` (electron-vite externalizes MAIN deps). **`file:` snapshots at install** → after
  editing the lib, rebuild it AND re-run `pnpm install` in the app.
- Phase 0 **live tests do NOT boot Electron** — they spin their own in-process HTTP server. Driving
  the real Canvas ADE app is a later phase (when MAIN hosts the server).

## Top risks (carry forward)

- **SDK v1→v2 churn** — transport rename + package split; mitigated by import isolation in
  `transport.ts` + `auth/`.
- **No OAuth breadcrumbs** — never mount `mcpAuthMetadataRouter` / `/.well-known/oauth-*`.
- **Tier factory must register-only** — `tools/list` itself must hide other-tier tools.
- **`AuthInfo.expiresAt`** — board lifetime, or `requireBearerAuth` expires a live session.
- **InMemory contract tests bypass HTTP** — auth/Origin/session are covered ONLY in `test/live`.
- **Origin allowlist after `listen(0)`** — exact host:port, both spellings, or you 403 your own agents.
