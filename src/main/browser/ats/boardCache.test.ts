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
  const workdayBoard = {
    provider: 'workday' as const,
    token: 'acme',
    host: 'acme.wd5.myworkdayjobs.com',
    site: 'Careers'
  }

  it('ignores the query and the limit for a provider that always returns the whole board', () => {
    const board = { provider: 'greenhouse' as const, token: 'acme', host: null, site: null }
    expect(boardCacheKey(board, 'engineer', 20)).toBe(boardCacheKey(board, 'designer', 60))
  })

  it('includes the query for Workday, whose response depends on it', () => {
    expect(boardCacheKey(workdayBoard, 'engineer', 20)).not.toBe(boardCacheKey(workdayBoard, 'designer', 20))
    // Case and padding shouldn't split one query into two entries.
    expect(boardCacheKey(workdayBoard, ' Engineer ', 20)).toBe(boardCacheKey(workdayBoard, 'engineer', 20))
  })

  it('includes the limit for Workday, since a small fetch cannot serve a larger one', () => {
    // Workday pages server-side and truncates to what was asked for, so the
    // entry written for a 20-row request holds fewer postings than a later
    // 60-row request needs — serving it would silently cap the bigger search.
    expect(boardCacheKey(workdayBoard, 'engineer', 20)).not.toBe(boardCacheKey(workdayBoard, 'engineer', 60))
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
