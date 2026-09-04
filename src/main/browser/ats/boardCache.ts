import {
  ATS_BOARD_CACHE_MAX_ENTRIES,
  ATS_BOARD_CACHE_TTL_MS,
  ATS_BOARD_ERROR_CACHE_TTL_MS,
  ATS_BOARD_NOT_FOUND_CACHE_TTL_MS
} from '@shared/constants'
import { adapterFor, boardKeyOf } from './providers'
import type { AtsBoardDescriptor } from '@shared/types/companyBoard'
import type { AtsBoardFetchOutcome } from './types'

/**
 * In-memory, process-lifetime cache of fetched boards.
 *
 * An agent typically runs several searches in a row, and re-downloading a
 * 500-posting board for each one is pure waste — boards change on the order
 * of a day, not a minute. Deliberately not persisted: it holds someone else's
 * live listings, and a stale board surviving a restart is worse than one
 * extra request.
 *
 * Failures are cached too, with their own shorter lifetimes, so a wrong slug
 * doesn't cost an HTTP round trip on every subsequent search while a
 * transient network failure still clears quickly.
 */

interface CacheEntry {
  outcome: AtsBoardFetchOutcome
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

function ttlFor(outcome: AtsBoardFetchOutcome): number {
  switch (outcome.status) {
    case 'ok':
      return ATS_BOARD_CACHE_TTL_MS
    case 'not_found':
      return ATS_BOARD_NOT_FOUND_CACHE_TTL_MS
    case 'error':
      return ATS_BOARD_ERROR_CACHE_TTL_MS
  }
}

/**
 * Workday filters and pages server-side, so its response depends on the query
 * *and* on how many postings were asked for — an entry fetched for a small
 * request holds fewer rows than a later, larger one needs, so both are part
 * of the key. The other three always return the whole board, so neither is
 * relevant to what came back and folding them in would mean re-downloading
 * the same board per query.
 */
export function boardCacheKey(descriptor: AtsBoardDescriptor, query: string, limit: number): string {
  const key = boardKeyOf(descriptor)
  if (!adapterFor(descriptor.provider)?.serverSideQuery) return key
  return `${key}|${query.trim().toLowerCase()}|${limit}`
}

export function readBoardCache(key: string, now = Date.now()): AtsBoardFetchOutcome | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= now) {
    cache.delete(key)
    return null
  }
  // Re-insert so the eviction below is least-recently-*used*, not merely oldest.
  cache.delete(key)
  cache.set(key, entry)
  return entry.outcome
}

export function writeBoardCache(key: string, outcome: AtsBoardFetchOutcome, now = Date.now()): void {
  cache.delete(key)
  cache.set(key, { outcome, expiresAt: now + ttlFor(outcome) })

  while (cache.size > ATS_BOARD_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}

/**
 * Drops cached boards. Called when the tracked-board list changes (a newly
 * added board that was probed a moment ago should show its postings straight
 * away) and by tests, which must not share state through this module.
 */
export function clearBoardCache(): void {
  cache.clear()
}

/** Test/diagnostic helper — the number of live entries, not counting expired ones. */
export function boardCacheSize(now = Date.now()): number {
  let live = 0
  for (const entry of cache.values()) if (entry.expiresAt > now) live++
  return live
}
