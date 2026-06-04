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
 * Owns the per-session transport map and the stateful streamable-HTTP routing.
 * This is the ONLY module importing the SDK transport — isolated so a future SDK
 * v2 bump (which renames the transport) is a one-file change.
 */
export class SessionManager {
  private readonly transports = new Map<string, StreamableHTTPServerTransport>()

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
      await existing.handleRequest(req, res, req.body)
      return
    }

    if (!isInitializeRequest(req.body)) {
      res
        .status(400)
        .json(rpcError(-32000, 'Bad Request: no session ID and not an initialize request'))
      return
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        this.transports.set(id, transport)
      }
    })
    transport.onclose = () => {
      const id = transport.sessionId
      if (id !== undefined) this.transports.delete(id)
    }

    const server = this.factory.getServer(ctx)
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  }

  /** GET (SSE) and DELETE /mcp: route to the named session. */
  async handleSession(req: Request, res: Response): Promise<void> {
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
    await transport.handleRequest(req, res)
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
      this.transports.clear()
    }
  }
}
