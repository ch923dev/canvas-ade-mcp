import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../orchestrator/Orchestrator'

/**
 * Registers the read-only `canvas://boards` resource (board list). Available to
 * both tiers — observation is safe. Richer board resources land in later phases.
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
}
