import { describe, expect, it } from 'vitest'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { ctxFromAuth } from '../../src/server/mcpHttp'

// D5: the session context is derived SOLELY from the verified token's `extra`.
// There is no agent-supplied boardId path; these tests lock that in so a future
// change can't introduce one.
function auth(extra: unknown): AuthInfo {
  return { token: 't', clientId: '', scopes: ['read'], extra } as AuthInfo
}

describe('ctxFromAuth derives context solely from the token', () => {
  it('uses the tier + boardId carried in extra', () => {
    expect(ctxFromAuth(auth({ tier: 'orchestrator', boardId: 'bA' }))).toEqual({
      tier: 'orchestrator',
      scopes: ['read'],
      boardId: 'bA'
    })
  })

  it('defaults to worker tier when extra is absent', () => {
    expect(ctxFromAuth(undefined).tier).toBe('worker')
    expect(ctxFromAuth(undefined).boardId).toBe('')
  })

  it('a non-string boardId is rejected (never trust a forged extra)', () => {
    expect(ctxFromAuth(auth({ tier: 'orchestrator', boardId: 123 })).boardId).toBe('')
  })

  it('two tokens map to two distinct boards (cross-board isolation)', () => {
    const a = ctxFromAuth(auth({ tier: 'worker', boardId: 'bA' }))
    const b = ctxFromAuth(auth({ tier: 'worker', boardId: 'bB' }))
    expect(a.boardId).toBe('bA')
    expect(b.boardId).toBe('bB')
    expect(a.boardId).not.toBe(b.boardId)
  })
})
