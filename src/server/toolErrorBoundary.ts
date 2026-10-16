import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'
import type { McpServer, StandardSchemaV1 } from '@modelcontextprotocol/server'
import { toolErrorCodeOf, toolErrorResult } from './toolErrors'

/**
 * The per-tool ERROR BOUNDARY (0.26.0) — the ONE place every failed `tools/call` gets its
 * structured code (`structuredContent.error.code`, see `toolErrors.ts`). Installed once per
 * session server by `ServerFactory.getServer`, BEFORE any tool registers, by wrapping that
 * instance's own `registerTool`; the 26 `register*` call sites are untouched.
 *
 * A tool can fail three ways, and each is classified here:
 *
 * 1. **The handler THROWS** (almost always a host `Orchestrator` method rejecting). SDK v2's own
 *    catch-all (`McpServer` `tools/call` handler → private `createToolError`) would turn it into
 *    `{ isError, content: [{ text: err.message }] }` with no code. The boundary catches first and
 *    returns the SAME text plus `toolErrorCodeOf(err)`: a `CanvasToolError` (or any Error with a
 *    valid `code`) maps through, everything else is `internal`.
 * 2. **The handler RETURNS `isError`** without a code — the in-handler refusals that predate codes
 *    (mutually exclusive fields, a field invalid for the board type, an empty patch). By package
 *    convention those are argument rejections, so the boundary tags them `invalid_input`. A refusal
 *    of any OTHER class (own-board binding, a cap, a timeout) MUST tag itself via
 *    `toolErrorResult(code, …)`; the boundary never overwrites an existing `structuredContent`.
 * 3. **The WIRE SCHEMA rejects the arguments** before the handler runs. SDK v2 validates in
 *    `validateToolInput` and routes the throw into the same uncoded catch-all, and offers no
 *    public hook on that path. So the boundary DEFERS validation into itself: the registered
 *    `inputSchema` is wrapped in a Standard Schema facade that runs the real schema unchanged but,
 *    on failure, hands the handler a private marker instead of failing; the wrapped handler turns
 *    the marker into `invalid_input` with the SDK's exact message (see {@link formatInputError}).
 *    The facade delegates `~standard.jsonSchema` to the real schema, so `tools/list` is identical.
 *
 * Why a facade and not an override of the SDK's `createToolError`: that method is TS-`private`
 * internals with no stability promise, and it only receives a message string, so classifying would
 * mean string-matching the SDK's own text. The facade relies only on the PUBLIC Standard Schema
 * contract (`~standard.validate` / `~standard.jsonSchema`) the SDK documents for every schema.
 *
 * Text compatibility is the hard rule: every message is byte-identical to what the SDK produced
 * before codes existed (contract-tested against a bare, un-bounded McpServer in
 * `toolErrors.contract.test.ts`, so an SDK bump that changes its wording fails loudly here).
 */
export function installToolErrorBoundary(server: McpServer): void {
  if (installed.has(server)) return
  installed.add(server)
  const register = server.registerTool.bind(server) as unknown as LooseRegister
  const guarded: LooseRegister = (name, config, cb) =>
    register(
      name,
      config.inputSchema === undefined
        ? config
        : { ...config, inputSchema: deferValidation(config.inputSchema) },
      guardHandler(name, cb)
    )
  server.registerTool = guarded as unknown as McpServer['registerTool']
}

/** Idempotence guard — a double install would nest two facades (harmless, but pointless). */
const installed = new WeakSet<McpServer>()

type LooseHandler = (...args: unknown[]) => unknown
type LooseRegister = (
  name: string,
  config: { inputSchema?: unknown } & Record<string, unknown>,
  cb: LooseHandler
) => unknown

/**
 * 🔒 Marker the facade hands the handler in place of rejected arguments. A Symbol key cannot
 * arrive over JSON-RPC, so a client can never forge a marker — and the marker never reaches a
 * real handler: `guardHandler` checks for it before invoking anything.
 */
const INVALID_INPUT = Symbol('canvas-ade-mcp.invalidInput')
type InvalidInputMarker = { readonly [INVALID_INPUT]: string }

function isInvalidInputMarker(value: unknown): value is InvalidInputMarker {
  return typeof value === 'object' && value !== null && INVALID_INPUT in value
}

type StdProps = StandardSchemaV1['~standard']
type StdResult = StandardSchemaV1.Result<unknown>

/**
 * Wrap a Standard Schema so validation FAILURE becomes a success carrying the formatted issues.
 * Everything else (`vendor`, `version`, `jsonSchema`, …) is the real schema's, untouched. A value
 * that is not a Standard Schema (the SDK's deprecated raw-shape form) is passed through as-is: the
 * SDK then validates it natively and a rejection keeps its text but carries no code — none of this
 * package's tools use that form.
 */
function deferValidation(schema: unknown): unknown {
  if (!isStandardSchema(schema)) return schema
  const std = schema['~standard']
  const settle = (result: StdResult): StdResult =>
    result.issues !== undefined && result.issues.length > 0
      ? { value: { [INVALID_INPUT]: result.issues.map(formatIssue).join(', ') } }
      : result
  return {
    '~standard': {
      ...std,
      validate: (value: unknown, options?: StandardSchemaV1.Options) => {
        const out = std.validate(value, options)
        return out instanceof Promise ? out.then(settle) : settle(out)
      }
    }
  }
}

function isStandardSchema(value: unknown): value is { '~standard': StdProps } {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  const std = (value as { '~standard'?: { validate?: unknown } })['~standard']
  return typeof std?.validate === 'function'
}

/**
 * MIRROR of SDK v2's `formatIssue` (`core-internal/src/util/standardSchema.ts`) — the issue
 * rendering inside "Input validation error: …". Kept byte-for-byte so a schema rejection reads
 * exactly as it did when the SDK produced it; the parity contract test fails if they diverge.
 */
function formatIssue(issue: StandardSchemaV1.Issue): string {
  if (!issue.path?.length) return issue.message
  const path = issue.path.map((p) => String(typeof p === 'object' ? p.key : p)).join('.')
  return `${path}: ${issue.message}`
}

/** MIRROR of SDK v2 `McpServer.validateToolInput`'s rejection message (see {@link formatIssue}). */
function formatInputError(toolName: string, issues: string): string {
  return `Input validation error: Invalid arguments for tool ${toolName}: ${issues}`
}

function guardHandler(name: string, cb: LooseHandler): LooseHandler {
  return async (...args: unknown[]) => {
    const [first] = args
    if (isInvalidInputMarker(first)) {
      return toolErrorResult('invalid_input', formatInputError(name, first[INVALID_INPUT]))
    }
    try {
      return tagUncodedRefusal(await cb(...args))
    } catch (err) {
      // The ONE throw the SDK deliberately re-raises as a protocol error rather than an isError
      // result (URL-mode elicitation) — preserve that, so the boundary never changes the protocol
      // shape of a call. Nothing in this package raises it today.
      if (err instanceof ProtocolError && err.code === ProtocolErrorCode.UrlElicitationRequired) {
        throw err
      }
      return toolErrorResult(toolErrorCodeOf(err), err instanceof Error ? err.message : String(err))
    }
  }
}

/**
 * Give a handler-RETURNED `isError` result its code when it has none (case 2 above). Results that
 * already carry `structuredContent`, success results, and anything not result-shaped are returned
 * by reference, unchanged. The message is the result's text blocks, joined by newline.
 */
function tagUncodedRefusal(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return result
  const r = result as { isError?: unknown; structuredContent?: unknown; content?: unknown }
  if (r.isError !== true || r.structuredContent !== undefined) return result
  const message = Array.isArray(r.content)
    ? r.content
        .filter((c): c is { type: 'text'; text: string } => c?.type === 'text')
        .map((c) => c.text)
        .join('\n')
    : ''
  return {
    ...result,
    structuredContent: { error: { code: 'invalid_input', message } }
  }
}
