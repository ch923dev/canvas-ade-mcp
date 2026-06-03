import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../orchestrator/Orchestrator'

/**
 * Registers the read-only project-memory resources (T1.7 — both tiers; 🔒 PASSIVE
 * context only, these expose no action):
 *   - `canvas://memory`               — the project memory index.
 *   - `canvas://board/{id}/summary`   — a board's memory summary.
 * Backed by the sibling Brain/Memory engine's `.canvas/memory/`. When that subsystem
 * is absent (it ships on a separate track), each resource returns the empty shell
 * `{ present: false, text: '' }` — graceful, never an error.
 */
export function registerMemoryResources(server: McpServer, orchestrator: Orchestrator): void {
  server.registerResource(
    'memory',
    'canvas://memory',
    {
      description: 'Project memory index (passive context). Empty shell when no memory exists.',
      mimeType: 'application/json'
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(await orchestrator.projectMemory()) }]
    })
  )

  server.registerResource(
    'board-summary',
    new ResourceTemplate('canvas://board/{id}/summary', { list: undefined }),
    {
      description: "A board's memory summary (passive context). Empty shell when none exists.",
      mimeType: 'application/json'
    },
    async (uri, variables) => {
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id
      if (!id) throw new Error('canvas://board/{id}/summary: missing board id')
      return { contents: [{ uri: uri.href, text: JSON.stringify(await orchestrator.boardSummary(id)) }] }
    }
  )
}
