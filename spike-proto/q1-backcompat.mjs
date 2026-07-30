// Q1 empirical probe — can an SDK v2 server serve TODAY'S stateful client?
//
// Server side: SDK v2 (@modelcontextprotocol/server 2.0.0) McpServer +
//   NodeStreamableHTTPServerTransport (@modelcontextprotocol/node 2.0.0), stateful
//   (sessionIdGenerator set), mounted in Express exactly like src/server/mcpHttp.ts.
// Client side: SDK v1 (@modelcontextprotocol/sdk 1.29.0) Client +
//   StreamableHTTPClientTransport — the 2025-06-18 stateful line Claude Code speaks now.
//
// PASS = initialize handshake completes, Mcp-Session-Id round-trips, tools/list +
// tools/call work, GET-SSE opens, DELETE tears the session down (404 after).
import express from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/server'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const transports = new Map()

const app = express()
app.use(express.json())

app.post('/mcp', async (req, res) => {
  const sid = req.header('mcp-session-id')
  if (sid !== undefined) {
    const t = transports.get(sid)
    if (!t) {
      res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null })
      return
    }
    await t.handleRequest(req, res, req.body)
    return
  }
  // new session on initialize — mirrors SessionManager.handlePost
  const server = new McpServer({ name: 'q1-probe', version: '0.0.0' })
  server.registerTool(
    'ping',
    { description: 'Health check. Returns "pong".' },
    async () => ({ content: [{ type: 'text', text: 'pong' }] })
  )
  server.registerTool(
    'echo',
    { description: 'Echo with zod4 input schema.', inputSchema: z.object({ msg: z.string() }) },
    async ({ msg }) => ({ content: [{ type: 'text', text: `echo:${msg}` }] })
  )
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => transports.set(id, transport)
  })
  transport.onclose = () => {
    if (transport.sessionId) transports.delete(transport.sessionId)
  }
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
})

app.get('/mcp', sessionRoute)
app.delete('/mcp', sessionRoute)
async function sessionRoute(req, res) {
  const sid = req.header('mcp-session-id')
  const t = sid && transports.get(sid)
  if (!t) {
    res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null })
    return
  }
  await t.handleRequest(req, res)
}

const httpServer = app.listen(0, '127.0.0.1', async () => {
  const url = new URL(`http://127.0.0.1:${httpServer.address().port}/mcp`)
  const results = []
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
  }
  try {
    const client = new Client({ name: 'v1-client', version: '1.29.0' })
    const clientTransport = new StreamableHTTPClientTransport(url)
    await client.connect(clientTransport)
    check('initialize handshake (v1 client -> v2 server)', true,
      `negotiated protocolVersion=${clientTransport.protocolVersion ?? '(n/a)'}`)
    check('Mcp-Session-Id issued', clientTransport.sessionId !== undefined,
      `sessionId=${clientTransport.sessionId}`)

    const tools = await client.listTools()
    check('tools/list on reused session', tools.tools.length === 2,
      tools.tools.map((t) => t.name).join(','))

    const ping = await client.callTool({ name: 'ping', arguments: {} })
    check('tools/call ping', ping.content?.[0]?.text === 'pong', JSON.stringify(ping.content))

    const echo = await client.callTool({ name: 'echo', arguments: { msg: 'hi' } })
    check('tools/call echo (zod4 schema)', echo.content?.[0]?.text === 'echo:hi', JSON.stringify(echo.content))

    // standalone GET-SSE — today's attention-notifier channel
    const sseRes = await fetch(url, {
      headers: {
        accept: 'text/event-stream',
        'mcp-session-id': clientTransport.sessionId,
        'mcp-protocol-version': clientTransport.protocolVersion ?? '2025-06-18'
      }
    })
    check('standalone GET-SSE opens', sseRes.status === 200 &&
      (sseRes.headers.get('content-type') ?? '').includes('text/event-stream'),
      `status=${sseRes.status} ct=${sseRes.headers.get('content-type')}`)
    sseRes.body?.cancel?.()

    const sid = clientTransport.sessionId
    await clientTransport.terminateSession() // DELETE /mcp
    const after = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 99 })
    })
    check('DELETE tears down (reuse -> 404)', after.status === 404, `status=${after.status}`)

    await client.close()
  } catch (err) {
    check('unexpected error', false, String(err?.stack ?? err))
  } finally {
    const failed = results.filter((r) => !r.ok).length
    console.log(`\n${results.length - failed}/${results.length} checks passed`)
    httpServer.close()
    process.exit(failed ? 1 : 0)
  }
})
