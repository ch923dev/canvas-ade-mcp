import { z } from 'zod'
import {
  MAX_DIAGRAM_SPEC_BYTES,
  MAX_SPEC_OPS,
  SPEC_DETAIL_MAX,
  SPEC_EDGE_LABEL_MAX,
  SPEC_HREF_FILE_MAX,
  SPEC_ICON_MAX,
  SPEC_ID_MAX,
  SPEC_LABEL_MAX,
  SPEC_MAX_EDGES,
  SPEC_MAX_GROUPS,
  SPEC_MAX_NODES,
  SPEC_THEME_MAX,
  SPEC_TITLE_MAX
} from '../constants'

/**
 * Transport-layer zod schemas for the structured DiagramSpec (`engine:'expanse'`) — diagram
 * Phase 3 (MCP contract v2). Shape + caps + closed enums ONLY: referential integrity (dangling
 * edge endpoints / group refs, duplicate ids) and the authoritative byte measure live host-side
 * in expanse-desktop's `assertDiagramSpec` (`src/renderer/src/lib/diagramSpec.ts`), which the
 * host runs on every write regardless. Keeping the deep semantics in ONE place (the host) is
 * deliberate — this layer only stops obviously-malformed payloads before they cross the wire.
 *
 * The closed vocabularies (status / node kind / edge kind) mirror the host's exactly. An unknown
 * value is REJECTED, not coerced: a newer vocabulary is a newer contract version, and silently
 * passing it through would let a wire ack succeed on a payload the host must then refuse.
 */

/** Slug charset for every spec id — mirrors the host's `ID_RE` (stable, diffable, DOM-safe). */
export const SPEC_ID_RE = /^[A-Za-z0-9._-]+$/

export const SPEC_STATUSES = ['neutral', 'active', 'done', 'error', 'warn', 'muted'] as const
export const SPEC_NODE_KINDS = [
  'step',
  'decision',
  'data',
  'service',
  'artifact',
  'actor',
  'note'
] as const
export const SPEC_EDGE_KINDS = ['flow', 'data', 'dependency'] as const

const specId = z.string().min(1).max(SPEC_ID_MAX).regex(SPEC_ID_RE)
const specStatus = z.enum(SPEC_STATUSES)

export const specNodeSchema = z.object({
  id: specId,
  label: z.string().min(1).max(SPEC_LABEL_MAX),
  detail: z.string().max(SPEC_DETAIL_MAX).optional(),
  kind: z.enum(SPEC_NODE_KINDS).optional(),
  status: specStatus.optional(),
  icon: z.string().max(SPEC_ICON_MAX).optional(),
  group: specId.optional(),
  pos: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
  href: z
    .object({
      file: z.string().min(1).max(SPEC_HREF_FILE_MAX),
      line: z.number().int().positive().optional()
    })
    .optional()
})

export const specEdgeSchema = z.object({
  id: specId,
  from: specId,
  to: specId,
  label: z.string().max(SPEC_EDGE_LABEL_MAX).optional(),
  kind: z.enum(SPEC_EDGE_KINDS).optional(),
  status: specStatus.optional(),
  animated: z.boolean().optional()
})

export const specGroupSchema = z.object({
  id: specId,
  label: z.string().min(1).max(SPEC_LABEL_MAX),
  collapsed: z.boolean().optional(),
  status: specStatus.optional()
})

/**
 * One full DiagramSpec on the wire. `version` is the SPEC's own literal version (the host
 * migrates inside the element on a future spec v2 — independent of the document schema).
 * The byte refine enforces {@link MAX_DIAGRAM_SPEC_BYTES} on the serialized payload — the
 * confirm-reviewability bound; the host re-measures authoritatively.
 */
export const diagramSpecSchema = z
  .object({
    version: z.literal(1),
    title: z.string().max(SPEC_TITLE_MAX).optional(),
    direction: z.enum(['right', 'down']),
    theme: z.string().min(1).max(SPEC_THEME_MAX).optional(),
    nodes: z.array(specNodeSchema).max(SPEC_MAX_NODES),
    edges: z.array(specEdgeSchema).max(SPEC_MAX_EDGES),
    groups: z.array(specGroupSchema).max(SPEC_MAX_GROUPS).optional()
  })
  .refine((spec) => JSON.stringify(spec).length <= MAX_DIAGRAM_SPEC_BYTES, {
    message: `diagram spec exceeds ${MAX_DIAGRAM_SPEC_BYTES} serialized bytes`
  })

/**
 * One incremental spec op (`update_planning_element.specOps`) — the read-then-update loop for
 * structured diagrams. Upserts are idempotent by slug id; ops apply IN ORDER host-side against
 * the element's current spec, and the whole batch is ONE human confirm + ONE undo step. The host
 * validates the RESULTING spec with its authoritative validator (so an op batch can never land
 * a spec the emit path would reject).
 */
export const specOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('upsertNode'), node: specNodeSchema }),
  z.object({ op: z.literal('removeNode'), id: specId }),
  z.object({ op: z.literal('upsertEdge'), edge: specEdgeSchema }),
  z.object({ op: z.literal('removeEdge'), id: specId }),
  z.object({ op: z.literal('upsertGroup'), group: specGroupSchema }),
  z.object({ op: z.literal('removeGroup'), id: specId }),
  z.object({
    op: z.literal('setMeta'),
    title: z.string().max(SPEC_TITLE_MAX).optional(),
    direction: z.enum(['right', 'down']).optional(),
    theme: z.string().min(1).max(SPEC_THEME_MAX).optional()
  })
])

export const specOpsArraySchema = z.array(specOpSchema).min(1).max(MAX_SPEC_OPS)
