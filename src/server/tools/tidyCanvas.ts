import { z } from 'zod'
import type { McpServer } from "@modelcontextprotocol/server";
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import { TIDY_MODES, TOOL_TIDY_CANVAS } from '../../constants'

/**
 * Register the `tidy_canvas` tool (P2) — reposition the whole canvas into a clean, non-overlapping
 * arrangement via the app's deterministic packer. The CALLER (ServerFactory) gates this to the
 * ORCHESTRATOR tier by only invoking `registerTidyCanvas` for that tier; a worker/connected
 * `tools/list` never contains it. Orchestrator-only is deliberate: repositioning the whole canvas is
 * an orchestrator-scope act — a single connected worker shouldn't rearrange everyone else's boards.
 *
 * 🔒 Content-less + reposition-only: the host only MOVES boards that already exist (never resizes,
 * creates, or deletes one — the packer guarantees this), so — like `spawn_group` — it carries no exec
 * vector and no text, and it is NOT human-gated (the write-time confirm stays on content writes). It
 * is also fully reversible in ONE Ctrl+Z (the host's `tidyBoards` action is a single undoable step).
 * This tool is the thin transport: validate the mode, forward to {@link Orchestrator.tidyCanvas},
 * surface the moved count as JSON (`{ moved }` — 0 ⇒ the canvas was already tidy).
 */
export function registerTidyCanvas(server: McpServer, orchestrator: Orchestrator): void {
  server.registerTool(
    TOOL_TIDY_CANVAS,
    {
      description:
        'Tidy the whole canvas: reposition every board into a clean, non-overlapping arrangement ' +
        'using the deterministic packer. Orchestrator-tier only. Reposition-only — it never resizes, ' +
        'creates, or deletes a board — and is fully reversible in one undo. Pick a mode: "smart" ' +
        '(link-aware, the default), "by-type", or "grid". Returns { moved } — the count of boards ' +
        'whose position changed (0 ⇒ the canvas was already tidy). Read canvas://layout first to ' +
        'decide whether a tidy is warranted.',
      inputSchema: z.object({
              mode: z.enum(TIDY_MODES).optional()
            })
    },
    async (args) => {
      const result = await orchestrator.tidyCanvas({ mode: args.mode })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  )
}
