import { ATS_FETCH_TIMEOUT_MS } from '@shared/constants'

/**
 * Shared HTTP layer for the board APIs.
 *
 * These are plain public JSON endpoints — no auth, no browser, no captcha
 * surface — so the only things that can go wrong are the ordinary network
 * ones, and every one of them has to come back as a value rather than a
 * throw: a single unreachable board must never fail a whole search.
 */

/** A 404/410 is kept distinct from every other failure: only it proves the board isn't there. */
export type JsonFetchOutcome =
  | { status: 'ok'; data: unknown }
  | { status: 'not_found' }
  | { status: 'error'; message: string }

export interface JsonFetchOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  timeoutMs?: number
  /**
   * Extra statuses (beyond 404/410) that mean "this board does not exist"
   * rather than "something went wrong" — Workday answers 422 for an unknown
   * tenant, for instance.
   */
  notFoundStatuses?: number[]
}

/**
 * Identifying the client is the polite thing to do on someone else's public
 * endpoint, and it gives board operators something to contact rather than an
 * anonymous script if we ever misbehave.
 */
const USER_AGENT = 'Applyer/0.1 (+https://github.com/xCirno1/applyer)'

/**
 * Ceiling on one board response.
 *
 * Sized against what these APIs really serve, not against what looks tidy.
 * Ashby's board endpoint returns the full HTML *and* plain-text description
 * of every posting in one document, so a large employer's board is genuinely
 * tens of megabytes — a real one measured at 33 MB, which the previous 32 MB
 * ceiling refused by a hair and left permanently unfetchable. The limit still
 * exists because the body is parsed in the main process and `JSON.parse`
 * costs several times the text size in live objects, so it has to stop
 * *somewhere*; this is that somewhere, a few times the largest board seen
 * rather than just under it.
 */
const MAX_RESPONSE_BYTES = 96 * 1024 * 1024

/** Bytes as a person reads them, for a message that ends up in the board's Last result column. */
function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`
}

/** One retry only, and only for the two statuses that actually mean "later". */
const RETRYABLE_STATUSES = [429, 502, 503, 504]
const MAX_RETRY_DELAY_MS = 5000
const DEFAULT_RETRY_DELAY_MS = 1000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * `Retry-After` is either seconds or an HTTP date, and is attacker-controlled
 * as far as we're concerned — a board answering `Retry-After: 86400` must not
 * park a search for a day, so the wait is clamped and a nonsense value falls
 * back to the default.
 */
export function retryDelayMs(header: string | null): number {
  if (!header) return DEFAULT_RETRY_DELAY_MS
  const seconds = Number.parseInt(header.trim(), 10)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS)
  }
  const dateMs = Date.parse(header)
  if (Number.isFinite(dateMs)) {
    return Math.min(Math.max(dateMs - Date.now(), 0), MAX_RETRY_DELAY_MS)
  }
  return DEFAULT_RETRY_DELAY_MS
}

/**
 * One attempt, reduced to the few things the caller needs. The body is read
 * here rather than by the caller so that it happens inside the timeout — see
 * `attempt`.
 */
interface Attempt {
  status: number
  retryAfter: string | null
  /** The body text, or null when it was deliberately not read. */
  body: string | null
  /** Set only when the body was refused for exceeding `MAX_RESPONSE_BYTES` — the declared size, or how much had arrived when the read was stopped. */
  oversizeBytes: number | null
}

/**
 * Reads the body with a hard byte budget.
 *
 * `response.text()` would materialise whatever arrives before anything could
 * check it, so a missing or lying `content-length` — neither of which we
 * control, both of which are ordinary — turned the ceiling below into a check
 * performed *after* the damage. Streaming means the read stops within one
 * chunk of the limit whatever the headers claimed.
 */
async function readCapped(response: Response): Promise<{ text: string | null; bytes: number }> {
  const body = response.body
  // Undici always gives a stream for a real response; a mocked or empty one
  // may not, and falling back keeps this working rather than erroring.
  if (!body) {
    const text = await response.text()
    return text.length > MAX_RESPONSE_BYTES ? { text: null, bytes: text.length } : { text, bytes: text.length }
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let bytes = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        return { text: null, bytes }
      }
      // `stream: true` so a multi-byte character split across two chunks is
      // decoded once both halves have arrived rather than as replacement
      // characters.
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return { text: chunks.join(''), bytes }
  } finally {
    reader.releaseLock()
  }
}

/** Releases a body we are not going to parse instead of leaving the socket to the garbage collector. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Already consumed, already errored, or aborted mid-cancel — there is
    // nothing left to release either way.
  }
}

/**
 * The timeout has to span the body read, not just the request.
 * `fetch` resolves as soon as the response *headers* arrive, so a board that
 * sends headers and then stalls mid-body would sit in `response.text()`
 * forever if the timer were cleared when `fetch` resolved — holding one of
 * the few concurrency slots and, with enough of them, stalling a whole search
 * despite an explicit timeout. Reading the body inside the same window keeps
 * one timer covering the entire exchange.
 */
async function attempt(url: string, options: JsonFetchOptions): Promise<Attempt> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? ATS_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    })

    // Nothing downstream parses the body of a failed response, and a
    // retryable status is about to be requested again, so neither is read.
    if (!response.ok) {
      await discard(response)
      return {
        status: response.status,
        retryAfter: response.headers.get('retry-after'),
        body: null,
        oversizeBytes: null
      }
    }

    // A declared size over the limit is refused unread — no reason to spend
    // the transfer to reach the same conclusion — but it is only a hint, so
    // the read below enforces the same limit for itself.
    const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      await discard(response)
      return { status: response.status, retryAfter: null, body: null, oversizeBytes: declaredLength }
    }

    const { text, bytes } = await readCapped(response)
    return { status: response.status, retryAfter: null, body: text, oversizeBytes: text === null ? bytes : null }
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchAtsJson(url: string, options: JsonFetchOptions = {}): Promise<JsonFetchOutcome> {
  const notFound = new Set([404, 410, ...(options.notFoundStatuses ?? [])])

  let result: Attempt
  try {
    result = await attempt(url, options)
    if (RETRYABLE_STATUSES.includes(result.status)) {
      await delay(retryDelayMs(result.retryAfter))
      result = await attempt(url, options)
    }
  } catch (err) {
    // An abort is by far the most common failure here and reads as a bare
    // "This operation was aborted" otherwise, which tells a user nothing.
    const aborted = err instanceof Error && err.name === 'AbortError'
    return {
      status: 'error',
      message: aborted ? `Timed out after ${options.timeoutMs ?? ATS_FETCH_TIMEOUT_MS}ms` : String(err)
    }
  }

  if (notFound.has(result.status)) return { status: 'not_found' }
  if (result.oversizeBytes !== null) {
    // This lands in a board's Last result column, where "34640105" is not an
    // explanation — say how big it was, against what, so the number means
    // something to whoever reads the row.
    return {
      status: 'error',
      message: `Board is too large to fetch (${formatBytes(result.oversizeBytes)}; limit ${formatBytes(MAX_RESPONSE_BYTES)})`
    }
  }
  if (result.body === null) return { status: 'error', message: `HTTP ${result.status}` }

  try {
    return { status: 'ok', data: JSON.parse(result.body) }
  } catch {
    // A board behind a CDN error page or a login wall answers 200 with HTML.
    return { status: 'error', message: 'Response was not valid JSON' }
  }
}

/**
 * Runs `fn` over `items` with at most `limit` in flight. Deliberately not
 * `Promise.all` over the whole list: this is many small requests aimed at a
 * few hosts, and firing all of them at once is both rude and the fastest way
 * to get rate-limited off a public endpoint.
 *
 * Results keep the input order, and a rejection is surfaced as a rejection of
 * the whole call — callers here hand in functions that already return
 * outcomes rather than throwing.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const safeLimit = Math.max(1, Math.floor(limit))
  const results = new Array<R>(items.length)
  let next = 0

  const workers = Array.from({ length: Math.min(safeLimit, items.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index]!, index)
    }
  })

  await Promise.all(workers)
  return results
}
