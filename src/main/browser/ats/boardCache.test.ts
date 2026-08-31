import { describe, it, expect, beforeEach } from 'vitest'
import { boardCacheKey, boardCacheSize, clearBoardCache, readBoardCache, writeBoardCache } from './boardCache'
import {
  ATS_BOARD_CACHE_MAX_ENTRIES,
  ATS_BOARD_CACHE_TTL_MS,
  ATS_BOARD_ERROR_CACHE_TTL_MS,
  ATS_BOARD_NOT_FOUND_CACHE_TTL_MS
} from '@shared/constants'
import type { AtsBoardFetchOutcome } from './types'

const ok: AtsBoardFetchOutcome = { status: 'ok', postings: [], skipped: 0 }

beforeEach(() => {
  clearBoardCache()
})

describe('boardCacheKey', () => {
  it('ignores the query for a provider that always returns the whole board', () => {
    const board = { provider: 'greenhouse' as const, token: 'acme', host: null, site: null }
    expect(boardCacheKey(board, 'engineer')).toBe(boardCacheKey(board, 'designer'))
  })

  it('includes the query for Workday, whose response depends on it', () => {
    const board = {
      provider: 'workday' as const,
      token: 'acme',
      host: 'acme.wd5.myworkdayjobs.com',
      site: 'Careers'
    }
    expect(boardCacheKey(board, 'engineer')).not.toBe(boardCacheKey(board, 'designer'))
    // Case and padding shouldn't split one query into two entries.
    expect(boardCacheKey(board, ' Engineer ')).toBe(boardCacheKey(board, 'engineer'))
  })
})

describe('board cache', () => {
  it('returns a stored outcome and misses on an unknown key', () => {
    writeBoardCache('a', ok)
    expect(readBoardCache('a')).toEqual(ok)
    expect(readBoardCache('b')).toBeNull()
  })

  it('expires a successful fetch after its TTL', () => {
    const now = 1_000_000
    writeBoardCache('a', ok, now)
    expect(readBoardCache('a', now + ATS_BOARD_CACHE_TTL_MS - 1)).toEqual(ok)
    expect(readBoardCache('a', now + ATS_BOARD_CACHE_TTL_MS + 1)).toBeNull()
  })

  it('holds a 404 longer than a transient error, since a wrong slug is the more stable fact', () => {
    const now = 1_000_000
    writeBoardCache('missing', { status: 'not_found' }, now)
    writeBoardCache('broken', { status: 'error', message: 'ECONNRESET' }, now)

    const afterErrorTtl = now + ATS_BOARD_ERROR_CACHE_TTL_MS + 1
    expect(readBoardCache('broken', afterErrorTtl)).toBeNull()
    expect(readBoardCache('missing', afterErrorTtl)).toEqual({ status: 'not_found' })
    expect(readBoardCache('missing', now + ATS_BOARD_NOT_FOUND_CACHE_TTL_MS + 1)).toBeNull()
  })

  it('evicts least-recently-used entries once full, keeping the ones still in use', () => {
    for (let i = 0; i < ATS_BOARD_CACHE_MAX_ENTRIES; i++) writeBoardCache(`key-${i}`, ok)
    // Touch the oldest so it is no longer the least recently used.
    expect(readBoardCache('key-0')).toEqual(ok)

    writeBoardCache('newcomer', ok)
    expect(boardCacheSize()).toBe(ATS_BOARD_CACHE_MAX_ENTRIES)
    expect(readBoardCache('key-0')).toEqual(ok)
    expect(readBoardCache('key-1')).toBeNull()
  })

  it('clears everything when the tracked-board list changes', () => {
    writeBoardCache('a', ok)
    clearBoardCache()
    expect(readBoardCache('a')).toBeNull()
    expect(boardCacheSize()).toBe(0)
  })
})
