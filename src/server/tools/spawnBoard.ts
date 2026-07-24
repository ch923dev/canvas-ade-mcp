import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Orchestrator, PlanningElementSpec } from '../../orchestrator/Orchestrator'
import type { SessionCtx } from '../factory'
import {
  SPAWN_BOARD_MAX_PROMPT,
  SPAWN_BOARD_MAX_TITLE,
  SPAWN_BOARD_MAX_URL,
  SPAWNABLE_BOARD_TYPES,
  TOOL_SPAWN_BOARD
} from '../../constants'
import { planningElementsArraySchema } from './addPlanningElements'

/**
 * Register the `spawn_board` lifecycle tool (T3.1) — the first WRITE tool. The
 * CALLER (ServerFactory) gates this to the orchestrator tier by only invoking
 * `registerSpawnBoard` for that tier; a worker's `tools/list` never contains it.
 * The closed `type` enum is the input-validation guard: an unknown type is
 * rejected by the SDK's schema check BEFORE the orchestrator is ever called, so a
 * bad type can never reach the host's board factory.
 *
 * The orchestrator (Canvas ADE MAIN) mints the board id and drives the canvas via
 * the command channel; the tool just surfaces that server-issued id to the agent.
 *
 * When `opts.planningWrite` is set (the same host flag that exposes
 * `add_planning_elements`, S2), spawn_board ALSO accepts an optional `seed` — a batch of
 * planning elements to populate a freshly-spawned `planning` board in ONE call. The seed
 * rides the SAME host write-confirm as `add_planning_elements` (the seed is only applied
 * after the human approves the content); a non-planning target with a seed is rejected
 * BEFORE any spawn. The seed key is absent from the schema entirely when the flag is off.
 */
export function registerSpawnBoard(
  server: McpServer,
  orchestrator: Orchestrator,
  opts: { planningWrite?: boolean; ctx?: SessionCtx } = {}
): void {
  const inputSchema = {
    type: z.enum(SPAWNABLE_BOARD_TYPES),
    // rc.6: prompt is the TERMINAL's spawn-time launch command (first PTY line). The host
    // re-sanitizes + re-clamps authoritatively; the wire `.max` rejects an oversize prompt
    // before the host is called (the write_result C3 discipline).
    prompt: z.string().max(SPAWN_BOARD_MAX_PROMPT).optional(),
    cwd: z.string().optional(),
    // 2b: optional display name for the new board (else the host's per-type default). The host
    // re-sanitizes + re-clamps; the wire `.max` rejects an over-long title before the host is called.
    title: z.string().max(SPAWN_BOARD_MAX_TITLE).optional(),
    // H3: url is the BROWSER's initial page. http/https enforced at the wire (`.url()` + protocol
    // refine); the host re-validates authoritatively (the preview URL bar's own rules apply).
    url: z
      .string()
      .max(SPAWN_BOARD_MAX_URL)
      .url()
      .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
        message: 'url must be http(s)'
      })
      .optional(),
    // Only offer `seed` when the host has enabled the planning-write path (S2).
    ...(opts.planningWrite ? { seed: planningElementsArraySchema.optional() } : {})
  }
  server.registerTool(
    TOOL_SPAWN_BOARD,
    {
      description:
        'Create a new board on the canvas. type is one of terminal | browser | planning. ' +
        'Terminal only: optional prompt — a SINGLE command line the new terminal runs as its ' +
        'first PTY line on spawn (e.g. an agent CLI like `claude`; the host sanitizes it to one ' +
        'line, strips control chars, and clamps to 400) — and optional cwd (spawn working ' +
        'directory; a missing/invalid path falls back to the user home directory; never ' +
        'executed). prompt/cwd with a non-terminal type is an error (no board is created). ' +
        'The launched agent boots ASYNCHRONOUSLY — deliver its task via assign_prompt / ' +
        'relay_prompt, which wait for the terminal to be ready. ' +
        'Browser only: optional url — the http(s) page the new browser board loads instead of ' +
        'the default; url with a non-browser type is an error. ' +
        'Optional title: a short display name for the new board (else a generic per-type default). ' +
        (opts.planningWrite
          ? 'Optional seed (planning only): structured elements to populate the new board in one ' +
            'call, shown to the human for confirmation before they land. '
          : '') +
        'Returns the new board id. Subject to a concurrency cap.',
      inputSchema
    },
    async (args) => {
      const seed = (args as { seed?: unknown }).seed as PlanningElementSpec[] | undefined
      // A seed is only meaningful for a planning board — reject a mismatch BEFORE spawning so
      // the canvas is never left with an empty board the agent can't populate.
      if (seed && seed.length > 0 && args.type !== 'planning') {
        return {
          isError: true,
          content: [{ type: 'text', text: 'spawn_board: seed is only valid for a planning board' }]
        }
      }
      // rc.6: prompt/cwd are terminal-only — reject a mismatch at the wire too (defense in depth
      // over the host's own pre-side-effect gate), mirroring the seed check above.
      if ((args.prompt !== undefined || args.cwd !== undefined) && args.type !== 'terminal') {
        return {
          isError: true,
          content: [
            { type: 'text', text: 'spawn_board: prompt/cwd are only valid for a terminal board' }
          ]
        }
      }
      // H3: url is browser-only — same pre-spawn mismatch discipline as prompt/cwd/seed.
      if (args.url !== undefined && args.type !== 'browser') {
        return {
          isError: true,
          content: [{ type: 'text', text: 'spawn_board: url is only valid for a browser board' }]
        }
      }
      const { id } = await orchestrator.spawnBoard({
        type: args.type,
        prompt: args.prompt,
        cwd: args.cwd,
        title: args.title,
        url: args.url,
        // 🔒 Auto-cable (rc.6; lead added in Phase 1): a CONNECTED- or LEAD-tier terminal
        // spawning a board passes its own token-derived id — never client input, so it cannot be
        // forged — and the host creates a directed orchestration connector spawner→spawned
        // alongside the board, authorizing follow-up relay/assign dispatch into it.
        // Orchestrator-tier spawns pass nothing (the 'app' command board dispatches via
        // assign/handoff, which need no cable).
        ...((opts.ctx?.tier === 'connected' || opts.ctx?.tier === 'lead') && opts.ctx.boardId
          ? { sourceBoardId: opts.ctx.boardId }
          : {})
      })
      // Apply the seed through the SAME confirmed write path as add_planning_elements. A
      // decline throws there → surface it as an isError result (the board still exists, just
      // empty), so the agent learns the content was not written.
      if (seed && seed.length > 0) {
        try {
          await orchestrator.addPlanningElements(id, { elements: seed })
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `spawn_board: created ${id} but the seed was not written: ${
                  err instanceof Error ? err.message : String(err)
                }`
              }
            ]
          }
        }
      }
      // content[0] stays the bare id (back-compat with okText-style parsers + existing e2e);
      // a prompt-carrying spawn appends an honest note — the command is QUEUED as the first PTY
      // line of an asynchronously-booting terminal, not already executed.
      return {
        content: [
          { type: 'text' as const, text: id },
          ...(args.prompt
            ? [
                {
                  type: 'text' as const,
                  text: 'launch command queued: runs as the first line of the new terminal (the agent boots asynchronously — dispatch its task via assign_prompt/relay_prompt)'
                }
              ]
            : [])
        ]
      }
    }
  )
}
