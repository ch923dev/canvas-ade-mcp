import { isIP } from 'node:net'
import type { RequestHandler } from 'express'

/** Exact loopback host spellings (the common cases; IP forms are checked below too). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1'])

/**
 * Extract the hostname from a `Host` header value, dropping an optional `:port`.
 * Handles the three shapes that reach a loopback listener:
 *   - `localhost` / `localhost:5173`        → `localhost`
 *   - `127.0.0.1` / `127.0.0.1:443`         → `127.0.0.1`
 *   - `[::1]` / `[::1]:5173` (bracketed v6)  → `::1`
 *   - `::1` (bare v6 literal, no port)       → `::1`
 */
function parseHostname(host: string): string {
  const h = host.trim()
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    return end === -1 ? h.slice(1) : h.slice(1, end)
  }
  // A bare IPv6 literal (e.g. `::1`) has multiple colons and no `[..]` → it is
  // the hostname itself, never `host:port`. Only a single colon means a port.
  if ((h.match(/:/g)?.length ?? 0) > 1) return h
  const idx = h.indexOf(':')
  return idx === -1 ? h : h.slice(0, idx)
}

/**
 * True only for the loopback hosts the server is bound to. Case-insensitive;
 * a `:port` suffix is ignored. Anything else (a public name, a suffix attack
 * like `localhost.evil.com`, a non-loopback IP, or an empty value) is false.
 */
export function isLoopbackHost(host: string): boolean {
  if (host === '') return false
  const h = parseHostname(host).toLowerCase()
  if (LOOPBACK_HOSTS.has(h)) return true
  // The whole 127.0.0.0/8 block is loopback — accept any 127.x.x.x (a browser or
  // CLI may use a non-.1 address). `isIP` confirms it is a well-formed IPv4 literal
  // so a name like `127.evil.com` can't slip through the prefix check.
  if (isIP(h) === 4 && h.startsWith('127.')) return true
  return false
}

/**
 * Rejects requests whose `Host` header is not a loopback host — the MANDATORY
 * DNS-rebinding mitigation. Binding to 127.0.0.1 and validating `Origin` alone is
 * INSUFFICIENT: a browser can be tricked into sending a request whose `Host`
 * resolves to the loopback listener (TS-SDK CVE-2025-66414, fixed upstream in
 * sdk 1.24.0). For Expanse the exact vector is a Browser board previewing a
 * malicious `localhost` page. Unlike `Origin` (absent for non-browser CLI
 * clients, so missing-Origin passes), a conformant HTTP/1.1 request ALWAYS
 * carries `Host`, so a missing or non-loopback `Host` is rejected with 403.
 * Pairs with `originGuard` + the per-board bearer token (defence in depth).
 */
export function hostGuard(): RequestHandler {
  return (req, res, next) => {
    const host = req.headers.host
    if (host !== undefined && isLoopbackHost(host)) {
      next()
      return
    }
    res.status(403).json({ error: 'forbidden_host' })
  }
}
