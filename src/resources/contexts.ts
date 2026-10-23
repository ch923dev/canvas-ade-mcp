import type { McpServer } from '@modelcontextprotocol/server'
import type { Orchestrator } from '../orchestrator/Orchestrator'
import { warnSkipped } from '../server/tools/spatialShared'

/** The `canvas://contexts` resource URI (declared beside its register fn, like `ATTENTION_URI`). */
export const CONTEXTS_URI = 'canvas://contexts'

/**
 * Register the `canvas://contexts` resource (C6) — the read-only CONTEXT digest: which boards belong
 * together. `{ version: 1, contexts: DerivedContext[], ungrouped: string[] }`, where every existing
 * Named Group is a context (`existingGroupId`, confidence high) and the rest are host-derived
 * proposals from preview links, orchestration cables, loopback ports, data-flow sources, shared cwd
 * and file refs (`signals` says which; `confidence` high / medium / low). `ungrouped` lists the boards
 * in no Named Group. An agent reads it to propose `group_boards` / `edit_groups` batches.
 *
 * The CALLER (ServerFactory) registers it for the ORCHESTRATOR, LEAD and CONNECTED tiers (D1) — the
 * same set as `canvas://layout`; a worker `resources/list` never contains it. The handler is the thin
 * transport: call {@link Orchestrator.describeContexts} and serialize the host-owned digest (typed
 * `unknown`, like `canvas://layout`). The package does not re-cap it: `MAX_CONTEXTS` is the host's
 * `deriveContexts` bound, exported only for the parity test.
 *
 * OPTIONAL host method: a host without `describeContexts` does not get the resource, and one
 * `console.warn` names the gap.
 */
export function registerContextsResource(server: McpServer, orchestrator: Orchestrator): void {
  const describeContexts = orchestrator.describeContexts
  if (typeof describeContexts !== 'function') {
    warnSkipped(`resource ${CONTEXTS_URI}`, 'describeContexts')
    return
  }
  server.registerResource(
    'contexts',
    CONTEXTS_URI,
    {
      description:
        'Read-only context digest: which boards belong together. { version: 1, contexts, ungrouped } ' +
        '— each context is { key, suggestedName, boardIds, signals, confidence, existingGroupId?, ' +
        'addBoardIds? }: an existing Named Group (existingGroupId set) or a proposal derived from ' +
        'preview links, orchestration cables, ports, data-flow, shared cwd or file refs. ungrouped = ' +
        'board ids in no Named Group. Use it to propose group_boards (new groups) or edit_groups ' +
        '(addBoardIds on an existing group). Orchestrator, lead and connected tiers.',
      mimeType: 'application/json'
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(await describeContexts.call(orchestrator)) }]
    })
  )
}
