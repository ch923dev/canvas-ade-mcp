import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { EmittingOrchestrator } from '../helpers/emittingOrchestrator'
import { TOOL_WAIT_FOR_IDLE, TOOL_WAIT_FOR_ALL } from '../../src/constants'

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
      arguments: { boardIds: ['a', 'b'], timeoutMs: 0 }
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

  it('rejects an empty boardId / empty boardIds at the schema', async () => {
    const client = await connectInMemory('orchestrator')
    const a = await client.callTool({ name: TOOL_WAIT_FOR_IDLE, arguments: { boardId: '' } })
    const b = await client.callTool({ name: TOOL_WAIT_FOR_ALL, arguments: { boardIds: [] } })
    expect(a.isError).toBe(true)
    expect(b.isError).toBe(true)
    await client.close()
  })
})
