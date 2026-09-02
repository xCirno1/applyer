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

/** Responses larger than this are refused unread — a board that big is a bug, not a board. */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024

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
  /** Set only when the body was refused unread because the response declared an implausible size. */
  declaredLength: number | null
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
        declaredLength: null
      }
    }

    const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      await discard(response)
      return { status: response.status, retryAfter: null, body: null, declaredLength }
    }

    return { status: response.status, retryAfter: null, body: await response.text(), declaredLength: null }
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
  if (result.declaredLength !== null) {
    return { status: 'error', message: `Response too large (${result.declaredLength} bytes)` }
  }
  if (result.body === null) return { status: 'error', message: `HTTP ${result.status}` }
  if (result.body.length > MAX_RESPONSE_BYTES) {
    return { status: 'error', message: `Response too large (${result.body.length} bytes)` }
  }

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
