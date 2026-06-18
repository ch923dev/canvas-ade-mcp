import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import {
  TOOL_ADD_PLANNING_ELEMENTS,
  TOOL_ASSIGN_PROMPT,
  TOOL_CLOSE_BOARD,
  TOOL_CONFIGURE_BOARD,
  TOOL_GIT_DIFF,
  TOOL_HANDOFF_PROMPT,
  TOOL_INTERRUPT,
  TOOL_ORCHESTRATOR_PING,
  TOOL_PING,
  TOOL_RELAY_PROMPT,
  TOOL_SPAWN_BOARD,
  TOOL_WRITE_RESULT
} from '../../src/constants'

// The capability-split proof: tier is enforced by REGISTRATION, so a worker's
// tools/list never even contains the orchestrator tool.
describe('capability tier split', () => {
  it('worker tools/list omits orchestrator_ping', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL_PING)
    expect(names).not.toContain(TOOL_ORCHESTRATOR_PING)
    await client.close()
  })

  it('orchestrator tools/list includes orchestrator_ping', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL_PING)
    expect(names).toContain(TOOL_ORCHESTRATOR_PING)
    await client.close()
  })

  // Connected tier (Agent Orchestration v1): a narrow slice — relay along its own cables +
  // act on the canvas (spawn/configure/plan-write). NONE of the cross-board/observational tools.
  describe('connected tier (Agent Orchestration)', () => {
    it('includes relay_prompt + spawn_board + configure_board + write_result', async () => {
      const client = await connectInMemory('connected')
      const names = (await client.listTools()).tools.map((t) => t.name)
      expect(names).toContain(TOOL_PING)
      expect(names).toContain(TOOL_RELAY_PROMPT)
      expect(names).toContain(TOOL_SPAWN_BOARD)
      expect(names).toContain(TOOL_CONFIGURE_BOARD)
      expect(names).toContain(TOOL_WRITE_RESULT)
      await client.close()
    })

    it('OMITS orchestrator-only tools (orchestrator_ping / handoff / assign / interrupt / close / git_diff)', async () => {
      const client = await connectInMemory('connected')
      const names = (await client.listTools()).tools.map((t) => t.name)
      for (const omitted of [
        TOOL_ORCHESTRATOR_PING,
        TOOL_HANDOFF_PROMPT,
        TOOL_ASSIGN_PROMPT,
        TOOL_INTERRUPT,
        TOOL_CLOSE_BOARD,
        TOOL_GIT_DIFF
      ]) {
        expect(names).not.toContain(omitted)
      }
      await client.close()
    })

    it('add_planning_elements follows the planningWrite flag (absent off, present on)', async () => {
      const off = await connectInMemory('connected', undefined, 'b', undefined, false)
      expect((await off.listTools()).tools.map((t) => t.name)).not.toContain(
        TOOL_ADD_PLANNING_ELEMENTS
      )
      await off.close()
      const on = await connectInMemory('connected', undefined, 'b', undefined, true)
      expect((await on.listTools()).tools.map((t) => t.name)).toContain(TOOL_ADD_PLANNING_ELEMENTS)
      await on.close()
    })

    it('a lazy planningWrite getter is honored (re-evaluated per session)', async () => {
      const on = await connectInMemory('connected', undefined, 'b', undefined, () => true)
      expect((await on.listTools()).tools.map((t) => t.name)).toContain(TOOL_ADD_PLANNING_ELEMENTS)
      await on.close()
    })
  })
})
