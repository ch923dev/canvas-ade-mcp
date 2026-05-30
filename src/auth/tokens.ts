import type { AuthRow } from '../types'

/**
 * In-memory per-board token store. Tokens are minted out-of-band when a board
 * spawns and revoked when it closes — no OAuth flow. In-memory by design:
 * sessions die on MAIN restart (correct for a single-user desktop app).
 */
export class TokenStore {
  private readonly rows = new Map<string, AuthRow>()

  mint(token: string, row: AuthRow): void {
    this.rows.set(token, row)
  }

  revoke(token: string): void {
    this.rows.delete(token)
  }

  get(token: string): AuthRow | undefined {
    return this.rows.get(token)
  }
}
