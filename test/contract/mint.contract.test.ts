import { describe, expect, it } from 'vitest'
import { TokenStore } from '../../src/auth/tokens'
import { mintBoardToken } from '../../src/auth/mint'
import { SCOPE_READ } from '../../src/auth/scopes'

describe('mintBoardToken', () => {
  it('mints a 32-byte hex token stored under its row, with a board-lifetime expiry', () => {
    const store = new TokenStore()
    const before = Math.floor(Date.now() / 1000)
    const { token, row } = mintBoardToken(store, { boardId: 'bX', tier: 'worker' })
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(store.get(token)).toEqual(row)
    expect(row.boardId).toBe('bX')
    expect(row.scopes).toEqual([SCOPE_READ])
    // The SDK requires a numeric expiresAt — a default mint MUST carry one (far out).
    expect(typeof row.expiresAt).toBe('number')
    expect(row.expiresAt).toBeGreaterThan(before + 300 * 24 * 60 * 60)
  })

  it('two mints never collide', () => {
    const store = new TokenStore()
    const a = mintBoardToken(store, { boardId: 'b', tier: 'worker' })
    const b = mintBoardToken(store, { boardId: 'b', tier: 'worker' })
    expect(a.token).not.toBe(b.token)
  })

  it('an orchestrator mint carries the orchestrator scopes', () => {
    const store = new TokenStore()
    const { row } = mintBoardToken(store, { boardId: 'b', tier: 'orchestrator' })
    expect(row.scopes).toContain('dispatch')
  })

  it('ttlSeconds overrides the default expiresAt', () => {
    const store = new TokenStore()
    const before = Math.floor(Date.now() / 1000)
    const { row } = mintBoardToken(store, { boardId: 'b', tier: 'orchestrator', ttlSeconds: 600 })
    expect(row.expiresAt).toBeGreaterThanOrEqual(before + 600)
    expect(row.expiresAt).toBeLessThan(before + 600 + 60)
  })
})
