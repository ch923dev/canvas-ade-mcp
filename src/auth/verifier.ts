import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server'
import type { AuthInfo, OAuthTokenVerifier } from '@modelcontextprotocol/server'
import type { TokenStore } from './tokens'

/**
 * A bearer-token verifier over our in-memory token store. The capability tier
 * is carried in `extra.{tier,boardId}` and re-derived server-side on every
 * request. Throwing OAuthError(InvalidToken) makes requireBearerAuth return
 * 401 (not 500). This file (with tokens.ts) is the only place SDK auth is
 * imported.
 */
export function createVerifier(store: TokenStore): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const row = store.get(token)
      if (!row) throw new OAuthError(OAuthErrorCode.InvalidToken, 'Unknown or revoked token')
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
