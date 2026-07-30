import { z } from 'zod'
import type { McpServer } from "@modelcontextprotocol/server";
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import type { SessionCtx } from '../factory'
import { SPAWN_GROUP_MAX_LAUNCH, SPAWN_GROUP_MAX_NAME, TOOL_SPAWN_GROUP } from '../../constants'

/**
 * Register the `spawn_group` tool (C2-wire / PR-5c) — spawn a feature-zone CLUSTER (a terminal board
 * + optional planning + optional browser, grouped under a Named Group) in ONE step. The CALLER
 * (ServerFactory) gates this to the ORCHESTRATOR + LEAD tiers by only invoking `registerSpawnGroup`
 * for those tiers; a worker/connected `tools/list` never contains it. The connected-tier omission is
 * the load-bearing invariant: a connected agent (a terminal with a cable) must not grow the swarm
 * without the orchestrator's awareness. A LEAD terminal (orchestration Phase 1) IS the orchestrator
 * role, so it registers here — its clusters auto-cable lead→terminal-member (see `ctx` below), the
 * same discipline as its `spawn_board`.
 *
 * 🔒 The host (Canvas ADE MAIN) owns safety: it mints every member id, reserves all member slots
 * against the same spawn cap BEFORE creating any board (a near-cap group can't burst past it), and
 * sanitizes `launchCommand` to a single PTY-safe line before writing it (F5/SPEC-W1-B — the
 * pre-sanitized path is a merged dependency of this tool). The group is content-less (empty boards),
 * so it is cap-checked, NOT human-gated; the write-time confirm stays on content writes
 * (handoff/assign/relay/add_planning_elements). This tool is the thin transport: validate, forward
 * to {@link Orchestrator.spawnGroup}, surface the minted ids as JSON.
 */
export function registerSpawnGroup(
  server: McpServer,
  orchestrator: Orchestrator,
  opts: { ctx?: SessionCtx } = {}
): void {
  server.registerTool(
    TOOL_SPAWN_GROUP,
    {
      description:
        'Spawn a feature-zone cluster: a terminal board (always) plus an optional planning board ' +
        'and an optional browser board, grouped under a Named Group. ' +
        'launchCommand is the first PTY line written on the terminal member (an exec vector — ' +
        'the host sanitizes it). Returns the minted ids of every created member as JSON. Subject ' +
        'to the spawn concurrency cap (the whole cluster is reserved before any board is created).',
      inputSchema: z.object({
              name: z.string().min(1).max(SPAWN_GROUP_MAX_NAME),
              planning: z.boolean().optional(),
              browser: z.boolean().optional(),
              launchCommand: z.string().max(SPAWN_GROUP_MAX_LAUNCH).optional()
            })
    },
    async (args) => {
      const result = await orchestrator.spawnGroup({
        name: args.name,
        planning: args.planning,
        browser: args.browser,
        launchCommand: args.launchCommand,
        // 🔒 Auto-cable (Phase 1): a LEAD-tier caller passes its own token-derived id — never
        // client input, so it cannot be forged — and the host creates a directed orchestration
        // connector lead→terminal-member alongside the cluster, authorizing follow-up
        // relay/assign dispatch into it (the spawn_board rc.6 discipline). Orchestrator-tier
        // spawns pass nothing (the 'app' command board needs no cable).
        ...(opts.ctx?.tier === 'lead' && opts.ctx.boardId
          ? { sourceBoardId: opts.ctx.boardId }
          : {})
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  )
}
