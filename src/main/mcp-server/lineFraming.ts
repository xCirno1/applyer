/**
 * Newline-delimited JSON framing, split out from the socket transport so the
 * buffering rules can be exercised without a socket (same plain-module split
 * as `workspace/workspaceLayout.ts` vs its hook).
 *
 * The reason it is not just `buffer.split('\n')`: a socket hands over
 * arbitrary chunks, so a message can arrive in pieces and several can arrive
 * at once. Whatever follows the last newline is a partial message and has to
 * be held for the next chunk.
 */

/**
 * Ceiling on a single un-terminated message.
 *
 * Without one, a client that connects and sends bytes without ever sending a
 * newline grows the pending buffer until the main process runs out of memory
 * — no malice required, a wedged writer does it too. Sized well above any
 * real request: the largest thing an agent can send is `queue_job` with a
 * 50,000-character description, so 4 MiB is roughly eighty times the biggest
 * legitimate message rather than a limit anyone could reach by accident.
 */
export const MAX_PENDING_BYTES = 4 * 1024 * 1024

export type FramingResult =
  /** Complete messages, in arrival order. May be empty while a message is still arriving. */
  | { status: 'ok'; lines: string[] }
  /** The pending message passed `MAX_PENDING_BYTES`; the caller drops the connection, since there is no way to resynchronise a stream mid-message. */
  | { status: 'overflow'; pendingBytes: number }

export class LineFramer {
  private pending = ''

  push(chunk: string): FramingResult {
    this.pending += chunk
    const lines: string[] = []

    let newlineIndex: number
    while ((newlineIndex = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, newlineIndex)
      this.pending = this.pending.slice(newlineIndex + 1)
      // Blank lines are framing, not content — an empty JSON-RPC message does
      // not exist, and forwarding one would only produce a parse error.
      if (line.trim()) lines.push(line)
    }

    if (this.pending.length > MAX_PENDING_BYTES) {
      const pendingBytes = this.pending.length
      this.pending = ''
      return { status: 'overflow', pendingBytes }
    }

    return { status: 'ok', lines }
  }

  /** Bytes held back waiting for a newline — for tests and diagnostics. */
  get pendingLength(): number {
    return this.pending.length
  }
}
