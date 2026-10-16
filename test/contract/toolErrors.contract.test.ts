import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { McpServer, ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'
import { connectInMemory } from '../helpers/inMemory'
import { MockOrchestrator } from '../../src/orchestrator/mock'
import type {
  BoardResult,
  PlanningElementsSpec,
  RelayResult
} from '../../src/orchestrator/Orchestrator'
import type { BoardId } from '../../src/types'
import { installToolErrorBoundary } from '../../src/server/toolErrorBoundary'
import {
  CanvasToolError,
  TOOL_ERROR_CODES,
  isToolErrorCode,
  toolErrorCodeOf,
  toolErrorResult
} from '../../src/server/toolErrors'

/**
 * Structured tool errors (0.26.0). Two things are pinned here, and the second matters as much as
 * the first:
 *
 * 1. every failed `tools/call` carries `structuredContent.error.{code,message}` with the RIGHT code
 *    (host throw → its own code; wire rejection → invalid_input; anything else → internal);
 * 2. the `content` TEXT is byte-identical to what the package produced before codes existed —
 *    agents and the host's e2e string-match it. Where the SDK produced the text (schema rejection,
 *    handler throw) it is compared against a BARE McpServer with no boundary installed.
 */

type CallResult = Awaited<ReturnType<Client['callTool']>>

function textOf(res: CallResult): string {
  return (res.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n')
}

function errorOf(res: CallResult): { code: string; message: string } | undefined {
  return (res.structuredContent as { error?: { code: string; message: string } } | undefined)?.error
}

/** Assert the full coded-failure shape: isError + unchanged text + code + message === text. */
function expectToolError(res: CallResult, code: string, text: string): void {
  expect(res.isError).toBe(true)
  expect(res.content).toEqual([{ type: 'text', text }])
  expect(errorOf(res)).toEqual({ code, message: text })
}

/** Connect a client to an arbitrary McpServer over the in-memory pair. */
async function connect(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'tool-errors-test', version: '0.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

describe('structured tool errors — host throws', () => {
  it('a not_found CanvasToolError maps through with its exact message', async () => {
    class Orch extends MockOrchestrator {
      override async closeBoard(boardId: BoardId): Promise<void> {
        throw new CanvasToolError('not_found', `board not found: ${boardId}`)
      }
    }
    const client = await connectInMemory('orchestrator', new Orch())
    const res = await client.callTool({ name: 'close_board', arguments: { id: 'b9' } })
    expectToolError(res, 'not_found', 'board not found: b9')
    await client.close()
  })

  it('a declined CanvasToolError (human gate) maps through', async () => {
    class Orch extends MockOrchestrator {
      override async addPlanningElements(_id: BoardId, _spec: PlanningElementsSpec): Promise<void> {
        throw new CanvasToolError(
          'declined',
          'add_planning_elements: write denied by the human gate'
        )
      }
    }
    const client = await connectInMemory('orchestrator', new Orch(), 'test-board', undefined, true)
    const res = await client.callTool({
      name: 'add_planning_elements',
      arguments: { boardId: 'p1', elements: [{ kind: 'note', text: 'hi' }] }
    })
    expectToolError(res, 'declined', 'add_planning_elements: write denied by the human gate')
    await client.close()
  })

  it('a duck-typed Error carrying a valid code maps through (no CanvasToolError needed)', async () => {
    class Orch extends MockOrchestrator {
      override async interrupt(): Promise<void> {
        throw Object.assign(new Error('interrupt: target is not a terminal (planning)'), {
          code: 'invalid_input'
        })
      }
    }
    const client = await connectInMemory('orchestrator', new Orch())
    const res = await client.callTool({ name: 'interrupt', arguments: { boardId: 'p1' } })
    expectToolError(res, 'invalid_input', 'interrupt: target is not a terminal (planning)')
    await client.close()
  })

  it('a plain Error ⇒ internal, original message unchanged', async () => {
    class Orch extends MockOrchestrator {
      override async closeBoard(): Promise<void> {
        throw new Error('close_board failed: no-window')
      }
    }
    const client = await connectInMemory('orchestrator', new Orch())
    const res = await client.callTool({ name: 'close_board', arguments: { id: 'b1' } })
    expectToolError(res, 'internal', 'close_board failed: no-window')
    await client.close()
  })

  it('an off-vocabulary code (a Node system error) ⇒ internal, not passed through', async () => {
    class Orch extends MockOrchestrator {
      override async gitDiff(): Promise<string> {
        throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
      }
    }
    const client = await connectInMemory('orchestrator', new Orch())
    const res = await client.callTool({ name: 'git_diff', arguments: { boardId: 't1' } })
    expectToolError(res, 'internal', 'spawn git ENOENT')
    await client.close()
  })

  it('spawn_board: a declined seed write keeps its prefixed text and the host code', async () => {
    class Orch extends MockOrchestrator {
      override async addPlanningElements(): Promise<void> {
        throw new CanvasToolError('declined', 'write denied by the human gate')
      }
    }
    const client = await connectInMemory('orchestrator', new Orch(), 'test-board', undefined, true)
    const res = await client.callTool({
      name: 'spawn_board',
      arguments: { type: 'planning', seed: [{ kind: 'note', text: 'x' }] }
    })
    // MockOrchestrator mints 'mock-planning-1'-style ids; read it back rather than hard-coding.
    const text = textOf(res)
    expect(text).toMatch(
      /^spawn_board: created \S+ but the seed was not written: write denied by the human gate$/
    )
    expectToolError(res, 'declined', text)
    await client.close()
  })
})

describe('structured tool errors — wire-validation rejections ⇒ invalid_input', () => {
  it('a schema rejection (SDK zod path) is coded invalid_input with the SDK message', async () => {
    const client = await connectInMemory('orchestrator')
    const res = await client.callTool({ name: 'close_board', arguments: { id: '' } })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toMatch(/^Input validation error: Invalid arguments for tool close_board: /)
    expect(errorOf(res)).toEqual({ code: 'invalid_input', message: textOf(res) })
    await client.close()
  })

  it('an in-handler argument refusal (returned isError) is tagged invalid_input', async () => {
    const client = await connectInMemory('orchestrator')
    const res = await client.callTool({ name: 'configure_board', arguments: { id: 'b1' } })
    expectToolError(
      res,
      'invalid_input',
      'configure_board: at least one of shell/launchCommand/cwd/columnAxis/axisLabel required'
    )
    await client.close()
  })

  it('an in-handler argument THROW (update_planning_element source+specOps) is invalid_input', async () => {
    const client = await connectInMemory(
      'orchestrator',
      new MockOrchestrator(),
      'b',
      undefined,
      true
    )
    const res = await client.callTool({
      name: 'update_planning_element',
      arguments: {
        boardId: 'p1',
        elementId: 'e1',
        source: 'graph TD; A-->B',
        specOps: [{ op: 'removeNode', id: 'n1' }]
      }
    })
    expectToolError(
      res,
      'invalid_input',
      'supply either "source" (Mermaid) or "specOps" (expanse), not both'
    )
    await client.close()
  })
})

describe('structured tool errors — explicitly coded refusals', () => {
  it('relay_prompt from a foreign source (connected tier) ⇒ unauthorized', async () => {
    const client = await connectInMemory('connected', new MockOrchestrator(), 'me')
    const res = await client.callTool({
      name: 'relay_prompt',
      arguments: { sourceId: 'someone-else', targetId: 't2', prompt: 'go' }
    })
    expectToolError(
      res,
      'unauthorized',
      'relay_prompt: a connected terminal may only relay from its own board'
    )
    await client.close()
  })

  it('relay_prompts from a non-designated orchestrator ⇒ unauthorized', async () => {
    class Orch extends MockOrchestrator {
      override async relayPrompts(): Promise<RelayResult[]> {
        throw new Error('must not be reached')
      }
    }
    const client = await connectInMemory('orchestrator', new Orch(), 'not-app', 'app')
    const res = await client.callTool({
      name: 'relay_prompts',
      arguments: { items: [{ sourceId: 'a', targetId: 'b', prompt: 'go' }] }
    })
    expectToolError(
      res,
      'unauthorized',
      'relay_prompts: caller is not the designated command orchestrator'
    )
    await client.close()
  })

  it('write_result with no board bound to the token ⇒ unauthorized', async () => {
    const client = await connectInMemory('worker', new MockOrchestrator(), '')
    const res = await client.callTool({ name: 'write_result', arguments: { status: 'success' } })
    expectToolError(res, 'unauthorized', 'write_result: no board bound to this session')
    await client.close()
  })

  it('a handoff that outlives its backstop ⇒ conflict (the dispatch may still be in flight)', async () => {
    class Hung extends MockOrchestrator {
      override handoffPrompt(): Promise<BoardResult> {
        return new Promise<BoardResult>(() => {})
      }
    }
    const client = await connectInMemory('orchestrator', new Hung())
    const res = await client.callTool({
      name: 'handoff_prompt',
      arguments: { boardId: 'board-7', prompt: 'run', timeoutMs: 20 }
    })
    expectToolError(
      res,
      'conflict',
      'handoff_prompt: timed out after 20ms waiting for board board-7 to go idle — the dispatch ' +
        'may still be running; read canvas://board/board-7/result later'
    )
    await client.close()
  })

  it('publish_findings: a host refusal carries the host code; an uncoded one reads internal', async () => {
    let code: string | undefined = 'not_found'
    class Orch extends MockOrchestrator {
      override async publishFindings(boardId: BoardId) {
        return {
          ok: false,
          published: 0,
          summary: `board not found: ${boardId}`,
          ...(code !== undefined ? { code: code as 'not_found' } : {})
        }
      }
    }
    const client = await connectInMemory('orchestrator', new Orch(), 'b', undefined, true)
    const coded = await client.callTool({ name: 'publish_findings', arguments: { boardId: 'k1' } })
    expectToolError(coded, 'not_found', 'board not found: k1')
    code = undefined
    const uncoded = await client.callTool({
      name: 'publish_findings',
      arguments: { boardId: 'k1' }
    })
    expectToolError(uncoded, 'internal', 'board not found: k1')
    await client.close()
  })

  it('a success result carries no structuredContent', async () => {
    const client = await connectInMemory('worker')
    const res = await client.callTool({ name: 'ping' })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toBeUndefined()
    expect(res.content).toEqual([{ type: 'text', text: 'pong' }])
    await client.close()
  })
})

describe('structured tool errors — byte-identical to the bare SDK', () => {
  // The same schema + handlers on two servers: one exactly as the SDK ships (no boundary), one
  // with the boundary. Everything the agent could already see must be identical; the bounded one
  // only ADDS structuredContent.
  const schema = z.object({
    id: z.string().min(1),
    items: z.array(z.object({ label: z.string().max(3) })).max(2),
    mode: z.enum(['a', 'b']).optional(),
    url: z
      .string()
      .url()
      .refine((u) => u.startsWith('https://'), { message: 'url must be https' })
      .optional()
  })

  function build(bounded: boolean): McpServer {
    const server = new McpServer({ name: 'parity', version: '0.0.0' })
    if (bounded) installToolErrorBoundary(server)
    server.registerTool('probe', { description: 'p', inputSchema: schema }, async (args) => {
      if (args.id === 'throw') throw new Error('host says no')
      if (args.id === 'throw-string') throw 'a bare string'
      return { content: [{ type: 'text', text: `ok ${args.id}` }] }
    })
    server.registerTool('noargs', { description: 'n' }, async () => {
      throw new Error('noargs failed')
    })
    return server
  }

  const cases: Array<{ label: string; tool: string; args?: Record<string, unknown> }> = [
    { label: 'single issue', tool: 'probe', args: { id: '', items: [] } },
    {
      label: 'several issues incl. nested paths',
      tool: 'probe',
      args: { id: '', items: [{ label: 'toolong' }, { label: 1 }, { label: 'x' }], mode: 'z' }
    },
    { label: 'refine message', tool: 'probe', args: { id: 'x', items: [], url: 'http://a.b' } },
    { label: 'missing required fields', tool: 'probe', args: {} },
    { label: 'handler throws an Error', tool: 'probe', args: { id: 'throw', items: [] } },
    { label: 'handler throws a non-Error', tool: 'probe', args: { id: 'throw-string', items: [] } },
    { label: 'no-inputSchema handler throws', tool: 'noargs' }
  ]

  for (const c of cases) {
    it(`${c.label}: content identical, code added`, async () => {
      const bare = await connect(build(false))
      const bounded = await connect(build(true))
      const call = { name: c.tool, ...(c.args !== undefined ? { arguments: c.args } : {}) }
      const a = await bare.callTool(call)
      const b = await bounded.callTool(call)
      expect(a.isError).toBe(true)
      expect(b.isError).toBe(true)
      expect(b.content).toEqual(a.content)
      expect(a.structuredContent).toBeUndefined()
      expect(errorOf(b)?.message).toBe(textOf(a))
      expect(isToolErrorCode(errorOf(b)?.code)).toBe(true)
      await bare.close()
      await bounded.close()
    })
  }

  it('success results are untouched', async () => {
    const bare = await connect(build(false))
    const bounded = await connect(build(true))
    const call = { name: 'probe', arguments: { id: 'fine', items: [{ label: 'ok' }] } }
    expect(await bounded.callTool(call)).toEqual(await bare.callTool(call))
    await bare.close()
    await bounded.close()
  })

  it('tools/list (incl. the advertised inputSchema) is identical', async () => {
    const bare = await connect(build(false))
    const bounded = await connect(build(true))
    expect(await bounded.listTools()).toEqual(await bare.listTools())
    await bare.close()
    await bounded.close()
  })

  it('the URL-elicitation protocol error still propagates as a protocol error', async () => {
    const server = new McpServer({ name: 'parity', version: '0.0.0' })
    installToolErrorBoundary(server)
    server.registerTool('elicit', { description: 'e' }, async () => {
      throw new ProtocolError(ProtocolErrorCode.UrlElicitationRequired, 'needs a url')
    })
    const client = await connect(server)
    await expect(client.callTool({ name: 'elicit' })).rejects.toThrow()
    await client.close()
  })
})

describe('structured tool errors — vocabulary helpers', () => {
  it('TOOL_ERROR_CODES is the closed agreed set', () => {
    expect(TOOL_ERROR_CODES).toEqual([
      'invalid_input',
      'not_found',
      'declined',
      'unauthorized',
      'conflict',
      'cap_exceeded',
      'app_unavailable',
      'internal'
    ])
  })

  it('toolErrorCodeOf: only an Error with an in-vocabulary code maps through', () => {
    expect(toolErrorCodeOf(new CanvasToolError('conflict', 'x'))).toBe('conflict')
    expect(toolErrorCodeOf(Object.assign(new Error('x'), { code: 'cap_exceeded' }))).toBe(
      'cap_exceeded'
    )
    expect(toolErrorCodeOf(new Error('x'))).toBe('internal')
    expect(toolErrorCodeOf(Object.assign(new Error('x'), { code: 'EPERM' }))).toBe('internal')
    expect(toolErrorCodeOf(new ProtocolError(ProtocolErrorCode.InvalidParams, 'x'))).toBe(
      'internal'
    )
    // A plain object is not an Error — even with a valid code (the contract is "an Error").
    expect(toolErrorCodeOf({ code: 'not_found', message: 'x' })).toBe('internal')
    expect(toolErrorCodeOf('not_found')).toBe('internal')
  })

  it('CanvasToolError is a real Error with name, code and cause', () => {
    const cause = new Error('root')
    const err = new CanvasToolError('app_unavailable', 'project-loading', { cause })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('CanvasToolError')
    expect(err.code).toBe('app_unavailable')
    expect(err.message).toBe('project-loading')
    expect(err.cause).toBe(cause)
  })

  it('toolErrorResult builds the documented wire shape', () => {
    expect(toolErrorResult('declined', 'no thanks')).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'no thanks' }],
      structuredContent: { error: { code: 'declined', message: 'no thanks' } }
    })
  })
})
