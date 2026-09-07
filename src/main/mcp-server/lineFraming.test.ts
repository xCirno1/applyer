import { describe, it, expect } from 'vitest'
import { LineFramer, MAX_PENDING_BYTES } from './lineFraming'

const ok = (result: ReturnType<LineFramer['push']>): string[] => {
  if (result.status !== 'ok') throw new Error(`Expected ok, got ${result.status}`)
  return result.lines
}

describe('LineFramer', () => {
  it('returns a complete message', () => {
    expect(ok(new LineFramer().push('{"id":1}\n'))).toEqual(['{"id":1}'])
  })

  it('returns several messages arriving in one chunk, in order', () => {
    expect(ok(new LineFramer().push('{"id":1}\n{"id":2}\n'))).toEqual(['{"id":1}', '{"id":2}'])
  })

  it('holds a partial message until its newline arrives', () => {
    const framer = new LineFramer()
    expect(ok(framer.push('{"id":'))).toEqual([])
    expect(ok(framer.push('1}'))).toEqual([])
    expect(ok(framer.push('\n'))).toEqual(['{"id":1}'])
  })

  it('keeps the trailing partial while returning the complete ones before it', () => {
    const framer = new LineFramer()
    expect(ok(framer.push('{"id":1}\n{"id":2'))).toEqual(['{"id":1}'])
    expect(ok(framer.push('}\n'))).toEqual(['{"id":2}'])
  })

  it('reassembles a message split across many chunks', () => {
    const framer = new LineFramer()
    const message = '{"jsonrpc":"2.0","method":"tools/call","id":7}'
    for (const char of message) expect(ok(framer.push(char))).toEqual([])
    expect(ok(framer.push('\n'))).toEqual([message])
  })

  it('skips blank and whitespace-only lines rather than forwarding them as messages', () => {
    expect(ok(new LineFramer().push('\n\n{"id":1}\n   \n'))).toEqual(['{"id":1}'])
  })

  it('does not treat a newline inside a JSON string as a frame boundary it can recover from', () => {
    // Framing is byte-level by design (it matches what the client writes), so
    // an embedded raw newline splits the message. Documented here because it
    // is the contract, not an accident: senders escape newlines as \\n.
    expect(ok(new LineFramer().push('{"text":"a\nb"}\n'))).toEqual(['{"text":"a', 'b"}'])
  })

  it('is empty-safe', () => {
    const framer = new LineFramer()
    expect(ok(framer.push(''))).toEqual([])
    expect(framer.pendingLength).toBe(0)
  })

  describe('the pending-message ceiling', () => {
    it('accepts a large message that still terminates', () => {
      const big = `{"d":"${'x'.repeat(1024 * 1024)}"}`
      expect(ok(new LineFramer().push(`${big}\n`))).toEqual([big])
    })

    // The bug this exists for: a client that never sends a newline used to
    // grow this buffer until the main process ran out of memory.
    it('reports overflow once an un-terminated message passes the ceiling', () => {
      const framer = new LineFramer()
      const chunk = 'x'.repeat(1024 * 1024)

      for (let i = 0; i < 4; i++) expect(framer.push(chunk).status).toBe('ok')

      const result = framer.push(chunk)
      expect(result.status).toBe('overflow')
      expect(result.status === 'overflow' && result.pendingBytes).toBeGreaterThan(MAX_PENDING_BYTES)
    })

    it('drops the buffer on overflow rather than holding the memory it just refused', () => {
      const framer = new LineFramer()
      framer.push('x'.repeat(MAX_PENDING_BYTES + 1))
      expect(framer.pendingLength).toBe(0)
    })
  })
})
