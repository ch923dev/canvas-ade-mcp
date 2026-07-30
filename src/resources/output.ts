import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import type { Variables } from "@modelcontextprotocol/server";
import type { BoardOutput, Orchestrator } from '../orchestrator/Orchestrator'
import { MAX_OUTPUT_PAGE } from '../constants'
import { assertBoardReadable, type ResourceScope } from './scope'

/** First value of a templated URI variable (templates yield string | string[]). */
function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/**
 * Read one capped page of a board's scrollback and serialize it. Shared by both the
 * tail (no cursor) and `?cursor` templates. **🔒 Hard-caps the page at
 * `MAX_OUTPUT_PAGE` here too** — defense in depth, so a misbehaving host can never
 * make this resource dump more than one MCP page (the host already caps; this is the
 * belt-and-suspenders the security checklist requires). `nextCursor`/`droppedOlder`
 * pass through unchanged so the agent always knows whether to keep paging.
 */
async function readPage(
  orchestrator: Orchestrator,
  scope: ResourceScope,
  uriHref: string,
  variables: Variables
): Promise<{ contents: Array<{ uri: string; text: string }> }> {
  const id = first(variables.id)
  if (!id) throw new Error('canvas://board/{id}/output: missing board id')
  // 🔒 Raw scrollback is the MOST sensitive read surface (echoed secrets, env dumps,
  // another task's source) — a worker reads only its own board (audit Phase A).
  assertBoardReadable(scope, id, 'canvas://board/{id}/output')
  // A cursor, when supplied, must be a non-negative integer (chars-from-end). A
  // malformed value is NOT silently coerced to "newest tail" — that would loop an
  // agent forever (it pages with garbage, keeps getting page 1). Fail loud instead.
  const rawCursor = first(variables.cursor)
  let opts: { cursor: number } | undefined
  if (rawCursor !== undefined) {
    const cursor = Number(rawCursor)
    if (!Number.isInteger(cursor) || cursor < 0) {
      throw new Error(`canvas://board/${id}/output: invalid cursor "${rawCursor}"`)
    }
    opts = { cursor }
  }

  const out = await orchestrator.boardOutput(id, opts)
  // 🔒 never emit more than one page, whatever the host returned. Keep the NEWEST
  // MAX_OUTPUT_PAGE chars (the contract is tail-anchored — `text` is the newest
  // slice), NOT the oldest. When we have to drop, the dropped chars are OLDER and
  // remain unconsumed, so the cursor MUST advance by exactly what we kept (= the
  // dropped older content is still reachable on the next, older page).
  let page: BoardOutput = out
  if (out.text.length > MAX_OUTPUT_PAGE) {
    const text = out.text.slice(-MAX_OUTPUT_PAGE)
    page = {
      ...out,
      text,
      returned: text.length,
      nextCursor: (opts?.cursor ?? 0) + text.length
    }
  }
  return { contents: [{ uri: uriHref, text: JSON.stringify(page) }] }
}

/**
 * Registers the read-only, capped, paginated `canvas://board/{id}/output` resource
 * (T1.4 🔒 — both tiers; observation is safe). Two disjoint templates back ONE
 * logical resource because the SDK's UriTemplate compiles `{?cursor}` into a
 * MANDATORY query group — a URI with no `?cursor` won't match it. So:
 *   - `canvas://board/{id}/output`          → newest tail page (no cursor)
 *   - `canvas://board/{id}/output{?cursor}` → an older page at the given cursor
 * Their regexes are mutually exclusive (`…/output$` vs `…/output\?cursor=…$`), so
 * each concrete read routes to exactly one. Both delegate to `readPage`.
 */
export function registerBoardOutputResource(
  server: McpServer,
  orchestrator: Orchestrator,
  scope: ResourceScope
): void {
  const meta = {
    description:
      "A capped, paginated, ANSI-stripped page of a board's recent output (tail-anchored; pass nextCursor as ?cursor for older).",
    mimeType: 'application/json'
  }
  server.registerResource(
    'board-output',
    new ResourceTemplate('canvas://board/{id}/output', { list: undefined }),
    meta,
    (uri, variables) => readPage(orchestrator, scope, uri.href, variables)
  )
  server.registerResource(
    'board-output-paged',
    new ResourceTemplate('canvas://board/{id}/output{?cursor}', { list: undefined }),
    meta,
    (uri, variables) => readPage(orchestrator, scope, uri.href, variables)
  )
}
