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
  SCOPE_GIT_WRITE
  // 🔒 F11: SCOPE_ANSWER_PERMISSION is intentionally OMITTED until the M8 `answer_permission`
  // tool ships (Wave 3 / C5). Granting it now would implicitly pre-authorize any future tool of
  // that name on every orchestrator token minted today — a contributor who later adds an
  // `answer_permission`-scoped tool would silently widen every existing token's authority. The
  // SCOPE_ANSWER_PERMISSION constant stays defined: M8's tool registration consumes it as the
  // scope-gate, and only THEN is it added back to this default array (with its security review).
]
// A consented Terminal board (Agent Orchestration v1): relay (dispatch) along its own cables +
// spawn/configure the canvas. NO git:write (it reads no other board's diff) and NO
// answer_permission. Tier registration in the factory remains the load-bearing gate; these scopes
// are the forward-looking finer-grained lever (not yet enforced per-tool).
const CONNECTED_SCOPES: readonly Scope[] = [SCOPE_READ, SCOPE_DISPATCH, SCOPE_SPAWN]

/** Default scopes granted to a freshly-minted token of the given tier. */
export function defaultScopesFor(tier: Tier): Scope[] {
  switch (tier) {
    case 'orchestrator':
      return [...ORCHESTRATOR_SCOPES]
    case 'connected':
      return [...CONNECTED_SCOPES]
    default:
      return [...WORKER_SCOPES]
  }
}
