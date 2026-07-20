import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator, PlanningElementPatch } from '../../orchestrator/Orchestrator'
import {
  MAX_PLANNING_DIAGRAM,
  MAX_PLANNING_ELEMENT_ID,
  MAX_PLANNING_ITEMS,
  MAX_PLANNING_LABEL,
  MAX_PLANNING_TEXT,
  MAX_PLANNING_TITLE,
  TOOL_REMOVE_PLANNING_ELEMENT,
  TOOL_UPDATE_PLANNING_ELEMENT
} from '../../constants'
import { specOpsArraySchema } from '../diagramSpec'

/**
 * Register the planning-element UPDATE + REMOVE tools (S6) — the read-then-update loop that closes the
 * append-only gap in `add_planning_elements`. Orchestrator + connected tiers, flag-gated (the CALLER,
 * ServerFactory, only registers them when the host enables `planningWrite`; editing durable canvas
 * content is the same content-write gate as `add_planning_elements` / the Kanban card tools). Each op
 * writes attacker-influenceable CONTENT onto the durable canvas (ADR 0003), so the HOST resolves the
 * element by id, re-validates + sanitizes + caps the patch AGAINST the element's resolved kind, and
 * gates every op behind a mandatory write-time human confirm. Lengths are capped here as transport-layer
 * defence in depth; the host caps authoritatively. Passive content — an edited element renders on the
 * board, never auto-arms an action.
 */
export function registerPlanningEdit(server: McpServer, orchestrator: Orchestrator): void {
  const boardId = z.string().min(1)
  const elementId = z.string().min(1).max(MAX_PLANNING_ELEMENT_ID)

  server.registerTool(
    TOOL_UPDATE_PLANNING_ELEMENT,
    {
      description:
        'Edit ONE EXISTING element on a PLANNING board in place — the way to keep a plan LIVE instead ' +
        'of stacking a stale duplicate. First read canvas://board/{id}/planning to get each element id ' +
        '(and, for a checklist, its item ids); then supply boardId + elementId + only the fields you ' +
        'want to change. Which fields apply depends on the element kind: note → text and/or tint; text ' +
        '→ text; checklist → title, setItems (edit items by id: toggle done and/or relabel), addItems ' +
        '(append), removeItemIds (delete items by id); diagram → source (Mermaid engine) OR specOps ' +
        '(expanse engine: an ordered batch of incremental ops — upsertNode/removeNode/upsertEdge/' +
        'removeEdge/upsertGroup/removeGroup by slug id, setMeta for title/direction/theme; upserts ' +
        'are idempotent by id, the whole batch is one confirm + one undo step, and the host ' +
        'validates the RESULTING spec — read the current spec from canvas://board/{id}/planning ' +
        'and send the minimal delta); arrow → dx/dy. A ' +
        "field that doesn't match the element's kind is rejected. Human-confirmed before it lands; the " +
        'edit renders as passive content and never runs anything.',
      inputSchema: {
        boardId,
        elementId,
        // ── note / text ───────────────────────────────────────────────────────────
        text: z.string().min(1).max(MAX_PLANNING_TEXT).optional(),
        tint: z.enum(['yellow', 'blue', 'green', 'plain']).optional(),
        // ── checklist ─────────────────────────────────────────────────────────────
        title: z.string().min(1).max(MAX_PLANNING_TITLE).optional(),
        setItems: z
          .array(
            z.object({
              id: z.string().min(1).max(MAX_PLANNING_ELEMENT_ID),
              label: z.string().min(1).max(MAX_PLANNING_LABEL).optional(),
              done: z.boolean().optional()
            })
          )
          .max(MAX_PLANNING_ITEMS)
          .optional(),
        addItems: z
          .array(
            z.object({
              label: z.string().min(1).max(MAX_PLANNING_LABEL),
              done: z.boolean().optional()
            })
          )
          .max(MAX_PLANNING_ITEMS)
          .optional(),
        removeItemIds: z
          .array(z.string().min(1).max(MAX_PLANNING_ELEMENT_ID))
          .max(MAX_PLANNING_ITEMS)
          .optional(),
        // ── diagram (Mermaid engine) ──────────────────────────────────────────────
        source: z.string().min(1).max(MAX_PLANNING_DIAGRAM).optional(),
        // ── diagram (expanse engine, Phase 3) ─────────────────────────────────────
        specOps: specOpsArraySchema.optional(),
        // ── arrow ─────────────────────────────────────────────────────────────────
        dx: z.number().finite().optional(),
        dy: z.number().finite().optional()
      }
    },
    async (args) => {
      // `source` and `specOps` target different diagram ENGINES — never both in one patch
      // (transport-layer guard; the host rejects against the element's resolved engine anyway).
      if (args.source !== undefined && args.specOps !== undefined) {
        throw new Error('supply either "source" (Mermaid) or "specOps" (expanse), not both')
      }
      // Assemble the FLAT patch from only the present fields (the host requires ≥1 applicable field
      // and re-validates each against the resolved element's kind).
      const patch: PlanningElementPatch = {}
      if (args.text !== undefined) patch.text = args.text
      if (args.tint !== undefined) patch.tint = args.tint
      if (args.title !== undefined) patch.title = args.title
      if (args.setItems !== undefined) patch.setItems = args.setItems
      if (args.addItems !== undefined) patch.addItems = args.addItems
      if (args.removeItemIds !== undefined) patch.removeItemIds = args.removeItemIds
      if (args.source !== undefined) patch.source = args.source
      if (args.specOps !== undefined) patch.specOps = args.specOps
      if (args.dx !== undefined) patch.dx = args.dx
      if (args.dy !== undefined) patch.dy = args.dy
      await orchestrator.updatePlanningElement(args.boardId, args.elementId, patch)
      return {
        content: [{ type: 'text', text: `updated element ${args.elementId} on ${args.boardId}` }]
      }
    }
  )

  server.registerTool(
    TOOL_REMOVE_PLANNING_ELEMENT,
    {
      description:
        'Remove ONE element from a PLANNING board by id (from canvas://board/{id}/planning). Use this ' +
        'to delete a stray duplicate an older append-only write left behind. This is destructive and is ' +
        'human-confirmed before it lands.',
      inputSchema: { boardId, elementId }
    },
    async (args) => {
      await orchestrator.removePlanningElement(args.boardId, args.elementId)
      return {
        content: [{ type: 'text', text: `removed element ${args.elementId} from ${args.boardId}` }]
      }
    }
  )
}
