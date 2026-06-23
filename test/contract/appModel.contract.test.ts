import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'

// canvas://app-model (C1) is the read-only app self-model resource — board types, tool catalog,
// live canvas, and orchestration rules. ORCHESTRATOR-TIER ONLY: it is registered inside the
// orchestrator block in ServerFactory (NOT in registerBoardResources, which serves both tiers), so
// a worker/connected resources/list never contains it. The MockOrchestrator.describeApp returns a
// minimal AppModel-shaped object — enough to prove the wire + tier gate.
const URI = 'canvas://app-model'

function uris(list: { resources: Array<{ uri: string }> }): string[] {
  return list.resources.map((r) => r.uri)
}

function readText(contents: ReadonlyArray<{ uri?: unknown; text?: unknown }>): string {
  return contents.map((c) => (typeof c.text === 'string' ? c.text : '')).join('')
}

describe('canvas://app-model resource (C1, orchestrator-tier self-model)', () => {
  it('orchestrator resources/list INCLUDES canvas://app-model', async () => {
    const client = await connectInMemory('orchestrator')
    expect(uris(await client.listResources())).toContain(URI)
    await client.close()
  })

  it('worker resources/list OMITS canvas://app-model (orchestrator-only)', async () => {
    const client = await connectInMemory('worker')
    expect(uris(await client.listResources())).not.toContain(URI)
    await client.close()
  })

  it('connected resources/list OMITS canvas://app-model (orchestrator-only)', async () => {
    const client = await connectInMemory('connected')
    expect(uris(await client.listResources())).not.toContain(URI)
    await client.close()
  })

  it('returns JSON with the expected AppModel shape', async () => {
    const client = await connectInMemory('orchestrator')
    const res = await client.readResource({ uri: URI })
    const model = JSON.parse(readText(res.contents))
    expect(model).toMatchObject({
      version: 1,
      boardTypes: expect.any(Array),
      tools: expect.any(Array),
      canvas: { boards: expect.any(Array), connectors: expect.any(Array), groups: expect.any(Array) },
      rules: expect.any(Object)
    })
    await client.close()
  })

  it('a worker cannot read canvas://app-model (no registration for the tier)', async () => {
    const client = await connectInMemory('worker')
    await expect(client.readResource({ uri: URI })).rejects.toThrow()
    await client.close()
  })
})
