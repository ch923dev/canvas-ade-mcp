import { describe, expect, it } from 'vitest'
import { TokenStore } from '../../src/auth/tokens'
import { mintBoardToken } from '../../src/auth/mint'
import { SCOPE_READ } from '../../src/auth/scopes'

describe('mintBoardToken', () => {
  it('mints a 32-byte hex token stored under its row', () => {
    const store = new TokenStore()
    const { token, row } = mintBoardToken(store, { boardId: 'bX', tier: 'worker' })
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(store.get(token)).toEqual(row)
    expect(row.boardId).toBe('bX')
    expect(row.scopes).toEqual([SCOPE_READ])
    expect(row.expiresAt).toBeUndefined()
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

  it('ttlSeconds sets a future expiresAt; omitting it leaves none', () => {
    const store = new TokenStore()
    const before = Math.floor(Date.now() / 1000)
    const { row } = mintBoardToken(store, { boardId: 'b', tier: 'orchestrator', ttlSeconds: 600 })
    expect(row.expiresAt).toBeGreaterThanOrEqual(before + 600)
  })
})
