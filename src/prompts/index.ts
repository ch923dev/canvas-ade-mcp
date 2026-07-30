import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import type { SessionCtx } from '../server/factory'
import type { PromptArgs } from './registry'
import { promptRegistry } from './registry'
import './canvas-orientation' // side effect: registers the canvas-orientation prompt

export type { PromptArgs, PromptMessage, PromptSpec } from './registry'
export { PromptRegistry, promptRegistry } from './registry'

/**
 * Register the MCP prompts primitive on `server` for the session described by `ctx`.
 *
 * Tier gating is server-side, keyed off the verified bearer token's `ctx.tier`:
 * `prompts/list` returns ONLY the prompts visible to that tier (`worker` → `[]`);
 * `prompts/get` returns a protocol error for any name not in that tier's set.
 *
 * The capability + both handlers are installed for EVERY tier (unlike the
 * structural tool split) so a worker's `prompts/list` is a well-formed empty
 * array rather than a "server does not support prompts" rejection — the single
 * tier-gated choke point reads `promptRegistry.list(ctx.tier)`, and `PromptSpec.
 * tiers` excludes `worker` at the type level, so worker visibility is impossible
 * by construction.
 *
 * PURE RENDER: `registerPrompts` never calls any Orchestrator write path, and the
 * playbook `build` functions are pure-render too. Any action a playbook later steers
 * the agent toward still pays `runGatedWrite` host-side. MUST be called BEFORE
 * `server.connect(transport)` (registerCapabilities is connect-gated; getServer
 * always runs before connect).
 */
export function registerPrompts(server: McpServer, ctx: SessionCtx): void {
  server.server.registerCapabilities({ prompts: {} })

  server.server.setRequestHandler('prompts/list', () => ({
    prompts: promptRegistry.list(ctx.tier).map((spec) => ({
      name: spec.name,
      description: spec.description,
      arguments: promptRegistry.argumentDescriptors(spec)
    }))
  }))

  server.server.setRequestHandler('prompts/get', (request) => {
    const messages = promptRegistry.get(
      request.params.name,
      ctx.tier,
      (request.params.arguments ?? {}) as PromptArgs
    )
    if (!messages) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        `Prompt '${request.params.name}' not found or not available for tier '${ctx.tier}'.`
      )
    }
    return { messages }
  })
}
