import { describe, it, expect, vi, beforeEach } from 'vitest'
import { session } from 'electron'
import { applyProductionCsp } from './security'

describe('applyProductionCsp', () => {
  beforeEach(() => {
    vi.mocked(session.defaultSession.webRequest.onHeadersReceived).mockReset()
  })

  it('registers a webRequest header handler', () => {
    applyProductionCsp()
    expect(session.defaultSession.webRequest.onHeadersReceived).toHaveBeenCalledTimes(1)
  })

  it('injects a restrictive Content-Security-Policy header alongside existing headers', () => {
    applyProductionCsp()
    const handler = vi.mocked(session.defaultSession.webRequest.onHeadersReceived).mock.calls[0]![0] as (
      details: unknown,
      callback: (response: { responseHeaders: Record<string, string[]> }) => void
    ) => void

    const callback = vi.fn()
    handler({ responseHeaders: { 'X-Existing': ['keep-me'] } }, callback)

    expect(callback).toHaveBeenCalledTimes(1)
    const [{ responseHeaders }] = callback.mock.calls[0] as [{ responseHeaders: Record<string, string[]> }]
    expect(responseHeaders['X-Existing']).toEqual(['keep-me'])
    const csp = responseHeaders['Content-Security-Policy']![0]!
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("img-src 'self' data: applyer-file:")
  })
})
