import { randomBytes } from 'node:crypto'
import type { TokenStore } from './tokens'
import type { AuthRow, BoardId, Tier } from '../types'
import { defaultScopesFor } from './scopes'

export interface MintedToken {
  token: string
  row: AuthRow
}

/**
 * Mint a crypto-random per-board bearer token, store it, and return token + row.
 * Scopes come from the tier (ADR 0002, D2). No expiresAt by default (D3): the
 * token lives until the board closes and TokenStore.revoke drops it — a short ttl
 * would kill a long agent run mid-session. Pass ttlSeconds only for a token meant
 * to be deliberately short-lived.
 */
export function mintBoardToken(
  store: TokenStore,
  input: { boardId: BoardId; tier: Tier; ttlSeconds?: number }
): MintedToken {
  const token = randomBytes(32).toString('hex')
  const row: AuthRow = {
    boardId: input.boardId,
    tier: input.tier,
    scopes: defaultScopesFor(input.tier)
  }
  if (input.ttlSeconds !== undefined) {
    row.expiresAt = Math.floor(Date.now() / 1000) + input.ttlSeconds
  }
  store.mint(token, row)
  return { token, row }
}
