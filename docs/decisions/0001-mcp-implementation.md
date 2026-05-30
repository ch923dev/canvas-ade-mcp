# ADR 0001 — MCP implementation: official SDK, no framework

- **Status:** Accepted (2026-05-30)
- **Context:** canvas-ade-mcp needs an MCP server hosted inside Canvas ADE's Electron MAIN process,
  exposing tools/resources to AI agents in Terminal boards, with a command-board (orchestrator) vs
  worker capability split. Two deep-research workflows surveyed the framework landscape + the MCP
  spec + real prior art (Claude Code Agent Teams, Cursor 3, Warp, Anthropic's multi-agent research
  system). This ADR records the implementation decisions, validated by building Phase 0 against them.

## Decision

**Build directly on the official `@modelcontextprotocol/sdk` (installed `1.29.0`) low-level
primitives — NO higher-level framework.** Concretely:

- `McpServer` (`/server/mcp.js`), `StreamableHTTPServerTransport` (`/server/streamableHttp.js`),
  `requireBearerAuth` + `OAuthTokenVerifier` (`/server/auth/...`), `isInitializeRequest`
  (`/types.js`), `InMemoryTransport` (`/inMemory.js`), `Client` (`/client/index.js`).
- **Stateful streamable-HTTP**, a single `/mcp` endpoint, **one transport + one `McpServer` per
  session**, keyed by `mcp-session-id` (routing only — authority is the bearer token).
- **Capability tiers enforced server-side by token, via a per-session factory that registers ONLY
  the allowed tier's tools** — never tool annotations, never prompt, never register-all-then-gate. A
  worker's `tools/list` does not even contain an orchestrator tool.
- **Custom per-board bearer token** verified by a slim `OAuthTokenVerifier` over an in-memory token
  store. **No OAuth discovery** routes (`resourceMetadataUrl` left unset) so Claude Code does not
  falsely flag "needs authentication."
- **Origin/Host 403 guard owned by us** (`src/security/origin.ts`), not the transport's `@deprecated`
  DNS-rebinding flags. Bind `127.0.0.1`, never `0.0.0.0`.
- **All SDK transport imports isolated to `src/server/transport.ts`** (and auth imports to
  `src/auth/`) so a future SDK v2 bump (which renames the transport + splits packages) is one file.
- **Control plane only** — high-volume PTY bytes stay on Canvas ADE's existing MessagePort, never
  through MCP.
- **Consumed by Canvas ADE as a `file:` dependency** (`"canvas-ade-mcp": "file:../canvas-ade-mcp"`),
  NOT `pnpm link` (symlinks break electron-builder asar packaging). Pure JS → lives inside the asar.

### Module resolution (deviation from the research's NodeNext suggestion)

We use **`moduleResolution: "Bundler"` + extensionless relative imports**, not NodeNext. Rationale:
tsup bundles to a single self-contained `dist/index.js`, Bundler resolution resolves the SDK's
`exports` map fine, and Bundler avoids the `.js`-suffix friction that NodeNext imposes uniformly
across `tsc`, `tsup`, **and Vitest** (Vite does not auto-map `.js`→`.ts`). Canvas ADE's MAIN tsconfig
also uses Bundler, and it consumes the built `dist/` via the package `exports` map regardless.

## Alternatives rejected

- **FastMCP** — owns/starts its own Hono server (won't mount into MAIN's lifecycle); gates via a
  per-tool `canAccess(auth)` predicate on a _shared_ server = exactly the annotation-style gating our
  security model forbids.
- **xmcp / vercel mcp-handler** — Next/Vercel/serverless, stateless. Wrong model for a long-lived
  in-process bus.
- **SDK v2 alpha** (`2.0.0-alpha.2`) — renames the transport, splits packages; too early. Isolated
  imports keep the future bump cheap.

## Consequences

- We own all multi-agent safety design (the spec gives the protocol, not safety guidance): provenance
  tagging, nonce/replay protection, human-confirm on risky tools, `answer_permission` unconditional
  confirm, audit logging, session revocation. Tracked per-phase in `docs/roadmap.md`.
- Elicitation/sampling support varies by CLI client — verify target agents + build fallbacks before
  depending on them (later phases).
- Phase 0 shipped on this stack: `@modelcontextprotocol/sdk@1.29.0`, `express@5.2.1`, `zod@4.4.3`;
  toolchain `typescript@6.0.3` (+ `ignoreDeprecations: "6.0"` for the tsup dts build), `tsup@8`,
  `vitest@4`, `eslint@10` flat config. `pnpm audit` clean (the previously-noted GH#2042 CVE is not
  present in 1.29.0).
