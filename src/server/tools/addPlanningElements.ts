import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator, PlanningElementSpec } from '../../orchestrator/Orchestrator'
import {
  MAX_PLANNING_DIAGRAM,
  MAX_PLANNING_ELEMENTS_PER_CALL,
  MAX_PLANNING_ITEMS,
  MAX_PLANNING_LABEL,
  MAX_PLANNING_TEXT,
  MAX_PLANNING_TITLE,
  TOOL_ADD_PLANNING_ELEMENTS
} from '../../constants'

/**
 * Schema for ONE agent-emitted planning element (S2; `diagram` added with host schema v11).
 * A discriminated union on `kind`, matching the schema kinds that carry agent content
 * (note · checklist · text · arrow · diagram). Lengths are capped here as transport-layer
 * defence in depth; the HOST (Canvas ADE MAIN) re-validates + sanitizes + caps authoritatively
 * before any write, and a `diagram`'s Mermaid source is rendered by the host's sandboxed worker.
 */
const noteSpec = z.object({
  kind: z.literal('note'),
  text: z.string().min(1).max(MAX_PLANNING_TEXT),
  tint: z.enum(['yellow', 'blue', 'green', 'plain']).optional()
})
const checklistSpec = z.object({
  kind: z.literal('checklist'),
  title: z.string().min(1).max(MAX_PLANNING_TITLE),
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(MAX_PLANNING_LABEL),
        done: z.boolean().optional()
      })
    )
    .min(1)
    .max(MAX_PLANNING_ITEMS)
})
const textSpec = z.object({
  kind: z.literal('text'),
  text: z.string().min(1).max(MAX_PLANNING_TEXT)
})
const arrowSpec = z.object({
  kind: z.literal('arrow'),
  dx: z.number().finite(),
  dy: z.number().finite()
})
const diagramSpec = z.object({
  kind: z.literal('diagram'),
  // Mermaid source text; the host renders it to a themed SVG in a sandboxed worker.
  source: z.string().min(1).max(MAX_PLANNING_DIAGRAM)
})

export const planningElementSpecSchema = z.discriminatedUnion('kind', [
  noteSpec,
  checklistSpec,
  textSpec,
  arrowSpec,
  diagramSpec
])

/** A non-empty, capped batch of planning elements an agent writes in one confirmed call. */
export const planningElementsArraySchema = z
  .array(planningElementSpecSchema)
  .min(1)
  .max(MAX_PLANNING_ELEMENTS_PER_CALL)

/**
 * Register the `add_planning_elements` content-write tool (S2). Orchestrator-tier AND
 * flag-gated — the CALLER (ServerFactory) only registers it when the host enables
 * `planningWrite`, so it appears in `tools/list` for nobody otherwise. It writes
 * attacker-influenceable CONTENT onto the durable canvas (ADR 0003), so the host gates the
 * write behind a mandatory write-time human confirm showing the full rendered content. The
 * agent-emitted content is untrusted passive context: it renders, never auto-arms an action.
 */
export function registerAddPlanningElements(server: McpServer, orchestrator: Orchestrator): void {
  server.registerTool(
    TOOL_ADD_PLANNING_ELEMENTS,
    {
      description:
        'Write structured content to a PLANNING board to render the current plan: notes, ' +
        'checklists (with items), free text, arrows, and Mermaid diagrams (kind:"diagram" with a ' +
        '"source" string — flowchart/sequence/ERD; rendered to a themed SVG). boardId must be an ' +
        'existing planning board id (from spawn_board or canvas://boards). Every write is shown to ' +
        'the human for confirmation before it lands; declined writes change nothing. Content ' +
        'renders as passive context and never runs anything. Subject to per-call element/size caps.',
      inputSchema: {
        boardId: z.string().min(1),
        elements: planningElementsArraySchema
      }
    },
    async (args) => {
      // The discriminated-union parse above narrows each element; widen back to the shared
      // spec type for the orchestrator call (host re-validates regardless).
      await orchestrator.addPlanningElements(args.boardId, {
        elements: args.elements as PlanningElementSpec[]
      })
      return {
        content: [
          { type: 'text', text: `wrote ${args.elements.length} element(s) to ${args.boardId}` }
        ]
      }
    }
  )
}
