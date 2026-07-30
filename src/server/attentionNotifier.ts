import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../orchestrator/Orchestrator'
import { ATTENTION_BUCKETS, ATTENTION_URI, selectAttention } from '../resources/attention'

export interface AttentionNotifier {
  /** Unsubscribe from the orchestrator status stream (called on session close). */
  dispose(): void
}

/**
 * Per session: push `notifications/resources/updated` on `canvas://attention` whenever the
 * MEMBERSHIP of the attention set changes (a board enters or leaves blocked/awaiting-review/
 * failed). A change WITHIN the set (blocked→failed) or outside it (running→idle) emits
 * nothing — the resource membership is unchanged. A board that opted out of monitoring
 * (`monitorActivity === false`) is never counted as in-attention, so it raises no push —
 * matching {@link selectAttention}; the host re-emits on a flag flip so a mid-session
 * opt-out/opt-in still produces the corresponding leave/enter. Gated on a live
 * `resources/subscribe` for the URI; the emit is wrapped so a post-close
 * `sendResourceUpdated` ("Not connected") can't throw into the orchestrator fan-out.
 */
export function createAttentionNotifier(deps: {
  server: McpServer
  orchestrator: Orchestrator
  isSubscribed: (uri: string) => boolean
}): AttentionNotifier {
  const { server, orchestrator, isSubscribed } = deps
  const inAttention = new Set<string>()

  const unsub = orchestrator.subscribeStatus((change) => {
    const nowAttn = ATTENTION_BUCKETS.has(change.status) && change.monitorActivity !== false
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

  // Level-trigger seed (audit Phase A): `inAttention` starts empty, so a board ALREADY
  // in an attention bucket before this session opened had `wasAttn === false` — its
  // later LEAVE (blocked → idle) would compare equal and be silently swallowed, leaving
  // the client's view stale forever. Subscribe FIRST (above, the barrierWaiter
  // discipline), then seed from one level read. The seed only ADDS: a change that
  // raced in between subscribe and this read already updated the set itself, and the
  // worst case is one SPURIOUS notification (the client re-reads a correct resource),
  // never a missed leave after the seed lands. Best-effort — a host without listBoards
  // wired (bare test stubs) just skips the seed.
  void (async () => {
    try {
      for (const b of selectAttention(await orchestrator.listBoards())) inAttention.add(b.id)
    } catch {
      // seed is best-effort; the notifier still tracks every post-subscribe edge
    }
  })()

  return { dispose: unsub }
}
