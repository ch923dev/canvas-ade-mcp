import { randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { HEADER_SESSION_ID } from '../constants'
import type { ServerFactory, SessionCtx } from './factory'

function rpcError(code: number, message: string): unknown {
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

  constructor(private readonly factory: ServerFactory) {}

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
      await existing.handleRequest(req, res, req.body)
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
      }
    })
    transport.onclose = () => {
      const id = transport.sessionId
      if (id !== undefined) {
        this.transports.delete(id)
        this.disposers.get(id)?.()
        this.disposers.delete(id)
        this.owners.delete(id)
      }
    }

    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
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
    await transport.handleRequest(req, res)
  }

  /** 🔒 True iff the presenting token's {tier,boardId} matches the session creator's. */
  private isOwner(sid: string, ctx: SessionCtx): boolean {
    const owner = this.owners.get(sid)
    return owner !== undefined && ownsSession(owner, ctx)
  }

  /**
   * Tear down every live session (called on app quit). Uses `allSettled` so one
   * transport whose `close()` rejects can't short-circuit the loop and leak the
   * remaining sessions; the map is always cleared.
   */
  async closeAll(): Promise<void> {
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
    }
  }
}
