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
