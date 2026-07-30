import type { McpServer } from "@modelcontextprotocol/server";
import type { Orchestrator } from '../orchestrator/Orchestrator'

/**
 * Register the `canvas://app-model` resource (C1) — the read-only app self-model: board types, the
 * tool catalog, the live canvas (boards/connectors/groups), and the orchestration rules. The CALLER
 * (ServerFactory) gates this to the ORCHESTRATOR tier by only invoking `registerAppModelResource`
 * for that tier; it is absent from a worker/connected `resources/list` (the self-model exposes the
 * full tool catalog + spawn cap + idle TTL — of no use to a non-orchestrator, and the capability
 * split stays structural, never a per-handler check).
 *
 * The handler is the thin transport: call {@link Orchestrator.describeApp} (which wraps the host's
 * `buildAppModel` over the loopback wire) and serialize the result as JSON — analogous to
 * `canvas://boards`. The `AppModel` shape is host-owned, so the resource carries no compile-time
 * dependency on it.
 */
export function registerAppModelResource(server: McpServer, orchestrator: Orchestrator): void {
  server.registerResource(
    'app-model',
    'canvas://app-model',
    {
      description:
        'Read-only app self-model: board types, tool catalog, live canvas ' +
        '(boards/connectors/groups), and orchestration rules. Orchestrator-tier.',
      mimeType: 'application/json'
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(await orchestrator.describeApp()) }]
    })
  )
}
