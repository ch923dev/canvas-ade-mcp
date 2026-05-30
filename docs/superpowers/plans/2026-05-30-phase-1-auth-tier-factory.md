# Phase 1 — Auth + capability tier-factory (hardening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that what an agent can call is decided solely by its bearer token, server-side, and that the token lifecycle (invalid / expired / revoked / cross-board) is airtight — across both the contract and live test layers.

**Architecture:** Phase 0 already stood up the auth spine (bearer verifier + token store, `requireBearerAuth` on every `/mcp` request, a register-only tier factory). Phase 1 is *hardening*: add the missing tests that lock the guarantees in, formalize the scope model as data carried by the token, and ship MAIN-agnostic lib utilities (token mint helper + `.mcp.json` writer) in isolation. No new transport or framework code.

**Tech Stack:** TypeScript 6 (`moduleResolution: Bundler`), `@modelcontextprotocol/sdk@1.29.0`, `express@5`, `zod@4`, `vitest@4` (two projects: `contract` = in-memory/no-HTTP, `live` = real loopback HTTP), `tsup`, `eslint@10`, `prettier@3`. Run from `Z:\canvas-ade-mcp` with `corepack pnpm <script>`.

**Locked decisions (recorded in `docs/decisions/0002-phase-1-auth-scope-model.md`, written in Task 7):**
- **D1 — no cross-tier runtime guard.** Tier separation is enforced by *registration*: a worker's server never registers `orchestrator_ping`, so the callback cannot run. A belt-and-suspenders guard inside that callback would be dead code for the cross-tier case. Per-tool *scope* gating (within a tier) is deferred to Phase 3, which will consume the scope model defined here.
- **D2 — scope vocabulary.** `read`, `dispatch`, `spawn`, `git:write`, `answer_permission`. `worker → [read]`; `orchestrator → all five`.
- **D3 — token expiry.** `mintBoardToken` sets **no** `expiresAt` by default (board-lifetime; revoked on board close). A short TTL would expire a long agent run mid-session. An optional `ttlSeconds` exists for deliberately short-lived tokens. `requireBearerAuth` enforces expiry when set.
- **D4 — `requiredScopes` middleware arg is NOT used for tier separation.** It is one coarse value per mount; the register-only factory is the real gate.
- **D5 — board binding.** `ctxFromAuth` derives `boardId`/`tier`/`scopes` **solely** from the verified token's `extra`, never an agent-supplied value. Exported + contract-locked so a future change can't regress it.

**Baseline (confirmed green before starting):** `typecheck` clean · contract 3 passed · live 5 passed.

---

## File Structure

**Create:**
- `src/auth/scopes.ts` — scope string constants + `defaultScopesFor(tier)` (the tier→scopes map). One responsibility: the scope vocabulary.
- `src/auth/mint.ts` — `mintBoardToken(store, input)` crypto-random token mint helper over `TokenStore`.
- `src/config/mcpJson.ts` — pure `buildMcpJson(port, token)` + thin `writeMcpJson(dir, port, token)` writer.
- `test/live/tierCall.live.test.ts` — Task 1 (tools/call enforcement, real HTTP).
- `test/live/tokenLifecycle.live.test.ts` — Task 2 + Task 6 (invalid/expired/revoked + auth-runs-first, real HTTP).
- `test/contract/scopes.contract.test.ts` — Task 3 (scope model).
- `test/contract/boardBinding.contract.test.ts` — Task 4 (`ctxFromAuth` lock-in).
- `test/contract/mint.contract.test.ts` — Task 5a (mint helper).
- `test/contract/mcpJson.contract.test.ts` — Task 5b (`.mcp.json`).
- `docs/decisions/0002-phase-1-auth-scope-model.md` — Task 7 ADR.

**Modify:**
- `src/server/mcpHttp.ts:28-33` — export `ctxFromAuth` (currently a local function).
- `src/index.ts` — re-export the new public lib utilities.
- `docs/roadmap.md` — Phase 1 status line.

---

## Task 1: tools/call tier enforcement (live)

Registration already hides other-tier tools, so a worker calling `orchestrator_ping` gets method-not-found from the SDK. This task **documents that behavior with a live test** and confirms the orchestrator path still works. Per D1, no runtime guard is added.

**Files:**
- Test: `test/live/tierCall.live.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/live/tierCall.live.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'
import { TOOL_ORCHESTRATOR_PING } from '../../src/constants'

// Per ADR 0002 (D1): tier separation is enforced by REGISTRATION. A worker's
// server never registers orchestrator_ping, so the SDK answers tools/call with
// method-not-found. This proves the gate holds at tools/call, not just tools/list.
describe('tier enforcement at tools/call (real HTTP)', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
    mintToken(ts.tokens, 'tok-worker', { tier: 'worker', boardId: 'bW' })
    mintToken(ts.tokens, 'tok-orch', { tier: 'orchestrator', boardId: 'bO' })
  })

  afterAll(async () => {
    await ts.server.close()
  })

  async function connect(token: string): Promise<Client> {
    const client = new Client({ name: 'live-test', version: '0.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(ts.url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
    await client.connect(transport)
    return client
  }

  it('a worker calling orchestrator_ping is rejected', async () => {
    const client = await connect('tok-worker')
    await expect(client.callTool({ name: TOOL_ORCHESTRATOR_PING })).rejects.toThrow()
    await client.close()
  })

  it('an orchestrator calling orchestrator_ping succeeds', async () => {
    const client = await connect('tok-orch')
    const res = await client.callTool({ name: TOOL_ORCHESTRATOR_PING })
    expect(JSON.stringify(res)).toContain('orchestrator-pong')
    await client.close()
  })
})
```

- [ ] **Step 2: Run it — verify it passes (documents existing behavior)**

Run: `corepack pnpm test:live`
Expected: live project now reports **7 passed** (5 existing + 2 new). Both new `tierCall` tests green.

If the worker test does NOT reject, the factory is registering `orchestrator_ping` for workers — STOP and inspect `src/server/factory.ts:35`.

- [ ] **Step 3: Commit**

```bash
git add test/live/tierCall.live.test.ts
git commit -m "test(phase-1): lock tools/call tier enforcement (worker denied orchestrator_ping)"
```

---

## Task 2: Token-lifecycle rejections (live)

The key risk surface: invalid / expired / revoked tokens must all 401. `requireBearerAuth` runs before any session or tool logic, so a raw `fetch` of an `initialize` is enough to assert the status (mirrors the existing missing-token test).

**Files:**
- Test: `test/live/tokenLifecycle.live.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/live/tokenLifecycle.live.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mintToken, startTestServer, type TestServer } from '../helpers/httpServer'

// requireBearerAuth runs before session/tool logic, so a raw initialize POST is
// enough to assert the status. (No Origin header -> CLI-client path, passes the
// origin guard; the bearer token is the authority.)
function initPost(url: string, token: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 })
  })
}

describe('token lifecycle rejections (real HTTP)', () => {
  let ts: TestServer

  beforeAll(async () => {
    ts = await startTestServer()
    // expired: expiresAt 10s in the past.
    mintToken(ts.tokens, 'tok-expired', {
      tier: 'worker',
      boardId: 'b1',
      expiresAt: Math.floor(Date.now() / 1000) - 10
    })
    // revoked: minted then dropped from the store.
    mintToken(ts.tokens, 'tok-revoked', { tier: 'worker', boardId: 'b1' })
    ts.tokens.revoke('tok-revoked')
  })

  afterAll(async () => {
    await ts.server.close()
  })

  it('an invalid (never-minted) token -> 401', async () => {
    const res = await initPost(ts.url, 'tok-never-existed')
    expect(res.status).toBe(401)
  })

  it('an expired token -> 401', async () => {
    const res = await initPost(ts.url, 'tok-expired')
    expect(res.status).toBe(401)
  })

  it('a revoked token -> 401', async () => {
    const res = await initPost(ts.url, 'tok-revoked')
    expect(res.status).toBe(401)
  })

  // Task 6: a bad token is rejected BEFORE session routing. With a session-id
  // header present, a missing/bad token must still 401 (auth middleware first),
  // never reach the handler that would 404 an unknown session.
  it('a bad token with a session-id header -> 401, not 404', async () => {
    const res = await fetch(ts.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer tok-never-existed',
        'mcp-session-id': 'whatever'
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
    })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run it — verify it passes**

Run: `corepack pnpm test:live`
Expected: live project now **11 passed** (7 + 4 new). If the expired test returns 200/400 instead of 401, `requireBearerAuth` is not enforcing `expiresAt` — confirm `AuthInfo.expiresAt` is in **seconds** in `src/auth/verifier.ts:21`.

- [ ] **Step 3: Commit**

```bash
git add test/live/tokenLifecycle.live.test.ts
git commit -m "test(phase-1): lock invalid/expired/revoked 401 + auth-runs-before-session"
```

---

## Task 3: Formalize the scope model

`Scope` exists in `src/types.ts` but is unused. Define the scope strings and the tier→default-scopes map as data the token carries. Per D1/D4 the factory's tier registration is the real gate; scopes are the finer lever Phases 3+ will consume.

**Files:**
- Create: `src/auth/scopes.ts`
- Test: `test/contract/scopes.contract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/contract/scopes.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  defaultScopesFor,
  SCOPE_ANSWER_PERMISSION,
  SCOPE_DISPATCH,
  SCOPE_GIT_WRITE,
  SCOPE_READ,
  SCOPE_SPAWN
} from '../../src/auth/scopes'

describe('tier -> default scopes', () => {
  it('a worker gets read only', () => {
    expect(defaultScopesFor('worker')).toEqual([SCOPE_READ])
  })

  it("a worker's scopes exclude every orchestrator scope", () => {
    const worker = defaultScopesFor('worker')
    for (const s of [SCOPE_DISPATCH, SCOPE_SPAWN, SCOPE_GIT_WRITE, SCOPE_ANSWER_PERMISSION]) {
      expect(worker).not.toContain(s)
    }
  })

  it('an orchestrator gets read + dispatch + spawn + git:write + answer_permission', () => {
    expect(defaultScopesFor('orchestrator')).toEqual(
      expect.arrayContaining([
        SCOPE_READ,
        SCOPE_DISPATCH,
        SCOPE_SPAWN,
        SCOPE_GIT_WRITE,
        SCOPE_ANSWER_PERMISSION
      ])
    )
  })

  it('returns a fresh array each call (no shared mutable state)', () => {
    const a = defaultScopesFor('orchestrator')
    a.push('mutated')
    expect(defaultScopesFor('orchestrator')).not.toContain('mutated')
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `corepack pnpm test`
Expected: FAIL — `Cannot find module '../../src/auth/scopes'`.

- [ ] **Step 3: Write the implementation**

Create `src/auth/scopes.ts`:

```ts
import type { Scope, Tier } from '../types'

// The Phase 1 scope vocabulary (ADR 0002, D2). Scopes are carried by the token
// and consumed by per-tool gating in Phases 3+. Tier registration in the factory
// remains the primary capability gate; scopes are the finer-grained future lever.
export const SCOPE_READ: Scope = 'read'
export const SCOPE_DISPATCH: Scope = 'dispatch'
export const SCOPE_SPAWN: Scope = 'spawn'
export const SCOPE_GIT_WRITE: Scope = 'git:write'
export const SCOPE_ANSWER_PERMISSION: Scope = 'answer_permission'

const WORKER_SCOPES: readonly Scope[] = [SCOPE_READ]
const ORCHESTRATOR_SCOPES: readonly Scope[] = [
  SCOPE_READ,
  SCOPE_DISPATCH,
  SCOPE_SPAWN,
  SCOPE_GIT_WRITE,
  SCOPE_ANSWER_PERMISSION
]

/** Default scopes granted to a freshly-minted token of the given tier. */
export function defaultScopesFor(tier: Tier): Scope[] {
  return [...(tier === 'orchestrator' ? ORCHESTRATOR_SCOPES : WORKER_SCOPES)]
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `corepack pnpm test`
Expected: contract project **7 passed** (3 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/auth/scopes.ts test/contract/scopes.contract.test.ts
git commit -m "feat(phase-1): scope vocabulary + tier->default-scopes map"
```

---

## Task 4: Lock token→board binding (`ctxFromAuth`)

`ctxFromAuth` already derives the context from the token only — but it's a private function with no test. Export it and lock its behavior so a future change can't introduce an agent-supplied boardId path (D5). Cross-board isolation falls out for free: the only boardId source is the token.

**Files:**
- Modify: `src/server/mcpHttp.ts:28` (add `export`)
- Test: `test/contract/boardBinding.contract.test.ts`

- [ ] **Step 1: Export `ctxFromAuth`**

In `src/server/mcpHttp.ts`, change the function declaration on line 28 from:

```ts
/** Re-derive the session context from the server-verified bearer token. */
function ctxFromAuth(auth: AuthInfo | undefined): SessionCtx {
```

to:

```ts
/** Re-derive the session context from the server-verified bearer token. */
export function ctxFromAuth(auth: AuthInfo | undefined): SessionCtx {
```

- [ ] **Step 2: Write the failing test**

Create `test/contract/boardBinding.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { ctxFromAuth } from '../../src/server/mcpHttp'

// D5: the session context is derived SOLELY from the verified token's `extra`.
// There is no agent-supplied boardId path; these tests lock that in so a future
// change can't introduce one.
function auth(extra: unknown): AuthInfo {
  return { token: 't', clientId: '', scopes: ['read'], extra } as AuthInfo
}

describe('ctxFromAuth derives context solely from the token', () => {
  it('uses the tier + boardId carried in extra', () => {
    expect(ctxFromAuth(auth({ tier: 'orchestrator', boardId: 'bA' }))).toEqual({
      tier: 'orchestrator',
      scopes: ['read'],
      boardId: 'bA'
    })
  })

  it('defaults to worker tier when extra is absent', () => {
    expect(ctxFromAuth(undefined).tier).toBe('worker')
    expect(ctxFromAuth(undefined).boardId).toBe('')
  })

  it('a non-string boardId is rejected (never trust a forged extra)', () => {
    expect(ctxFromAuth(auth({ tier: 'orchestrator', boardId: 123 })).boardId).toBe('')
  })

  it('two tokens map to two distinct boards (cross-board isolation)', () => {
    const a = ctxFromAuth(auth({ tier: 'worker', boardId: 'bA' }))
    const b = ctxFromAuth(auth({ tier: 'worker', boardId: 'bB' }))
    expect(a.boardId).toBe('bA')
    expect(b.boardId).toBe('bB')
    expect(a.boardId).not.toBe(b.boardId)
  })
})
```

- [ ] **Step 3: Run it — verify it passes**

Run: `corepack pnpm test`
Expected: contract project **11 passed** (7 + 4 new).

- [ ] **Step 4: Commit**

```bash
git add src/server/mcpHttp.ts test/contract/boardBinding.contract.test.ts
git commit -m "test(phase-1): lock ctxFromAuth board binding (token is sole authority)"
```

---

## Task 5a: Token mint helper

Crypto-random per-board token minted into `TokenStore`, scopes from the tier, no expiry by default (D3).

**Files:**
- Create: `src/auth/mint.ts`
- Test: `test/contract/mint.contract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/contract/mint.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { TokenStore } from '../../src/auth/tokens'
import { mintBoardToken } from '../../src/auth/mint'
import { SCOPE_READ } from '../../src/auth/scopes'

describe('mintBoardToken', () => {
  it('mints a 32-byte hex token stored under its row', () => {
    const store = new TokenStore()
    const { token, row } = mintBoardToken(store, { boardId: 'bX', tier: 'worker' })
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(store.get(token)).toEqual(row)
    expect(row.boardId).toBe('bX')
    expect(row.scopes).toEqual([SCOPE_READ])
    expect(row.expiresAt).toBeUndefined()
  })

  it('two mints never collide', () => {
    const store = new TokenStore()
    const a = mintBoardToken(store, { boardId: 'b', tier: 'worker' })
    const b = mintBoardToken(store, { boardId: 'b', tier: 'worker' })
    expect(a.token).not.toBe(b.token)
  })

  it('an orchestrator mint carries the orchestrator scopes', () => {
    const store = new TokenStore()
    const { row } = mintBoardToken(store, { boardId: 'b', tier: 'orchestrator' })
    expect(row.scopes).toContain('dispatch')
  })

  it('ttlSeconds sets a future expiresAt; omitting it leaves none', () => {
    const store = new TokenStore()
    const before = Math.floor(Date.now() / 1000)
    const { row } = mintBoardToken(store, { boardId: 'b', tier: 'orchestrator', ttlSeconds: 600 })
    expect(row.expiresAt).toBeGreaterThanOrEqual(before + 600)
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `corepack pnpm test`
Expected: FAIL — `Cannot find module '../../src/auth/mint'`.

- [ ] **Step 3: Write the implementation**

Create `src/auth/mint.ts`:

```ts
import { randomBytes } from 'node:crypto'
import type { TokenStore } from './tokens'
import type { AuthRow, BoardId, Tier } from '../types'
import { defaultScopesFor } from './scopes'

export interface MintedToken {
  token: string
  row: AuthRow
}

/**
 * Mint a crypto-random per-board bearer token, store it, and return token + row.
 * Scopes come from the tier (ADR 0002, D2). No expiresAt by default (D3): the
 * token lives until the board closes and TokenStore.revoke drops it — a short ttl
 * would kill a long agent run mid-session. Pass ttlSeconds only for a token meant
 * to be deliberately short-lived.
 */
export function mintBoardToken(
  store: TokenStore,
  input: { boardId: BoardId; tier: Tier; ttlSeconds?: number }
): MintedToken {
  const token = randomBytes(32).toString('hex')
  const row: AuthRow = {
    boardId: input.boardId,
    tier: input.tier,
    scopes: defaultScopesFor(input.tier)
  }
  if (input.ttlSeconds !== undefined) {
    row.expiresAt = Math.floor(Date.now() / 1000) + input.ttlSeconds
  }
  store.mint(token, row)
  return { token, row }
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `corepack pnpm test`
Expected: contract project **15 passed** (11 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/auth/mint.ts test/contract/mint.contract.test.ts
git commit -m "feat(phase-1): mintBoardToken crypto-random per-board token helper"
```

---

## Task 5b: `.mcp.json` writer

Pure builder + thin writer for a board worktree's project-scoped `.mcp.json`. No OAuth discovery (ADR 0001). Unit-testable without Electron.

**Files:**
- Create: `src/config/mcpJson.ts`
- Test: `test/contract/mcpJson.contract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/contract/mcpJson.contract.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildMcpJson, writeMcpJson } from '../../src/config/mcpJson'

describe('buildMcpJson', () => {
  it('builds a loopback http server entry with the bearer header', () => {
    expect(buildMcpJson(54321, 'tok-abc')).toEqual({
      mcpServers: {
        'canvas-ade': {
          type: 'http',
          url: 'http://127.0.0.1:54321/mcp',
          headers: { Authorization: 'Bearer tok-abc' }
        }
      }
    })
  })
})

describe('writeMcpJson', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcpjson-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('writes a parseable .mcp.json into the dir and returns its path', () => {
    const file = writeMcpJson(dir, 4000, 'tok-z')
    expect(file).toBe(join(dir, '.mcp.json'))
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    expect(parsed.mcpServers['canvas-ade'].url).toBe('http://127.0.0.1:4000/mcp')
    expect(parsed.mcpServers['canvas-ade'].headers.Authorization).toBe('Bearer tok-z')
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `corepack pnpm test`
Expected: FAIL — `Cannot find module '../../src/config/mcpJson'`.

- [ ] **Step 3: Write the implementation**

Create `src/config/mcpJson.ts`:

```ts
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface McpJson {
  mcpServers: {
    'canvas-ade': {
      type: 'http'
      url: string
      headers: { Authorization: string }
    }
  }
}

/**
 * Pure builder for a board worktree's project-scoped .mcp.json: a single loopback
 * streamable-HTTP server entry carrying the board's bearer token. No OAuth
 * discovery is referenced (ADR 0001) — the static bearer token is the authority.
 */
export function buildMcpJson(port: number, token: string): McpJson {
  return {
    mcpServers: {
      'canvas-ade': {
        type: 'http',
        url: `http://127.0.0.1:${port}/mcp`,
        headers: { Authorization: `Bearer ${token}` }
      }
    }
  }
}

/** Write .mcp.json into a board's worktree dir. Returns the written file path. */
export function writeMcpJson(dir: string, port: number, token: string): string {
  const file = join(dir, '.mcp.json')
  writeFileSync(file, JSON.stringify(buildMcpJson(port, token), null, 2) + '\n', 'utf8')
  return file
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `corepack pnpm test`
Expected: contract project **18 passed** (15 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/config/mcpJson.ts test/contract/mcpJson.contract.test.ts
git commit -m "feat(phase-1): buildMcpJson + writeMcpJson worktree config writer"
```

---

## Task 6: Public exports

Surface the new MAIN-agnostic utilities from the package entry so Canvas ADE MAIN can consume them. (The Task 6 *test* — auth-runs-before-session — already shipped in Task 2.)

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add exports**

Replace the contents of `src/index.ts` with:

```ts
export { createMcpHttpServer } from './server/mcpHttp'
export type { McpServerDeps, RunningMcpServer } from './server/mcpHttp'
export { TokenStore } from './auth/tokens'
export { mintBoardToken } from './auth/mint'
export type { MintedToken } from './auth/mint'
export {
  defaultScopesFor,
  SCOPE_READ,
  SCOPE_DISPATCH,
  SCOPE_SPAWN,
  SCOPE_GIT_WRITE,
  SCOPE_ANSWER_PERMISSION
} from './auth/scopes'
export { buildMcpJson, writeMcpJson } from './config/mcpJson'
export type { McpJson } from './config/mcpJson'
export { MockOrchestrator } from './orchestrator/mock'
export type { Orchestrator, BoardSummary } from './orchestrator/Orchestrator'
export type { Tier, Scope, AuthRow, BoardId } from './types'
```

- [ ] **Step 2: Typecheck + build**

Run: `corepack pnpm typecheck && corepack pnpm build`
Expected: both clean; `dist/index.js` + `dist/index.d.ts` regenerate with the new exports.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(phase-1): export mint + scopes + mcpJson utilities"
```

---

## Task 7: ADR 0002 + roadmap status

Record the load-bearing Phase 1 decisions and flip the roadmap status.

**Files:**
- Create: `docs/decisions/0002-phase-1-auth-scope-model.md`
- Modify: `docs/roadmap.md:38` (under the Phase 1 header)

- [ ] **Step 1: Write the ADR**

Create `docs/decisions/0002-phase-1-auth-scope-model.md`:

```markdown
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
  `tools/call` (Phase 1 live test). Per-tool *scope* gating (finer-grained, within a
  tier) is deferred to Phase 3, which consumes the scope model below.
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
```

- [ ] **Step 2: Update the roadmap status**

In `docs/roadmap.md`, immediately after the line `## Phase 1 — Auth + capability tier-factory 🔒` (line 38), insert a blank line then:

```markdown
> **Status:** ✅ shipped (2026-05-30, pre-MAIN). Capability split proven at
> `tools/list` + `tools/call`; invalid/expired/revoked/cross-board all 401; scope
> model + mint helper + `.mcp.json` writer landed and tested. Live tests run their
> own loopback HTTP server (the drive-the-real-Canvas-ADE form activates at the
> MAIN-wiring milestone). See ADR 0002.
```

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0002-phase-1-auth-scope-model.md docs/roadmap.md
git commit -m "docs(phase-1): ADR 0002 scope model + auth policy; roadmap status"
```

---

## Task 8: Full green gate + push

Run every gate the Definition of Done requires, then push.

- [ ] **Step 1: Run all gates**

Run:
```bash
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test
corepack pnpm test:live
corepack pnpm lint
corepack pnpm exec prettier --check .
```
Expected: typecheck clean · build clean · **contract 18 passed** · **live 11 passed** · lint clean · prettier clean.

If prettier flags any new file, run `corepack pnpm format` and amend the relevant commit (or add a `style:` commit).

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Verify the DoD checklist**
  - 🔒🚦 worker token can NEVER list (`tierSplit.contract`) or call (`tierCall.live`) an orchestrator tool — both layers ✅
  - invalid / expired / revoked / cross-board all rejected — `tokenLifecycle.live` + `boardBinding.contract` ✅
  - scope model + tier→scopes map + test (`scopes.contract`) ✅
  - `.mcp.json` writer + mint helper exist + tested (`mcpJson.contract`, `mint.contract`) ✅
  - all gates green ✅ · committed on `main` + pushed ✅ · roadmap status updated ✅

---

## Self-Review (performed against the handoff spec)

- **Handoff Task 1** (tools/call enforcement + decision) → Plan Task 1 + D1 in ADR. ✅
- **Handoff Task 2** (invalid/expired/revoked/cross-board) → Plan Task 2 (invalid/expired/revoked) + Task 4 (cross-board via `ctxFromAuth`). ✅
- **Handoff Task 3** (scope model + tier map + test) → Plan Task 3. ✅
- **Handoff Task 4** (strict token→board binding + lock-in test) → Plan Task 4 + D5. ✅
- **Handoff Task 5** (mint helper + `.mcp.json` writer, MAIN-agnostic) → Plan Tasks 5a + 5b + Task 6 exports. ✅
- **Handoff Task 6** (middleware-vs-session decision + auth-runs-first test) → D4 in ADR + Task 2's 4th test. ✅
- **DoD** (both layers, 401s, scope model, writer+mint, all gates, commit+push, roadmap+memory) → Plan Task 8. Memory pointer handled outside the plan (Claude memory, not repo). ✅
- **Type consistency:** `mintBoardToken(store, {boardId,tier,ttlSeconds?}) → {token, row}`, `defaultScopesFor(tier) → Scope[]`, `buildMcpJson(port, token) → McpJson`, `writeMcpJson(dir, port, token) → string`, `ctxFromAuth(auth) → SessionCtx`. Names consistent across tasks + exports. ✅
- **Placeholder scan:** no TBD/TODO/"add appropriate X"; every code step shows full code. ✅
- **Invariant guardrails honored:** register-only (no register-all-then-gate), tier-from-token, no OAuth discovery, SDK auth imports stay in `src/auth/`, far-future/no expiry for real tokens. ✅
```
