import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { SpawnGroupInput, SpawnGroupResult } from '../../src/orchestrator/Orchestrator'

// spawn_group (C2-wire) spawns a feature-zone cluster (terminal + optional planning/browser, under
// a Named Group) in one cap-checked step. ORCHESTRATOR-TIER ONLY — unlike spawn_board, a connected
// agent must NOT be able to grow the swarm topology unaware. The host owns cap-check + launchCommand
// sanitization; this tool is the thin transport.
const TOOL = 'spawn_group'

/** Records every spawnGroup call and returns a deterministic cluster, to prove the passthrough. */
class SpyOrchestrator extends MockOrchestrator {
  groups: SpawnGroupInput[] = []
  override async spawnGroup(input: SpawnGroupInput): Promise<SpawnGroupResult> {
    this.groups.push(input)
    return {
      groupId: 'g1',
      terminalId: 't1',
      ...(input.planning ? { planningId: 'p1' } : {}),
      ...(input.browser ? { browserId: 'b1' } : {})
    }
  }
}

function parse(res: unknown): Record<string, unknown> {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? []
  const text = content.map((c) => c.text ?? '').join('')
  return JSON.parse(text)
}

describe('spawn_group tool (C2-wire, orchestrator-tier feature-zone cluster)', () => {
  it('orchestrator tools/list INCLUDES spawn_group', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL)
    await client.close()
  })

  it('worker tools/list OMITS spawn_group', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    await client.close()
  })

  it('connected tools/list OMITS spawn_group (NOT spawn_board — bounds swarm growth)', async () => {
    const client = await connectInMemory('connected')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL)
    // sanity: the connected tier DOES get spawn_board — so the omission is specific to spawn_group.
    expect(names).toContain('spawn_board')
    await client.close()
  })

  it('forwards the input and returns the minted ids as JSON', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: { name: 'Auth zone', planning: true }
    })
    expect(res.isError).toBeFalsy()
    expect(orch.groups).toEqual([
      { name: 'Auth zone', planning: true, browser: undefined, launchCommand: undefined }
    ])
    expect(parse(res)).toEqual({ groupId: 'g1', terminalId: 't1', planningId: 'p1' })
    await client.close()
  })

  it('forwards an agentic launchCommand for the worker terminal', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    await client.callTool({
      name: TOOL,
      arguments: { name: 'zone', launchCommand: 'claude', browser: true }
    })
    expect(orch.groups[0]).toMatchObject({ name: 'zone', launchCommand: 'claude', browser: true })
    await client.close()
  })

  it('rejects an empty name WITHOUT calling the adapter (Zod min(1))', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { name: '' } })
    expect(res.isError).toBe(true)
    expect(orch.groups).toHaveLength(0)
    await client.close()
  })

  it('rejects a name longer than 80 chars WITHOUT calling the adapter (Zod max)', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({ name: TOOL, arguments: { name: 'x'.repeat(81) } })
    expect(res.isError).toBe(true)
    expect(orch.groups).toHaveLength(0)
    await client.close()
  })

  it('rejects a launchCommand longer than 400 chars WITHOUT calling the adapter', async () => {
    const orch = new SpyOrchestrator()
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL,
      arguments: { name: 'zone', launchCommand: 'x'.repeat(401) }
    })
    expect(res.isError).toBe(true)
    expect(orch.groups).toHaveLength(0)
    await client.close()
  })
})
