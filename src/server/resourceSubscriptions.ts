import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema
} from '@modelcontextprotocol/sdk/types.js'

export interface ResourceSubscriptions {
  /** True when a client has an active `resources/subscribe` for this exact URI. */
  isSubscribed(uri: string): boolean
}

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
  server.server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    uris.add(req.params.uri)
    return {}
  })
  server.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    uris.delete(req.params.uri)
    return {}
  })
  return { isSubscribed: (uri) => uris.has(uri) }
}
