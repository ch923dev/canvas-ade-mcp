import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { TokenStore } from './tokens'

/**
 * A bearer-token verifier over our in-memory token store. The capability tier
 * is carried in `extra.{tier,boardId}` and re-derived server-side on every
 * request. Throwing InvalidTokenError makes requireBearerAuth return 401 (not
 * 500). This file (with tokens.ts) is the only place SDK auth is imported.
 */
export function createVerifier(store: TokenStore): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const row = store.get(token)
      if (!row) throw new InvalidTokenError('Unknown or revoked token')
      return {
        token,
        clientId: row.boardId,
        scopes: row.scopes,
        expiresAt: row.expiresAt,
        extra: { tier: row.tier, boardId: row.boardId }
      }
    }
  }
}
