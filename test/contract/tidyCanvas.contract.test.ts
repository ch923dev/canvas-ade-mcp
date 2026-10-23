import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { TidyCanvasInput } from '../../src/orchestrator/Orchestrator'
import { MAX_FOCUS_TARGET_ID, TIDY_MODES, TILE_TEMPLATES, TIDY_OVERFLOW } from '../../src/constants'
import type { Tier } from '../../src/types'

// tidy_canvas (P2, widened 0.27.0 / spatial-awareness C6) arranges the canvas to fit the user's
// screen. Registered for orchestrator + lead + connected (D1); never worker. The orchestrator tier is
// un-gated host-side; a lead/connected call binds the caller's token-derived board id as
// sourceBoardId so the HOST can raise its confirm. The host owns the packers + the result shape; this
// tool is the thin transport — and it must NEVER fill a default mode (D8 a).
const TOOL = 'tidy_canvas'

/** Records every tidyCanvas call and returns a deterministic C6 result, to prove the passthrough. */
class SpyOrchestrator extends MockOrchestrator {
  calls: TidyCanvasInput[] = []
  override async tidyCanvas(input: TidyCanvasInput): Promise<unknown> {
    this.calls.push(input)
    return { moved: 3, fitZoom: 0.62, readable: true }
  }
}

function parse(res: unknown): Record<string, unknown> {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? []
  const text = content.map((c) => c.text ?? '').join('')
  return JSON.parse(text)
}

function text(res: unknown): string {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? []
  return content.map((c) => c.text ?? '').join('')
}

function errorCode(res: unknown): unknown {
  return (res as { structuredContent?: { error?: { code?: unknown } } }).structuredContent?.error
    ?.code
}

/** Call tidy_canvas at `tier` with `args`; return the result + every call the host saw. */
async function call(args: Record<string, unknown>, tier: Tier = 'orchestrator', boardId = 'b') {
  const orch = new SpyOrchestrator()
  const client = await connectInMemory(tier, orch, boardId)
  const res = await client.callTool({ name: TOOL, arguments: args })
  await client.close()
  return { res, calls: orch.calls }
}

describe('tidy_canvas — tier membership (D1)', () => {
  for (const tier of ['orchestrator', 'lead', 'connected'] as const) {
    it(`${tier} tools/list INCLUDES tidy_canvas`, async () => {
      const client = await connectInMemory(tier)
      expect((await client.listTools()).tools.map((t) => t.name)).toContain(TOOL)
      await client.close()
    })
  }

  it('worker tools/list OMITS tidy_canvas', async () => {
    const client = await connectInMemory('worker')
    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain(TOOL)
    await client.close()
  })
})

describe('tidy_canvas — forwarding + the D8 (a) no-default rule', () => {
  it('forwards the mode and returns the host result as JSON', async () => {
    const { res, calls } = await call({ mode: 'grid' })
    expect(res.isError).toBeFalsy()
    expect(calls).toEqual([{ mode: 'grid' }])
    expect(parse(res)).toEqual({ moved: 3, fitZoom: 0.62, readable: true })
  })

  it('🔒 an OMITTED mode reaches the host as undefined — no default is injected (D8 a)', async () => {
    // The host reads undefined as an IMPLICIT roles (shell-only units fall back to fit) and must be
    // able to tell it from an explicit mode:'roles'. A package-side default would erase that.
    const { res, calls } = await call({})
    expect(res.isError).toBeFalsy()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.mode).toBeUndefined()
    expect('mode' in calls[0]!).toBe(false)
    // fit is described as default-true but likewise left off the wire (the host owns the default).
    expect('fit' in calls[0]!).toBe(false)
  })

  it('an explicit mode:"roles" arrives as "roles" (distinguishable from the omitted case)', async () => {
    const { calls } = await call({ mode: 'roles' })
    expect(calls).toEqual([{ mode: 'roles' }])
  })

  it('the advertised inputSchema carries no default for mode', async () => {
    const client = await connectInMemory('orchestrator')
    const tool = (await client.listTools()).tools.find((t) => t.name === TOOL)!
    const props = (tool.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>
    expect(Object.keys(props).sort()).toEqual(
      ['fit', 'mode', 'overflow', 'primary', 'resize', 'scope', 'template'].sort()
    )
    expect(props.mode).not.toHaveProperty('default')
    expect(tool.inputSchema.required ?? []).toEqual([])
    await client.close()
  })

  it('forwards every C6 field verbatim', async () => {
    const args = {
      mode: 'roles',
      scope: { groupId: 'g-1' },
      overflow: 'pages',
      fit: false,
      primary: 'b-hero',
      resize: false
    }
    const { res, calls } = await call(args)
    expect(res.isError).toBeFalsy()
    expect(calls).toEqual([args])
  })

  it('accepts every scope form', async () => {
    for (const scope of ['all', 'visible', { groupId: 'g-1' }]) {
      const { res, calls } = await call({ mode: 'fit', scope })
      expect(res.isError, JSON.stringify(scope)).toBeFalsy()
      expect(calls).toEqual([{ mode: 'fit', scope }])
    }
  })

  it('rejects an unknown scope string and an over-long scope groupId', async () => {
    for (const scope of ['selection', { groupId: 'x'.repeat(MAX_FOCUS_TARGET_ID + 1) }]) {
      const { res, calls } = await call({ scope })
      expect(res.isError, JSON.stringify(scope)).toBe(true)
      expect(errorCode(res)).toBe('invalid_input')
      expect(calls).toHaveLength(0)
    }
  })
})

describe('tidy_canvas — enum widening (C6)', () => {
  it('the mode vocabulary is exactly the C6 set', () => {
    expect([...TIDY_MODES]).toEqual(['fit', 'roles', 'smart', 'by-type', 'grid', 'tile'])
    expect([...TILE_TEMPLATES]).toEqual(['cols-2', 'cols-3', 'cols-4', 'main-sidebar', 'grid'])
    expect([...TIDY_OVERFLOW]).toEqual(['report', 'pages', 'shrink'])
  })

  for (const mode of TIDY_MODES) {
    it(`accepts mode "${mode}"`, async () => {
      const args = mode === 'tile' ? { mode, template: 'cols-2' } : { mode }
      const { res, calls } = await call(args)
      expect(res.isError).toBeFalsy()
      expect(calls).toEqual([args])
    })
  }

  for (const overflow of TIDY_OVERFLOW) {
    it(`accepts overflow "${overflow}"`, async () => {
      const { res, calls } = await call({ mode: 'fit', overflow })
      expect(res.isError).toBeFalsy()
      expect(calls).toEqual([{ mode: 'fit', overflow }])
    })
  }

  it('rejects an off-enum mode WITHOUT calling the host', async () => {
    const { res, calls } = await call({ mode: 'diagonal' })
    expect(res.isError).toBe(true)
    expect(errorCode(res)).toBe('invalid_input')
    expect(calls).toHaveLength(0)
  })

  it('rejects an off-enum overflow WITHOUT calling the host', async () => {
    const { res, calls } = await call({ mode: 'fit', overflow: 'scroll' })
    expect(res.isError).toBe(true)
    expect(calls).toHaveLength(0)
  })
})

describe('tidy_canvas — template iff mode "tile"', () => {
  for (const template of TILE_TEMPLATES) {
    it(`mode "tile" + template "${template}" is accepted`, async () => {
      const { res, calls } = await call({ mode: 'tile', template })
      expect(res.isError).toBeFalsy()
      expect(calls).toEqual([{ mode: 'tile', template }])
    })
  }

  it('mode "tile" WITHOUT a template is rejected with a clear error', async () => {
    const { res, calls } = await call({ mode: 'tile' })
    expect(res.isError).toBe(true)
    expect(errorCode(res)).toBe('invalid_input')
    expect(text(res)).toContain("template is required when mode is 'tile'")
    expect(calls).toHaveLength(0)
  })

  it('a template with any other explicit mode is rejected', async () => {
    for (const mode of TIDY_MODES.filter((m) => m !== 'tile')) {
      const { res, calls } = await call({ mode, template: 'cols-2' })
      expect(res.isError, mode).toBe(true)
      expect(text(res)).toContain("template is only valid with mode 'tile'")
      expect(calls).toHaveLength(0)
    }
  })

  it('a template with NO mode is rejected (an omitted mode is roles, not tile)', async () => {
    const { res, calls } = await call({ template: 'cols-3' })
    expect(res.isError).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('an off-enum template is rejected', async () => {
    const { res, calls } = await call({ mode: 'tile', template: 'cols-9' })
    expect(res.isError).toBe(true)
    expect(calls).toHaveLength(0)
  })
})

describe('tidy_canvas — primary / resize are roles-only (REJECTED with other modes)', () => {
  it('accepted with mode "roles"', async () => {
    const { res, calls } = await call({ mode: 'roles', primary: 'b-1', resize: false })
    expect(res.isError).toBeFalsy()
    expect(calls).toEqual([{ mode: 'roles', primary: 'b-1', resize: false }])
  })

  it('accepted with NO mode (the implicit roles default) — mode still arrives undefined', async () => {
    const { res, calls } = await call({ primary: 'b-1', resize: true })
    expect(res.isError).toBeFalsy()
    expect(calls).toEqual([{ primary: 'b-1', resize: true }])
    expect('mode' in calls[0]!).toBe(false)
  })

  for (const mode of TIDY_MODES.filter((m) => m !== 'roles')) {
    it(`primary + resize are each rejected with mode "${mode}"`, async () => {
      const base = mode === 'tile' ? { mode, template: 'grid' } : { mode }
      for (const extra of [{ primary: 'b-1' }, { resize: false }]) {
        const { res, calls } = await call({ ...base, ...extra })
        expect(res.isError, JSON.stringify(extra)).toBe(true)
        expect(errorCode(res)).toBe('invalid_input')
        expect(text(res)).toContain('roles-only')
        expect(calls).toHaveLength(0)
      }
    })
  }

  it('an over-long primary id is rejected', async () => {
    const { res, calls } = await call({ primary: 'x'.repeat(MAX_FOCUS_TARGET_ID + 1) })
    expect(res.isError).toBe(true)
    expect(calls).toHaveLength(0)
  })
})

describe('tidy_canvas — 🔒 sourceBoardId binding (the D1 confirm trigger)', () => {
  it('orchestrator caller: sourceBoardId is ABSENT (un-gated host-side)', async () => {
    const { calls } = await call({ mode: 'fit' }, 'orchestrator', 'app')
    expect(calls).toEqual([{ mode: 'fit' }])
    expect('sourceBoardId' in calls[0]!).toBe(false)
  })

  for (const tier of ['lead', 'connected'] as const) {
    it(`${tier} caller: sourceBoardId is the caller's token-derived board id`, async () => {
      const { calls } = await call({ mode: 'fit' }, tier, `${tier}-board`)
      expect(calls).toEqual([{ mode: 'fit', sourceBoardId: `${tier}-board` }])
    })
  }

  it('a client-supplied sourceBoardId is STRIPPED, never forwarded (orchestrator tier)', async () => {
    const { calls } = await call({ mode: 'fit', sourceBoardId: 'forged' }, 'orchestrator', 'app')
    expect(calls).toEqual([{ mode: 'fit' }])
  })

  it('a client-supplied sourceBoardId cannot override a connected caller’s own id', async () => {
    const { calls } = await call({ sourceBoardId: 'forged' }, 'connected', 'my-board')
    expect(calls).toEqual([{ sourceBoardId: 'my-board' }])
  })
})

describe('tidy_canvas — description contract (C6)', () => {
  it('states the default, what moves, the one-undo rule, the return shape and when to call', async () => {
    const client = await connectInMemory('orchestrator')
    const tool = (await client.listTools()).tools.find((t) => t.name === TOOL)!
    const d = tool.description ?? ''
    expect(d).toMatch(/omit it for the default/i)
    expect(d).toMatch(/positions only/i)
    expect(d).toMatch(/ONE undo step/)
    expect(d).toContain('{ moved, fitZoom, readable, pages?, units? }')
    expect(d).toContain('canvas://layout')
    expect(d).toContain('fit.readable')
    expect(d).toContain('focus_viewport')
    await client.close()
  })
})
