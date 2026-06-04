import { z } from 'zod'

/**
 * True if `s` contains any character that must never reach a target board's PTY
 * through a dispatch payload: any C0 control char EXCEPT TAB (0x09), plus DEL
 * (0x7f). This blocks CR (0x0d) and LF (0x0a) — which would let one human-approved
 * "line" smuggle extra commands — and Ctrl-C (0x03), ESC (0x1b), and other
 * terminal control bytes.
 */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 0x09) continue // TAB is allowed
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

/**
 * A non-empty dispatch prompt with no embedded control characters. The host
 * (Canvas ADE MAIN) is the real gate — it strips/rejects these before any PTY
 * write — but this transport-layer refinement is defence in depth: a hostile or
 * malformed payload is rejected at the tool schema, never forwarded to the
 * orchestrator. Shared by assign_prompt / handoff_prompt / relay_prompt.
 */
export const dispatchPromptSchema = z
  .string()
  .min(1)
  .refine((s) => !hasControlChar(s), {
    message: 'prompt must not contain control characters (CR/LF/C0/DEL)'
  })
