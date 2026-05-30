import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { TOOL_PING } from '../../src/constants'

describe('handshake (in-memory)', () => {
  it('initializes and ping returns pong', async () => {
    const client = await connectInMemory('worker')
    const result = await client.callTool({ name: TOOL_PING, arguments: {} })
    expect(JSON.stringify(result.content)).toContain('pong')
    await client.close()
  })
})
