import type { z } from 'zod'
import type { Tier } from '../types'

/**
 * A single parsed argument set for a prompt invocation. MCP `prompts/get`
 * passes every argument as a string, so the value type is always `string`.
 */
export type PromptArgs = Record<string, string>

/** One rendered message in a prompt response (the MCP `PromptMessage` shape). */
export interface PromptMessage {
  role: 'user' | 'assistant'
  content: { type: 'text'; text: string }
}

/**
 * A registered prompt specification — the in-package "skill" unit.
 *
 * Prompts are PURE RENDER: `build` returns text for the agent to read and
 * reason over. It MUST NOT call any Orchestrator write path. Any risky action
 * a playbook later steers the agent toward still flows through `tools/call` →
 * `runGatedWrite` host-side; the prompt text is data, it does not execute.
 */
export interface PromptSpec<TArgs extends PromptArgs = PromptArgs> {
  /** MCP name: lower-kebab, e.g. 'canvas-orientation'. */
  name: string
  description: string
  /**
   * Zod schema for the prompt's optional named arguments. Use `z.object({})`
   * for a zero-argument prompt. Each field must be `z.string()` — MCP
   * `prompts/get` only ever passes string values.
   */
  argsSchema: z.ZodType<TArgs>
  /**
   * Which tiers may see this prompt in `prompts/list` and invoke it via
   * `prompts/get`. `worker` is excluded at the TYPE level (`Exclude<Tier,
   * 'worker'>`) so a prompt author cannot accidentally grant a worker token
   * read-access to orchestration playbooks — workers get no prompts, ever.
   */
  tiers: ReadonlyArray<Exclude<Tier, 'worker'>>
  /**
   * Pure render function. Returns the `PromptMessage[]` to send the agent.
   * MUST NOT call any Orchestrator write path (spawn/dispatch/handoff/relay/
   * interrupt/configure/add_planning_elements/write_result).
   */
  build(args: TArgs): PromptMessage[]
}

/**
 * The in-package prompt registry. Populated at module-import time by each
 * playbook file's side-effect `register(...)` call; immutable thereafter
 * (a process singleton — every per-session `getServer` shares the same
 * contents, which is correct: prompt content is static after boot).
 */
export class PromptRegistry {
  private readonly specs: PromptSpec[] = []

  register<TArgs extends PromptArgs>(spec: PromptSpec<TArgs>): void {
    this.specs.push(spec as unknown as PromptSpec)
  }

  /** All prompts visible to `tier`. Worker → `[]` (the hard gate). */
  list(tier: Tier): PromptSpec[] {
    if (tier === 'worker') return []
    return this.specs.filter((s) => (s.tiers as ReadonlyArray<string>).includes(tier))
  }

  /**
   * Render a prompt by name for `tier`. Returns `null` when the prompt is not
   * found, not visible to `tier`, or its arguments fail validation — the
   * caller (the `prompts/get` handler) maps `null` to an MCP error.
   */
  get(name: string, tier: Tier, rawArgs: PromptArgs): PromptMessage[] | null {
    const spec = this.list(tier).find((s) => s.name === name)
    if (!spec) return null
    const parsed = spec.argsSchema.safeParse(rawArgs)
    if (!parsed.success) return null
    return spec.build(parsed.data as PromptArgs)
  }

  /**
   * The optional named arguments declared by a visible prompt, as MCP
   * `prompts/list` argument descriptors. Derived from the Zod object shape;
   * a zero-argument prompt (`z.object({})`) yields `[]`. All prompt arguments
   * are optional (MCP passes strings; required-ness is enforced inside `build`).
   */
  argumentDescriptors(spec: PromptSpec): Array<{ name: string; required: false }> {
    const shape = (spec.argsSchema as { shape?: Record<string, unknown> }).shape
    if (!shape) return []
    return Object.keys(shape).map((name) => ({ name, required: false }))
  }
}

/** Module-level singleton — imported by `registerPrompts` and every playbook file. */
export const promptRegistry = new PromptRegistry()
