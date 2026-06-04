import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { TOOL_PING } from '../../src/constants'

const pkgVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).version as string

describe('handshake (in-memory)', () => {
  it('initializes and ping returns pong', async () => {
    const client = await connectInMemory('worker')
    const result = await client.callTool({ name: TOOL_PING, arguments: {} })
    expect(JSON.stringify(result.content)).toContain('pong')
    await client.close()
  })

  it('advertises the real package version in the handshake (not a placeholder)', async () => {
    const client = await connectInMemory('worker')
    expect(client.getServerVersion()?.version).toBe(pkgVersion)
    await client.close()
  })
})
