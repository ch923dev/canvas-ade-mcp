import type { McpServer } from '@modelcontextprotocol/server'
import type { Orchestrator } from '../orchestrator/Orchestrator'

/**
 * Register the `canvas://layout` resource (P1b) — the read-only SPATIAL digest of the canvas: the
 * union bounding box, each placed board's world-space geometry (+ group membership), overlapping
 * pairs, and a coarse arrangement (`row`/`column`/`grid`/`scattered`). It is the "smart grid" fuel:
 * an orchestrator reads it to decide whether to tidy, which orientation to propose, and where a new
 * plan/Kanban should land in open space — reasoning over STRUCTURE instead of raw coordinates.
 *
 * ORCHESTRATOR + LEAD + CONNECTED tiers (D1, 0.27.0 — widened from orchestrator-only): the CALLER
 * (ServerFactory) registers it in each of those tier blocks, beside `tidy_canvas` / `focus_viewport`,
 * because an agent the user talks to must be able to see whether the canvas fits the screen before it
 * proposes a tidy. A worker `resources/list` never contains it (structural split; `canvas://app-model`
 * stays orchestrator-only).
 *
 * The handler is the thin transport: call {@link Orchestrator.describeLayout} (which wraps the host's
 * `buildLayoutDigest` over the loopback wire) and serialize the result as JSON — analogous to
 * `canvas://app-model`. The `LayoutDigest` shape is host-owned, so this resource carries no
 * compile-time dependency on it (typed `unknown`, like `describeApp`).
 */
export function registerLayoutResource(server: McpServer, orchestrator: Orchestrator): void {
  server.registerResource(
    'layout',
    'canvas://layout',
    {
      description:
        'Read-only spatial digest of the canvas: bounding box, per-board geometry + group, ' +
        'overlapping pairs, and a coarse row/column/grid/scattered arrangement. Orchestrator, lead ' +
        'and connected tiers.',
      mimeType: 'application/json'
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(await orchestrator.describeLayout()) }]
    })
  )
}
