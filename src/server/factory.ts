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
import { registerAddPlanningElements } from './tools/addPlanningElements'
import { registerHandoffPrompt } from './tools/handoffPrompt'
import { registerAssignPrompt } from './tools/assignPrompt'
import { registerWriteResult } from './tools/writeResult'
import { registerInterrupt } from './tools/interrupt'
import { registerGitDiff } from './tools/gitDiff'
import { registerRelayPrompt } from './tools/relayPrompt'
import { registerBarrierTools } from './tools/barriers'
import { installResourceSubscriptions } from './resourceSubscriptions'
import { createAttentionNotifier } from './attentionNotifier'

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
  /**
   * @param commandBoardId Optional single command-orchestrator board id (BUG-021). When set,
   *   `relay_prompt` is restricted to that token-bound identity so a second orchestrator-tier
   *   token can't drive cables it doesn't own. Left undefined → relay open to any orchestrator
   *   (the prior single-token behaviour).
   */
  /**
   * @param planningWrite Gate for the S2 planning content-write path. When true,
   *   `add_planning_elements` is registered (orchestrator-tier) and `spawn_board` gains an
   *   optional `seed`. Default false → the write tool is absent from every `tools/list`
   *   (flag-gated for the first release, ADR 0003).
   */
  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly commandBoardId?: BoardId,
    private readonly planningWrite: boolean = false
  ) {}

  getServer(ctx: SessionCtx): { server: McpServer; dispose: () => void } {
    const server = new McpServer(SERVER_INFO)
    const disposers: Array<() => void> = []

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
      // Lifecycle write tools (Phase 3+). `spawn_board` gains the optional planning `seed`
      // only when the host enables the S2 write path (the same flag below).
      registerSpawnBoard(server, this.orchestrator, { planningWrite: this.planningWrite })
      registerCloseBoard(server, this.orchestrator)
      registerConfigureBoard(server, this.orchestrator)
      // 🔒 Planning content write (S2) — flag-gated, orchestrator-tier. Absent from
      // tools/list entirely unless the host opts in (ADR 0003: attacker-influenceable
      // content onto the durable canvas, behind a mandatory write-time human confirm).
      if (this.planningWrite) {
        registerAddPlanningElements(server, this.orchestrator)
      }
      // Dispatch write tools (Phase 4) — write into another board's PTY.
      registerHandoffPrompt(server, this.orchestrator)
      registerAssignPrompt(server, this.orchestrator)
      registerInterrupt(server, this.orchestrator)
      // relay_prompt is bound to the designated command orchestrator when one is set (BUG-021).
      registerRelayPrompt(server, this.orchestrator, ctx, this.commandBoardId)
      // git_diff (PR-2b) — read-only working-tree diff per board, for the result/recap roll-up.
      registerGitDiff(server, this.orchestrator)
      // M5 barriers — orchestrator-tier; dispose cancels any in-flight wait on session close.
      disposers.push(registerBarrierTools(server, this.orchestrator))
    }

    // write_result (T4.4) — the FIRST worker-tier WRITE tool. Registered for BOTH tiers
    // (OUTSIDE the orchestrator-only block) and bound to ctx.boardId so a worker can only
    // record its OWN board's result, never forge another's.
    registerWriteResult(server, this.orchestrator, ctx)

    registerBoardResources(server, this.orchestrator)
    registerPrompts(server)

    // M5 attention push (both tiers — observation is safe). Subscribe wiring MUST precede
    // connect (registerCapabilities is connect-gated); getServer always runs before connect.
    const subs = installResourceSubscriptions(server)
    const notifier = createAttentionNotifier({
      server,
      orchestrator: this.orchestrator,
      isSubscribed: subs.isSubscribed
    })
    disposers.push(() => notifier.dispose())

    return {
      server,
      dispose: () => {
        for (const d of disposers) d()
      }
    }
  }
}
