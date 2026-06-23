import { describe, expect, it } from 'vitest'
import {
  defaultScopesFor,
  SCOPE_ANSWER_PERMISSION,
  SCOPE_DISPATCH,
  SCOPE_GIT_WRITE,
  SCOPE_READ,
  SCOPE_SPAWN
} from '../../src/auth/scopes'

describe('tier -> default scopes', () => {
  it('a worker gets read only', () => {
    expect(defaultScopesFor('worker')).toEqual([SCOPE_READ])
  })

  it("a worker's scopes exclude every orchestrator scope", () => {
    const worker = defaultScopesFor('worker')
    for (const s of [SCOPE_DISPATCH, SCOPE_SPAWN, SCOPE_GIT_WRITE, SCOPE_ANSWER_PERMISSION]) {
      expect(worker).not.toContain(s)
    }
  })

  it('an orchestrator gets read + dispatch + spawn + git:write', () => {
    expect(defaultScopesFor('orchestrator')).toEqual(
      expect.arrayContaining([SCOPE_READ, SCOPE_DISPATCH, SCOPE_SPAWN, SCOPE_GIT_WRITE])
    )
  })

  // 🔒 F11: SCOPE_ANSWER_PERMISSION is NOT in the orchestrator defaults — it must not be granted
  // until the M8 `answer_permission` tool ships (else every minted orchestrator token would
  // implicitly pre-authorize a future tool of that name before its security review).
  it('an orchestrator does NOT get answer_permission (F11 — premature grant removed)', () => {
    expect(defaultScopesFor('orchestrator')).not.toContain(SCOPE_ANSWER_PERMISSION)
  })

  it('NO tier gets answer_permission by default (the scope is reserved for the unbuilt M8 tool)', () => {
    expect(defaultScopesFor('worker')).not.toContain(SCOPE_ANSWER_PERMISSION)
    expect(defaultScopesFor('connected')).not.toContain(SCOPE_ANSWER_PERMISSION)
    expect(defaultScopesFor('orchestrator')).not.toContain(SCOPE_ANSWER_PERMISSION)
  })

  it('a connected board gets read + dispatch + spawn (NO git:write / answer_permission)', () => {
    const connected = defaultScopesFor('connected')
    expect(connected).toEqual(expect.arrayContaining([SCOPE_READ, SCOPE_DISPATCH, SCOPE_SPAWN]))
    expect(connected).not.toContain(SCOPE_GIT_WRITE)
    expect(connected).not.toContain(SCOPE_ANSWER_PERMISSION)
  })

  it('returns a fresh array each call (no shared mutable state)', () => {
    const a = defaultScopesFor('orchestrator')
    a.push('mutated')
    expect(defaultScopesFor('orchestrator')).not.toContain('mutated')
  })
})
