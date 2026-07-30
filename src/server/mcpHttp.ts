import { createServer, type Server } from 'node:http'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { MCP_PATH } from '../constants'
import type { BoardId, Tier } from '../types'
import type { Orchestrator } from '../orchestrator/Orchestrator'
import { createVerifier } from '../auth/verifier'
import type { TokenStore } from '../auth/tokens'
import { originGuard } from '../security/origin'
import { hostGuard } from '../security/host'
import { ServerFactory, type SessionCtx } from './factory'
import { rpcError, SessionManager } from './transport'

export interface McpServerDeps {
  orchestrator: Orchestrator
  tokens: TokenStore
  /**
   * Optional single command-orchestrator board id (BUG-021). When set, `relay_prompt` is
   * restricted to the token bound to this board, so a second orchestrator-tier token can't
   * drive orchestration cables it doesn't own. Omit to keep the prior open-to-any-orchestrator
   * behaviour (correct for a single-orchestrator-token deployment).
   */
  commandBoardId?: BoardId
  /**
   * Gate for the S2 planning content-write path. When true, `add_planning_elements` is
   * registered (orchestrator + connected tiers) and `spawn_board` gains an optional `seed`.
   * Default false → the write tool is flag-gated off for the first release (ADR 0003).
   *
   * May be a `() => boolean` getter, re-evaluated PER SESSION (each `getServer`). The host's
   * orchestration consent is per-project and runtime-toggleable while this server is a process
   * singleton, so a fixed boolean captured at boot would never reflect a later Enable — the
   * getter lets a session opened after consent is granted see the write tool. (Agent Orchestration.)
   */
  planningWrite?: boolean | (() => boolean)
}

export interface RunningMcpServer {
  app: Express
  httpServer: Server
  port: number
  setAllowedOrigins(origins: readonly string[]): void
  /**
   * Close every live MCP session created by a token bound to `boardId` (audit Phase A /
   * roadmap Phase 9). The HOST wires this into its board-teardown path (`close_board` /
   * discard-worktree) so a killed board's agent loses its LIVE session too —
   * `TokenStore.revoke` alone only 401s future requests. Resolves to the number of
   * sessions closed.
   */
  closeSessionsForBoard(boardId: string): Promise<number>
  close(): Promise<void>
}

/**
 * Re-derive the session context from the server-verified bearer token. The tier is read from
 * the token's `extra.tier` and re-validated against the closed vocabulary — an unknown value
 * fails CLOSED to `worker` (least privilege), never silently to a higher tier. `lead`
 * (orchestration Phase 1) is part of the closed vocabulary: without this branch a lead token
 * would silently collapse to `worker` at the HTTP boundary (the 0.22.0 gap the live tests now
 * pin — the in-memory contract layer bypasses this fn, so only an HTTP-layer test catches it).
 */
export function ctxFromAuth(auth: AuthInfo | undefined): SessionCtx {
  const extra = (auth?.extra ?? {}) as { tier?: unknown; boardId?: unknown }
  const tier: Tier =
    extra.tier === 'orchestrator'
      ? 'orchestrator'
      : extra.tier === 'connected'
        ? 'connected'
        : extra.tier === 'lead'
          ? 'lead'
          : 'worker'
  const boardId = typeof extra.boardId === 'string' ? extra.boardId : ''
  return { tier, scopes: auth?.scopes ?? [], boardId }
}

/**
 * Creates the loopback streamable-HTTP MCP server and starts listening on an
 * ephemeral 127.0.0.1 port. Pipeline: originGuard -> requireBearerAuth -> /mcp.
 * NO OAuth discovery routes are mounted (resourceMetadataUrl is left unset), so
 * MCP clients use the static per-board bearer token without a "needs auth" flag.
 */
export async function createMcpHttpServer(deps: McpServerDeps): Promise<RunningMcpServer> {
  const app = express()

  // DNS-rebinding defence in two layers: Host (always required) THEN Origin. These
  // run BEFORE any body parsing so a non-loopback request is 403'd outright and its
  // body is never parsed (no pre-auth parse / memory pressure).
  app.use(hostGuard())
  let allowedOrigins: readonly string[] = []
  app.use(originGuard(() => allowedOrigins))

  const verifier = createVerifier(deps.tokens)
  app.use(MCP_PATH, requireBearerAuth({ verifier }))

  // Parse the JSON body only on /mcp, only after Host/Origin/bearer have passed, and
  // with an explicit cap (MCP control messages are small; reject oversized bodies).
  app.use(MCP_PATH, express.json({ limit: '1mb' }))

  const sessions = new SessionManager(
    new ServerFactory(deps.orchestrator, deps.commandBoardId, deps.planningWrite ?? false)
  )

  app.post(MCP_PATH, (req, res, next) => {
    sessions.handlePost(req, res, ctxFromAuth(req.auth)).catch(next)
  })
  app.get(MCP_PATH, (req, res, next) => {
    sessions.handleSession(req, res, ctxFromAuth(req.auth)).catch(next)
  })
  app.delete(MCP_PATH, (req, res, next) => {
    sessions.handleSession(req, res, ctxFromAuth(req.auth)).catch(next)
  })

  // Final error handler (audit Phase A). Without it an error thrown past the routes —
  // a malformed JSON body from an AUTHENTICATED client, an oversized body, a transport
  // throw — falls to Express's default finalhandler, which renders an HTML page
  // embedding `err.stack` whenever NODE_ENV isn't 'production' (nothing in an
  // embedding Electron host guarantees it is). Always answer with the JSON-RPC error
  // shape the routes already use, and NEVER echo error internals to the client (the
  // host owns diagnostics; this response is agent-facing).
  app.use(MCP_PATH, (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err)
      return
    }
    const e = err as { type?: string } | null
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json(rpcError(-32700, 'Parse error: invalid JSON body'))
      return
    }
    if (e?.type === 'entity.too.large') {
      res.status(413).json(rpcError(-32600, 'Request body too large'))
      return
    }
    res.status(500).json(rpcError(-32603, 'Internal server error'))
  })

  const httpServer = createServer(app)
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()))
  const address = httpServer.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  allowedOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`]

  return {
    app,
    httpServer,
    port,
    setAllowedOrigins(origins) {
      allowedOrigins = origins
    },
    closeSessionsForBoard(boardId) {
      return sessions.closeByBoardId(boardId)
    },
    async close() {
      await sessions.closeAll()
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()))
      })
    }
  }
}
