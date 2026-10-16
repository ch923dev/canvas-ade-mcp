import { describe, expect, it } from 'vitest'
import * as pkg from '../../src/index'
import * as constants from '../../src/constants'

// The package ROOT is the only surface the host (expanse-desktop) can import, and its cross-repo
// parity tests (e.g. src/main/mcpPlanningCapsParity.test.ts) look caps up BY NAME on it: an entry
// that reads `undefined` SKIPS rather than fails, so an accidentally dropped export would silently
// disarm the host's drift guard. This pins every parity-tested cap to the root, value-for-value.
describe('package root exports every host-mirrored transport cap', () => {
  const root = pkg as unknown as Record<string, unknown>
  const consts = constants as unknown as Record<string, unknown>

  const caps = [
    // 0.26.0 additions
    'WRITE_RESULT_MAX_SUMMARY',
    'WRITE_RESULT_MAX_REFS',
    'WRITE_RESULT_MAX_REF_LEN',
    'SPAWN_BOARD_MAX_TITLE',
    'SPAWN_BOARD_MAX_PROMPT',
    'SPAWN_BOARD_MAX_URL',
    'SPAWN_GROUP_MAX_NAME',
    'SPAWN_GROUP_MAX_LAUNCH',
    'MAX_RELAY_BATCH',
    'MAX_PLAN_ITEMS',
    'MAX_PLAN_ITEM_TITLE',
    'MAX_PLAN_ITEM_STATUS',
    'MAX_PLAN_ITEM_TAG',
    'MAX_PLAN_ITEM_ASSIGNEE',
    'MAX_PLAN_ITEM_NOTE',
    'MAX_PLAN_TITLE',
    'MAX_KANBAN_COLUMNS',
    'MAX_KANBAN_CARDS',
    // pre-existing exports the host already parity-tests (regression lock)
    'MAX_OUTPUT_PAGE',
    'MAX_CARD_TITLE',
    'MAX_CARD_FILE_REF_PATH',
    'MAX_PLANNING_ELEMENTS_PER_CALL',
    'SPEC_MAX_NODES',
    'MAX_DIAGRAM_SPEC_BYTES',
    'MAX_SPEC_OPS'
  ]

  for (const name of caps) {
    it(`${name} is exported from the root with its constants.ts value`, () => {
      expect(typeof consts[name]).toBe('number')
      expect(root[name]).toBe(consts[name])
    })
  }

  it('the 0.26.0 values match the host clamps they mirror', () => {
    // Literal pins: a change here is a cross-repo contract change and must move with the host.
    expect(pkg.WRITE_RESULT_MAX_SUMMARY).toBe(100_000)
    expect(pkg.WRITE_RESULT_MAX_REFS).toBe(256)
    expect(pkg.WRITE_RESULT_MAX_REF_LEN).toBe(256)
    expect(pkg.SPAWN_BOARD_MAX_TITLE).toBe(80)
    expect(pkg.SPAWN_BOARD_MAX_PROMPT).toBe(400)
    expect(pkg.SPAWN_BOARD_MAX_URL).toBe(2048)
    expect(pkg.SPAWN_GROUP_MAX_NAME).toBe(80)
    expect(pkg.SPAWN_GROUP_MAX_LAUNCH).toBe(400)
    expect(pkg.MAX_RELAY_BATCH).toBe(10)
    expect(pkg.MAX_PLAN_ITEMS).toBe(100)
    expect(pkg.MAX_PLAN_TITLE).toBe(200)
    expect(pkg.MAX_KANBAN_COLUMNS).toBe(50)
    expect(pkg.MAX_KANBAN_CARDS).toBe(300)
  })
})

// C6 spatial-awareness wire (0.27.0). The host's parity test (SPEC §5, the
// mcpPlanningCapsParity pattern) looks these up by name on the root — pin every one of them here.
describe('package root exports the C6 spatial wire (0.27.0)', () => {
  const root = pkg as unknown as Record<string, unknown>
  const consts = constants as unknown as Record<string, unknown>

  const caps = ['MAX_GROUP_BATCH', 'MAX_GROUP_MEMBERS', 'GROUP_NAME_MAX', 'MAX_CONTEXTS']
  for (const name of caps) {
    it(`${name} is exported from the root with its constants.ts value`, () => {
      expect(typeof consts[name]).toBe('number')
      expect(root[name]).toBe(consts[name])
    })
  }

  it('the C6 cap values are the SPEC values', () => {
    expect(pkg.MAX_GROUP_BATCH).toBe(10)
    expect(pkg.MAX_GROUP_MEMBERS).toBe(50)
    expect(pkg.GROUP_NAME_MAX).toBe(80)
    expect(pkg.MAX_CONTEXTS).toBe(50)
  })

  it('🔒 GROUP_NAME_MAX === SPAWN_GROUP_MAX_NAME (one group name, two tools)', () => {
    expect(pkg.GROUP_NAME_MAX).toBe(pkg.SPAWN_GROUP_MAX_NAME)
  })

  it('the vocabularies are exported verbatim', () => {
    expect(pkg.TIDY_MODES).toBe(constants.TIDY_MODES)
    expect([...pkg.TIDY_MODES]).toEqual(['fit', 'roles', 'smart', 'by-type', 'grid', 'tile'])
    expect([...pkg.TILE_TEMPLATES]).toEqual(['cols-2', 'cols-3', 'cols-4', 'main-sidebar', 'grid'])
    expect([...pkg.TIDY_OVERFLOW]).toEqual(['report', 'pages', 'shrink'])
  })

  it('the tool names + the contexts URI are exported', () => {
    expect(pkg.TOOL_GROUP_BOARDS).toBe('group_boards')
    expect(pkg.TOOL_EDIT_GROUPS).toBe('edit_groups')
    expect(pkg.TOOL_TIDY_CANVAS).toBe('tidy_canvas')
    expect(pkg.TOOL_FOCUS_VIEWPORT).toBe('focus_viewport')
    expect(pkg.CONTEXTS_URI).toBe('canvas://contexts')
    expect(pkg.MAX_FOCUS_TARGET_ID).toBe(200)
  })
})
