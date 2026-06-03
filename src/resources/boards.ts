import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../orchestrator/Orchestrator'
import { registerBoardStatesResource } from './boardStates'
import { registerAttentionResource } from './attention'
import { registerBoardOutputResource } from './output'

/**
 * Registers the read-only board observation resources. Available to BOTH tiers —
 * observation is safe (no write, no cross-agent influence):
 *
 * - `canvas://boards` — the full board list (id/type/title + coarse status bucket).
 * - `canvas://board/{id}/status` — one board's coarse status bucket (T1.1). The
 *   bucket is derived host-side from the live runtime (terminal PTY + browser load
 *   state) and is the same value an agent sees in `canvas://boards` and a human sees
 *   on the board's on-canvas status pill — one source of truth.
 */
export function registerBoardResources(server: McpServer, orchestrator: Orchestrator): void {
  server.registerResource(
    'boards',
    'canvas://boards',
    { description: 'List of boards currently on the canvas.', mimeType: 'application/json' },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(await orchestrator.listBoards()) }]
    })
  )

  server.registerResource(
    'board-status',
    new ResourceTemplate('canvas://board/{id}/status', { list: undefined }),
    {
      description:
        "A single board's coarse status bucket (idle/running/awaiting-review/blocked/failed/static).",
      mimeType: 'application/json'
    },
    async (uri, variables) => {
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id
      if (!id) throw new Error('canvas://board/{id}/status: missing board id')
      const status = await orchestrator.boardStatus(id)
      return { contents: [{ uri: uri.href, text: JSON.stringify({ id, status }) }] }
    }
  )

  registerBoardStatesResource(server, orchestrator)
  registerAttentionResource(server, orchestrator)
  registerBoardOutputResource(server, orchestrator)
}
