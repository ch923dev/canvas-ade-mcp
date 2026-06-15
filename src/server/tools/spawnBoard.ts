import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator, PlanningElementSpec } from '../../orchestrator/Orchestrator'
import { SPAWNABLE_BOARD_TYPES, TOOL_SPAWN_BOARD } from '../../constants'
import { planningElementsArraySchema } from './addPlanningElements'

/**
 * Register the `spawn_board` lifecycle tool (T3.1) — the first WRITE tool. The
 * CALLER (ServerFactory) gates this to the orchestrator tier by only invoking
 * `registerSpawnBoard` for that tier; a worker's `tools/list` never contains it.
 * The closed `type` enum is the input-validation guard: an unknown type is
 * rejected by the SDK's schema check BEFORE the orchestrator is ever called, so a
 * bad type can never reach the host's board factory.
 *
 * The orchestrator (Canvas ADE MAIN) mints the board id and drives the canvas via
 * the command channel; the tool just surfaces that server-issued id to the agent.
 *
 * When `opts.planningWrite` is set (the same host flag that exposes
 * `add_planning_elements`, S2), spawn_board ALSO accepts an optional `seed` — a batch of
 * planning elements to populate a freshly-spawned `planning` board in ONE call. The seed
 * rides the SAME host write-confirm as `add_planning_elements` (the seed is only applied
 * after the human approves the content); a non-planning target with a seed is rejected
 * BEFORE any spawn. The seed key is absent from the schema entirely when the flag is off.
 */
export function registerSpawnBoard(
  server: McpServer,
  orchestrator: Orchestrator,
  opts: { planningWrite?: boolean } = {}
): void {
  const inputSchema = {
    type: z.enum(SPAWNABLE_BOARD_TYPES),
    prompt: z.string().optional(),
    cwd: z.string().optional(),
    // Only offer `seed` when the host has enabled the planning-write path (S2).
    ...(opts.planningWrite ? { seed: planningElementsArraySchema.optional() } : {})
  }
  server.registerTool(
    TOOL_SPAWN_BOARD,
    {
      description:
        'Create a new board on the canvas. type is one of terminal | browser | planning. ' +
        'Optional prompt (terminal launch command / agent task) and cwd (working directory). ' +
        (opts.planningWrite
          ? 'Optional seed (planning only): structured elements to populate the new board in one ' +
            'call, shown to the human for confirmation before they land. '
          : '') +
        'Returns the new board id. Subject to a concurrency cap.',
      inputSchema
    },
    async (args) => {
      const seed = (args as { seed?: unknown }).seed as PlanningElementSpec[] | undefined
      // A seed is only meaningful for a planning board — reject a mismatch BEFORE spawning so
      // the canvas is never left with an empty board the agent can't populate.
      if (seed && seed.length > 0 && args.type !== 'planning') {
        return {
          isError: true,
          content: [{ type: 'text', text: 'spawn_board: seed is only valid for a planning board' }]
        }
      }
      const { id } = await orchestrator.spawnBoard({
        type: args.type,
        prompt: args.prompt,
        cwd: args.cwd
      })
      // Apply the seed through the SAME confirmed write path as add_planning_elements. A
      // decline throws there → surface it as an isError result (the board still exists, just
      // empty), so the agent learns the content was not written.
      if (seed && seed.length > 0) {
        try {
          await orchestrator.addPlanningElements(id, { elements: seed })
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `spawn_board: created ${id} but the seed was not written: ${
                  err instanceof Error ? err.message : String(err)
                }`
              }
            ]
          }
        }
      }
      return { content: [{ type: 'text', text: id }] }
    }
  )
}
