import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MAX_ATS_BOARDS_PER_SEARCH } from '@shared/constants'
import type { CompanyBoardRecord } from '@shared/types/companyBoard'
import type { AtsBoardFetchOutcome, AtsPosting } from './types'

const listSearchableCompanyBoards = vi.fn()
const recordCompanyBoardFetch = vi.fn()
const fetchBoardMock = vi.fn()
const broadcastCompanyBoardsChanged = vi.fn()

vi.mock('../../db/repositories/companyBoardsRepository', () => ({
  listSearchableCompanyBoards: (...args: unknown[]) => listSearchableCompanyBoards(...args),
  recordCompanyBoardFetch: (...args: unknown[]) => recordCompanyBoardFetch(...args)
}))

vi.mock('../../ipc/jobsBroadcast', () => ({
  broadcastCompanyBoardsChanged: () => broadcastCompanyBoardsChanged()
}))

vi.mock('./providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providers')>()
  return {
    ...actual,
    adapterFor: (provider: string) => ({
      provider,
      label: provider,
      serverSideQuery: false,
      probeable: true,
      parseBoardUrl: () => null,
      fetchBoard: (...args: unknown[]) => fetchBoardMock(...args)
    })
  }
})

import { searchAtsBoards } from './searchAtsBoards'
import { clearBoardCache } from './boardCache'

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
    lastError: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  }
}

function posting(overrides: Partial<AtsPosting> = {}): AtsPosting {
  return {
    id: '1',
    title: 'Backend Engineer',
    company: 'Acme',
    url: 'https://job-boards.greenhouse.io/acme/jobs/1',
    snippet: '',
    ...overrides
  }
}

const okWith = (...postings: AtsPosting[]): AtsBoardFetchOutcome => ({ status: 'ok', postings, skipped: 0 })

beforeEach(() => {
  clearBoardCache()
  listSearchableCompanyBoards.mockReset().mockReturnValue([])
  recordCompanyBoardFetch.mockReset()
  broadcastCompanyBoardsChanged.mockReset()
  fetchBoardMock.mockReset().mockResolvedValue(okWith())
})

describe('searchAtsBoards', () => {
  it('says so plainly when nothing is tracked, instead of returning a silent empty result', async () => {
    const result = await searchAtsBoards({ query: 'engineer', limit: 20 })
    expect(result.results).toEqual([])
    expect(result.searchedBoards).toBe(0)
    expect(result.warnings[0]).toContain('no boards are being tracked')
    expect(fetchBoardMock).not.toHaveBeenCalled()
  })

  it('fetches each tracked board and maps its postings to search results', async () => {
    listSearchableCompanyBoards.mockReturnValue([board({ token: 'acme', companyName: 'Acme Labs' })])
    fetchBoardMock.mockResolvedValue(
      okWith(posting({ title: 'Backend Engineer', location: 'Berlin', salaryRange: '$100k' }))
    )

    const result = await searchAtsBoards({ query: 'engineer', limit: 20 })
    expect(result.results).toEqual([
      {
        title: 'Backend Engineer',
        company: 'Acme',
        location: 'Berlin',
        url: 'https://job-boards.greenhouse.io/acme/jobs/1',
        source: 'greenhouse',
        postedAt: undefined,
        snippet: '',
        salaryRange: '$100k'
      }
    ])
    expect(result.searchedProviders).toEqual(['greenhouse'])
  })

  it('filters locally, since these boards have no keyword search of their own', async () => {
    listSearchableCompanyBoards.mockReturnValue([board()])
    fetchBoardMock.mockResolvedValue(
      okWith(
        posting({ id: '1', title: 'Backend Engineer', url: 'https://x/1' }),
        posting({ id: '2', title: 'Office Manager', url: 'https://x/2' })
      )
    )

    const result = await searchAtsBoards({ query: 'engineer', limit: 20 })
    expect(result.results.map((r) => r.title)).toEqual(['Backend Engineer'])
  })

  it('asks a paged provider for more postings than the page will show', async () => {
    // The location filter and the cross-board dedupe run after the fetch, so
    // fetching exactly `limit` rows from a server-side-paged board (Workday)
    // can filter down to nothing while matching postings sit on the next page.
    listSearchableCompanyBoards.mockReturnValue([board()])

    await searchAtsBoards({ query: 'engineer', location: 'Berlin', limit: 20 })

    const options = fetchBoardMock.mock.calls[0]![1] as { limit: number }
    expect(options.limit).toBeGreaterThan(20)
  })

  it('signals the boards panel after a search, which rewrites every board status', async () => {
    // The panel reads the list on mount and then stays mounted while another
    // screen is showing, so without this its "last checked" column would keep
    // showing whatever it read at startup.
    listSearchableCompanyBoards.mockReturnValue([board()])

    await searchAtsBoards({ query: 'engineer', limit: 20 })
    expect(broadcastCompanyBoardsChanged).toHaveBeenCalledTimes(1)
  })

  it('does not signal the panel when there was nothing to fetch', async () => {
    await searchAtsBoards({ query: 'engineer', limit: 20 })
    expect(broadcastCompanyBoardsChanged).not.toHaveBeenCalled()
  })

  it('reuses a fetched board across searches rather than re-downloading it', async () => {
    listSearchableCompanyBoards.mockReturnValue([board()])
    fetchBoardMock.mockResolvedValue(okWith(posting()))

    await searchAtsBoards({ query: 'engineer', limit: 20 })
    await searchAtsBoards({ query: 'engineer', limit: 20 })
    expect(fetchBoardMock).toHaveBeenCalledTimes(1)
  })

  it('gives every board a share of the page, so a big board cannot crowd out a small one', async () => {
    listSearchableCompanyBoards.mockReturnValue([
      board({ token: 'big', boardKey: 'greenhouse:big', companyName: 'Big' }),
      board({ token: 'small', boardKey: 'greenhouse:small', companyName: 'Small' })
    ])
    fetchBoardMock.mockImplementation(async (descriptor: { token: string }) =>
      descriptor.token === 'big'
        ? okWith(
            ...Array.from({ length: 10 }, (_, i) =>
              posting({ id: `b${i}`, title: 'Engineer', company: 'Big', url: `https://big/${i}` })
            )
          )
        : okWith(posting({ id: 's1', title: 'Engineer', company: 'Small', url: 'https://small/1' }))
    )

    const result = await searchAtsBoards({ query: 'engineer', limit: 4 })
    expect(result.results.map((r) => r.company)).toContain('Small')
    expect(result.results).toHaveLength(4)
  })

  it('collapses one job reached through two boards, which is what a mid-migration company looks like', async () => {
    listSearchableCompanyBoards.mockReturnValue([
      board({ token: 'acme', boardKey: 'lever:acme', provider: 'lever' }),
      board({ token: 'acme', boardKey: 'ashby:acme', provider: 'ashby' })
    ])
    fetchBoardMock.mockImplementation(async (descriptor: { provider: string }) =>
      okWith(
        posting({
          id: descriptor.provider === 'lever' ? 'l1' : 'a1',
          title: 'Backend Engineer',
          company: 'Acme',
          location: 'Berlin',
          // The same role has an entirely different URL on each board.
          url: `https://jobs.${descriptor.provider}.example/acme/1`
        })
      )
    )

    const result = await searchAtsBoards({ query: 'engineer', limit: 20 })
    expect(result.results).toHaveLength(1)
  })

  it('keeps two same-titled postings from one board, which are two real requisitions', async () => {
    listSearchableCompanyBoards.mockReturnValue([board()])
    fetchBoardMock.mockResolvedValue(
      okWith(
        posting({ id: '1', title: 'Backend Engineer', location: 'Berlin', url: 'https://x/1' }),
        posting({ id: '2', title: 'Backend Engineer', location: 'Berlin', url: 'https://x/2' })
      )
    )

    const result = await searchAtsBoards({ query: 'engineer', limit: 20 })
    expect(result.results.map((r) => r.url)).toEqual(['https://x/1', 'https://x/2'])
  })

  it('warns per board on a 404 and on a fetch failure, without failing the search', async () => {
    listSearchableCompanyBoards.mockReturnValue([
      board({ token: 'gone', boardKey: 'greenhouse:gone', companyName: 'Gone Inc' }),
      board({ token: 'broken', boardKey: 'greenhouse:broken', companyName: 'Broken Inc' }),
      board({ token: 'fine', boardKey: 'greenhouse:fine', companyName: 'Fine Inc' })
    ])
    fetchBoardMock.mockImplementation(async (descriptor: { token: string }) => {
      if (descriptor.token === 'gone') return { status: 'not_found' }
      if (descriptor.token === 'broken') return { status: 'error', message: 'ECONNRESET' }
      return okWith(posting({ title: 'Engineer' }))
    })

    const result = await searchAtsBoards({ query: 'engineer', limit: 20 })
    expect(result.results).toHaveLength(1)
    expect(result.warnings.join(' ')).toContain('Gone Inc')
    expect(result.warnings.join(' ')).toContain('ECONNRESET')
  })

  it('records what each fetch found, including a live board holding nothing', async () => {
    listSearchableCompanyBoards.mockReturnValue([
      board({ token: 'quiet', boardKey: 'greenhouse:quiet' }),
      board({ token: 'gone', boardKey: 'greenhouse:gone' })
    ])
    fetchBoardMock.mockImplementation(async (descriptor: { token: string }) =>
      descriptor.token === 'quiet' ? okWith() : { status: 'not_found' }
    )

    await searchAtsBoards({ query: 'engineer', limit: 20 })

    expect(recordCompanyBoardFetch).toHaveBeenCalledWith('greenhouse:quiet', { jobCount: 0, error: null })
    expect(recordCompanyBoardFetch).toHaveBeenCalledWith('greenhouse:gone', {
      jobCount: 0,
      error: expect.stringContaining('404')
    })
  })

  it('does not let a bookkeeping failure lose results that were already fetched', async () => {
    listSearchableCompanyBoards.mockReturnValue([board()])
    recordCompanyBoardFetch.mockImplementation(() => {
      throw new Error('database is locked')
    })
    fetchBoardMock.mockResolvedValue(okWith(posting({ title: 'Engineer' })))

    const result = await searchAtsBoards({ query: 'engineer', limit: 20 })
    expect(result.results).toHaveLength(1)
  })

  it('survives an adapter that throws instead of returning an outcome', async () => {
    listSearchableCompanyBoards.mockReturnValue([board()])
    fetchBoardMock.mockRejectedValue(new Error('boom'))

    const result = await searchAtsBoards({ query: 'engineer', limit: 20 })
    expect(result.results).toEqual([])
    expect(result.warnings.join(' ')).toContain('boom')
  })

  it('caps how many boards one search fetches and says which ones it skipped', async () => {
    const many = Array.from({ length: MAX_ATS_BOARDS_PER_SEARCH + 5 }, (_, i) =>
      board({ token: `c${i}`, boardKey: `greenhouse:c${i}` })
    )
    listSearchableCompanyBoards.mockReturnValue(many)

    const result = await searchAtsBoards({ query: 'engineer', limit: 20 })
    expect(fetchBoardMock).toHaveBeenCalledTimes(MAX_ATS_BOARDS_PER_SEARCH)
    expect(result.searchedBoards).toBe(MAX_ATS_BOARDS_PER_SEARCH)
    expect(result.warnings.join(' ')).toContain(String(many.length))
  })

  it('passes the requested providers through, so a narrowed search stays narrow', async () => {
    listSearchableCompanyBoards.mockReturnValue([])
    await searchAtsBoards({ query: 'engineer', limit: 20, providers: ['lever'] })
    expect(listSearchableCompanyBoards).toHaveBeenCalledWith(['lever'])
  })

  it('reports a failure to read the tracked list as a warning rather than throwing', async () => {
    listSearchableCompanyBoards.mockImplementation(() => {
      throw new Error('no such table')
    })

    const result = await searchAtsBoards({ query: 'engineer', limit: 20 })
    expect(result.results).toEqual([])
    expect(result.warnings.join(' ')).toContain('no such table')
  })
})
