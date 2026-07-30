import { randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import {
  DEFAULT_SESSION_IDLE_TTL_MS,
  HEADER_SESSION_ID,
  SESSION_SWEEP_MAX_INTERVAL_MS
} from '../constants'
import type { ServerFactory, SessionCtx } from './factory'

/** JSON-RPC-shaped HTTP error body (also used by the mcpHttp error middleware). */
export function rpcError(code: number, message: string): unknown {
  return { jsonrpc: '2.0', error: { code, message }, id: null }
}

/**
 * 🔒 PKG-N1 — does the presenting token own this session? A session's McpServer (its tool set
 * + the boardId bound into write_result/relay_prompt) is frozen at init from the CREATING
 * token's {tier,boardId}. `requireBearerAuth` validates any token globally but binds it to no
 * session, so reuse/GET/DELETE routed purely by Mcp-Session-Id would let any valid token drive
 * someone else's session at the creator's tier (a confused-deputy bypass of the structural tier
 * split). Bind every reuse to the creator's identity: same tier AND same boardId.
 */
function ownsSession(owner: SessionCtx, caller: SessionCtx): boolean {
  return owner.tier === caller.tier && owner.boardId === caller.boardId
}

/** Per-session liveness bookkeeping for the idle sweep (audit Phase A). */
interface SessionActivity {
  /** Last request start/finish (ms epoch). */
  lastSeen: number
  /** Requests currently inside `transport.handleRequest` (a blocking barrier counts). */
  inflight: number
  /** Open GET-SSE streams (decremented on the response's 'close'). */
  streams: number
}

/** The effective idle TTL: env override (finite; ≤ 0 disables) else the 30-min default. */
function resolveIdleTtl(): number {
  const env = process.env.CANVAS_ADE_SESSION_IDLE_TTL_MS
  if (env !== undefined) {
    const n = Number(env)
    if (Number.isFinite(n)) return n
  }
  return DEFAULT_SESSION_IDLE_TTL_MS
}

/**
 * Owns the per-session transport map and the stateful streamable-HTTP routing.
 * This is the ONLY module importing the SDK transport — isolated so a future SDK
 * v2 bump (which renames the transport) is a one-file change.
 */
export class SessionManager {
  private readonly transports = new Map<string, StreamableHTTPServerTransport>()
  /** Per-session teardown (M5 notifier unsubscribe + in-flight barrier cancel). */
  private readonly disposers = new Map<string, () => void>()
  /** 🔒 PKG-N1: the {tier,boardId} of the token that CREATED each session (ownership key). */
  private readonly owners = new Map<string, SessionCtx>()
  /** Idle-sweep bookkeeping, keyed like the maps above (audit Phase A). */
  private readonly activity = new Map<string, SessionActivity>()
  private readonly idleTtlMs = resolveIdleTtl()
  private sweepTimer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly factory: ServerFactory) {
    // Reap abandoned sessions (client died without DELETE — crashed agent, killed board).
    // A session with an in-flight request or an open SSE stream is NEVER reaped; a reaped
    // client's next request 404s and it re-initializes per the streamable-HTTP spec.
    if (this.idleTtlMs > 0) {
      const tick = Math.max(1, Math.min(this.idleTtlMs, SESSION_SWEEP_MAX_INTERVAL_MS))
      this.sweepTimer = setInterval(() => this.sweepIdle(), tick)
      // The sweep must not hold the host process open (same discipline as the barrier backstop).
      ;(this.sweepTimer as { unref?: () => void }).unref?.()
    }
  }

  /** POST /mcp: reuse an existing session, or open a new one on initialize. */
  async handlePost(req: Request, res: Response, ctx: SessionCtx): Promise<void> {
    const sid = req.header(HEADER_SESSION_ID)

    if (sid !== undefined) {
      const existing = this.transports.get(sid)
      if (!existing) {
        res.status(404).json(rpcError(-32001, 'Session not found'))
        return
      }
      // 🔒 PKG-N1: bind reuse to the creating token — a globally-valid bearer from a
      // different board/tier must not drive someone else's session.
      if (!this.isOwner(sid, ctx)) {
        res.status(403).json(rpcError(-32003, 'Forbidden: session belongs to another token'))
        return
      }
      await this.tracked(sid, () => existing.handleRequest(req, res, req.body))
      return
    }

    if (!isInitializeRequest(req.body)) {
      res
        .status(400)
        .json(rpcError(-32000, 'Bad Request: no session ID and not an initialize request'))
      return
    }

    const { server, dispose } = this.factory.getServer(ctx)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        this.transports.set(id, transport)
        this.disposers.set(id, dispose)
        this.owners.set(id, ctx) // 🔒 PKG-N1: record the creating token's identity
        this.activity.set(id, { lastSeen: Date.now(), inflight: 0, streams: 0 })
      }
    })
    transport.onclose = () => {
      const id = transport.sessionId
      if (id !== undefined) {
        this.transports.delete(id)
        this.disposers.get(id)?.()
        this.disposers.delete(id)
        this.owners.delete(id)
        this.activity.delete(id)
      }
    }

    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } finally {
      // getServer eagerly subscribed the attention notifier; when initialize never
      // completed (connect/handleRequest threw, or the SDK rejected the handshake
      // without minting a session id) nothing else will ever run that disposer —
      // tear down HERE or the status listener leaks for the process lifetime.
      if (transport.sessionId === undefined) {
        try {
          dispose()
        } catch {
          // teardown must not mask the original failure
        }
        void transport.close().catch(() => {})
      }
    }
  }

  /** GET (SSE) and DELETE /mcp: route to the named session, gated on token ownership. */
  async handleSession(req: Request, res: Response, ctx: SessionCtx): Promise<void> {
    const sid = req.header(HEADER_SESSION_ID)
    if (sid === undefined) {
      res.status(400).json(rpcError(-32000, 'Missing session ID'))
      return
    }
    const transport = this.transports.get(sid)
    if (!transport) {
      res.status(404).json(rpcError(-32001, 'Session not found'))
      return
    }
    // 🔒 PKG-N1: same ownership gate as POST reuse — the GET-SSE stream + the DELETE teardown
    // must also be refused to a token that did not create the session.
    if (!this.isOwner(sid, ctx)) {
      res.status(403).json(rpcError(-32003, 'Forbidden: session belongs to another token'))
      return
    }
    // A standing GET-SSE stream marks the session live until the socket closes —
    // handleRequest RETURNS once the stream is set up, so inflight alone can't cover it.
    const row = this.activity.get(sid)
    if (row && req.method === 'GET') {
      row.streams++
      res.once('close', () => {
        row.streams = Math.max(0, row.streams - 1)
        row.lastSeen = Date.now()
      })
    }
    await this.tracked(sid, () => transport.handleRequest(req, res))
  }

  /**
   * Close every live session created by a token bound to `boardId` (audit Phase A /
   * roadmap Phase 9 "session revocation on close_board"). The HOST calls this from its
   * board-teardown path so a killed board's agent can't keep driving tools on a live
   * session after `TokenStore.revoke` (which only 401s FUTURE requests). Returns the
   * number of sessions closed. An empty boardId matches nothing — it is the unbound
   * fallback identity, not a real board.
   */
  async closeByBoardId(boardId: string): Promise<number> {
    if (boardId === '') return 0
    const targets: string[] = []
    for (const [sid, owner] of this.owners) {
      if (owner.boardId === boardId) targets.push(sid)
    }
    await Promise.allSettled(
      targets.map((sid) => this.transports.get(sid)?.close() ?? Promise.resolve())
    )
    // transport.onclose normally runs the cleanup; sweep any straggler whose close() rejected.
    for (const sid of targets) {
      if (this.transports.has(sid)) {
        try {
          this.disposers.get(sid)?.()
        } catch {
          // a teardown throw must not abort the rest
        }
        this.transports.delete(sid)
        this.disposers.delete(sid)
        this.owners.delete(sid)
        this.activity.delete(sid)
      }
    }
    return targets.length
  }

  /** 🔒 True iff the presenting token's {tier,boardId} matches the session creator's. */
  private isOwner(sid: string, ctx: SessionCtx): boolean {
    const owner = this.owners.get(sid)
    return owner !== undefined && ownsSession(owner, ctx)
  }

  /** Run one request with inflight/lastSeen bookkeeping (the idle sweep's liveness input). */
  private async tracked(sid: string, run: () => Promise<void>): Promise<void> {
    const row = this.activity.get(sid)
    if (!row) {
      await run()
      return
    }
    row.lastSeen = Date.now()
    row.inflight++
    try {
      await run()
    } finally {
      row.inflight--
      row.lastSeen = Date.now()
    }
  }

  /** One sweep tick: close sessions idle past the TTL with nothing in flight/streaming. */
  private sweepIdle(): void {
    const now = Date.now()
    for (const [sid, row] of this.activity) {
      if (row.inflight === 0 && row.streams === 0 && now - row.lastSeen > this.idleTtlMs) {
        // close() fires transport.onclose, which runs the full per-session cleanup.
        void this.transports
          .get(sid)
          ?.close()
          .catch(() => {})
      }
    }
  }

  /**
   * Tear down every live session (called on app quit). Uses `allSettled` so one
   * transport whose `close()` rejects can't short-circuit the loop and leak the
   * remaining sessions; the map is always cleared.
   */
  async closeAll(): Promise<void> {
    if (this.sweepTimer !== undefined) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = undefined
    }
    try {
      await Promise.allSettled([...this.transports.values()].map((t) => t.close()))
    } finally {
      for (const dispose of this.disposers.values()) {
        try {
          dispose()
        } catch {
          // a teardown throw must not abort the rest
        }
      }
      this.disposers.clear()
      this.transports.clear()
      this.owners.clear()
      this.activity.clear()
    }
  }
}
