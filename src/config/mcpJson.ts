import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface McpJson {
  mcpServers: {
    'canvas-ade': {
      type: 'http'
      url: string
      headers: { Authorization: string }
    }
  }
}

/**
 * Pure builder for a board worktree's project-scoped .mcp.json: a single loopback
 * streamable-HTTP server entry carrying the board's bearer token. No OAuth
 * discovery is referenced (ADR 0001) — the static bearer token is the authority.
 */
export function buildMcpJson(port: number, token: string): McpJson {
  return {
    mcpServers: {
      'canvas-ade': {
        type: 'http',
        url: `http://127.0.0.1:${port}/mcp`,
        headers: { Authorization: `Bearer ${token}` }
      }
    }
  }
}

/**
 * Write .mcp.json into a board's worktree dir. Returns the written file path.
 * Written owner-only (0600): the file embeds a plaintext bearer token, so it must
 * not be world-readable on a multi-user box. (POSIX mode is a no-op on Windows.)
 */
export function writeMcpJson(dir: string, port: number, token: string): string {
  const file = join(dir, '.mcp.json')
  writeFileSync(file, JSON.stringify(buildMcpJson(port, token), null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600
  })
  return file
}
