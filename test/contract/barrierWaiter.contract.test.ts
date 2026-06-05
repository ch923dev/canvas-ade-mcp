import { describe, expect, it } from 'vitest'
import { waitForBoards } from '../../src/server/barrierWaiter'
import { EmittingOrchestrator } from '../helpers/emittingOrchestrator'

const NO_TIMEOUT = 0 // ≤ 0 opts out

describe('waitForBoards', () => {
  it('resolves immediately when the target is already settled (idle + result)', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'idle' }]
    orch.setResult('t1', { present: true, status: 'success', summary: 'ok' })
    const { promise } = waitForBoards({
      orchestrator: orch,
      targets: ['t1'],
      timeoutMs: NO_TIMEOUT
    })
    expect(await promise).toEqual([
      { id: 't1', status: 'idle', result: { present: true, status: 'success', summary: 'ok' } }
    ])
  })

  it('resolves on the idle event for a running target (event-driven, no timer)', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    const { promise } = waitForBoards({
      orchestrator: orch,
      targets: ['t1'],
      timeoutMs: NO_TIMEOUT
    })
    queueMicrotask(() => orch.emit({ id: 't1', status: 'idle' }))
    expect(await promise).toEqual([{ id: 't1', status: 'idle' }])
  })

  it('resolves blocked (not idle) for a running→blocked target', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    const { promise } = waitForBoards({
      orchestrator: orch,
      targets: ['t1'],
      timeoutMs: NO_TIMEOUT
    })
    queueMicrotask(() => orch.emit({ id: 't1', status: 'blocked' }))
    expect(await promise).toEqual([{ id: 't1', status: 'blocked' }])
  })

  it('wait-for-all waits for the SLOWEST and preserves input order', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [
      { id: 'a', type: 'terminal', title: 'A', status: 'running' },
      { id: 'b', type: 'terminal', title: 'B', status: 'running' }
    ]
    const { promise } = waitForBoards({
      orchestrator: orch,
      targets: ['a', 'b'],
      timeoutMs: NO_TIMEOUT
    })
    queueMicrotask(() => orch.emit({ id: 'b', status: 'idle' }))
    queueMicrotask(() => orch.emit({ id: 'a', status: 'failed' }))
    expect(await promise).toEqual([
      { id: 'a', status: 'failed' },
      { id: 'b', status: 'idle' }
    ])
  })

  it('resolves `gone` for an id absent at call time', async () => {
    const orch = new EmittingOrchestrator()
    const { promise } = waitForBoards({
      orchestrator: orch,
      targets: ['ghost'],
      timeoutMs: NO_TIMEOUT
    })
    expect(await promise).toEqual([{ id: 'ghost', status: 'gone' }])
  })

  it('resolves `gone` when a target vanishes mid-wait', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    const { promise } = waitForBoards({
      orchestrator: orch,
      targets: ['t1'],
      timeoutMs: NO_TIMEOUT
    })
    queueMicrotask(() => orch.emit({ id: 't1', status: 'gone' }))
    expect(await promise).toEqual([{ id: 't1', status: 'gone' }])
  })

  it('resolves `timed-out` (never throws) when the backstop fires before settle', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    const { promise } = waitForBoards({ orchestrator: orch, targets: ['t1'], timeoutMs: 10 })
    expect(await promise).toEqual([{ id: 't1', status: 'timed-out' }])
  })

  it('with timeout opted out, stays pending until the event (no premature resolve)', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    const { promise } = waitForBoards({
      orchestrator: orch,
      targets: ['t1'],
      timeoutMs: NO_TIMEOUT
    })
    const race = await Promise.race([
      promise,
      new Promise((r) => setTimeout(() => r('pending'), 30))
    ])
    expect(race).toBe('pending')
    orch.emit({ id: 't1', status: 'idle' })
    expect(await promise).toEqual([{ id: 't1', status: 'idle' }])
  })

  it('cancel() unsubscribes and resolves the pending targets as gone', async () => {
    const orch = new EmittingOrchestrator()
    orch.boards = [{ id: 't1', type: 'terminal', title: 'T', status: 'running' }]
    const { promise, cancel } = waitForBoards({
      orchestrator: orch,
      targets: ['t1'],
      timeoutMs: NO_TIMEOUT
    })
    cancel()
    expect(await promise).toEqual([{ id: 't1', status: 'gone' }])
  })
})
