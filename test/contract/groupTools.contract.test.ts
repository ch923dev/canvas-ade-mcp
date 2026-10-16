import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type { EditGroupsInput, GroupBoardsInput } from '../../src/orchestrator/Orchestrator'
import {
  GROUP_NAME_MAX,
  MAX_FOCUS_TARGET_ID,
  MAX_GROUP_BATCH,
  MAX_GROUP_MEMBERS,
  TOOL_EDIT_GROUPS,
  TOOL_GROUP_BOARDS
} from '../../src/constants'
import type { Tier } from '../../src/types'

// group_boards + edit_groups (C6 / D2 / D6) — Named Group writes over EXISTING boards. Every call is
// human batch-confirmed host-side (all tiers); the package validates the batch shape + caps, binds a
// lead/connected caller's own board id, dedupes member ids, and serializes the host's per-row result.

class SpyOrchestrator extends MockOrchestrator {
  groupCalls: GroupBoardsInput[] = []
  editCalls: EditGroupsInput[] = []
  override async groupBoards(input: GroupBoardsInput): Promise<unknown> {
    this.groupCalls.push(input)
    return input.groups.map((_g, i) =>
      i === 0 ? { status: 'created', groupId: 'g-new' } : { status: 'denied', detail: 'declined' }
    )
  }
  override async editGroups(input: EditGroupsInput): Promise<unknown> {
    this.editCalls.push(input)
    return input.ops.map(() => ({ status: 'applied' }))
  }
}

function parse(res: unknown): unknown {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? []
  return JSON.parse(content.map((c) => c.text ?? '').join(''))
}

function errorCode(res: unknown): unknown {
  return (res as { structuredContent?: { error?: { code?: unknown } } }).structuredContent?.error
    ?.code
}

async function run(name: string, args: unknown, tier: Tier = 'orchestrator', boardId = 'b') {
  const orch = new SpyOrchestrator()
  const client = await connectInMemory(tier, orch, boardId)
  const res = await client.callTool({ name, arguments: args as Record<string, unknown> })
  await client.close()
  return { res, orch }
}

const ids = (n: number, prefix = 'b'): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`)
const row = (i = 0) => ({ name: `Group ${i}`, boardIds: ['b1', 'b2'] })

describe('group_boards — schema caps', () => {
  it('accepts 1 and MAX_GROUP_BATCH rows', async () => {
    for (const n of [1, MAX_GROUP_BATCH]) {
      const { res, orch } = await run(TOOL_GROUP_BOARDS, {
        groups: Array.from({ length: n }, (_, i) => row(i))
      })
      expect(res.isError, String(n)).toBeFalsy()
      expect(orch.groupCalls[0]!.groups).toHaveLength(n)
    }
  })

  const rejected: Array<[string, unknown]> = [
    ['0 rows', { groups: [] }],
    ['MAX+1 rows', { groups: Array.from({ length: MAX_GROUP_BATCH + 1 }, (_, i) => row(i)) }],
    ['missing groups', {}],
    ['an empty name', { groups: [{ name: '', boardIds: ['b1'] }] }],
    ['an over-long name', { groups: [{ name: 'x'.repeat(GROUP_NAME_MAX + 1), boardIds: ['b1'] }] }],
    ['zero members', { groups: [{ name: 'G', boardIds: [] }] }],
    ['too many members', { groups: [{ name: 'G', boardIds: ids(MAX_GROUP_MEMBERS + 1) }] }],
    ['an empty board id', { groups: [{ name: 'G', boardIds: [''] }] }],
    [
      'an over-long board id',
      { groups: [{ name: 'G', boardIds: ['x'.repeat(MAX_FOCUS_TARGET_ID + 1)] }] }
    ]
  ]
  for (const [label, args] of rejected) {
    it(`rejects ${label} WITHOUT calling the host (invalid_input)`, async () => {
      const { res, orch } = await run(TOOL_GROUP_BOARDS, args)
      expect(res.isError).toBe(true)
      expect(errorCode(res)).toBe('invalid_input')
      expect(orch.groupCalls).toHaveLength(0)
    })
  }

  it('accepts exactly GROUP_NAME_MAX chars and MAX_GROUP_MEMBERS members', async () => {
    const { res, orch } = await run(TOOL_GROUP_BOARDS, {
      groups: [{ name: 'x'.repeat(GROUP_NAME_MAX), boardIds: ids(MAX_GROUP_MEMBERS) }]
    })
    expect(res.isError).toBeFalsy()
    expect(orch.groupCalls[0]!.groups[0]!.boardIds).toHaveLength(MAX_GROUP_MEMBERS)
  })
})

describe('group_boards — forwarding', () => {
  it('forwards the rows and serializes the host per-row result verbatim', async () => {
    const { res, orch } = await run(TOOL_GROUP_BOARDS, { groups: [row(0), row(1)] })
    expect(res.isError).toBeFalsy()
    expect(orch.groupCalls).toEqual([{ groups: [row(0), row(1)] }])
    expect(parse(res)).toEqual([
      { status: 'created', groupId: 'g-new' },
      { status: 'denied', detail: 'declined' }
    ])
  })

  it('DEDUPES repeated member ids, keeping first-occurrence order', async () => {
    const { res, orch } = await run(TOOL_GROUP_BOARDS, {
      groups: [{ name: 'G', boardIds: ['b2', 'b1', 'b2', 'b3', 'b1'] }]
    })
    expect(res.isError).toBeFalsy()
    expect(orch.groupCalls[0]!.groups[0]!.boardIds).toEqual(['b2', 'b1', 'b3'])
  })

  it('orchestrator caller: no sourceBoardId', async () => {
    const { orch } = await run(TOOL_GROUP_BOARDS, { groups: [row()] }, 'orchestrator', 'app')
    expect('sourceBoardId' in orch.groupCalls[0]!).toBe(false)
  })

  for (const tier of ['lead', 'connected'] as const) {
    it(`${tier} caller: sourceBoardId is the caller's own board id (a forged one is stripped)`, async () => {
      const { orch } = await run(
        TOOL_GROUP_BOARDS,
        { groups: [row()], sourceBoardId: 'forged' },
        tier,
        `${tier}-board`
      )
      expect(orch.groupCalls).toEqual([{ groups: [row()], sourceBoardId: `${tier}-board` }])
    })
  }
})

describe('edit_groups — schema caps + discriminated union', () => {
  const okOps = [
    { op: 'rename', groupId: 'g1', name: 'Renamed' },
    { op: 'add', groupId: 'g1', boardIds: ['b1'] },
    { op: 'remove', groupId: 'g1', boardIds: ['b2'] },
    { op: 'ungroup', groupId: 'g2' }
  ]

  it('accepts every op variant in one batch and forwards them verbatim', async () => {
    const { res, orch } = await run(TOOL_EDIT_GROUPS, { ops: okOps })
    expect(res.isError).toBeFalsy()
    expect(orch.editCalls).toEqual([{ ops: okOps }])
    expect(parse(res)).toEqual(okOps.map(() => ({ status: 'applied' })))
  })

  it('accepts MAX_GROUP_BATCH ops', async () => {
    const ops = Array.from({ length: MAX_GROUP_BATCH }, (_, i) => ({
      op: 'ungroup',
      groupId: `g${i}`
    }))
    const { res, orch } = await run(TOOL_EDIT_GROUPS, { ops })
    expect(res.isError).toBeFalsy()
    expect(orch.editCalls[0]!.ops).toHaveLength(MAX_GROUP_BATCH)
  })

  const rejected: Array<[string, unknown]> = [
    ['0 ops', { ops: [] }],
    [
      'MAX+1 ops',
      {
        ops: Array.from({ length: MAX_GROUP_BATCH + 1 }, (_, i) => ({
          op: 'ungroup',
          groupId: `g${i}`
        }))
      }
    ],
    ['an unknown op', { ops: [{ op: 'merge', groupId: 'g1' }] }],
    ['a missing op', { ops: [{ groupId: 'g1' }] }],
    ['rename without a name', { ops: [{ op: 'rename', groupId: 'g1' }] }],
    [
      'rename with an over-long name',
      { ops: [{ op: 'rename', groupId: 'g1', name: 'x'.repeat(GROUP_NAME_MAX + 1) }] }
    ],
    ['add without boardIds', { ops: [{ op: 'add', groupId: 'g1' }] }],
    ['add with zero members', { ops: [{ op: 'add', groupId: 'g1', boardIds: [] }] }],
    [
      'add with too many members',
      { ops: [{ op: 'add', groupId: 'g1', boardIds: ids(MAX_GROUP_MEMBERS + 1) }] }
    ],
    [
      'remove with too many members',
      { ops: [{ op: 'remove', groupId: 'g1', boardIds: ids(MAX_GROUP_MEMBERS + 1) }] }
    ],
    ['ungroup without a groupId', { ops: [{ op: 'ungroup' }] }],
    [
      'an over-long groupId',
      { ops: [{ op: 'ungroup', groupId: 'x'.repeat(MAX_FOCUS_TARGET_ID + 1) }] }
    ]
  ]
  for (const [label, args] of rejected) {
    it(`rejects ${label} WITHOUT calling the host (invalid_input)`, async () => {
      const { res, orch } = await run(TOOL_EDIT_GROUPS, args)
      expect(res.isError).toBe(true)
      expect(errorCode(res)).toBe('invalid_input')
      expect(orch.editCalls).toHaveLength(0)
    })
  }

  it('dedupes add/remove member ids; rename/ungroup pass through untouched', async () => {
    const { orch } = await run(TOOL_EDIT_GROUPS, {
      ops: [
        { op: 'add', groupId: 'g1', boardIds: ['b1', 'b1', 'b2'] },
        { op: 'remove', groupId: 'g1', boardIds: ['b3', 'b3'] },
        { op: 'rename', groupId: 'g1', name: 'N' }
      ]
    })
    expect(orch.editCalls[0]!.ops).toEqual([
      { op: 'add', groupId: 'g1', boardIds: ['b1', 'b2'] },
      { op: 'remove', groupId: 'g1', boardIds: ['b3'] },
      { op: 'rename', groupId: 'g1', name: 'N' }
    ])
  })

  it('orchestrator caller: no sourceBoardId; lead/connected: their own board id', async () => {
    const ops = [{ op: 'ungroup', groupId: 'g1' }]
    const o = await run(TOOL_EDIT_GROUPS, { ops }, 'orchestrator', 'app')
    expect('sourceBoardId' in o.orch.editCalls[0]!).toBe(false)
    for (const tier of ['lead', 'connected'] as const) {
      const r = await run(TOOL_EDIT_GROUPS, { ops, sourceBoardId: 'forged' }, tier, `${tier}-b`)
      expect(r.orch.editCalls).toEqual([{ ops, sourceBoardId: `${tier}-b` }])
    }
  })
})

describe('group tools — descriptions state the D2 gate', () => {
  it('both say every call is batch-confirmed, nothing moves, and approved rows are one undo', async () => {
    const client = await connectInMemory('orchestrator')
    const tools = (await client.listTools()).tools
    for (const name of [TOOL_GROUP_BOARDS, TOOL_EDIT_GROUPS]) {
      const d = tools.find((t) => t.name === name)?.description ?? ''
      expect(d, name).toMatch(/EVERY call is shown to the user as ONE batch confirm/)
      expect(d, name).toMatch(/ONE undo step/)
      expect(d, name).toMatch(/no board moves|nothing moves/)
    }
    await client.close()
  })
})
