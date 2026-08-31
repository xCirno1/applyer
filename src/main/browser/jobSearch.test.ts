import { describe, it, expect, vi, beforeEach } from 'vitest'

const searchIndeed = vi.fn()
const searchLinkedIn = vi.fn()
const searchAtsBoards = vi.fn()
const isUrlExcluded = vi.fn()

vi.mock('./scrapers/indeed', () => ({ searchIndeed: (...args: unknown[]) => searchIndeed(...args) }))
vi.mock('./scrapers/linkedin', () => ({ searchLinkedIn: (...args: unknown[]) => searchLinkedIn(...args) }))
vi.mock('./ats/searchAtsBoards', () => ({ searchAtsBoards: (...args: unknown[]) => searchAtsBoards(...args) }))
vi.mock('../db/repositories/jobExclusionsRepository', () => ({
  isUrlExcluded: (...args: unknown[]) => isUrlExcluded(...args)
}))

import { searchJobs } from './jobSearch'
import type { JobSearchResultItem } from './types'
import type { JobSource } from './sourceRouter'

function result(url: string, source: JobSource = 'indeed', overrides: Partial<JobSearchResultItem> = {}): JobSearchResultItem {
  return { title: `Job at ${url}`, company: 'Acme', url, source, snippet: '', ...overrides }
}

beforeEach(() => {
  searchIndeed.mockReset().mockResolvedValue({ results: [], blocked: false })
  searchLinkedIn.mockReset().mockResolvedValue({ results: [], blocked: false })
  searchAtsBoards
    .mockReset()
    .mockResolvedValue({ results: [], warnings: [], searchedBoards: 0, searchedProviders: [] })
  isUrlExcluded.mockReset().mockReturnValue(false)
})

describe('searchJobs', () => {
  it('searches the aggregators and the tracked company boards when no sources are given', async () => {
    await searchJobs({ query: 'engineer', limit: 20 })
    expect(searchIndeed).toHaveBeenCalledWith('engineer', undefined, 20)
    expect(searchLinkedIn).toHaveBeenCalledWith('engineer', undefined, 20)
    expect(searchAtsBoards).toHaveBeenCalledWith({
      query: 'engineer',
      location: undefined,
      limit: 20,
      providers: ['greenhouse', 'lever', 'ashby', 'workday']
    })
  })

  it('only searches requested sources when a subset is given', async () => {
    await searchJobs({ query: 'engineer', sources: ['indeed'], limit: 20 })
    expect(searchIndeed).toHaveBeenCalled()
    expect(searchLinkedIn).not.toHaveBeenCalled()
    expect(searchAtsBoards).not.toHaveBeenCalled()
  })

  it('narrows the board search to the ATS providers that were asked for', async () => {
    await searchJobs({ query: 'engineer', sources: ['lever', 'ashby'], limit: 20 })
    expect(searchAtsBoards).toHaveBeenCalledWith(expect.objectContaining({ providers: ['lever', 'ashby'] }))
    expect(searchIndeed).not.toHaveBeenCalled()
  })

  it('runs one board search for several ATS providers, not one per provider', async () => {
    await searchJobs({ query: 'engineer', sources: ['greenhouse', 'lever', 'workday'], limit: 20 })
    expect(searchAtsBoards).toHaveBeenCalledTimes(1)
  })

  it('reports the ATS providers that actually contributed a board as searched', async () => {
    searchAtsBoards.mockResolvedValue({
      results: [],
      warnings: [],
      searchedBoards: 2,
      searchedProviders: ['greenhouse', 'ashby']
    })
    const outcome = await searchJobs({ query: 'engineer', sources: ['greenhouse', 'ashby'], limit: 20 })
    expect(outcome.searchedSources).toEqual(['greenhouse', 'ashby'])
  })

  it('passes the board search warnings through (e.g. nothing tracked yet)', async () => {
    searchAtsBoards.mockResolvedValue({
      results: [],
      warnings: ['company boards: no boards are being tracked yet'],
      searchedBoards: 0,
      searchedProviders: []
    })
    const outcome = await searchJobs({ query: 'engineer', sources: ['greenhouse'], limit: 20 })
    expect(outcome.warnings).toEqual([expect.stringContaining('no boards are being tracked')])
  })

  it('still warns about a source with nothing to enumerate at all', async () => {
    const outcome = await searchJobs({ query: 'engineer', sources: ['generic'], limit: 20 })
    expect(outcome.searchedSources).toEqual([])
    expect(outcome.warnings).toEqual([expect.stringContaining('generic')])
    expect(outcome.warnings[0]).toContain('no keyword-search endpoint')
  })

  it('mixes a warning for an unsupported source with results from supported ones', async () => {
    searchIndeed.mockResolvedValue({ results: [result('https://indeed.com/1')], blocked: false })
    const outcome = await searchJobs({ query: 'engineer', sources: ['indeed', 'generic'], limit: 20 })
    expect(outcome.searchedSources).toEqual(['indeed'])
    expect(outcome.results).toHaveLength(1)
    expect(outcome.warnings).toEqual([expect.stringContaining('generic')])
  })

  it('deduplicates results with the same URL across sources', async () => {
    searchIndeed.mockResolvedValue({ results: [result('https://x.com/1')], blocked: false })
    searchLinkedIn.mockResolvedValue({ results: [result('https://x.com/1', 'linkedin')], blocked: false })
    const outcome = await searchJobs({ query: 'engineer', limit: 20 })
    expect(outcome.results).toHaveLength(1)
  })

  it("drops an aggregator's copy of a posting already found on the company's own board", async () => {
    // The two rows are the same job with different URLs and no shared id, so
    // company + title + location is the only thing linking them.
    searchAtsBoards.mockResolvedValue({
      results: [
        result('https://job-boards.greenhouse.io/acme/jobs/1', 'greenhouse', {
          title: 'Backend Engineer',
          company: 'Acme',
          location: 'Berlin'
        })
      ],
      warnings: [],
      searchedBoards: 1,
      searchedProviders: ['greenhouse']
    })
    searchLinkedIn.mockResolvedValue({
      results: [
        result('https://www.linkedin.com/jobs/view/99', 'linkedin', {
          title: 'Backend  Engineer',
          company: 'Acme Inc.',
          location: 'BERLIN'
        })
      ],
      blocked: false
    })

    const outcome = await searchJobs({ query: 'engineer', limit: 20 })
    expect(outcome.results.map((r) => r.source)).toEqual(['greenhouse'])
  })

  it('keeps two aggregator listings that merely look alike — they are often separate requisitions', async () => {
    const shared = { title: 'Backend Engineer', company: 'Acme', location: 'Berlin' }
    searchIndeed.mockResolvedValue({ results: [result('https://indeed.com/1', 'indeed', shared)], blocked: false })
    searchLinkedIn.mockResolvedValue({
      results: [result('https://linkedin.com/2', 'linkedin', shared)],
      blocked: false
    })

    const outcome = await searchJobs({ query: 'engineer', limit: 20 })
    expect(outcome.results).toHaveLength(2)
  })

  it('interleaves board and aggregator results so neither fills the whole page', async () => {
    searchAtsBoards.mockResolvedValue({
      results: [
        result('https://gh/1', 'greenhouse', { title: 'A' }),
        result('https://gh/2', 'greenhouse', { title: 'B' })
      ],
      warnings: [],
      searchedBoards: 1,
      searchedProviders: ['greenhouse']
    })
    searchIndeed.mockResolvedValue({
      results: [
        result('https://in/1', 'indeed', { title: 'C' }),
        result('https://in/2', 'indeed', { title: 'D' })
      ],
      blocked: false
    })

    const outcome = await searchJobs({ query: 'engineer', limit: 4 })
    expect(outcome.results.map((r) => r.source)).toEqual(['greenhouse', 'indeed', 'greenhouse', 'indeed'])
  })

  it('produces the same ordering regardless of which source returns first', async () => {
    searchIndeed.mockImplementation(
      async () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ results: [result('https://in/1', 'indeed')], blocked: false }), 5)
        )
    )
    searchLinkedIn.mockResolvedValue({ results: [result('https://li/1', 'linkedin')], blocked: false })

    const outcome = await searchJobs({ query: 'engineer', sources: ['indeed', 'linkedin'], limit: 20 })
    expect(outcome.results.map((r) => r.url)).toEqual(['https://in/1', 'https://li/1'])
  })

  it('filters out results whose URL is on the exclusion list', async () => {
    searchIndeed.mockResolvedValue({
      results: [result('https://x.com/keep'), result('https://x.com/excluded')],
      blocked: false
    })
    isUrlExcluded.mockImplementation((url: string) => url === 'https://x.com/excluded')

    const outcome = await searchJobs({ query: 'engineer', sources: ['indeed'], limit: 20 })
    expect(outcome.results.map((r) => r.url)).toEqual(['https://x.com/keep'])
  })

  it('excludes a board result the same way it excludes an aggregator one', async () => {
    searchAtsBoards.mockResolvedValue({
      results: [result('https://gh/excluded', 'greenhouse')],
      warnings: [],
      searchedBoards: 1,
      searchedProviders: ['greenhouse']
    })
    isUrlExcluded.mockReturnValue(true)

    const outcome = await searchJobs({ query: 'engineer', sources: ['greenhouse'], limit: 20 })
    expect(outcome.results).toEqual([])
  })

  it('truncates combined results to the requested limit', async () => {
    searchIndeed.mockResolvedValue({
      results: [result('https://x.com/1'), result('https://x.com/2'), result('https://x.com/3')],
      blocked: false
    })
    const outcome = await searchJobs({ query: 'engineer', sources: ['indeed'], limit: 2 })
    expect(outcome.results).toHaveLength(2)
  })

  it('propagates a per-source warning (e.g. blocked by a captcha) without failing the whole search', async () => {
    searchIndeed.mockResolvedValue({ results: [], blocked: true, warning: 'indeed: blocked by a verification challenge' })
    const outcome = await searchJobs({ query: 'engineer', sources: ['indeed'], limit: 20 })
    expect(outcome.warnings).toContain('indeed: blocked by a verification challenge')
  })

  it('records a warning (not a thrown error) when a source rejects unexpectedly', async () => {
    searchLinkedIn.mockRejectedValue(new Error('page crashed'))
    searchIndeed.mockResolvedValue({ results: [result('https://x.com/1')], blocked: false })

    const outcome = await searchJobs({ query: 'engineer', sources: ['indeed', 'linkedin'], limit: 20 })
    expect(outcome.results).toHaveLength(1)
    expect(outcome.warnings).toEqual([expect.stringContaining('page crashed')])
  })

  it('keeps the aggregators working when the board search itself blows up', async () => {
    searchAtsBoards.mockRejectedValue(new Error('board search exploded'))
    searchIndeed.mockResolvedValue({ results: [result('https://x.com/1')], blocked: false })

    const outcome = await searchJobs({ query: 'engineer', limit: 20 })
    expect(outcome.results).toHaveLength(1)
    expect(outcome.warnings).toEqual([expect.stringContaining('board search exploded')])
  })
})
