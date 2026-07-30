import { describe, expect, it } from 'vitest'
import { connectInMemory } from '../helpers/inMemory'
import { promptRegistry } from '../../src/prompts/registry'
import '../../src/prompts/index' // side effect: registers the canvas-orientation prompt

// ── Layer 1: the PromptRegistry in isolation (pure, no transport, no mock) ──────────────────
// The proof-of-life prompt is static, so the registry can be exercised end-to-end with no
// Orchestrator — which is itself the "pure render" invariant (build() touches no write path).
describe('PromptRegistry (tier gating + render)', () => {
  it('list: worker tier returns an empty array (the hard gate)', () => {
    expect(promptRegistry.list('worker')).toEqual([])
  })

  it('list: orchestrator tier includes canvas-orientation', () => {
    expect(promptRegistry.list('orchestrator').map((s) => s.name)).toContain('canvas-orientation')
  })

  it('list: connected tier includes canvas-orientation', () => {
    expect(promptRegistry.list('connected').map((s) => s.name)).toContain('canvas-orientation')
  })

  it('list: lead tier includes canvas-orientation (audit Phase A — added when 0.22.1 missed it)', () => {
    expect(promptRegistry.list('lead').map((s) => s.name)).toContain('canvas-orientation')
  })

  it('get: orchestrator + valid name → non-empty user/text messages', () => {
    const messages = promptRegistry.get('canvas-orientation', 'orchestrator', {})
    expect(messages).not.toBeNull()
    expect(messages?.length ?? 0).toBeGreaterThan(0)
    const first = messages?.[0]
    expect(first?.role).toBe('user')
    expect(first?.content.type).toBe('text')
  })

  it('get: worker + valid name → null (never visible to a worker)', () => {
    expect(promptRegistry.get('canvas-orientation', 'worker', {})).toBeNull()
  })

  it('get: orchestrator + unknown name → null', () => {
    expect(promptRegistry.get('no-such-prompt', 'orchestrator', {})).toBeNull()
  })

  it('canvas-orientation render: carries all three safety-rule keywords (pure render, no orchestrator)', () => {
    const spec = promptRegistry.list('orchestrator').find((s) => s.name === 'canvas-orientation')
    expect(spec).toBeDefined()
    const messages = spec ? spec.build({}) : []
    expect(messages.length).toBeGreaterThan(0)
    const text = messages.map((m) => m.content.text).join('\n')
    expect(text).toContain('runGatedWrite')
    expect(text).toContain('tainted worker output')
    expect(text).toContain('cable authorization')
  })

  it('canvas-orientation render: mentions all three board types', () => {
    const messages = promptRegistry.get('canvas-orientation', 'orchestrator', {}) ?? []
    const text = messages.map((m) => m.content.text).join('\n')
    for (const boardType of ['terminal', 'browser', 'planning']) {
      expect(text).toContain(boardType)
    }
  })

  it('argumentDescriptors: a zero-argument prompt yields []', () => {
    const spec = promptRegistry.list('orchestrator').find((s) => s.name === 'canvas-orientation')
    expect(spec).toBeDefined()
    expect(spec ? promptRegistry.argumentDescriptors(spec) : null).toEqual([])
  })
})

// ── Layer 2: tier gating over the in-memory transport (factory → registerPrompts → wire) ────
// Mirrors what the live `@mcp` e2e probe asserts over loopback: the worker must get a
// well-formed empty array (capability declared for every tier), never a "server does not
// support prompts" rejection.
describe('prompts over the wire (tier-gated)', () => {
  it('orchestrator prompts/list includes canvas-orientation with an empty arguments list', async () => {
    const client = await connectInMemory('orchestrator')
    try {
      const { prompts } = await client.listPrompts()
      const orientation = prompts.find((p) => p.name === 'canvas-orientation')
      expect(orientation).toBeDefined()
      expect(orientation?.arguments ?? []).toEqual([])
    } finally {
      await client.close()
    }
  })

  it('connected prompts/list includes canvas-orientation', async () => {
    const client = await connectInMemory('connected')
    try {
      const names = (await client.listPrompts()).prompts.map((p) => p.name)
      expect(names).toContain('canvas-orientation')
    } finally {
      await client.close()
    }
  })

  it('lead prompts/list includes canvas-orientation (no longer empty, audit Phase A)', async () => {
    const client = await connectInMemory('lead')
    try {
      const names = (await client.listPrompts()).prompts.map((p) => p.name)
      expect(names).toContain('canvas-orientation')
    } finally {
      await client.close()
    }
  })

  it('worker prompts/list is a well-formed empty array (not a capability rejection)', async () => {
    const client = await connectInMemory('worker')
    try {
      const { prompts } = await client.listPrompts()
      expect(prompts).toEqual([])
    } finally {
      await client.close()
    }
  })

  it('orchestrator prompts/get renders the orientation text', async () => {
    const client = await connectInMemory('orchestrator')
    try {
      const { messages } = await client.getPrompt({ name: 'canvas-orientation', arguments: {} })
      expect(messages.length).toBeGreaterThan(0)
      const first = messages[0]
      expect(first?.role).toBe('user')
      const text = first && first.content.type === 'text' ? first.content.text : ''
      expect(text.length).toBeGreaterThan(50)
      expect(text).toContain('runGatedWrite')
    } finally {
      await client.close()
    }
  })

  it('worker prompts/get is rejected (tier-gated, server-side)', async () => {
    const client = await connectInMemory('worker')
    try {
      await expect(
        client.getPrompt({ name: 'canvas-orientation', arguments: {} })
      ).rejects.toThrow()
    } finally {
      await client.close()
    }
  })

  it('orchestrator prompts/get for an unknown name is rejected', async () => {
    const client = await connectInMemory('orchestrator')
    try {
      await expect(client.getPrompt({ name: 'no-such-prompt' })).rejects.toThrow()
    } finally {
      await client.close()
    }
  })
})
