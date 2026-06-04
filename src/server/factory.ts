import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import pkg from '../../package.json' with { type: 'json' }
import type { BoardId, Scope, Tier } from '../types'
import type { Orchestrator } from '../orchestrator/Orchestrator'
import { TOOL_ORCHESTRATOR_PING, TOOL_PING } from '../constants'
import { registerBoardResources } from '../resources/boards'
import { registerPrompts } from '../prompts/index'
import { registerSpawnBoard } from './tools/spawnBoard'
import { registerCloseBoard } from './tools/closeBoard'
import { registerConfigureBoard } from './tools/configureBoard'
import { registerHandoffPrompt } from './tools/handoffPrompt'
import { registerAssignPrompt } from './tools/assignPrompt'
import { registerWriteResult } from './tools/writeResult'
import { registerInterrupt } from './tools/interrupt'
import { registerRelayPrompt } from './tools/relayPrompt'

/** Per-session context, derived from the validated bearer token. */
export interface SessionCtx {
  tier: Tier
  scopes: Scope[]
  boardId: BoardId
}

// Version is sourced from package.json so the handshake never drifts from the
// published version (clients log/compat-check serverInfo.version).
const SERVER_INFO = { name: 'canvas-ade-mcp', version: pkg.version }

/**
 * Builds a fresh McpServer per session, registering ONLY the tools the session's
 * tier is allowed. The capability split is structural (by registration) — a
 * worker's tools/list never even contains an orchestrator tool. Never
 * register-all-then-gate-in-handler.
 */
export class ServerFactory {
  constructor(private readonly orchestrator: Orchestrator) {}

  getServer(ctx: SessionCtx): McpServer {
    const server = new McpServer(SERVER_INFO)

    // ping — both tiers.
    server.registerTool(TOOL_PING, { description: 'Health check. Returns "pong".' }, async () => ({
      content: [{ type: 'text', text: 'pong' }]
    }))

    // Orchestrator-only tools — registered ONLY for the orchestrator tier, so a
    // worker's tools/list never even contains them (the capability split is
    // structural, never a per-handler check).
    if (ctx.tier === 'orchestrator') {
      server.registerTool(
        TOOL_ORCHESTRATOR_PING,
        { description: 'Orchestrator-only health check. Returns "orchestrator-pong".' },
        async () => ({ content: [{ type: 'text', text: 'orchestrator-pong' }] })
      )
      // Lifecycle write tools (Phase 3+).
      registerSpawnBoard(server, this.orchestrator)
      registerCloseBoard(server, this.orchestrator)
      registerConfigureBoard(server, this.orchestrator)
      // Dispatch write tools (Phase 4) — write into another board's PTY.
      registerHandoffPrompt(server, this.orchestrator)
      registerAssignPrompt(server, this.orchestrator)
      registerInterrupt(server, this.orchestrator)
      registerRelayPrompt(server, this.orchestrator)
    }

    // write_result (T4.4) — the FIRST worker-tier WRITE tool. Registered for BOTH tiers
    // (OUTSIDE the orchestrator-only block) and bound to ctx.boardId so a worker can only
    // record its OWN board's result, never forge another's.
    registerWriteResult(server, this.orchestrator, ctx)

    registerBoardResources(server, this.orchestrator)
    registerPrompts(server)

    return server
  }
}
