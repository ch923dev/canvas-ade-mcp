import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { ArrangeMainBoardInput } from '../../src/orchestrator/Orchestrator'
import { resetWarnSkipped } from '../../src/server/tools/spatialShared'
import {
  MAIN_SIDES,
  MAX_FOCUS_TARGET_ID,
  TOOL_ARRANGE_MAIN_BOARD,
  TOOL_TIDY_CANVAS
} from '../../src/constants'
import type { Tier } from '../../src/types'

// arrange_main_board (0.28.0) — the MAIN + SIDEBAR intent ("make the browser the main one"): one
// board takes the big slot, every other in-scope board moves into a sidebar beside it. Registered
// for orchestrator + lead + connected (D1); never worker. The host maps it onto its tidy engine with
// primary = boardId; this tool is the thin transport — it validates, forwards verbatim, never fills a
// default, and binds a lead/connected caller's token-derived board id as sourceBoardId (the D1
// confirm trigger). OPTIONAL host method: absent ⇒ tool absent + one warn.
const TOOL = TOOL_ARRANGE_MAIN_BOARD

const RESULT = { moved: 4, fitZoom: 0.71, readable: true, units: [{ heroIds: ['b-main'] }] }

/** Records every arrangeMainBoard call and returns a deterministic result, to prove the passthrough. */
class SpyOrchestrator extends MockOrchestrator {
  calls: ArrangeMainBoardInput[] = []
  override async arrangeMainBoard(input: ArrangeMainBoardInput): Promise<unknown> {
    this.calls.push(input)
    return RESULT
  }
}

/** A host that has not wired the optional method. */
class NoArrangeMainBoard extends MockOrchestrator {
  override arrangeMainBoard = undefined as unknown as MockOrchestrator['arrangeMainBoard']
}

function parse(res: unknown): unknown {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? []
  return JSON.parse(content.map((c) => c.text ?? '').join(''))
}

function errorCode(res: unknown): unknown {
  return (res as { structuredContent?: { error?: { code?: unknown } } }).structuredContent?.error
    ?.code
}

/** Call arrange_main_board at `tier` with `args`; return the result + every call the host saw. */
async function call(args: Record<string, unknown>, tier: Tier = 'orchestrator', boardId = 'b') {
  const orch = new SpyOrchestrator()
  const client = await connectInMemory(tier, orch, boardId)
  const res = await client.callTool({ name: TOOL, arguments: args })
  await client.close()
  return { res, calls: orch.calls }
}

async function toolNames(tier: Tier, orch = new MockOrchestrator()): Promise<string[]> {
  const client = await connectInMemory(tier, orch)
  const names = (await client.listTools()).tools.map((t) => t.name)
  await client.close()
  return names
}

describe('arrange_main_board — tier membership (D1)', () => {
  for (const tier of ['orchestrator', 'lead', 'connected'] as const) {
    it(`${tier} tools/list INCLUDES arrange_main_board`, async () => {
      expect(await toolNames(tier)).toContain(TOOL)
    })
  }

  it('worker tools/list OMITS arrange_main_board', async () => {
    expect(await toolNames('worker')).not.toContain(TOOL)
  })
})

describe('arrange_main_board — forwarding (verbatim, nothing invented)', () => {
  it('forwards boardId alone and adds NO default side / scope / fit', async () => {
    const { res, calls } = await call({ boardId: 'b-main' })
    expect(res.isError).toBeFalsy()
    expect(calls).toEqual([{ boardId: 'b-main' }])
    for (const field of ['side', 'scope', 'fit', 'sourceBoardId']) {
      expect(field in calls[0]!, field).toBe(false)
    }
  })

  it('forwards boardId / side / scope / fit verbatim', async () => {
    const args = { boardId: 'b-main', side: 'bottom', scope: { groupId: 'g-1' }, fit: false }
    const { res, calls } = await call(args)
    expect(res.isError).toBeFalsy()
    expect(calls).toEqual([args])
  })

  for (const side of MAIN_SIDES) {
    it(`accepts side "${side}"`, async () => {
      const { res, calls } = await call({ boardId: 'b-main', side })
      expect(res.isError).toBeFalsy()
      expect(calls).toEqual([{ boardId: 'b-main', side }])
    })
  }

  it('accepts every scope form', async () => {
    for (const scope of ['all', 'visible', { groupId: 'g-1' }]) {
      const { res, calls } = await call({ boardId: 'b-main', scope })
      expect(res.isError, JSON.stringify(scope)).toBeFalsy()
      expect(calls).toEqual([{ boardId: 'b-main', scope }])
    }
  })

  it('serializes the host result as JSON text', async () => {
    const { res } = await call({ boardId: 'b-main' })
    expect(parse(res)).toEqual(RESULT)
  })

  it('tidy_canvas-only fields are stripped, never forwarded', async () => {
    const { res, calls } = await call({ boardId: 'b-main', mode: 'grid', primary: 'other' })
    expect(res.isError).toBeFalsy()
    expect(calls).toEqual([{ boardId: 'b-main' }])
  })
})

describe('arrange_main_board — schema', () => {
  it('advertises boardId as REQUIRED and no default on any field', async () => {
    const client = await connectInMemory('orchestrator')
    const tool = (await client.listTools()).tools.find((t) => t.name === TOOL)!
    await client.close()
    const props = (tool.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>
    expect(Object.keys(props).sort()).toEqual(['boardId', 'fit', 'scope', 'side'])
    expect(tool.inputSchema.required ?? []).toEqual(['boardId'])
    for (const [name, prop] of Object.entries(props)) {
      expect(prop, name).not.toHaveProperty('default')
    }
  })

  const rejected: Array<[string, Record<string, unknown>]> = [
    ['a missing boardId', {}],
    ['a missing boardId (options only)', { side: 'right', fit: true }],
    ['an empty boardId', { boardId: '' }],
    ['an over-long boardId', { boardId: 'x'.repeat(MAX_FOCUS_TARGET_ID + 1) }],
    ['a non-string boardId', { boardId: 42 }],
    ['an off-enum side', { boardId: 'b-main', side: 'center' }],
    ['an unknown scope string', { boardId: 'b-main', scope: 'selection' }],
    [
      'an over-long scope groupId',
      { boardId: 'b-main', scope: { groupId: 'x'.repeat(MAX_FOCUS_TARGET_ID + 1) } }
    ],
    ['a non-boolean fit', { boardId: 'b-main', fit: 'yes' }]
  ]
  for (const [label, args] of rejected) {
    it(`rejects ${label} WITHOUT calling the host (invalid_input)`, async () => {
      const { res, calls } = await call(args)
      expect(res.isError).toBe(true)
      expect(errorCode(res)).toBe('invalid_input')
      expect(calls).toHaveLength(0)
    })
  }
})

describe('arrange_main_board — 🔒 sourceBoardId binding (the D1 confirm trigger)', () => {
  it('orchestrator caller: sourceBoardId is ABSENT (un-gated host-side)', async () => {
    const { calls } = await call({ boardId: 'b-main' }, 'orchestrator', 'app')
    expect(calls).toEqual([{ boardId: 'b-main' }])
    expect('sourceBoardId' in calls[0]!).toBe(false)
  })

  for (const tier of ['lead', 'connected'] as const) {
    it(`${tier} caller: sourceBoardId is the caller's token-derived board id`, async () => {
      const { calls } = await call({ boardId: 'b-main', side: 'right' }, tier, `${tier}-board`)
      expect(calls).toEqual([{ boardId: 'b-main', side: 'right', sourceBoardId: `${tier}-board` }])
    })
  }

  it('a client-supplied sourceBoardId is STRIPPED, never forwarded (orchestrator tier)', async () => {
    const { calls } = await call({ boardId: 'b-main', sourceBoardId: 'forged' }, 'orchestrator')
    expect(calls).toEqual([{ boardId: 'b-main' }])
  })

  for (const tier of ['lead', 'connected'] as const) {
    it(`a client-supplied sourceBoardId cannot override a ${tier} caller's own id`, async () => {
      const { calls } = await call({ boardId: 'b-main', sourceBoardId: 'forged' }, tier, 'my-board')
      expect(calls).toEqual([{ boardId: 'b-main', sourceBoardId: 'my-board' }])
    })
  }
})

describe('arrange_main_board — optional host method (warn-on-skip)', () => {
  let warn: MockInstance<typeof console.warn>
  beforeEach(() => {
    resetWarnSkipped()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
  })

  it('a wired host: registered with ZERO warnings', async () => {
    for (const tier of ['orchestrator', 'lead', 'connected'] as const) {
      expect(await toolNames(tier), tier).toContain(TOOL)
    }
    expect(warn).not.toHaveBeenCalled()
  })

  it('a host without arrangeMainBoard: the tool is absent at every tier + exactly ONE warn', async () => {
    for (const tier of ['orchestrator', 'lead', 'connected'] as const) {
      const names = await toolNames(tier, new NoArrangeMainBoard())
      expect(names, tier).not.toContain(TOOL)
      // The rest of the spatial surface is unaffected.
      expect(names, tier).toContain(TOOL_TIDY_CANVAS)
    }
    expect(warn).toHaveBeenCalledTimes(1)
    const msg = String(warn.mock.calls[0]![0])
    expect(msg).toContain(TOOL)
    expect(msg).toContain('arrangeMainBoard()')
  })

  it('worker: never checks the method, so an unwired host raises NO warn', async () => {
    await toolNames('worker', new NoArrangeMainBoard())
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('arrange_main_board — description contract', () => {
  it('states the intent, the example phrases, the gate, the undo rule and the return shape', async () => {
    const client = await connectInMemory('orchestrator')
    const tool = (await client.listTools()).tools.find((t) => t.name === TOOL)!
    await client.close()
    const d = tool.description ?? ''
    expect(d).toMatch(/MAIN board/)
    expect(d).toMatch(/EVERY other board/)
    expect(d).toContain('sidebar')
    expect(d).toContain('make the browser the main one')
    expect(d).toContain('focus on the plan and put the rest on the side')
    expect(d).toContain('make the api terminal the big one')
    expect(d).toContain('tidy_canvas')
    expect(d).toContain('docked in a swarm board')
    expect(d).toMatch(/ONE undo step/)
    expect(d).toMatch(/Nothing is created or deleted/)
    expect(d).toMatch(/user approves it first/)
    expect(d).toContain('{ moved, fitZoom, readable, units? }')
  })

  it('tidy_canvas points primary at arrange_main_board (main + sidebar, not "hero")', async () => {
    const client = await connectInMemory('orchestrator')
    const tool = (await client.listTools()).tools.find((t) => t.name === TOOL_TIDY_CANVAS)!
    await client.close()
    const d = tool.description ?? ''
    expect(d).toContain('prefer arrange_main_board')
    expect(d).toContain('every other in-scope board its sidebar')
    expect(d).not.toMatch(/force as the hero/)
  })
})
