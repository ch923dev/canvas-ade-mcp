import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import type { SessionCtx } from '../factory'
import { TIDY_MODES, TIDY_OVERFLOW, TILE_TEMPLATES, TOOL_TIDY_CANVAS } from '../../constants'
import { callerSource, spatialIdSchema } from './spatialShared'

/** Modes under which the roles-only fields (`primary`, `resize`) apply: an explicit `roles`, or an
 *  omitted mode — which the host resolves to an IMPLICIT `roles` (D8 a). */
const rolesApplies = (mode: string | undefined): boolean => mode === undefined || mode === 'roles'

/**
 * The `tidy_canvas` wire schema (C6).
 *
 * 🔒 D8 (a): `mode` is `.optional()` and NEVER `.default()`ed. An omitted mode must reach the host as
 * `undefined`: the host reads that as an IMPLICIT `roles` (a unit of plain shells keeps its sizes,
 * position-only) and has to tell it apart from an explicit `mode:'roles'`, which never falls back. The
 * default lives in the tool DESCRIPTION, not in the schema. Same for `fit` (host default true).
 *
 * Cross-field rules (a refinement, so `tools/list` still shows a plain object schema):
 * - `template` is REQUIRED iff `mode === 'tile'`, and rejected with any other (or no) mode.
 * - `primary` / `resize` are roles-only: accepted with `mode:'roles'` or an omitted mode, REJECTED with
 *   any other explicit mode — silently ignoring them would tell the agent it steered a layout it
 *   did not.
 */
const tidyCanvasInputSchema = z
  .object({
    mode: z.enum(TIDY_MODES).optional(),
    template: z.enum(TILE_TEMPLATES).optional(),
    scope: z.union([z.enum(['all', 'visible']), z.object({ groupId: spatialIdSchema })]).optional(),
    overflow: z.enum(TIDY_OVERFLOW).optional(),
    fit: z.boolean().optional(),
    primary: spatialIdSchema.optional(),
    resize: z.boolean().optional()
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'tile' && v.template === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['template'],
        message: `template is required when mode is 'tile' (one of: ${TILE_TEMPLATES.join(', ')})`
      })
    }
    if (v.mode !== 'tile' && v.template !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['template'],
        message: "template is only valid with mode 'tile'"
      })
    }
    if (!rolesApplies(v.mode)) {
      for (const field of ['primary', 'resize'] as const) {
        if (v[field] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} is roles-only: use it with mode 'roles' or omit mode (got mode '${v.mode}')`
          })
        }
      }
    }
  })

const DESCRIPTION =
  "Arrange the canvas so its boards fit the user's screen. The whole arrangement is ONE undo step. " +
  'MODE — omit it for the default: the host arranges BY ROLE (the lead or browser gets the big slot, ' +
  'linked boards sit beside it) and falls back to "fit" for groups of plain shells. Explicit modes: ' +
  '"roles" (always role-aware, never falls back), "fit" (keep groups together and fit the window), ' +
  '"smart" (link-aware), "by-type" (terminal / browser / planning columns), "grid" (shelf pack), ' +
  `"tile" (fill the pane with a template — REQUIRES template: ${TILE_TEMPLATES.join(' | ')}; ` +
  'template is rejected with any other mode). ' +
  'WHAT MOVES — positions only, EXCEPT: "tile" and overflow "shrink" resize boards, and "roles" ' +
  '(and the default) resizes flexible boards (terminal, swarm, command, data-flow) to their slot, ' +
  'scales browser previews with their device aspect locked, and never resizes planning, kanban or ' +
  'file boards. Nothing is created or deleted. ' +
  'OPTIONS — scope: "all" (omitted ⇒ the whole canvas) | "visible" (only what is on screen) | ' +
  '{ groupId } (one Named Group). overflow, when everything cannot be readable on one screen: ' +
  '"report" (default — arrange anyway and return readable:false), "pages" (screen-sized pages laid ' +
  'left to right), "shrink" (scale boards down until readable). fit: reframe the camera on the result ' +
  '(default true). primary (a board id to force as the hero) and resize:false (keep the role order ' +
  'but resize nothing) are roles-only: accepted with mode "roles" or no mode, rejected otherwise. ' +
  'RETURNS { moved, fitZoom, readable, pages?, units? } — moved = boards repositioned (0 ⇒ already ' +
  'tidy); readable = everything is legible at fitZoom; pages with overflow "pages"; units (roles) = ' +
  '[{ scene, heroIds, why }]. ' +
  'WHEN — read canvas://layout first: if fit.readable is false, tidy (the default or "fit"), or ' +
  'focus_viewport one group instead. From a lead or connected terminal the user approves the tidy ' +
  'first; a declined tidy changes nothing.'

/**
 * Register the `tidy_canvas` tool (P2, widened 0.27.0 / C6). The CALLER (ServerFactory) registers it
 * for the ORCHESTRATOR, LEAD and CONNECTED tiers (D1); a worker `tools/list` never contains it.
 *
 * 🔒 Gate (D1): the tool binds a lead/connected caller's token-derived board id as `sourceBoardId`
 * ({@link callerSource}); the HOST raises ONE approve/deny confirm when it is present. Orchestrator-tier
 * calls carry no `sourceBoardId` and stay un-gated (today's behaviour). The host's `tidyBoards` is a
 * single undoable step in every mode.
 *
 * Thin transport: validate (enums + the cross-field refinement above), forward every supplied field
 * verbatim — never inventing a default — and surface the host's result as JSON.
 */
export function registerTidyCanvas(
  server: McpServer,
  orchestrator: Orchestrator,
  opts: { ctx?: SessionCtx } = {}
): void {
  server.registerTool(
    TOOL_TIDY_CANVAS,
    { description: DESCRIPTION, inputSchema: tidyCanvasInputSchema },
    async (args) => {
      const result = await orchestrator.tidyCanvas({ ...args, ...callerSource(opts.ctx) })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  )
}
