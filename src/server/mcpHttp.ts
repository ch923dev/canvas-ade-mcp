import { createServer, type Server } from 'node:http'
import express, { type Express } from 'express'
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
import { SessionManager } from './transport'

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
}

export interface RunningMcpServer {
  app: Express
  httpServer: Server
  port: number
  setAllowedOrigins(origins: readonly string[]): void
  close(): Promise<void>
}

/** Re-derive the session context from the server-verified bearer token. */
export function ctxFromAuth(auth: AuthInfo | undefined): SessionCtx {
  const extra = (auth?.extra ?? {}) as { tier?: unknown; boardId?: unknown }
  const tier: Tier = extra.tier === 'orchestrator' ? 'orchestrator' : 'worker'
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

  const sessions = new SessionManager(new ServerFactory(deps.orchestrator, deps.commandBoardId))

  app.post(MCP_PATH, (req, res, next) => {
    sessions.handlePost(req, res, ctxFromAuth(req.auth)).catch(next)
  })
  app.get(MCP_PATH, (req, res, next) => {
    sessions.handleSession(req, res, ctxFromAuth(req.auth)).catch(next)
  })
  app.delete(MCP_PATH, (req, res, next) => {
    sessions.handleSession(req, res, ctxFromAuth(req.auth)).catch(next)
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
    async close() {
      await sessions.closeAll()
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()))
      })
    }
  }
}
