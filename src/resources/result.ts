import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../orchestrator/Orchestrator'

/**
 * Registers the read-only `canvas://board/{id}/result` resource (T1.5 — both tiers;
 * observation is safe). Returns a board's STRUCTURED last result (a verdict + summary
 * + references, not raw logs — raw scrollback is `canvas://board/{id}/output`). v1 is
 * an observational shell: every board reads `{ present: false }` until M4's
 * `write_result` lets a worker record one; the resource shape is stable across that.
 */
export function registerBoardResultResource(server: McpServer, orchestrator: Orchestrator): void {
  server.registerResource(
    'board-result',
    new ResourceTemplate('canvas://board/{id}/result', { list: undefined }),
    {
      description:
        "A board's structured last result (verdict + summary + references, not raw logs). Empty shell until a result is recorded.",
      mimeType: 'application/json'
    },
    async (uri, variables) => {
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id
      if (!id) throw new Error('canvas://board/{id}/result: missing board id')
      const result = await orchestrator.boardResult(id)
      return { contents: [{ uri: uri.href, text: JSON.stringify(result) }] }
    }
  )
}
