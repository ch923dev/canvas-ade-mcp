import { randomBytes } from 'node:crypto'
import type { TokenStore } from './tokens'
import type { AuthRow, BoardId, Tier } from '../types'
import { defaultScopesFor } from './scopes'

export interface MintedToken {
  token: string
  row: AuthRow
}

/**
 * Board-lifetime default expiry (~1 year). The SDK's requireBearerAuth REJECTS a
 * token whose `expiresAt` is not a number ("Token has no expiration time"), so a
 * minted token MUST carry one — a missing expiry is not a valid "never expires".
 * The value is set far out (board lifetime, revoked on close) so it never kills a
 * long agent run mid-session; pass a short `ttlSeconds` only for a deliberately
 * short-lived token. (ADR 0002, D3.)
 */
const DEFAULT_TTL_SECONDS = 365 * 24 * 60 * 60

/**
 * Mint a crypto-random per-board bearer token, store it, and return token + row.
 * Scopes come from the tier (ADR 0002, D2). Always carries a board-lifetime
 * `expiresAt` (the SDK requires a numeric expiry); override with `ttlSeconds`.
 */
export function mintBoardToken(
  store: TokenStore,
  input: { boardId: BoardId; tier: Tier; ttlSeconds?: number }
): MintedToken {
  const token = randomBytes(32).toString('hex')
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS
  const row: AuthRow = {
    boardId: input.boardId,
    tier: input.tier,
    scopes: defaultScopesFor(input.tier),
    expiresAt: Math.floor(Date.now() / 1000) + ttl
  }
  store.mint(token, row)
  return { token, row }
}
