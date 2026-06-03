# MCP Client Connection Matrix — agentic CLIs → embedded loopback server

How the agentic CLI running **inside a terminal board** connects back to Expanse's embedded MCP
server (loopback Streamable-HTTP, per-board bearer token, **no OAuth discovery**). This is the
load-bearing wiring for every write-tool phase (roadmap Phase 3+): if a CLI can't reach the loopback
server with its board-scoped token, the "agent drives the canvas" loop breaks.

> **Method:** deep-research workflow (2026-06-02, 101 agents, 5 search angles → 19 sources fetched →
> 94 claims → 25 adversarially verified, **24 confirmed / 1 refuted**). Sources cited inline. Pairs
> with [`mcp-swarm-research.md`](mcp-swarm-research.md) (the swarm design) and the parent repo memory
> `mcp-spec-state-2026-06` (spec/SDK deltas). **Time-sensitive — MCP client transport surfaces move
> fast; re-verify on the CLI versions Expanse actually targets.**

---

## Bottom line

**All four target CLIs — Claude Code, OpenAI Codex, Cursor, Gemini CLI — can connect to a no-OAuth
loopback Streamable-HTTP MCP server with a per-board static bearer token TODAY. No `stdio↔HTTP` proxy
shim is required for any of them.** Each:

- speaks the **modern Streamable HTTP** transport (SSE is deprecated upstream across all four),
- accepts a per-server **`Authorization: Bearer <token>`** header,
- **auto-discovers a project-scoped config** in the per-board `cwd`,
- does **not** require OAuth/`.well-known` discovery for a static bearer — OAuth is optional
  everywhere, so emitting **no** OAuth metadata (what Expanse already does) is the clean sanctioned path.

The whole verdict is conditional on **the server advertising NO OAuth discovery** — see Gotcha #2.

---

## The matrix

| CLI              | HTTP transport (selector)                              | Bearer header                              | Project config (cwd)                   | Env-expand token                         | Headless approval                    | Proxy needed |
| ---------------- | ------------------------------------------------------ | ------------------------------------------ | -------------------------------------- | ---------------------------------------- | ------------------------------------ | ------------ |
| **Claude Code**  | ✅ `"type":"http"` + `"url"` (alias `streamable-http`) | ✅ `headers` object                        | `.mcp.json` (repo root)                | ✅ `${VAR}` in url+headers               | ✅ promptless for `.mcp.json` path   | **No**       |
| **OpenAI Codex** | ✅ `url` under `[mcp_servers.<id>]` (newest path)      | ✅ `bearer_token_env_var` / `http_headers` | `.codex/config.toml` (⚠️ trust-gated)  | ✅ via `*_env_var` fields                | ⚠️ **trust-gated** — pre-seed        | **No**       |
| **Cursor**       | ✅ `url` (HTTP-first, SSE fallback)                    | ✅ `headers` object                        | `.cursor/mcp.json` (repo root)         | ✅ `${env:NAME}` in url+headers          | ✅ config path promptless            | **No**       |
| **Gemini CLI**   | ✅ `httpUrl` (distinct from SSE `url`)                 | ✅ `headers` object                        | `.gemini/settings.json` → `mcpServers` | ⚠️ header-value expansion **unverified** | ✅ promptless for static-header path | **No**       |

---

## Per-CLI config recipes (no-disk-secret pattern)

The token is injected into the **spawned shell env** by MAIN; the on-disk config references the env
var so the secret never lands on disk.

### Claude Code — `.mcp.json` (project root)

```json
{
  "mcpServers": {
    "expanse": {
      "type": "http",
      "url": "http://127.0.0.1:${EXPANSE_MCP_PORT}/mcp",
      "headers": { "Authorization": "Bearer ${EXPANSE_BOARD_TOKEN}" }
    }
  }
}
```

`${VAR}` / `${VAR:-default}` expansion is documented for `url` and `headers`. CLI equivalent:
`claude mcp add --transport http expanse <url> --header "Authorization: Bearer <token>"`.
_Sources: code.claude.com/docs/en/mcp; anthropics/claude-code#38972 (curl-verified 200 OK on initialize)._

### OpenAI Codex — `~/.codex/config.toml` (global, trust-safe) or `.codex/config.toml`

```toml
[mcp_servers.expanse]
url = "http://127.0.0.1:8123/mcp"
bearer_token_env_var = "EXPANSE_BOARD_TOKEN"   # named var → auto-added as Authorization; never inline
```

`bearer_token_env_var` is the **cleanest** of the four (token is a named env var, not a config
string). CLI: `codex mcp add expanse --url <url> --bearer-token-env-var EXPANSE_BOARD_TOKEN`.
_Sources: developers.openai.com/codex/{mcp,config-reference,config-sample}._

### Cursor — `.cursor/mcp.json` (project root)

```json
{
  "mcpServers": {
    "expanse": {
      "url": "http://127.0.0.1:8123/mcp",
      "headers": { "Authorization": "Bearer ${env:EXPANSE_BOARD_TOKEN}" }
    }
  }
}
```

`${env:NAME}` resolves against **Cursor's process env at launch** — MAIN must inject the token into
the env of the process that launches the CLI (forum #156069).
_Sources: cursor.com/docs/context/mcp; TrueFoundry 2026 MCP-auth guide._

### Gemini CLI — `.gemini/settings.json` (project root) or `~/.gemini/settings.json`

```json
{
  "mcpServers": {
    "expanse": {
      "httpUrl": "http://127.0.0.1:8123/mcp",
      "headers": { "Authorization": "Bearer <token-or-verify-expansion>" },
      "timeout": 5000
    }
  }
}
```

**Must** use `httpUrl` (not `url`, which selects legacy SSE; a bare entry defaults to stdio and
**silently drops `headers`**). Header-value env-expansion is shown in examples but **was not
source-confirmed** (one such claim refuted 0-3) → write the literal token, use the `--header` CLI
flag, or verify expansion on the target version.
_Sources: google-gemini/gemini-cli docs/tools/mcp-server.md; github-mcp-server install-gemini-cli.md._

---

## Cross-cutting gotchas (honor all)

1. **Header name casing** must be exactly `Authorization` everywhere.
2. **Server must NOT advertise OAuth `/.well-known/oauth-*` discovery.** If it did, Cursor probes it
   first and **ignores the configured `Authorization` header** (forum #156054, maintainer-confirmed no
   "skip OAuth if header present" logic), and Claude Code's `/mcp` UI mislabels the server
   (#38972/#17152, cosmetic). Expanse 404s the `.well-known` probes → the static header **is** honored.
   This is the documented workaround case. **Do not add OAuth metadata to the loopback server.**
3. **`localhost` vs `127.0.0.1` are distinct strings** in some OAuth-redirect logic (irrelevant to a
   static-header scheme, but) — pick **one** host spelling consistently for the Origin/Host allowlist
   so a CLI's default request headers don't trip the guard. (The existing server allowlists both.)
4. **SSE is deprecated** upstream across all four — always select the HTTP transport, never SSE.
5. **Codex HTTP is the least-mature path:** it sat behind `[features] experimental_use_rmcp_client`
   (PR #4317, v0.46 Nov 2025), now apparently default, but had session bugs (#15815, #17529) and a
   **Windows** `missing field 'command'` error for HTTP servers (#4496, #11284). **Expanse is Windows
   (`Z:\Canvas ADE`)** → pin + smoke-test a specific Codex version before relying on it.
6. **Codex project config is trust-gated:** `.codex/config.toml` loads only when
   `projects.<path>.trust_level = "trusted"` (issue #10389); an auto-spawned board agent can't click
   the trust prompt → **pre-seed trust** in user-level config, or put the server in `~/.codex/config.toml`.

---

## Expanse implementation guidance

- **Default to env-injected tokens, not on-disk secrets.** MAIN writes the config referencing an env
  var and injects the board token into the spawned shell's environment (the existing `cwd`/env spawn
  plumbing already threads per-board env). On-disk config carries no secret.
- **Per-CLI writer:** the board-spawn path emits the right config file for the board's selected
  agent — `.mcp.json` / `.codex/config.toml` / `.cursor/mcp.json` / `.gemini/settings.json` — into the
  board `cwd`. Agent-agnostic `launchCommand` already implies knowing which CLI; extend that to pick
  the config shape.
- **Codex:** prefer `bearer_token_env_var` + pre-seeded user-level trust; pin a Windows-smoke-tested
  version.
- **Gemini:** use `httpUrl`; write the literal token (or verify header env-expansion on the pinned
  version) since expansion is unconfirmed.
- **A `stdio↔HTTP` shim is NOT needed today** — but `npx mcp-remote <url> --header "Authorization:
Bearer <token>"` (geelen/mcp-remote), `mcp-proxy` (sparfenyuk), and `supergateway` exist and pass
  bearer headers, so a future stdio-only agent has a sanctioned fallback. Keep the per-CLI writer
  pluggable so a shim entry can be added without touching the server.

---

## Open questions (validate in the real board-spawn harness)

- **Zero-prompt first run:** does each CLI silently load a project-scoped HTTP MCP server from `cwd`
  with no interactive approval on a fresh spawn? Codex is confirmed trust-gated; the others appear
  promptless for the static-header path but **no source exercised a true zero-prompt end-to-end
  spawn** — verify per version in the actual harness (reuse `CANVAS_SMOKE`).
- **Codex Windows HTTP stability** + current `experimental_use_rmcp_client` default — pin + smoke on Windows.
- **Gemini header env-expansion** on the target version — expand vs literal.
- **Default Origin/Host the CLIs send:** the matrix confirms header _injection_; the _default_ request
  headers each CLI's MCP HTTP client emits (Origin present? Host = `localhost` or `127.0.0.1`?) were
  not enumerated — **verify against the server's Origin/Host guard** so a CLI isn't 403'd by its own
  default headers.

---

## Provenance / sources (primary unless noted)

- Claude Code: `code.claude.com/docs/en/mcp` · anthropics/claude-code#38972, #17152
- Codex: `developers.openai.com/codex/{mcp,config-reference,config-sample}` · openai/codex#10389, #4496
- Cursor: `cursor.com/docs/context/mcp` · forum.cursor.com #156054, #156069 · TrueFoundry 2026 guide _(blog)_
- Gemini: `github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md` · github-mcp-server
  install-gemini-cli.md · gemini-cli#13762 (httpUrl→unified-url migration), #5282 _(refuted env-expand)_
- Fallback shims: geelen/mcp-remote · sparfenyuk/mcp-proxy · supercorp-ai/supergateway
- Method: deep-research task `w3zorcqfi` (full cited report in the task output).
