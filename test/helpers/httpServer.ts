import { createMcpHttpServer, type RunningMcpServer } from '../../src/server/mcpHttp'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import { TokenStore } from '../../src/auth/tokens'
import type { AuthRow } from '../../src/types'

export interface TestServer {
  server: RunningMcpServer
  tokens: TokenStore
  url: string
}

/** Start a real loopback MCP server on an ephemeral port for live tests. */
export async function startTestServer(): Promise<TestServer> {
  const tokens = new TokenStore()
  const server = await createMcpHttpServer({ orchestrator: new MockOrchestrator(), tokens })
  return { server, tokens, url: `http://127.0.0.1:${server.port}/mcp` }
}

/** Mint a bearer token with sensible far-future expiry for tests. */
export function mintToken(
  tokens: TokenStore,
  token: string,
  row: Partial<AuthRow> & { tier: AuthRow['tier'] }
): void {
  tokens.mint(token, {
    boardId: row.boardId ?? 'b1',
    tier: row.tier,
    scopes: row.scopes ?? [],
    expiresAt: row.expiresAt ?? Math.floor(Date.now() / 1000) + 3600
  })
}
