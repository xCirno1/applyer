import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchAtsJson, mapWithConcurrency, retryDelayMs } from './http'

/** Signature the spies are typed against, so `mock.calls[n][1]` is the request init rather than `never`. */
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
  vi.useRealTimers()
})

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init })
}

describe('retryDelayMs', () => {
  it('reads a plain seconds value', () => {
    expect(retryDelayMs('2')).toBe(2000)
  })

  it('clamps an absurd wait rather than parking the search for a day', () => {
    expect(retryDelayMs('86400')).toBe(5000)
  })

  it('accepts an HTTP-date form and clamps it too', () => {
    const soon = new Date(Date.now() + 1500).toUTCString()
    expect(retryDelayMs(soon)).toBeGreaterThan(0)
    expect(retryDelayMs(soon)).toBeLessThanOrEqual(5000)
    expect(retryDelayMs(new Date(Date.now() + 999_999).toUTCString())).toBe(5000)
  })

  it('never returns a negative wait for a date already in the past', () => {
    expect(retryDelayMs(new Date(Date.now() - 60_000).toUTCString())).toBe(0)
  })

  it('falls back to the default for a missing or nonsense header', () => {
    expect(retryDelayMs(null)).toBe(1000)
    expect(retryDelayMs('soon-ish')).toBe(1000)
  })
})

describe('fetchAtsJson', () => {
  it('returns the parsed body on success', async () => {
    global.fetch = vi.fn(async () => jsonResponse({ jobs: [1, 2] })) as typeof fetch
    const outcome = await fetchAtsJson('https://example.com/board')
    expect(outcome).toEqual({ status: 'ok', data: { jobs: [1, 2] } })
  })

  it('maps 404 and 410 to not_found, which is the only proof a slug is wrong', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 404 })) as typeof fetch
    expect(await fetchAtsJson('https://example.com/board')).toEqual({ status: 'not_found' })

    global.fetch = vi.fn(async () => new Response('', { status: 410 })) as typeof fetch
    expect(await fetchAtsJson('https://example.com/board')).toEqual({ status: 'not_found' })
  })

  it('honours caller-supplied not-found statuses (Workday answers 422 for an unknown tenant)', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 422 })) as typeof fetch
    expect(await fetchAtsJson('https://example.com/board', { notFoundStatuses: [422] })).toEqual({
      status: 'not_found'
    })
  })

  it('does not treat an unexpected status as not_found', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 500 })) as typeof fetch
    expect(await fetchAtsJson('https://example.com/board')).toEqual({ status: 'error', message: 'HTTP 500' })
  })

  it('retries a 429 once and returns the retry result', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    global.fetch = fetchSpy as typeof fetch

    const outcome = await fetchAtsJson('https://example.com/board')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(outcome).toEqual({ status: 'ok', data: { ok: true } })
  })

  it('gives up after a single retry rather than hammering the endpoint', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 503, headers: { 'retry-after': '0' } }))
    global.fetch = fetchSpy as typeof fetch

    const outcome = await fetchAtsJson('https://example.com/board')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(outcome).toEqual({ status: 'error', message: 'HTTP 503' })
  })

  it('reports a 200 that is not JSON as an error instead of throwing', async () => {
    global.fetch = vi.fn(async () => new Response('<html>maintenance</html>', { status: 200 })) as typeof fetch
    expect(await fetchAtsJson('https://example.com/board')).toEqual({
      status: 'error',
      message: 'Response was not valid JSON'
    })
  })

  it('refuses a response whose declared size is over the ceiling, without transferring it', async () => {
    const cancel = vi.fn()
    global.fetch = vi.fn(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          status: 200,
          headers: { 'content-length': String(128 * 1024 * 1024) }
        })
    ) as typeof fetch

    const outcome = await fetchAtsJson('https://example.com/board')
    expect(outcome.status).toBe('error')
    expect(outcome.status === 'error' && outcome.message).toContain('too large')
    // Named in megabytes against the limit: this text is what the board's
    // Last result column shows.
    expect(outcome.status === 'error' && outcome.message).toContain('MB')
    // Released on the declared size alone — no reason to spend the transfer
    // to reach the same conclusion.
    expect(cancel).toHaveBeenCalled()
  })

  it('accepts a board far larger than a typical one, since real boards are', async () => {
    // Ashby serves every posting's full description inline, so a big
    // employer's board really is tens of megabytes.
    const big = { jobs: [{ description: 'x'.repeat(40 * 1024 * 1024) }] }
    global.fetch = vi.fn(async () => jsonResponse(big)) as typeof fetch

    expect((await fetchAtsJson('https://example.com/board')).status).toBe('ok')
  })

  it('stops reading a body that runs past the ceiling even when nothing declared its size', async () => {
    // A chunked response has no content-length, so the ceiling can only be
    // enforced while reading — the case a check on the finished string misses.
    const chunk = new TextEncoder().encode('x'.repeat(4 * 1024 * 1024))
    let sent = 0
    global.fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              sent++
              controller.enqueue(chunk)
            }
          }),
          { status: 200 }
        )
    ) as typeof fetch

    const outcome = await fetchAtsJson('https://example.com/board')
    expect(outcome.status).toBe('error')
    expect(outcome.status === 'error' && outcome.message).toContain('too large')
    // Stopped just past the limit (96 MB in 4 MB chunks, plus what the
    // stream had already queued) rather than reading forever.
    expect(sent).toBeLessThanOrEqual(96 / 4 + 4)
  })

  it('turns a network failure into an error value, never a throw', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof fetch
    expect(await fetchAtsJson('https://example.com/board')).toEqual({
      status: 'error',
      message: expect.stringContaining('ECONNREFUSED')
    })
  })

  it('reports a timeout as a timeout rather than a bare abort message', async () => {
    global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      // Mimics undici: reject with an AbortError once the signal fires.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('This operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    }) as typeof fetch

    const outcome = await fetchAtsJson('https://example.com/board', { timeoutMs: 5 })
    expect(outcome).toEqual({ status: 'error', message: 'Timed out after 5ms' })
  })

  it('times out a response whose headers arrived but whose body never finishes', async () => {
    // fetch() resolves on headers, so a board that stalls mid-body used to
    // sit in response.text() forever — holding a concurrency slot despite the
    // timeout. The stream below is wired to the signal the way undici wires
    // a real one.
    global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"jobs":['))
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('This operation was aborted')
            err.name = 'AbortError'
            controller.error(err)
          })
        }
      })
      return new Response(stream, { status: 200 })
    }) as typeof fetch

    const outcome = await fetchAtsJson('https://example.com/board', { timeoutMs: 10 })
    expect(outcome).toEqual({ status: 'error', message: 'Timed out after 10ms' })
  })

  it('sends a JSON body and content-type for a POST', async () => {
    const fetchSpy = vi.fn<FetchLike>(async () => jsonResponse({ jobPostings: [] }))
    global.fetch = fetchSpy as unknown as typeof fetch

    await fetchAtsJson('https://example.com/board', { method: 'POST', body: { limit: 20 } })

    const init = fetchSpy.mock.calls[0]![1]!
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"limit":20}')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })
})

describe('mapWithConcurrency', () => {
  it('keeps results in input order regardless of completion order', async () => {
    const results = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms / 10))
      return ms
    })
    expect(results).toEqual([30, 10, 20])
  })

  it('never exceeds the concurrency cap', async () => {
    let inFlight = 0
    let peak = 0

    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async (value) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
      return value
    })

    expect(peak).toBeLessThanOrEqual(3)
  })

  it('handles an empty list and a nonsense cap without hanging', async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([])
    expect(await mapWithConcurrency([1, 2], 0, async (x) => x * 2)).toEqual([2, 4])
  })
})
