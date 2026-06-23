import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import pkg from '../../package.json' with { type: 'json' }
import type { BoardId, Scope, Tier } from '../types'
import type { Orchestrator } from '../orchestrator/Orchestrator'
import { TOOL_ORCHESTRATOR_PING, TOOL_PING } from '../constants'
import { registerBoardResources } from '../resources/boards'
import { registerAppModelResource } from '../resources/appModel'
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
import { registerSpawnGroup } from './tools/spawnGroup'
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
   *   `add_planning_elements` is registered (orchestrator + connected tiers) and `spawn_board`
   *   gains an optional `seed`. Default false → the write tool is absent from every `tools/list`
   *   (flag-gated for the first release, ADR 0003). May be a `() => boolean` getter re-evaluated
   *   per session so a runtime-toggled host consent is reflected (Agent Orchestration).
   */
  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly commandBoardId?: BoardId,
    private readonly planningWrite: boolean | (() => boolean) = false
  ) {}

  getServer(ctx: SessionCtx): { server: McpServer; dispose: () => void } {
    const server = new McpServer(SERVER_INFO)
    const disposers: Array<() => void> = []
    // Re-evaluate the planning-write gate ONCE per session (the host's orchestration consent is
    // runtime-toggleable while this server is a process singleton — a fixed boot-time boolean
    // would never reflect a later Enable). Computed here so both tier branches read one value.
    const planningWrite =
      typeof this.planningWrite === 'function' ? this.planningWrite() : this.planningWrite

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
      registerSpawnBoard(server, this.orchestrator, { planningWrite })
      registerCloseBoard(server, this.orchestrator)
      registerConfigureBoard(server, this.orchestrator)
      // 🔒 Planning content write (S2) — flag-gated, orchestrator-tier. Absent from
      // tools/list entirely unless the host opts in (ADR 0003: attacker-influenceable
      // content onto the durable canvas, behind a mandatory write-time human confirm).
      if (planningWrite) {
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
      // spawn_group (C2-wire) — spawn a feature-zone cluster in one cap-checked step. Orchestrator-
      // only to bound swarm growth (a connected agent must not grow the topology unaware).
      registerSpawnGroup(server, this.orchestrator)
      // canvas://app-model (C1) — read-only app self-model. Orchestrator-only: registered HERE (not
      // in registerBoardResources, which serves both tiers) so it is absent from a worker/connected
      // resources/list. The catalog/cap/TTL it exposes are of no use to a non-orchestrator.
      registerAppModelResource(server, this.orchestrator)
      // M5 barriers — orchestrator-tier; dispose cancels any in-flight wait on session close.
      disposers.push(registerBarrierTools(server, this.orchestrator))
    } else if (ctx.tier === 'connected') {
      // 🔒 Connected tier (Agent Orchestration v1): a CONSENTED Terminal board the user is
      // talking to. It gets a DELIBERATELY NARROW slice of the orchestrator's write surface —
      // relay along its OWN outgoing cables + act on the canvas (spawn/configure/plan-write) —
      // and NONE of the cross-board/observational tools (handoff_prompt/assign_prompt/interrupt/
      // close_board/git_diff/barriers stay orchestrator-only). Every tool below still pays the
      // host's per-action ConfirmModal; relay additionally requires a directed orchestration
      // cable AND is scoped to this board as source (see registerRelayPrompt). The capability
      // split is structural — a connected board's tools/list never even contains the omitted tools.
      registerSpawnBoard(server, this.orchestrator, { planningWrite })
      registerConfigureBoard(server, this.orchestrator)
      if (planningWrite) {
        registerAddPlanningElements(server, this.orchestrator)
      }
      // relay_prompt — tier-aware binding restricts a connected caller to its own board as source.
      registerRelayPrompt(server, this.orchestrator, ctx, this.commandBoardId)
    }

    // write_result (T4.4) — the FIRST worker-tier WRITE tool. Registered for BOTH tiers
    // (OUTSIDE the orchestrator-only block) and bound to ctx.boardId so a worker can only
    // record its OWN board's result, never forge another's.
    registerWriteResult(server, this.orchestrator, ctx)

    registerBoardResources(server, this.orchestrator)
    // Prompts substrate (W1-F): tier-gated `prompts/list`/`prompts/get`. Pure-render —
    // gated on ctx.tier (worker → no prompts). See src/prompts/index.ts.
    registerPrompts(server, ctx)

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
