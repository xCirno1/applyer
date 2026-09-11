import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MANUAL_BOARD_FETCH_LIMIT } from '@shared/constants'
import type { CompanyBoardRecord } from '@shared/types/companyBoard'
import type { AtsBoardFetchOutcome, AtsPosting } from './types'

const recordCompanyBoardFetch = vi.fn()
const fetchBoardMock = vi.fn()

vi.mock('../../db/repositories/companyBoardsRepository', () => ({
  recordCompanyBoardFetch: (...args: unknown[]) => recordCompanyBoardFetch(...args)
}))

vi.mock('./providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providers')>()
  return {
    ...actual,
    adapterFor: (provider: string) =>
      provider === 'unknown'
        ? undefined
        : {
            provider,
            label: provider,
            // As in the real registry: Workday is the one provider that sends
            // the query upstream instead of serving a whole board.
            serverSideQuery: provider === 'workday',
            probeable: provider !== 'workday',
            parseBoardUrl: () => null,
            fetchBoard: (...args: unknown[]) => fetchBoardMock(...args)
          }
  }
})

import { refreshBoards } from './refreshBoards'
import { boardCacheSize, clearBoardCache, readBoardCache } from './boardCache'

function board(overrides: Partial<CompanyBoardRecord> = {}): CompanyBoardRecord {
  const token = overrides.token ?? 'acme'
  return {
    id: `id-${token}`,
    boardKey: `greenhouse:${token}`,
    provider: 'greenhouse',
    token,
    host: null,
    site: null,
    companyName: overrides.companyName ?? 'Acme',
    addedBy: 'user',
    enabled: true,
    lastCheckedAt: null,
    lastJobCount: null,
    seedJobCount: null,
    lastError: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  }
}

function posting(id: string): AtsPosting {
  return { id, title: 'Engineer', company: 'Acme', url: `https://example.com/${id}`, snippet: '' }
}

function ok(count: number, total?: number): AtsBoardFetchOutcome {
  return {
    status: 'ok',
    postings: Array.from({ length: count }, (_, i) => posting(String(i))),
    skipped: 0,
    total
  }
}

beforeEach(() => {
  clearBoardCache()
  fetchBoardMock.mockReset()
  recordCompanyBoardFetch.mockReset()
})

describe('refreshBoards', () => {
  it('reports the count a board answered with and records it', async () => {
    fetchBoardMock.mockResolvedValue(ok(3))

    const results = await refreshBoards([board()])

    expect(results).toEqual([
      { id: 'id-acme', companyName: 'Acme', provider: 'greenhouse', status: 'ok', jobCount: 3, message: null }
    ])
    expect(recordCompanyBoardFetch).toHaveBeenCalledWith('greenhouse:acme', { jobCount: 3, error: null })
  })

  it("files a paging provider's own total as the board size, not the page it returned", async () => {
    // Workday answers a fetch with one page plus a count of everything that
    // matched, so a 300-role board would otherwise be recorded as having the
    // 60 roles that fit in the fetch.
    fetchBoardMock.mockResolvedValue(ok(60, 300))

    const [result] = await refreshBoards([board()])

    expect(result?.jobCount).toBe(300)
    expect(recordCompanyBoardFetch).toHaveBeenCalledWith('greenhouse:acme', { jobCount: 300, error: null })
  })

  it('counts a Workday board, which is what fetching it with no query is for', async () => {
    // The same provider a keyword search must not record a count for: this
    // path asks with an empty query, so what comes back is the whole board
    // and there is nothing to be careful about.
    fetchBoardMock.mockResolvedValue(ok(20, 412))

    const [result] = await refreshBoards([
      board({ provider: 'workday', boardKey: 'workday:acme', host: 'acme.wd5.myworkdayjobs.com', site: 'Careers' })
    ])

    expect(result?.jobCount).toBe(412)
    expect(recordCompanyBoardFetch).toHaveBeenCalledWith('workday:acme', { jobCount: 412, error: null })
  })

  it('ignores a total smaller than the rows in hand, which cannot be the board size', async () => {
    fetchBoardMock.mockResolvedValue(ok(5, 2))

    const [result] = await refreshBoards([board()])

    expect(result?.jobCount).toBe(5)
  })

  it('treats an empty board as a real answer, not a failure', async () => {
    fetchBoardMock.mockResolvedValue(ok(0))

    const [result] = await refreshBoards([board()])

    expect(result).toMatchObject({ status: 'ok', jobCount: 0, message: null })
    expect(recordCompanyBoardFetch).toHaveBeenCalledWith('greenhouse:acme', { jobCount: 0, error: null })
  })

  it('records a 404 as a sentence about the slug rather than a status code', async () => {
    fetchBoardMock.mockResolvedValue({ status: 'not_found' } satisfies AtsBoardFetchOutcome)

    const [result] = await refreshBoards([board()])

    expect(result?.status).toBe('not_found')
    expect(result?.message).toContain('404')
    expect(recordCompanyBoardFetch).toHaveBeenCalledWith(
      'greenhouse:acme',
      expect.objectContaining({ jobCount: 0, error: expect.stringContaining('404') })
    )
  })

  it('carries a provider error through to the row', async () => {
    fetchBoardMock.mockResolvedValue({ status: 'error', message: 'timed out' } satisfies AtsBoardFetchOutcome)

    const [result] = await refreshBoards([board()])

    expect(result).toMatchObject({ status: 'error', jobCount: 0, message: 'timed out' })
  })

  it('keeps one board\'s unexpected throw from taking down the rest', async () => {
    fetchBoardMock.mockImplementationOnce(() => Promise.reject(new Error('boom'))).mockResolvedValue(ok(1))

    const results = await refreshBoards([board({ token: 'bad' }), board({ token: 'good' })])

    expect(results[0]).toMatchObject({ status: 'error' })
    expect(results[1]).toMatchObject({ status: 'ok', jobCount: 1 })
  })

  it('reports an unknown provider rather than skipping the row silently', async () => {
    const [result] = await refreshBoards([board({ provider: 'unknown' as CompanyBoardRecord['provider'] })])

    expect(result).toMatchObject({ status: 'error' })
    expect(result?.message).toContain('unknown')
    expect(fetchBoardMock).not.toHaveBeenCalled()
  })

  it('asks the provider again rather than serving the cache, and caches the fresh answer', async () => {
    fetchBoardMock.mockResolvedValue(ok(2))
    await refreshBoards([board()])
    expect(boardCacheSize()).toBe(1)

    // A second refresh is a second request: pressing the button has to mean
    // "ask now", not "show me what we last saw".
    fetchBoardMock.mockResolvedValue(ok(5))
    await refreshBoards([board()])

    expect(fetchBoardMock).toHaveBeenCalledTimes(2)
    expect(readBoardCache('greenhouse:acme')).toMatchObject({ status: 'ok' })
  })

  it('fetches every board, including paused ones a search would skip', async () => {
    fetchBoardMock.mockResolvedValue(ok(1))

    const results = await refreshBoards([board({ token: 'a', enabled: false }), board({ token: 'b' })])

    expect(results.map((r) => r.id)).toEqual(['id-a', 'id-b'])
    expect(fetchBoardMock).toHaveBeenCalledTimes(2)
  })

  it('asks for a census of the board rather than running a query against it', async () => {
    fetchBoardMock.mockResolvedValue(ok(1))

    await refreshBoards([board()])

    expect(fetchBoardMock).toHaveBeenCalledWith(
      expect.objectContaining({ boardKey: 'greenhouse:acme' }),
      expect.objectContaining({ query: '', limit: MANUAL_BOARD_FETCH_LIMIT, companyName: 'Acme' })
    )
  })

  it('does nothing for an empty selection', async () => {
    expect(await refreshBoards([])).toEqual([])
    expect(fetchBoardMock).not.toHaveBeenCalled()
  })

  it('reports each board as it lands rather than holding them for the batch', async () => {
    // The second board never answers until released, so anything reported
    // before that can only have come from the first one finishing.
    let releaseSlow = (): void => {}
    const slow = new Promise<AtsBoardFetchOutcome>((resolve) => {
      releaseSlow = () => resolve(ok(7))
    })
    fetchBoardMock.mockResolvedValueOnce(ok(2)).mockReturnValueOnce(slow)

    const reported: string[] = []
    const pending = refreshBoards([board({ token: 'fast' }), board({ token: 'slow' })], (result) =>
      reported.push(result.id)
    )

    // Let the fast board's promise chain run to completion.
    await Promise.resolve()
    await Promise.resolve()
    expect(reported).toEqual(['id-fast'])

    releaseSlow()
    await pending
    expect(reported).toEqual(['id-fast', 'id-slow'])
  })

  it('reports a failure as it lands too, not only the boards that answered', async () => {
    fetchBoardMock.mockResolvedValue({ status: 'error', message: 'timed out' } satisfies AtsBoardFetchOutcome)

    const reported: string[] = []
    await refreshBoards([board()], (result) => reported.push(result.status))

    expect(reported).toEqual(['error'])
  })

  it('keeps fetching when reporting one result throws', async () => {
    fetchBoardMock.mockResolvedValue(ok(1))

    const results = await refreshBoards([board({ token: 'a' }), board({ token: 'b' })], (result) => {
      if (result.id === 'id-a') throw new Error('listener blew up')
    })

    expect(results.map((r) => r.id)).toEqual(['id-a', 'id-b'])
  })
})
