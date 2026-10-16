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
// The remaining wire caps that MIRROR a host clamp — exported for the same cross-repo parity test
// (0.26.0). Each one is documented in constants.ts as a mirror of a named host constant; until now
// the host could only copy the number, so a drift on either side was silent. Purely additive.
export {
  // write_result ↔ host mcpOrchestrator.ts WRITE_RESULT_MAX_*
  WRITE_RESULT_MAX_SUMMARY,
  WRITE_RESULT_MAX_REFS,
  WRITE_RESULT_MAX_REF_LEN,
  // spawn_board ↔ host mcpLifecycle.ts (title clamp, the shared 400-char SPAWN_LAUNCH_MAX, url)
  SPAWN_BOARD_MAX_TITLE,
  SPAWN_BOARD_MAX_PROMPT,
  SPAWN_BOARD_MAX_URL,
  // spawn_group ↔ host mcpLifecycle.ts SPAWN_GROUP_MAX_NAME / SPAWN_LAUNCH_MAX
  SPAWN_GROUP_MAX_NAME,
  SPAWN_GROUP_MAX_LAUNCH,
  // relay_prompts batch size (the host re-caps the batch authoritatively)
  MAX_RELAY_BATCH,
  // visualize_plan ↔ host mcpVisualize.ts MAX_PLAN_*
  MAX_PLAN_ITEMS,
  MAX_PLAN_ITEM_TITLE,
  MAX_PLAN_ITEM_STATUS,
  MAX_PLAN_ITEM_TAG,
  MAX_PLAN_ITEM_ASSIGNEE,
  MAX_PLAN_ITEM_NOTE,
  MAX_PLAN_TITLE,
  // canvas://board/{id}/cards read projection ↔ host boardRegistry.ts local copies
  MAX_KANBAN_COLUMNS,
  MAX_KANBAN_CARDS
} from './constants'
export type { Tier, Scope, AuthRow, BoardId } from './types'
// Prompts substrate (W1-F) — the in-package "skills" foundation. `registerPrompts`
// stays internal (called only by ServerFactory); the registry + types are public so
// Wave-2 playbook files can `promptRegistry.register(...)` in side-effect imports.
export { PromptRegistry, promptRegistry } from './prompts/registry'
export type { PromptArgs, PromptMessage, PromptSpec } from './prompts/registry'
