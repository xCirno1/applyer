import { describe, it, expect, vi, beforeEach } from 'vitest'

const searchIndeed = vi.fn()
const searchLinkedIn = vi.fn()
const isUrlExcluded = vi.fn()

vi.mock('./scrapers/indeed', () => ({ searchIndeed: (...args: unknown[]) => searchIndeed(...args) }))
vi.mock('./scrapers/linkedin', () => ({ searchLinkedIn: (...args: unknown[]) => searchLinkedIn(...args) }))
vi.mock('../db/repositories/jobExclusionsRepository', () => ({
  isUrlExcluded: (...args: unknown[]) => isUrlExcluded(...args)
}))

import { searchJobs } from './jobSearch'
import type { JobSearchResultItem } from './types'

function result(url: string, source: 'indeed' | 'linkedin' = 'indeed'): JobSearchResultItem {
  return { title: `Job at ${url}`, company: 'Acme', url, source, snippet: '' }
}

beforeEach(() => {
  searchIndeed.mockReset().mockResolvedValue({ results: [], blocked: false })
  searchLinkedIn.mockReset().mockResolvedValue({ results: [], blocked: false })
  isUrlExcluded.mockReset().mockReturnValue(false)
})

describe('searchJobs', () => {
  it('defaults to searching both indeed and linkedin when no sources are given', async () => {
    await searchJobs({ query: 'engineer', limit: 20 })
    expect(searchIndeed).toHaveBeenCalledWith('engineer', undefined, 20)
    expect(searchLinkedIn).toHaveBeenCalledWith('engineer', undefined, 20)
  })

  it('only searches requested sources when a subset is given', async () => {
    await searchJobs({ query: 'engineer', sources: ['indeed'], limit: 20 })
    expect(searchIndeed).toHaveBeenCalled()
    expect(searchLinkedIn).not.toHaveBeenCalled()
  })

  it('warns about non-searchable per-company sources instead of pretending to search them', async () => {
    const outcome = await searchJobs({ query: 'engineer', sources: ['greenhouse'], limit: 20 })
    expect(searchIndeed).not.toHaveBeenCalled()
    expect(searchLinkedIn).not.toHaveBeenCalled()
    expect(outcome.searchedSources).toEqual([])
    expect(outcome.warnings).toEqual([expect.stringContaining('greenhouse')])
    expect(outcome.warnings[0]).toContain('no keyword-search endpoint')
  })

  it('mixes a warning for unsupported sources with results from supported ones', async () => {
    searchIndeed.mockResolvedValue({ results: [result('https://indeed.com/1')], blocked: false })
    const outcome = await searchJobs({ query: 'engineer', sources: ['indeed', 'lever'], limit: 20 })
    expect(outcome.searchedSources).toEqual(['indeed'])
    expect(outcome.results).toHaveLength(1)
    expect(outcome.warnings).toEqual([expect.stringContaining('lever')])
  })

  it('deduplicates results with the same URL across sources', async () => {
    searchIndeed.mockResolvedValue({ results: [result('https://x.com/1')], blocked: false })
    searchLinkedIn.mockResolvedValue({ results: [result('https://x.com/1', 'linkedin')], blocked: false })
    const outcome = await searchJobs({ query: 'engineer', limit: 20 })
    expect(outcome.results).toHaveLength(1)
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

    const outcome = await searchJobs({ query: 'engineer', limit: 20 })
    expect(outcome.results).toHaveLength(1)
    expect(outcome.warnings).toEqual([expect.stringContaining('page crashed')])
  })
})
