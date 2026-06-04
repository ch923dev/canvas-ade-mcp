import { beforeEach, describe, expect, it, vi } from 'vitest'

// .mcp.json carries a plaintext bearer token, so it must be written owner-only
// (0600) — not world-readable. node:fs is mocked here to assert the write options
// deterministically (POSIX mode bits are not enforced by the Windows filesystem,
// so a stat-based assertion would be a no-op on the dev box).
const writeFileSyncSpy = vi.fn()
vi.mock('node:fs', () => ({
  writeFileSync: (...args: unknown[]) => writeFileSyncSpy(...args)
}))

import { writeMcpJson } from '../../src/config/mcpJson'

describe('writeMcpJson permissions', () => {
  beforeEach(() => writeFileSyncSpy.mockClear())

  it('writes .mcp.json with owner-only (0600) mode — it holds a bearer token', () => {
    writeMcpJson('/tmp/board', 4000, 'tok-secret')
    expect(writeFileSyncSpy).toHaveBeenCalledTimes(1)
    const options = writeFileSyncSpy.mock.calls[0]![2]
    expect(options).toMatchObject({ mode: 0o600 })
  })
})
