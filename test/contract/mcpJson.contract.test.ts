import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildMcpJson, writeMcpJson } from '../../src/config/mcpJson'

describe('buildMcpJson', () => {
  it('builds a loopback http server entry with the bearer header', () => {
    expect(buildMcpJson(54321, 'tok-abc')).toEqual({
      mcpServers: {
        'canvas-ade': {
          type: 'http',
          url: 'http://127.0.0.1:54321/mcp',
          headers: { Authorization: 'Bearer tok-abc' }
        }
      }
    })
  })
})

describe('writeMcpJson', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcpjson-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('writes a parseable .mcp.json into the dir and returns its path', () => {
    const file = writeMcpJson(dir, 4000, 'tok-z')
    expect(file).toBe(join(dir, '.mcp.json'))
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    expect(parsed.mcpServers['canvas-ade'].url).toBe('http://127.0.0.1:4000/mcp')
    expect(parsed.mcpServers['canvas-ade'].headers.Authorization).toBe('Bearer tok-z')
  })
})
