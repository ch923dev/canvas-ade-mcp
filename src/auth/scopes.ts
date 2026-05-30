import type { Scope, Tier } from '../types'

// The Phase 1 scope vocabulary (ADR 0002, D2). Scopes are carried by the token
// and consumed by per-tool gating in Phases 3+. Tier registration in the factory
// remains the primary capability gate; scopes are the finer-grained future lever.
export const SCOPE_READ: Scope = 'read'
export const SCOPE_DISPATCH: Scope = 'dispatch'
export const SCOPE_SPAWN: Scope = 'spawn'
export const SCOPE_GIT_WRITE: Scope = 'git:write'
export const SCOPE_ANSWER_PERMISSION: Scope = 'answer_permission'

const WORKER_SCOPES: readonly Scope[] = [SCOPE_READ]
const ORCHESTRATOR_SCOPES: readonly Scope[] = [
  SCOPE_READ,
  SCOPE_DISPATCH,
  SCOPE_SPAWN,
  SCOPE_GIT_WRITE,
  SCOPE_ANSWER_PERMISSION
]

/** Default scopes granted to a freshly-minted token of the given tier. */
export function defaultScopesFor(tier: Tier): Scope[] {
  return [...(tier === 'orchestrator' ? ORCHESTRATOR_SCOPES : WORKER_SCOPES)]
}
