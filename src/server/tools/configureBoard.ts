import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BoardConfig, Orchestrator } from '../../orchestrator/Orchestrator'
import { TOOL_CONFIGURE_BOARD } from '../../constants'

/**
 * Register the `configure_board` lifecycle tool (T3.3) — a WRITE tool, orchestrator
 * tier only (gated by the CALLER). Changes a board's durable per-type config
 * (shell / launchCommand / cwd). `id` is required; at least one config field must be
 * present (an empty change is rejected before the orchestrator is called). The host
 * additionally filters the patch to the board type's patchable keys.
 */
export function registerConfigureBoard(server: McpServer, orchestrator: Orchestrator): void {
  server.registerTool(
    TOOL_CONFIGURE_BOARD,
    {
      description:
        'Change a board config by id. At least one of shell | launchCommand | cwd is required. ' +
        'Applies to the board type that owns the key (shell/launchCommand/cwd are terminal config).',
      inputSchema: {
        id: z.string().min(1),
        shell: z.string().optional(),
        launchCommand: z.string().optional(),
        cwd: z.string().optional()
      }
    },
    async (args) => {
      const config: BoardConfig = {}
      if (args.shell !== undefined) config.shell = args.shell
      if (args.launchCommand !== undefined) config.launchCommand = args.launchCommand
      if (args.cwd !== undefined) config.cwd = args.cwd
      if (Object.keys(config).length === 0) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'configure_board: at least one of shell/launchCommand/cwd required'
            }
          ]
        }
      }
      await orchestrator.configureBoard(args.id, config)
      return { content: [{ type: 'text', text: `configured ${args.id}` }] }
    }
  )
}
