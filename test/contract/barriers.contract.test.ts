import { afterEach, describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { EmittingOrchestrator } from '../helpers/emittingOrchestrator'
import { resolveBarrierTimeout } from '../../src/server/tools/barriers'
import {
  TOOL_WAIT_FOR_IDLE,
  TOOL_WAIT_FOR_ALL,
  DEFAULT_BARRIER_TIMEOUT_MS,
  MAX_ACTIVE_BARRIERS
} from '../../src/constants'

function readText(content: unknown): string {
  return (content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
}

describe('barrier tools (M5, orchestrator-tier)', () => {
  it('worker tools/list OMITS both barrier tools (capability split)', async () => {
    const client = await connectInMemory('worker')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain(TOOL_WAIT_FOR_IDLE)
    expect(names).not.toContain(TOOL_WAIT_FOR_ALL)
    await client.close()
  })

  it('orchestrator tools/list INCLUDES both barrier tools', async () => {
    const client = await connectInMemory('orchestrator')
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain(TOOL_WAIT_FOR_IDLE)
    expect(names).toContain(TOOL_WAIT_FOR_ALL)
    await client.close()
  })

  it('wait_for_idle resolves the settled status as JSON', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'idle' }]
    orch.setResult('t1', { present: true, status: 'success' })
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL_WAIT_FOR_IDLE,
      arguments: { boardId: 't1', timeoutMs: 0 }
    })
    expect(JSON.parse(readText(res.content))).toEqual({
      id: 't1',
      status: 'idle',
      result: { present: true, status: 'success' }
    })
    await client.close()
  })

  it('wait_for_all reports each board + allIdle', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [
      { id: 'a', type: 'terminal', title: 'A', status: 'idle' },
      { id: 'b', type: 'terminal', title: 'B', status: 'blocked' }
    ]
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL_WAIT_FOR_ALL,
      arguments: { boardIds: ['a', 'b'] }
    })
    expect(JSON.parse(readText(res.content))).toEqual({
      boards: [
        { id: 'a', status: 'idle' },
        { id: 'b', status: 'blocked' }
      ],
      allIdle: false
    })
    await client.close()
  })

  it('wait_for_all reports allIdle true and passes through per-board results', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [
      { id: 'a', type: 'terminal', title: 'A', status: 'idle' },
      { id: 'b', type: 'terminal', title: 'B', status: 'idle' }
    ]
    orch.setResult('a', { present: true, status: 'success' })
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL_WAIT_FOR_ALL,
      arguments: { boardIds: ['a', 'b'], timeoutMs: 0 }
    })
    expect(JSON.parse(readText(res.content))).toEqual({
      boards: [
        { id: 'a', status: 'idle', result: { present: true, status: 'success' } },
        { id: 'b', status: 'idle' }
      ],
      allIdle: true
    })
    await client.close()
  })

  it('wait_for_idle backstop resolves timed-out (never errors)', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    const client = await connectInMemory('orchestrator', orch)
    const res = await client.callTool({
      name: TOOL_WAIT_FOR_IDLE,
      arguments: { boardId: 't1', timeoutMs: 10 }
    })
    expect(res.isError).toBeFalsy()
    expect(JSON.parse(readText(res.content))).toEqual({ id: 't1', status: 'timed-out' })
    await client.close()
  })

  it('🔒 caps concurrent waits per session; the over-cap call is a structured isError', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = Array.from({ length: MAX_ACTIVE_BARRIERS + 1 }, (_, i) => ({
      id: `b${i}`,
      type: 'terminal',
      title: `B${i}`,
      status: 'running'
    }))
    const client = await connectInMemory('orchestrator', orch)
    // Fill the cap with never-settling waits (boards stay running; no backstop).
    const inflight = Array.from({ length: MAX_ACTIVE_BARRIERS }, (_, i) =>
      client.callTool({
        name: TOOL_WAIT_FOR_IDLE,
        arguments: { boardId: `b${i}`, timeoutMs: 0 }
      })
    )
    // Let the requests land server-side before probing the cap.
    await new Promise((r) => setTimeout(r, 25))
    const over = await client.callTool({
      name: TOOL_WAIT_FOR_IDLE,
      arguments: { boardId: `b${MAX_ACTIVE_BARRIERS}`, timeoutMs: 0 }
    })
    expect(over.isError).toBe(true)
    expect(readText(over.content)).toContain('too many concurrent barrier waits')
    // Settle every board so the in-flight waits resolve and a slot frees up again.
    for (let i = 0; i < MAX_ACTIVE_BARRIERS + 1; i++) orch.emit({ id: `b${i}`, status: 'idle' })
    await Promise.all(inflight)
    const after = await client.callTool({
      name: TOOL_WAIT_FOR_IDLE,
      arguments: { boardId: 'b0', timeoutMs: 0 }
    })
    expect(after.isError).toBeFalsy()
    await client.close()
  })

  it('rejects an empty boardId / empty boardIds at the schema', async () => {
    const client = await connectInMemory('orchestrator')
    const a = await client.callTool({ name: TOOL_WAIT_FOR_IDLE, arguments: { boardId: '' } })
    const b = await client.callTool({ name: TOOL_WAIT_FOR_ALL, arguments: { boardIds: [] } })
    expect(a.isError).toBe(true)
    expect(b.isError).toBe(true)
    await client.close()
  })
})

describe('resolveBarrierTimeout', () => {
  const KEY = 'CANVAS_ADE_BARRIER_TIMEOUT_MS'
  const original = process.env[KEY]
  afterEach(() => {
    if (original === undefined) delete process.env[KEY]
    else process.env[KEY] = original
  })

  it('an explicit arg wins (even 0 / negative, which opt out downstream)', () => {
    process.env[KEY] = '5000'
    expect(resolveBarrierTimeout(123)).toBe(123)
    expect(resolveBarrierTimeout(0)).toBe(0)
    expect(resolveBarrierTimeout(-1)).toBe(-1)
  })

  it('falls back to a valid env override when no arg is given', () => {
    process.env[KEY] = '5000'
    expect(resolveBarrierTimeout()).toBe(5000)
  })

  it('ignores a non-positive / non-finite / unparseable env and uses the default', () => {
    for (const bad of ['0', '-10', 'abc', 'Infinity', '']) {
      process.env[KEY] = bad
      expect(resolveBarrierTimeout()).toBe(DEFAULT_BARRIER_TIMEOUT_MS)
    }
  })

  it('uses the default when neither arg nor env is set', () => {
    delete process.env[KEY]
    expect(resolveBarrierTimeout()).toBe(DEFAULT_BARRIER_TIMEOUT_MS)
  })
})
