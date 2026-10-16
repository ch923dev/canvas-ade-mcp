/**
 * Structured tool-error vocabulary (0.26.0).
 *
 * Before this, an agent that got a failed `tools/call` could only string-match `content[0].text`
 * to decide what to do next — retry, re-read the canvas, ask the human, or give up. Every failed
 * tool result now ALSO carries a machine-readable code:
 *
 * ```json
 * { "isError": true,
 *   "content": [{ "type": "text", "text": "<the same message as before>" }],
 *   "structuredContent": { "error": { "code": "not_found", "message": "<the same message>" } } }
 * ```
 *
 * The `content` text is BYTE-IDENTICAL to what this package produced before codes existed —
 * agents, the host's e2e suite, and the host's own tests all string-match it, so the code is
 * strictly additive. `structuredContent` is permitted on a result whose tool declares no
 * `outputSchema` (spec 2025-06-18; SDK v2 only validates it when an `outputSchema` exists, and
 * an object-shaped value is passed through untouched — no auto-appended text block).
 *
 * The HOST classifies its own failures by throwing {@link CanvasToolError} (or any `Error` with a
 * valid `code` property) from an `Orchestrator` method; the package's per-tool error boundary
 * (`toolErrorBoundary.ts`) maps it through. Anything unclassified maps to `internal`.
 */

/**
 * The CLOSED set of tool-error codes. Closed on purpose: an agent can switch over it
 * exhaustively, and a new code is a deliberate, versioned contract change (a minor bump), never a
 * free-form string a host invents ad hoc.
 *
 * - `invalid_input` — the arguments are wrong: the wire schema rejected them, or a tool-level
 *   precondition on the arguments failed (mutually exclusive fields, a field invalid for the board
 *   type, an empty patch). Fix the call; retrying it unchanged will fail again.
 * - `not_found` — a referenced id (board / element / card / column / group) does not exist.
 *   Re-read `canvas://boards` (or the board's resource) before retrying.
 * - `declined` — the human declined the confirm gate. Do NOT retry without new user intent.
 * - `unauthorized` — this session may not perform this act (tier / own-board binding / designated
 *   command board / no board bound to the token). Retrying cannot succeed.
 * - `conflict` — the call is well-formed but current canvas state does not allow it (no
 *   orchestration cable, the board changed while a confirm was open, the target has not settled
 *   and a dispatch may still be in flight). Re-read state, then decide.
 * - `cap_exceeded` — a session/host cap was hit (concurrent waits, board count, batch size).
 *   Wait for in-flight work to settle, or send less.
 * - `app_unavailable` — the host app cannot service the call right now (no window, project still
 *   loading, the renderer did not ack, a capability is not wired). Retry later.
 * - `internal` — an unexpected or unclassified failure. The message is the only detail.
 */
export const TOOL_ERROR_CODES = [
  'invalid_input',
  'not_found',
  'declined',
  'unauthorized',
  'conflict',
  'cap_exceeded',
  'app_unavailable',
  'internal'
] as const

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number]

/** Type guard: is `value` one of the {@link TOOL_ERROR_CODES}? */
export function isToolErrorCode(value: unknown): value is ToolErrorCode {
  return typeof value === 'string' && (TOOL_ERROR_CODES as readonly string[]).includes(value)
}

/**
 * The error a HOST `Orchestrator` method throws to classify a failure, e.g.
 * `throw new CanvasToolError('declined', 'add_planning_elements: write denied by the human gate')`.
 * The tool result's text is exactly `message`; `code` rides in `structuredContent.error.code`.
 *
 * The package recognises ANY `Error` whose `code` is a valid {@link ToolErrorCode} (duck-typed, see
 * {@link toolErrorCodeOf}), so a host may also tag an existing error class — this class is the
 * convenient, typed way to do it.
 */
export class CanvasToolError extends Error {
  readonly code: ToolErrorCode

  constructor(code: ToolErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CanvasToolError'
    this.code = code
  }
}

/**
 * Classify a thrown value: an `Error` carrying a valid {@link ToolErrorCode} as `code` maps
 * through; everything else — a plain `Error`, a Node system error (`code: 'ENOENT'`), an SDK
 * `ProtocolError` (numeric code), a non-Error throw — is `internal`.
 */
export function toolErrorCodeOf(err: unknown): ToolErrorCode {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code
    if (isToolErrorCode(code)) return code
  }
  return 'internal'
}

/** The shape of a failed tool result: the human/agent text PLUS its structured code. */
export type ToolErrorResult = {
  isError: true
  content: Array<{ type: 'text'; text: string }>
  structuredContent: { error: { code: ToolErrorCode; message: string } }
}

/**
 * Build a failed tool result. `message` becomes BOTH the text block (unchanged from the
 * pre-code shape) and `structuredContent.error.message`.
 */
export function toolErrorResult(code: ToolErrorCode, message: string): ToolErrorResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
    structuredContent: { error: { code, message } }
  }
}
