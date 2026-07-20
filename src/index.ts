export { createMcpHttpServer } from './server/mcpHttp'
export type { McpServerDeps, RunningMcpServer } from './server/mcpHttp'
// ServerFactory builds a per-session, tier-gated McpServer. Exported so a host can unit-test that
// its own tool catalog (e.g. the app's APP_TOOLS) stays in lockstep with what the package actually
// registers per tier (the F25 drift guard) without standing up a full HTTP server.
export { ServerFactory } from './server/factory'
export type { SessionCtx } from './server/factory'
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
  PlanningElementPatch,
  PlanningNoteTint,
  DiagramSpec,
  DiagramSpecNode,
  DiagramSpecEdge,
  DiagramSpecGroup,
  DiagramSpecOp,
  DiagramSpecStatus,
  DiagramSpecNodeKind,
  DiagramSpecEdgeKind,
  RelayItem,
  RelayResult,
  KanbanCardSpec,
  KanbanCardPatch,
  PlanItem,
  Visualization,
  VisualizePlanSpec,
  SpawnGroupInput,
  SpawnGroupResult
} from './orchestrator/Orchestrator'
export { MAX_OUTPUT_PAGE } from './constants'
// Kanban card write caps — exported so the HOST (expanse-desktop) can assert its authoritative caps
// (`mcpKanban.ts`) match these transport caps in a cross-repo parity test. A silent drift here (e.g. a
// wire cap laxer than the host) lets a payload ack `true` on the wire then get rejected by the host.
export {
  MAX_CARD_TITLE,
  MAX_CARD_TAG,
  MAX_CARD_ASSIGNEE,
  MAX_CARD_REF,
  MAX_CARD_ID,
  MAX_COLUMN_ID,
  MAX_CARD_DESCRIPTION,
  MAX_CARD_TAGS,
  MAX_CARD_FILE_REFS,
  MAX_CARD_FILE_REF_PATH,
  MAX_AXIS_LABEL
} from './constants'
// Planning-element + structured-diagram transport caps (diagram Phase 3) — exported for the same
// cross-repo parity test: the host asserts these NAME-FOR-NAME against its authoritative caps
// (`mcpPlanning.ts` / `lib/diagramSpec.ts`) so a wire cap can never silently drift laxer.
export {
  MAX_PLANNING_ELEMENTS_PER_CALL,
  MAX_PLANNING_ITEMS,
  MAX_PLANNING_TEXT,
  MAX_PLANNING_TITLE,
  MAX_PLANNING_LABEL,
  MAX_PLANNING_DIAGRAM,
  MAX_PLANNING_SECTION,
  MAX_PLANNING_ELEMENT_ID,
  MAX_PLANNING_READ_ELEMENTS,
  SPEC_MAX_NODES,
  SPEC_MAX_EDGES,
  SPEC_MAX_GROUPS,
  SPEC_ID_MAX,
  SPEC_LABEL_MAX,
  SPEC_DETAIL_MAX,
  SPEC_EDGE_LABEL_MAX,
  SPEC_TITLE_MAX,
  SPEC_ICON_MAX,
  SPEC_HREF_FILE_MAX,
  SPEC_THEME_MAX,
  MAX_DIAGRAM_SPEC_BYTES,
  MAX_SPEC_OPS
} from './constants'
export type { Tier, Scope, AuthRow, BoardId } from './types'
// Prompts substrate (W1-F) — the in-package "skills" foundation. `registerPrompts`
// stays internal (called only by ServerFactory); the registry + types are public so
// Wave-2 playbook files can `promptRegistry.register(...)` in side-effect imports.
export { PromptRegistry, promptRegistry } from './prompts/registry'
export type { PromptArgs, PromptMessage, PromptSpec } from './prompts/registry'
