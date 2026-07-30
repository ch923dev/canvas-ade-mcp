import { z } from 'zod'
import type { McpServer } from "@modelcontextprotocol/server";
import type { Orchestrator } from '../../orchestrator/Orchestrator'
import { TOOL_GIT_DIFF } from '../../constants'

/**
 * Register the `git_diff` READ tool (PR-2b) — return a terminal board's read-only
 * working-tree diff so the orchestrator can roll up "what changed" per worker (the
 * result/recap diffstats + "view diff"). The CALLER (ServerFactory) gates it to the
 * orchestrator tier by only invoking `registerGitDiff` for that tier; a worker's
 * `tools/list` never contains it (the capability split is structural — a worker must not
 * read another board's diff).
 *
 * 🔒 The host (Canvas ADE MAIN) owns safety: it resolves the OPAQUE board id to that
 * board's OWN resolved spawn cwd (never a caller-supplied path), rejects non-terminal
 * targets before touching git, runs `git diff` READ-ONLY via simple-git in MAIN, and
 * bounds the output (100 KB). This tool is the thin transport: validate, forward to
 * {@link Orchestrator.gitDiff}, and surface the diff text.
 */
export function registerGitDiff(server: McpServer, orchestrator: Orchestrator): void {
  server.registerTool(
    TOOL_GIT_DIFF,
    {
      description:
        "Read a terminal board's uncommitted working-tree diff (read-only) by id. " +
        "Returns the unified `git diff` text for the board's own working directory, or an " +
        'empty string when it is not a git repo / has no changes. Terminal targets only; ' +
        'boardId is required.',
      inputSchema: z.object({
              boardId: z.string().min(1)
            })
    },
    async (args) => {
      const diff = await orchestrator.gitDiff(args.boardId)
      return { content: [{ type: 'text', text: diff }] }
    }
  )
}
