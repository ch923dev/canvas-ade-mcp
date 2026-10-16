import { McpServer } from '@modelcontextprotocol/server'
import pkg from '../../package.json' with { type: 'json' }
import type { BoardId, Scope, Tier } from '../types'
import type { Orchestrator } from '../orchestrator/Orchestrator'
import { TOOL_ORCHESTRATOR_PING, TOOL_PING } from '../constants'
import { registerBoardResources } from '../resources/boards'
import { registerAppModelResource } from '../resources/appModel'
import { registerLayoutResource } from '../resources/layout'
import { registerContextsResource } from '../resources/contexts'
import { registerPrompts } from '../prompts/index'
import { registerSpawnBoard } from './tools/spawnBoard'
import { registerCloseBoard } from './tools/closeBoard'
import { registerConfigureBoard } from './tools/configureBoard'
import { registerAddPlanningElements } from './tools/addPlanningElements'
import { registerPlanningEdit } from './tools/planningEdit'
import { registerKanbanCards } from './tools/kanbanCards'
import { registerVisualizePlan } from './tools/visualizePlan'
import { registerPublishFindings } from './tools/publishFindings'
import { registerHandoffPrompt } from './tools/handoffPrompt'
import { registerAssignPrompt } from './tools/assignPrompt'
import { registerWriteResult } from './tools/writeResult'
import { registerInterrupt } from './tools/interrupt'
import { registerGitDiff } from './tools/gitDiff'
import { registerSpawnGroup } from './tools/spawnGroup'
import { registerTidyCanvas } from './tools/tidyCanvas'
import { registerFocusViewport } from './tools/focusViewport'
import { registerGroupBoards } from './tools/groupBoards'
import { registerEditGroups } from './tools/editGroups'
import { registerRelayPrompt } from './tools/relayPrompt'
import { registerRelayPrompts } from './tools/relayPrompts'
import { registerBarrierTools } from './tools/barriers'
import { installResourceSubscriptions } from './resourceSubscriptions'
import { installToolErrorBoundary } from './toolErrorBoundary'
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
 * The C6 SPATIAL surface (spatial-awareness, 0.27.0) — ONE registration set shared by the
 * orchestrator, lead and connected tiers (D1), so the three tiers cannot drift apart. A worker never
 * calls this, so none of it ever appears in a worker's `tools/list` / `resources/list`.
 *
 * - `canvas://layout` + `canvas://contexts` — read-only.
 * - `tidy_canvas` + `focus_viewport` — the tool binds a lead/connected caller's own token-derived
 *   board id as `sourceBoardId`, and the HOST raises one approve/deny confirm when it is present; an
 *   orchestrator caller binds none and stays un-gated.
 * - `group_boards` + `edit_groups` — human batch-confirmed host-side for EVERY tier (D2).
 *
 * `canvas://contexts`, `group_boards` and `edit_groups` sit on OPTIONAL Orchestrator methods: each is
 * skipped — with one `console.warn` — when the host has not wired its method.
 */
function registerSpatialSurface(
  server: McpServer,
  orchestrator: Orchestrator,
  ctx: SessionCtx
): void {
  registerTidyCanvas(server, orchestrator, { ctx })
  registerFocusViewport(server, orchestrator, { ctx })
  registerGroupBoards(server, orchestrator, { ctx })
  registerEditGroups(server, orchestrator, { ctx })
  registerLayoutResource(server, orchestrator)
  registerContextsResource(server, orchestrator)
}

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
    // Structured tool errors (0.26.0): wrap THIS instance's registerTool before anything registers,
    // so every tool below — whatever the tier — answers a failure with the same text as before PLUS
    // `structuredContent.error.code`. One central boundary; no per-tool edits (toolErrorBoundary.ts).
    installToolErrorBoundary(server)
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
      // only when the host enables the S2 write path (the same flag below). ctx rides along for
      // the rc.6 auto-cable (a no-op at this tier — only a `connected` caller mints a cable).
      registerSpawnBoard(server, this.orchestrator, { planningWrite, ctx })
      registerCloseBoard(server, this.orchestrator)
      registerConfigureBoard(server, this.orchestrator)
      // 🔒 Planning content write (S2) — flag-gated, orchestrator-tier. Absent from
      // tools/list entirely unless the host opts in (ADR 0003: attacker-influenceable
      // content onto the durable canvas, behind a mandatory write-time human confirm).
      if (planningWrite) {
        registerAddPlanningElements(server, this.orchestrator)
        // 🔒 Planning-element update/remove (S6) — the read-then-update loop closing the append-only
        // gap. Same content-write gate; each op resolves the element by id + is host-confirmed.
        registerPlanningEdit(server, this.orchestrator)
        // 🔒 Kanban card writes (P3) — same content-write gate as add_planning_elements (a Kanban
        // board is a plan surface). add/move/update/remove a card; each op is host-confirmed.
        registerKanbanCards(server, this.orchestrator)
        // 🔒 Visualize plan (P5) — the upgraded content-write gate: propose a flat plan, the host
        // surfaces a layout chooser (kanban/grid/checklist/columns) + creates the chosen board.
        registerVisualizePlan(server, this.orchestrator, { ctx })
        // 🔒 publish_findings (orchestration P4) — the BATCH sibling of add_card, and the reason the
        // end-of-run step is usable at all: N findings would otherwise be N confirm modals. Same
        // content-write gate; the caller supplies no content, only a destination board.
        registerPublishFindings(server, this.orchestrator)
      }
      // Dispatch write tools (Phase 4) — write into another board's PTY.
      registerHandoffPrompt(server, this.orchestrator)
      registerAssignPrompt(server, this.orchestrator)
      registerInterrupt(server, this.orchestrator)
      // relay_prompt is bound to the designated command orchestrator when one is set (BUG-021).
      registerRelayPrompt(server, this.orchestrator, ctx, this.commandBoardId)
      // relay_prompts (rc.8) — the batch sibling: N dispatches, ONE per-row human-confirm modal.
      // Same tier-aware source binding; each item stays an independent host-gated dispatch.
      registerRelayPrompts(server, this.orchestrator, ctx, this.commandBoardId)
      // git_diff (PR-2b) — read-only working-tree diff per board, for the result/recap roll-up.
      registerGitDiff(server, this.orchestrator)
      // spawn_group (C2-wire) — spawn a feature-zone cluster in one cap-checked step. Orchestrator-
      // only to bound swarm growth (a connected agent must not grow the topology unaware).
      registerSpawnGroup(server, this.orchestrator)
      // canvas://app-model (C1) — read-only app self-model. Orchestrator-only: registered HERE (not
      // in registerBoardResources, which serves both tiers) so it is absent from a worker/connected
      // resources/list. The catalog/cap/TTL it exposes are of no use to a non-orchestrator.
      registerAppModelResource(server, this.orchestrator)
      // Spatial surface (C6 / D1): tidy_canvas + focus_viewport stay UN-GATED at this tier (no
      // sourceBoardId is bound for an orchestrator caller); group writes are always batch-confirmed.
      registerSpatialSurface(server, this.orchestrator, ctx)
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
      // ctx rides along: a connected caller's token-derived boardId becomes the spawn's
      // sourceBoardId → the host auto-creates the spawner→spawned orchestration cable (rc.6),
      // so a follow-up relay_prompt into the freshly-spawned terminal is already authorized.
      registerSpawnBoard(server, this.orchestrator, { planningWrite, ctx })
      registerConfigureBoard(server, this.orchestrator)
      if (planningWrite) {
        registerAddPlanningElements(server, this.orchestrator)
        registerPlanningEdit(server, this.orchestrator)
        registerKanbanCards(server, this.orchestrator)
        registerVisualizePlan(server, this.orchestrator, { ctx })
      }
      // relay_prompt — tier-aware binding restricts a connected caller to its own board as source.
      registerRelayPrompt(server, this.orchestrator, ctx, this.commandBoardId)
      // relay_prompts (rc.8) — the batch sibling, same own-board source binding applied per item.
      registerRelayPrompts(server, this.orchestrator, ctx, this.commandBoardId)
      // Spatial surface (C6 / D1) — the terminal the user talks to can read the layout/contexts,
      // tidy, focus and group. tidy/focus bind this board as sourceBoardId → the host confirms first.
      registerSpatialSurface(server, this.orchestrator, ctx)
    } else if (ctx.tier === 'lead') {
      // 🔒 Lead tier (orchestration Phase 1, precondition X): a terminal board holding the
      // ORCHESTRATOR ROLE over the wire. Its dispatch authority binds to the CALLER'S OWN
      // token-derived board id — never to `commandBoardId` (which stays the 'app' path's
      // designation) — and every dispatch still pays the host's directed-cable check +
      // single-use nonce + human confirm + audit. The tool surface is the orchestration CORE
      // only: spawn (spawn_board/spawn_group, both auto-cabled lead→spawned so dispatch into a
      // freshly-spawned worker is already authorized), dispatch (relay_prompt/relay_prompts
      // own-board-bound; assign_prompt routed through the relay path with this board as source),
      // and JOIN (the M5 barriers), plus the C6 spatial surface (D1, 0.27.0 — see
      // registerSpatialSurface). Deliberately OMITTED: handoff_prompt/interrupt/close_board/
      // git_diff/configure_board/app-model — the app-resident orchestrator's cross-board/
      // observational surfaces are NOT part of the lead role (additive follow-ups if it earns
      // them). Planning writes stay flag-gated exactly like connected. The capability split is
      // structural — a lead board's tools/list never even contains the omitted tools.
      registerSpawnBoard(server, this.orchestrator, { planningWrite, ctx })
      registerSpawnGroup(server, this.orchestrator, { ctx })
      if (planningWrite) {
        registerAddPlanningElements(server, this.orchestrator)
        registerPlanningEdit(server, this.orchestrator)
        registerKanbanCards(server, this.orchestrator)
        registerVisualizePlan(server, this.orchestrator, { ctx })
        // 🔒 publish_findings (P4) — a lead IS the orchestrator over the wire, and this is the step
        // that makes its run's conclusions keepable. It needs no own-board binding like the dispatch
        // tools below: it carries no content and writes only findings the host already holds.
        registerPublishFindings(server, this.orchestrator)
      }
      // Dispatch — every path binds to the caller's own board id (see each tool's lead notes).
      registerRelayPrompt(server, this.orchestrator, ctx, this.commandBoardId)
      registerRelayPrompts(server, this.orchestrator, ctx, this.commandBoardId)
      registerAssignPrompt(server, this.orchestrator, ctx)
      // M5 barriers — the lead's JOIN over the boards it dispatched into; same dispose discipline
      // as the orchestrator tier (cancel in-flight waits on session close).
      disposers.push(registerBarrierTools(server, this.orchestrator))
      // Spatial surface (C6 / D1) — same as connected: tidy/focus bind this board → host confirm.
      registerSpatialSurface(server, this.orchestrator, ctx)
    }

    // write_result (T4.4) — the FIRST worker-tier WRITE tool. Registered for BOTH tiers
    // (OUTSIDE the orchestrator-only block) and bound to ctx.boardId so a worker can only
    // record its OWN board's result, never forge another's.
    registerWriteResult(server, this.orchestrator, ctx)

    // 🔒 Read-scoped per session (audit Phase A): a worker session reads ONLY its own
    // board — list resources filtered, per-board reads refused for a sibling id (the
    // same cross-worker info-leak rationale that keeps git_diff orchestrator-only).
    registerBoardResources(server, this.orchestrator, ctx)
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
