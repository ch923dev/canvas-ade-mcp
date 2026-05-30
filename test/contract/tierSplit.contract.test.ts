import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { TOOL_ORCHESTRATOR_PING, TOOL_PING } from '../../src/constants'

// The capability-split proof: tier is enforced by REGISTRATION, so a worker's
// tools/list never even contains the orchestrator tool.
describe('capability tier split', () => {
  it('worker tools/list omits orchestrator_ping', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL_PING)
    expect(names).not.toContain(TOOL_ORCHESTRATOR_PING)
    await client.close()
  })

  it('orchestrator tools/list includes orchestrator_ping', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL_PING)
    expect(names).toContain(TOOL_ORCHESTRATOR_PING)
    await client.close()
  })
})
