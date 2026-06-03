# ADR 0003 — Host-header allowlist (DNS-rebinding hardening)

- **Status:** Accepted (2026-06-03)
- **Context:** The loopback MCP server already bound `127.0.0.1` and validated the
  `Origin` header (ADR 0001), with a per-board bearer token as the real authority
  (ADR 0002). A 2026-06-02 deep-research pass on the current MCP spec found this is
  **insufficient** on its own: the spec marks **`Host`-header validation a MUST**
  for any locally-bound HTTP MCP server, because loopback bind + `Origin` alone do
  not stop a DNS-rebinding attack (TS-SDK **CVE-2025-66414**, fixed upstream in sdk
  `1.24.0`; `rmcp` **CVE-2026-42559**, CVSS 8.8). For Expanse the concrete vector is
  a **Browser board previewing a malicious `localhost` page** that scripts requests
  at the local MCP port.

## Decisions

- **D1 — Validate `Host` server-side, reject non-loopback with 403.** A new
  `hostGuard` (`src/security/host.ts`) runs FIRST in the middleware pipeline
  (`hostGuard → originGuard → requireBearerAuth`). It allows only `localhost`,
  `127.0.0.1`, `::1` (with or without a `:port` suffix, case-insensitive,
  bracketed-IPv6 `[::1]` handled); everything else → `403 { error: 'forbidden_host' }`.
- **D2 — Missing `Host` is rejected (unlike missing `Origin`).** `originGuard`
  PASSES a request with no `Origin` (non-browser CLI clients legitimately omit it).
  `Host` is different: a conformant HTTP/1.1 request ALWAYS carries it, so a missing
  `Host` is non-conformant/suspicious and is rejected. This keeps the guard strict
  without breaking the real CLI agents (which send `Host: 127.0.0.1:<port>`).
- **D3 — Own the check; do not rely on the transport flag.** Same rationale as the
  `Origin` guard (ADR 0001): the SDK transport's built-in DNS-rebinding flags are
  `@deprecated`. The guard is a few lines of owned, unit-tested code.
- **D4 — Defence in depth, not a replacement.** `Host` + `Origin` + the per-board
  bearer token are three independent layers. A Browser board has no token and no
  preload to obtain one, so bearer auth already backstopped this — but the spec
  marks `Host` validation mandatory and it is cheap, so it ships as the outer gate.

## Tests (two-layer)

- **Contract** (`test/contract/hostGuard.contract.test.ts`): `isLoopbackHost`
  accepts the loopback set (± port, bracketed v6, case) and rejects spoofs incl. the
  `localhost.evil.com` suffix attack and cloud-metadata IPs; the middleware 403s a
  spoofed/missing `Host` and `next()`s a loopback one.
- **Live** (`test/live/hostGuard.live.test.ts`): a raw `node:http` request (fetch
  forbids overriding `Host`) with a spoofed `Host` → 403; with a loopback `Host` →
  falls through to 401 (no bearer), proving the guard fires only on a bad `Host`.

## Consequences

- One more outer gate; no API change (internal middleware). Version bumped to
  `0.2.1` (security patch). Consumers (Canvas ADE MAIN) pick it up on the next bump;
  the app-side `CANVAS_SMOKE=mcp` smoke can later add a forged-`Host` probe against
  the in-process server (roadmap T0.2 follow-up, once the bump is consumed).
