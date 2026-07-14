import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import {
  MAX_CARD_ASSIGNEE,
  MAX_CARD_DESCRIPTION,
  MAX_CARD_FILE_REF_PATH,
  MAX_CARD_FILE_REFS,
  MAX_CARD_ID,
  MAX_CARD_REF,
  MAX_CARD_TAG,
  MAX_CARD_TAGS,
  MAX_CARD_TITLE,
  MAX_COLUMN_ID,
  TOOL_ADD_CARD,
  TOOL_MOVE_CARD,
  TOOL_REMOVE_CARD,
  TOOL_UPDATE_CARD
} from '../../constants'

/**
 * Register the Kanban card WRITE tools (P3) — `add_card` / `move_card` / `update_card` /
 * `remove_card`. Orchestrator + connected tiers, flag-gated (the CALLER, ServerFactory, only
 * registers them when the host enables `planningWrite`; a Kanban board is a plan surface, same
 * content-write gate as `add_planning_elements`). Each op writes attacker-influenceable CONTENT onto
 * the durable canvas (ADR 0003), so the HOST re-validates + sanitizes + caps and gates every op
 * behind a mandatory write-time human confirm. The card content is untrusted passive context: it
 * renders on the board, never auto-arms an action. Lengths are capped here as transport-layer
 * defence in depth; the host caps authoritatively.
 */
export function registerKanbanCards(server: McpServer, orchestrator: Orchestrator): void {
  const boardId = z.string().min(1)
  const cardId = z.string().min(1).max(MAX_CARD_ID)
  const columnId = z.string().min(1).max(MAX_COLUMN_ID)
  const title = z.string().min(1).max(MAX_CARD_TITLE)
  const tag = z.string().min(1).max(MAX_CARD_TAG).optional()
  const assignee = z.string().min(1).max(MAX_CARD_ASSIGNEE).optional()
  const ref = z.string().min(1).max(MAX_CARD_REF).optional()
  // v19 card-detail fields (agent read/write of the fields #345 added for humans). All OPTIONAL +
  // additive. `description` is a multi-line body; `tags` is the plural list (supersedes `tag`);
  // `fileRefs` is a bounded list of {path, line?, endLine?} pointers. The HOST re-validates + caps.
  const description = z.string().min(1).max(MAX_CARD_DESCRIPTION).optional()
  const tags = z.array(z.string().min(1).max(MAX_CARD_TAG)).max(MAX_CARD_TAGS).optional()
  const fileRefs = z
    .array(
      z.object({
        path: z.string().min(1).max(MAX_CARD_FILE_REF_PATH),
        line: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional()
      })
    )
    .max(MAX_CARD_FILE_REFS)
    .optional()

  server.registerTool(
    TOOL_ADD_CARD,
    {
      description:
        'Add ONE card to a column of a KANBAN board. boardId must be an existing kanban board id ' +
        '(from spawn_board or canvas://boards); columnId is a column on that board — the default ' +
        'lanes are "backlog", "in-progress", "review", "done". title is the card text; tag (a short ' +
        'status/type chip, e.g. "feature"), assignee (an agent id, e.g. "claude"), and ref (an ' +
        'external reference, e.g. "PR #271") are optional. RICH detail (all optional): description (a ' +
        'long-form multi-line body shown in the card modal), tags (an array of label chips — the plural ' +
        'that supersedes the singular tag), and fileRefs (files the card touches — an array of ' +
        '{path, line?, endLine?}, path project-root-relative). Returns the new card id — use it with ' +
        'move_card/update_card/remove_card. Every write is shown to the human for confirmation ' +
        'before it lands; a card renders as passive content and never runs anything.',
      inputSchema: { boardId, columnId, title, tag, assignee, ref, description, tags, fileRefs }
    },
    async (args) => {
      const { id } = await orchestrator.addCard(args.boardId, {
        columnId: args.columnId,
        title: args.title,
        ...(args.tag !== undefined ? { tag: args.tag } : {}),
        ...(args.assignee !== undefined ? { assignee: args.assignee } : {}),
        ...(args.ref !== undefined ? { ref: args.ref } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.tags !== undefined ? { tags: args.tags } : {}),
        ...(args.fileRefs !== undefined ? { fileRefs: args.fileRefs } : {})
      })
      return { content: [{ type: 'text', text: `added card ${id} to ${args.columnId}` }] }
    }
  )

  server.registerTool(
    TOOL_MOVE_CARD,
    {
      description:
        'Move an existing card to another column on the same KANBAN board (e.g. advance it from ' +
        '"in-progress" to "review"). cardId is the id returned by add_card; toColumnId is a column ' +
        'on the board. Human-confirmed before it lands.',
      inputSchema: { boardId, cardId, toColumnId: columnId }
    },
    async (args) => {
      await orchestrator.moveCard(args.boardId, args.cardId, args.toColumnId)
      return {
        content: [{ type: 'text', text: `moved card ${args.cardId} to ${args.toColumnId}` }]
      }
    }
  )

  server.registerTool(
    TOOL_UPDATE_CARD,
    {
      description:
        "Update an existing KANBAN card's title / tag / assignee / ref / description / tags / " +
        'fileRefs. Only the fields you pass change; supply at least one. tags (the plural array) ' +
        'REPLACES the card\'s chips and supersedes the singular tag; fileRefs (array of ' +
        '{path, line?, endLine?}) REPLACES the card\'s file references; description sets the modal ' +
        'body. cardId is the id returned by add_card. Human-confirmed before it lands.',
      inputSchema: {
        boardId,
        cardId,
        title: title.optional(),
        tag,
        assignee,
        ref,
        description,
        tags,
        fileRefs
      }
    },
    async (args) => {
      await orchestrator.updateCard(args.boardId, args.cardId, {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.tag !== undefined ? { tag: args.tag } : {}),
        ...(args.assignee !== undefined ? { assignee: args.assignee } : {}),
        ...(args.ref !== undefined ? { ref: args.ref } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.tags !== undefined ? { tags: args.tags } : {}),
        ...(args.fileRefs !== undefined ? { fileRefs: args.fileRefs } : {})
      })
      return { content: [{ type: 'text', text: `updated card ${args.cardId}` }] }
    }
  )

  server.registerTool(
    TOOL_REMOVE_CARD,
    {
      description:
        'Remove a card from a KANBAN board. cardId is the id returned by add_card. This is ' +
        'destructive and is human-confirmed before it lands.',
      inputSchema: { boardId, cardId }
    },
    async (args) => {
      await orchestrator.removeCard(args.boardId, args.cardId)
      return { content: [{ type: 'text', text: `removed card ${args.cardId}` }] }
    }
  )
}
