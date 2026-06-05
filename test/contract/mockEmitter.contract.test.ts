import { describe, expect, it } from 'vitest'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { BoardStatusChange } from '../../src/orchestrator/Orchestrator'

describe('MockOrchestrator.subscribeStatus / __emitStatus', () => {
  it('delivers emitted changes to subscribers and stops after unsubscribe', () => {
    const orch = new MockOrchestrator()
    const seen: BoardStatusChange[] = []
    const unsub = orch.subscribeStatus((c) => seen.push(c))

    orch.__emitStatus({ id: 'a', status: 'running' })
    orch.__emitStatus({ id: 'a', status: 'idle' })
    unsub()
    orch.__emitStatus({ id: 'a', status: 'running' }) // ignored

    expect(seen).toEqual([
      { id: 'a', status: 'running' },
      { id: 'a', status: 'idle' }
    ])
  })

  it('isolates a throwing listener from the others', () => {
    const orch = new MockOrchestrator()
    const seen: BoardStatusChange[] = []
    orch.subscribeStatus(() => {
      throw new Error('boom')
    })
    orch.subscribeStatus((c) => seen.push(c))
    expect(() => orch.__emitStatus({ id: 'a', status: 'idle' })).not.toThrow()
    expect(seen).toEqual([{ id: 'a', status: 'idle' }])
  })
})
