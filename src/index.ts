export { createMcpHttpServer } from './server/mcpHttp'
export type { McpServerDeps, RunningMcpServer } from './server/mcpHttp'
export { TokenStore } from './auth/tokens'
export { mintBoardToken } from './auth/mint'
export type { MintedToken } from './auth/mint'
export {
  defaultScopesFor,
  SCOPE_READ,
  SCOPE_DISPATCH,
  SCOPE_SPAWN,
  SCOPE_GIT_WRITE,
  SCOPE_ANSWER_PERMISSION
} from './auth/scopes'
export { buildMcpJson, writeMcpJson } from './config/mcpJson'
export type { McpJson } from './config/mcpJson'
export { MockOrchestrator } from './orchestrator/mock'
export type { Orchestrator, BoardSummary, BoardOutput } from './orchestrator/Orchestrator'
export { MAX_OUTPUT_PAGE } from './constants'
export type { Tier, Scope, AuthRow, BoardId } from './types'
