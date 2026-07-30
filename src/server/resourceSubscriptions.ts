import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { ATTENTION_URI } from '../resources/attention'

export interface ResourceSubscriptions {
  /** True when a client has an active `resources/subscribe` for this exact URI. */
  isSubscribed(uri: string): boolean
}

/**
 * 🔒 The ONLY URI the server ever pushes `notifications/resources/updated` for is
 * `canvas://attention` (the AttentionNotifier is its sole producer). A subscribe to any other
 * URI is dead weight AND lets a hostile in-session client grow the per-session Set without
 * bound (unbounded client-controlled allocation in MAIN) — so accept ONLY the allowlist and
 * reject the rest.
 */
const SUBSCRIBABLE: ReadonlySet<string> = new Set([ATTENTION_URI])

/**
 * Manually wire `resources/subscribe` / `resources/unsubscribe` for one session — the SDK's
 * high-level McpServer does NOT do this (sdk 1.29.0). Registers the `resources.subscribe`
 * capability + the two request handlers, tracking the subscribed URIs in a per-session Set.
 * The AttentionNotifier consults `isSubscribed` so it only pushes to clients that asked.
 * MUST be called BEFORE `server.connect(transport)` (registerCapabilities is connect-gated).
 */
export function installResourceSubscriptions(server: McpServer): ResourceSubscriptions {
  const uris = new Set<string>()
  server.server.registerCapabilities({ resources: { subscribe: true } })
  server.server.setRequestHandler('resources/subscribe', async (req) => {
    const { uri } = req.params
    // 🔒 Bound the per-session Set to the allowlist: a subscribe to a URI that never updates
    // fails loudly (InvalidParams) instead of silently never firing + allocating forever.
    if (!SUBSCRIBABLE.has(uri)) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, `resource is not subscribable: ${uri}`)
    }
    uris.add(uri)
    return {}
  })
  server.server.setRequestHandler('resources/unsubscribe', async (req) => {
    uris.delete(req.params.uri)
    return {}
  })
  return { isSubscribed: (uri) => uris.has(uri) }
}
