import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator, PlanItem, Visualization } from '../../orchestrator/Orchestrator'
import {
  MAX_PLAN_ITEM_ASSIGNEE,
  MAX_PLAN_ITEM_NOTE,
  MAX_PLAN_ITEM_STATUS,
  MAX_PLAN_ITEM_TAG,
  MAX_PLAN_ITEM_TITLE,
  MAX_PLAN_ITEMS,
  MAX_PLAN_TITLE,
  TOOL_VISUALIZE_PLAN,
  VISUALIZATIONS
} from '../../constants'

/**
 * Schema for ONE plan item (P5). Only `title` is required; the chips + note are optional. Lengths are
 * capped here as transport-layer defence in depth — the HOST (Canvas ADE MAIN) re-validates +
 * sanitizes + caps authoritatively before the confirm gate, and groups items by `status`.
 */
const planItemSchema = z.object({
  title: z.string().min(1).max(MAX_PLAN_ITEM_TITLE),
  status: z.string().min(1).max(MAX_PLAN_ITEM_STATUS).optional(),
  tag: z.string().min(1).max(MAX_PLAN_ITEM_TAG).optional(),
  assignee: z.string().min(1).max(MAX_PLAN_ITEM_ASSIGNEE).optional(),
  note: z.string().min(1).max(MAX_PLAN_ITEM_NOTE).optional()
})

/** A non-empty, capped flat plan an agent visualizes in one confirmed call. */
export const planItemsArraySchema = z.array(planItemSchema).min(1).max(MAX_PLAN_ITEMS)

/**
 * Register the `visualize_plan` content-write tool (P5). Orchestrator + connected tiers AND
 * flag-gated — the CALLER (ServerFactory) only registers it when the host enables `planningWrite`, so
 * it appears in `tools/list` for nobody otherwise. It writes attacker-influenceable CONTENT onto the
 * durable canvas (ADR 0003), so the host surfaces a mandatory write-time human confirm — the layout
 * CHOOSER — showing the full plan before it materializes a new board. Passive content: it renders,
 * never auto-arms an action.
 */
export function registerVisualizePlan(server: McpServer, orchestrator: Orchestrator): void {
  server.registerTool(
    TOOL_VISUALIZE_PLAN,
    {
      description:
        'Visualize a plan as a NEW board on the canvas. Give a flat list of "items" (each a "title" ' +
        'plus optional "status", "tag", "assignee", and "note"); "status" groups items into columns/' +
        'stages (e.g. "backlog"/"in progress"/"done"). Suggest a shape with "suggested" — "kanban" ' +
        '(a Trello board, statuses become columns), "grid" (loose notes), "checklist" (one toggleable ' +
        'list), or "columns" (notes grouped side-by-side by status). The human is shown the plan and ' +
        'PICKS the final shape in a confirmation chooser (your suggestion is preselected); the board ' +
        'is then tidied into open space. Give "title" to name the board. Nothing runs — this only ' +
        'draws passive content. Declined proposals change nothing. Subject to per-call item/size caps.',
      inputSchema: {
        items: planItemsArraySchema,
        suggested: z.enum(VISUALIZATIONS).optional(),
        title: z.string().min(1).max(MAX_PLAN_TITLE).optional()
      }
    },
    async (args) => {
      const { id } = await orchestrator.visualizePlan({
        items: args.items as PlanItem[],
        ...(args.suggested !== undefined ? { suggested: args.suggested as Visualization } : {}),
        ...(args.title !== undefined ? { title: args.title } : {})
      })
      return {
        content: [
          {
            type: 'text',
            text: `proposed a ${args.items.length}-item plan; created board ${id} on the canvas`
          }
        ]
      }
    }
  )
}
