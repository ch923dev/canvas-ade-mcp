import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator, PlanningElementSpec } from '../../orchestrator/Orchestrator'
import {
  MAX_PLANNING_DIAGRAM,
  MAX_PLANNING_ELEMENTS_PER_CALL,
  MAX_PLANNING_ITEMS,
  MAX_PLANNING_LABEL,
  MAX_PLANNING_SECTION,
  MAX_PLANNING_TEXT,
  MAX_PLANNING_TITLE,
  TOOL_ADD_PLANNING_ELEMENTS
} from '../../constants'
import { diagramSpecSchema } from '../diagramSpec'

/**
 * Schema for ONE agent-emitted planning element (S2; `diagram` added with host schema v11).
 * A discriminated union on `kind`, matching the schema kinds that carry agent content
 * (note · checklist · text · arrow · diagram). Lengths are capped here as transport-layer
 * defence in depth; the HOST (Canvas ADE MAIN) re-validates + sanitizes + caps authoritatively
 * before any write, and a `diagram`'s Mermaid source is rendered by the host's sandboxed worker.
 *
 * Every kind may carry an optional `section` (2a) — a short column label. The host groups elements
 * by section value and lays out one column per section (declared order), so an agent controls the
 * plan's column structure instead of leaving placement to height-balancing. Layout-only: the host
 * uses it to position cards, never persists it.
 */
const sectionField = z.string().min(1).max(MAX_PLANNING_SECTION).optional()
const noteSpec = z.object({
  kind: z.literal('note'),
  text: z.string().min(1).max(MAX_PLANNING_TEXT),
  tint: z.enum(['yellow', 'blue', 'green', 'plain']).optional(),
  section: sectionField
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
    .max(MAX_PLANNING_ITEMS),
  section: sectionField
})
const textSpec = z.object({
  kind: z.literal('text'),
  text: z.string().min(1).max(MAX_PLANNING_TEXT),
  section: sectionField
})
const arrowSpec = z.object({
  kind: z.literal('arrow'),
  dx: z.number().finite(),
  dy: z.number().finite(),
  section: sectionField
})
const diagramSpec = z.object({
  kind: z.literal('diagram'),
  // Mermaid source text; the host renders it to a themed SVG in a sandboxed worker.
  source: z.string().min(1).max(MAX_PLANNING_DIAGRAM).optional(),
  // Phase 3 (MCP contract v2): the structured form — engine:'expanse' + a full DiagramSpec the
  // host validates authoritatively (assertDiagramSpec) and renders as token-styled DOM. A
  // diagram carries EXACTLY ONE of source | spec (enforced in the array superRefine below —
  // a discriminated-union member must stay a plain object).
  engine: z.enum(['mermaid', 'expanse']).optional(),
  spec: diagramSpecSchema.optional(),
  section: sectionField
})

export const planningElementSpecSchema = z.discriminatedUnion('kind', [
  noteSpec,
  checklistSpec,
  textSpec,
  arrowSpec,
  diagramSpec
])

/**
 * A non-empty, capped batch of planning elements an agent writes in one confirmed call.
 * The superRefine enforces the diagram content-form contract (source XOR spec, engine
 * consistent with the form) — shared by `add_planning_elements` and the `spawn_board` seed.
 */
export const planningElementsArraySchema = z
  .array(planningElementSpecSchema)
  .min(1)
  .max(MAX_PLANNING_ELEMENTS_PER_CALL)
  .superRefine((elements, ctx) => {
    elements.forEach((el, i) => {
      if (el.kind !== 'diagram') return
      const hasSource = el.source !== undefined
      const hasSpec = el.spec !== undefined
      if (hasSource === hasSpec) {
        ctx.addIssue({
          code: 'custom',
          path: [i],
          message:
            'diagram element must carry exactly one of "source" (Mermaid) or "spec" (expanse)'
        })
      } else if (hasSpec && el.engine === 'mermaid') {
        ctx.addIssue({
          code: 'custom',
          path: [i],
          message: 'diagram element with engine "mermaid" cannot carry a structured "spec"'
        })
      } else if (hasSource && el.engine === 'expanse') {
        ctx.addIssue({
          code: 'custom',
          path: [i],
          message: 'diagram element with engine "expanse" cannot carry a Mermaid "source"'
        })
      }
    })
  })

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
        'checklists (with items), free text, arrows, and diagrams. A diagram (kind:"diagram") ' +
        'carries EXACTLY ONE content form: a Mermaid "source" string (flowchart/sequence/ERD; ' +
        'rendered to a themed SVG) OR engine:"expanse" + "spec" — a structured DiagramSpec ' +
        '(typed nodes/edges/groups with closed status/kind vocabularies; the host lays it out, ' +
        'themes it, and animates updates; PREFER it for flow/state/architecture diagrams — its ' +
        'ids enable later incremental edits via update_planning_element specOps; keep Mermaid ' +
        'for sequence/gantt/ER). boardId must be an ' +
        'existing planning board id (from spawn_board or canvas://boards). Give each element an ' +
        'optional "section" (a short column label, e.g. "Setup"/"Build"/"Test") to control layout: ' +
        'the board lays out ONE COLUMN PER SECTION, left-to-right in the order sections first ' +
        "appear, stacking each section's elements top-to-bottom in array order. Use sections to " +
        'present a multi-phase plan as tidy side-by-side columns; omit section everywhere to let ' +
        'the board auto-arrange. Every write is shown to the human for confirmation before it ' +
        'lands; declined writes change nothing. Content renders as passive context and never runs ' +
        'anything. Subject to per-call element/size caps.',
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
