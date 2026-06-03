import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import { SPAWNABLE_BOARD_TYPES, TOOL_SPAWN_BOARD } from '../../constants'

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
 */
export function registerSpawnBoard(server: McpServer, orchestrator: Orchestrator): void {
  server.registerTool(
    TOOL_SPAWN_BOARD,
    {
      description:
        'Create a new board on the canvas. type is one of terminal | browser | planning. ' +
        'Optional prompt (terminal launch command / agent task) and cwd (working directory). ' +
        'Returns the new board id. Subject to a concurrency cap.',
      inputSchema: {
        type: z.enum(SPAWNABLE_BOARD_TYPES),
        prompt: z.string().optional(),
        cwd: z.string().optional()
      }
    },
    async (args) => {
      const { id } = await orchestrator.spawnBoard({
        type: args.type,
        prompt: args.prompt,
        cwd: args.cwd
      })
      return { content: [{ type: 'text', text: id }] }
    }
  )
}
