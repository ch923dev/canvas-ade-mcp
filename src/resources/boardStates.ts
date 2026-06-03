import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BoardSummary, Orchestrator } from '../orchestrator/Orchestrator'
import type { BoardId } from '../types'

/**
 * Roll up a board list into `{ statusBucket: BoardId[] }`, preserving board order
 * within each bucket and omitting buckets with no boards. The compact "who is in
 * which state" view — counts are `array.length`; full per-board detail stays in
 * `canvas://boards`.
 */
export function groupBoardsByStatus(boards: BoardSummary[]): Record<string, BoardId[]> {
  const grouped: Record<string, BoardId[]> = {}
  for (const b of boards) {
    ;(grouped[b.status] ??= []).push(b.id)
  }
  return grouped
}

/**
 * Registers the read-only `canvas://board-states` roll-up resource (both tiers —
 * observation is safe). Lets an orchestrator see the swarm's shape at a glance
 * (how many boards are running / blocked / failed) without paging the full list.
 */
export function registerBoardStatesResource(server: McpServer, orchestrator: Orchestrator): void {
  server.registerResource(
    'board-states',
    'canvas://board-states',
    {
      description: 'Boards on the canvas grouped by status bucket ({ bucket: boardId[] }).',
      mimeType: 'application/json'
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(groupBoardsByStatus(await orchestrator.listBoards()))
        }
      ]
    })
  )
}
