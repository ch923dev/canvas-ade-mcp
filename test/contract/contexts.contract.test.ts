import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import { CONTEXTS_URI } from '../../src/resources/contexts'

// canvas://contexts (C6) — the read-only context digest. The shape is HOST-owned
// ({ version: 1, contexts: DerivedContext[], ungrouped: string[] }); the package only serializes it,
// exactly like canvas://layout. Tier membership + warn-on-skip live in spatialSurface.contract.test.ts.

function readText(contents: ReadonlyArray<{ uri?: unknown; text?: unknown }>): string {
  return contents.map((c) => (typeof c.text === 'string' ? c.text : '')).join('')
}

/** A host digest with one existing group + one derived proposal, served verbatim. */
class DigestOrchestrator extends MockOrchestrator {
  reads = 0
  override async describeContexts(): Promise<unknown> {
    this.reads++
    return {
      version: 1,
      contexts: [
        {
          key: 'k1',
          suggestedName: 'Auth',
          boardIds: ['b1', 'b2'],
          signals: ['group'],
          confidence: 'high',
          existingGroupId: 'g1',
          addBoardIds: ['b3']
        },
        {
          key: 'k2',
          suggestedName: 'Checkout',
          boardIds: ['b4', 'b5'],
          signals: ['preview', 'dataflow'],
          confidence: 'high'
        }
      ],
      ungrouped: ['b3', 'b4', 'b5']
    }
  }
}

describe('canvas://contexts resource (C6)', () => {
  it('the URI constant is canvas://contexts', () => {
    expect(CONTEXTS_URI).toBe('canvas://contexts')
  })

  it('serializes the host digest verbatim as JSON', async () => {
    const orch = new DigestOrchestrator()
    const client = await connectInMemory('connected', orch)
    const listed = (await client.listResources()).resources.find((r) => r.uri === CONTEXTS_URI)
    expect(listed?.mimeType).toBe('application/json')
    const res = await client.readResource({ uri: CONTEXTS_URI })
    expect(JSON.parse(readText(res.contents))).toEqual(
      await new DigestOrchestrator().describeContexts()
    )
    expect(orch.reads).toBe(1)
    await client.close()
  })

  it('the mock serves the empty v1 shell', async () => {
    const client = await connectInMemory('orchestrator')
    const res = await client.readResource({ uri: CONTEXTS_URI })
    expect(JSON.parse(readText(res.contents))).toEqual({ version: 1, contexts: [], ungrouped: [] })
    await client.close()
  })

  it('a worker cannot read it (no registration for the tier)', async () => {
    const client = await connectInMemory('worker')
    await expect(client.readResource({ uri: CONTEXTS_URI })).rejects.toThrow()
    await client.close()
  })
})
