import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../orchestrator/Orchestrator'
import { registerBoardStatesResource } from './boardStates'
import { registerAttentionResource } from './attention'
import { registerBoardOutputResource } from './output'
import { registerBoardResultResource } from './result'
import { registerMemoryResources } from './memory'
import { assertBoardReadable, scopeBoardList, type ResourceScope } from './scope'

/**
 * Registers the read-only board observation resources. Available to EVERY tier, but
 * 🔒 READ-SCOPED per session (audit Phase A): a WORKER session sees only its own
 * board — the list resources are filtered to it and every `canvas://board/{id}/…`
 * read of another board is refused (see {@link ResourceScope} for the rationale).
 * orchestrator / lead / connected read everything (they already hold spawn+dispatch).
 *
 * - `canvas://boards` — the board list (id/type/title + coarse status bucket).
 * - `canvas://board/{id}/status` — one board's coarse status bucket (T1.1). The
 *   bucket is derived host-side from the live runtime (terminal PTY + browser load
 *   state) and is the same value an agent sees in `canvas://boards` and a human sees
 *   on the board's on-canvas status pill — one source of truth.
 * - `canvas://board/{id}/cards` — one Kanban board's columns + cards (P3b), grouped
 *   host-side. The read half of the card mutation loop; a non-kanban board reads an
 *   empty shell.
 */
export function registerBoardResources(
  server: McpServer,
  orchestrator: Orchestrator,
  scope: ResourceScope
): void {
  server.registerResource(
    'boards',
    'canvas://boards',
    { description: 'List of boards currently on the canvas.', mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(scopeBoardList(scope, await orchestrator.listBoards()))
        }
      ]
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
      assertBoardReadable(scope, id, 'canvas://board/{id}/status')
      const status = await orchestrator.boardStatus(id)
      return { contents: [{ uri: uri.href, text: JSON.stringify({ id, status }) }] }
    }
  )

  server.registerResource(
    'board-cards',
    new ResourceTemplate('canvas://board/{id}/cards', { list: undefined }),
    {
      description:
        "One Kanban board's columns + cards (read-only), grouped by column. A non-kanban board " +
        'reads the empty shell { boardId, title, isKanban: false, columns: [] }.',
      mimeType: 'application/json'
    },
    async (uri, variables) => {
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id
      if (!id) throw new Error('canvas://board/{id}/cards: missing board id')
      assertBoardReadable(scope, id, 'canvas://board/{id}/cards')
      const cards = await orchestrator.boardCards(id)
      return { contents: [{ uri: uri.href, text: JSON.stringify(cards) }] }
    }
  )

  server.registerResource(
    'board-planning',
    new ResourceTemplate('canvas://board/{id}/planning', { list: undefined }),
    {
      description:
        "One Planning board's elements + their ids (read-only) — notes, text, checklists (with item " +
        'ids + done state), diagrams, arrows. READ this to learn each element id BEFORE editing it in ' +
        'place (update_planning_element / remove_planning_element) instead of re-adding a duplicate. A ' +
        'non-planning board reads the empty shell { boardId, title, isPlanning: false, elements: [] }.',
      mimeType: 'application/json'
    },
    async (uri, variables) => {
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id
      if (!id) throw new Error('canvas://board/{id}/planning: missing board id')
      assertBoardReadable(scope, id, 'canvas://board/{id}/planning')
      const planning = await orchestrator.boardPlanning(id)
      return { contents: [{ uri: uri.href, text: JSON.stringify(planning) }] }
    }
  )

  registerBoardStatesResource(server, orchestrator, scope)
  registerAttentionResource(server, orchestrator, scope)
  registerBoardOutputResource(server, orchestrator, scope)
  registerBoardResultResource(server, orchestrator, scope)
  registerMemoryResources(server, orchestrator, scope)
}
