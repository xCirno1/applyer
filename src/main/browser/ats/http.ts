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

async function once(url: string, options: JsonFetchOptions): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? ATS_FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchAtsJson(url: string, options: JsonFetchOptions = {}): Promise<JsonFetchOutcome> {
  const notFound = new Set([404, 410, ...(options.notFoundStatuses ?? [])])

  let response: Response
  try {
    response = await once(url, options)
    if (RETRYABLE_STATUSES.includes(response.status)) {
      await delay(retryDelayMs(response.headers.get('retry-after')))
      response = await once(url, options)
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

  if (notFound.has(response.status)) return { status: 'not_found' }
  if (!response.ok) return { status: 'error', message: `HTTP ${response.status}` }

  const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    return { status: 'error', message: `Response too large (${declaredLength} bytes)` }
  }

  let text: string
  try {
    text = await response.text()
  } catch (err) {
    return { status: 'error', message: `Failed to read response: ${String(err)}` }
  }
  if (text.length > MAX_RESPONSE_BYTES) {
    return { status: 'error', message: `Response too large (${text.length} bytes)` }
  }

  try {
    return { status: 'ok', data: JSON.parse(text) }
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
