import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'

// canvas://layout (P1b) is the read-only spatial digest resource — bounding box, per-board geometry,
// overlaps, and a coarse arrangement (v2 adds groups / screen / fit, host-owned). Widened in 0.27.0
// (spatial-awareness D1) from orchestrator-only to ORCHESTRATOR + LEAD + CONNECTED: registered by
// ServerFactory's shared spatial block, so only a worker resources/list lacks it.
// MockOrchestrator.describeLayout returns a minimal LayoutDigest-shaped object — enough to prove the
// wire + the tier gate.
const URI = 'canvas://layout'

function uris(list: { resources: Array<{ uri: string }> }): string[] {
  return list.resources.map((r) => r.uri)
}

function readText(contents: ReadonlyArray<{ uri?: unknown; text?: unknown }>): string {
  return contents.map((c) => (typeof c.text === 'string' ? c.text : '')).join('')
}

describe('canvas://layout resource (P1b, spatial digest — orchestrator/lead/connected)', () => {
  it('orchestrator resources/list INCLUDES canvas://layout', async () => {
    const client = await connectInMemory('orchestrator')
    expect(uris(await client.listResources())).toContain(URI)
    await client.close()
  })

  it('worker resources/list OMITS canvas://layout', async () => {
    const client = await connectInMemory('worker')
    expect(uris(await client.listResources())).not.toContain(URI)
    await client.close()
  })

  for (const tier of ['lead', 'connected'] as const) {
    it(`${tier} resources/list INCLUDES canvas://layout (D1 widening, 0.27.0)`, async () => {
      const client = await connectInMemory(tier)
      expect(uris(await client.listResources())).toContain(URI)
      await client.close()
    })

    it(`${tier} can read canvas://layout`, async () => {
      const client = await connectInMemory(tier)
      const res = await client.readResource({ uri: URI })
      expect(JSON.parse(readText(res.contents))).toMatchObject({ version: 1 })
      await client.close()
    })
  }

  it('returns JSON with the expected LayoutDigest shape', async () => {
    const client = await connectInMemory('orchestrator')
    const res = await client.readResource({ uri: URI })
    const digest = JSON.parse(readText(res.contents))
    expect(digest).toMatchObject({
      version: 1,
      count: expect.any(Number),
      boards: expect.any(Array),
      overlaps: expect.any(Array),
      arrangement: expect.any(String)
    })
    // bbox is null when nothing is placed (the mock) — the key must still be present.
    expect('bbox' in digest).toBe(true)
    await client.close()
  })

  it('a worker cannot read canvas://layout (no registration for the tier)', async () => {
    const client = await connectInMemory('worker')
    await expect(client.readResource({ uri: URI })).rejects.toThrow()
    await client.close()
  })
})
