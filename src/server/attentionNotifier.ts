import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../orchestrator/Orchestrator'
import { ATTENTION_BUCKETS, ATTENTION_URI } from '../resources/attention'

export interface AttentionNotifier {
  /** Unsubscribe from the orchestrator status stream (called on session close). */
  dispose(): void
}

/**
 * Per session: push `notifications/resources/updated` on `canvas://attention` whenever the
 * MEMBERSHIP of the attention set changes (a board enters or leaves blocked/awaiting-review/
 * failed). A change WITHIN the set (blocked→failed) or outside it (running→idle) emits
 * nothing — the resource membership is unchanged. Gated on a live `resources/subscribe` for
 * the URI; the emit is wrapped so a post-close `sendResourceUpdated` ("Not connected") can't
 * throw into the orchestrator fan-out.
 */
export function createAttentionNotifier(deps: {
  server: McpServer
  orchestrator: Orchestrator
  isSubscribed: (uri: string) => boolean
}): AttentionNotifier {
  const { server, orchestrator, isSubscribed } = deps
  const inAttention = new Set<string>()

  const unsub = orchestrator.subscribeStatus((change) => {
    const nowAttn = ATTENTION_BUCKETS.has(change.status)
    const wasAttn = inAttention.has(change.id)
    if (nowAttn === wasAttn) return // membership unchanged
    if (nowAttn) inAttention.add(change.id)
    else inAttention.delete(change.id)
    if (!isSubscribed(ATTENTION_URI)) return
    try {
      server.server.sendResourceUpdated({ uri: ATTENTION_URI })
    } catch {
      // post-close / not-connected emit — drop it; the fan-out must not throw
    }
  })

  return { dispose: unsub }
}
