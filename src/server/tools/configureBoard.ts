import { z } from 'zod'
import type { McpServer } from "@modelcontextprotocol/server";
import type { BoardConfig, Orchestrator } from '../../orchestrator/Orchestrator'
import { KANBAN_COLUMN_AXES, MAX_AXIS_LABEL, TOOL_CONFIGURE_BOARD } from '../../constants'

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
        'Change a board config by id. At least one of shell | launchCommand | cwd | columnAxis | ' +
        'axisLabel is required. Applies to the board type that owns the key: shell/launchCommand/cwd ' +
        'are TERMINAL config; columnAxis ("flow" = ordered workflow stages / "category" = unordered ' +
        'buckets) and axisLabel (the axis display name, e.g. "Phase"/"Subsystem") are KANBAN config. ' +
        'Human-confirmed when it sets an exec vector (launchCommand) or renderable kanban axis content.',
      inputSchema: z.object({
              id: z.string().min(1),
              shell: z.string().optional(),
              launchCommand: z.string().optional(),
              cwd: z.string().optional(),
              columnAxis: z.enum(KANBAN_COLUMN_AXES).optional(),
              axisLabel: z.string().min(1).max(MAX_AXIS_LABEL).optional()
            })
    },
    async (args) => {
      const config: BoardConfig = {}
      if (args.shell !== undefined) config.shell = args.shell
      if (args.launchCommand !== undefined) config.launchCommand = args.launchCommand
      if (args.cwd !== undefined) config.cwd = args.cwd
      if (args.columnAxis !== undefined) config.columnAxis = args.columnAxis
      if (args.axisLabel !== undefined) config.axisLabel = args.axisLabel
      if (Object.keys(config).length === 0) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'configure_board: at least one of shell/launchCommand/cwd/columnAxis/axisLabel required'
            }
          ]
        }
      }
      await orchestrator.configureBoard(args.id, config)
      return { content: [{ type: 'text', text: `configured ${args.id}` }] }
    }
  )
}
