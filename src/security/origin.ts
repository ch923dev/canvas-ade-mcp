import type { RequestHandler } from 'express'

/**
 * Rejects requests whose Origin is not in the allowlist — a DNS-rebinding guard
 * (so a web page can't drive the local MCP server). Requests with NO Origin
 * header (a CLI MCP client / non-browser) pass: the bearer token is the real
 * authority. `getAllowed` is a getter so the allowlist can be set AFTER
 * listen(0) resolves the real ephemeral port. We own this rather than relying on
 * the transport's @deprecated DNS-rebinding flags.
 */
export function originGuard(getAllowed: () => readonly string[]): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin
    if (origin === undefined) {
      next()
      return
    }
    if (getAllowed().includes(origin)) {
      next()
      return
    }
    res.status(403).json({ error: 'forbidden_origin' })
  }
}
