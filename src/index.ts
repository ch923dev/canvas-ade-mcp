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
export type {
  Orchestrator,
  BoardStatusChange,
  BoardSummary,
  BoardOutput,
  BoardResult,
  BoardResultInput,
  MemoryDoc,
  PlanningElementSpec,
  PlanningElementsSpec,
  PlanningNoteTint
} from './orchestrator/Orchestrator'
export { MAX_OUTPUT_PAGE } from './constants'
export type { Tier, Scope, AuthRow, BoardId } from './types'
// Prompts substrate (W1-F) — the in-package "skills" foundation. `registerPrompts`
// stays internal (called only by ServerFactory); the registry + types are public so
// Wave-2 playbook files can `promptRegistry.register(...)` in side-effect imports.
export { PromptRegistry, promptRegistry } from './prompts/registry'
export type { PromptArgs, PromptMessage, PromptSpec } from './prompts/registry'
