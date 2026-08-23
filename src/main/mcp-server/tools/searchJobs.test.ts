import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../../db/testDb'
import type * as schema from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../../db/index', () => ({ getDb: () => testDb }))

const searchJobs = vi.fn()
vi.mock('../../browser/jobSearch', () => ({ searchJobs: (...args: unknown[]) => searchJobs(...args) }))

beforeEach(() => {
  testDb = createTestDb().db
  searchJobs.mockReset()
})

import { searchJobsTool } from './searchJobs'
import { listActivity } from '../../db/repositories/activityLogRepository'
import { listIndexedJobs } from '../../db/repositories/indexedJobsRepository'
import type { JobSearchResultItem } from '../../browser/types'

function parse(result: Awaited<ReturnType<typeof searchJobsTool>>): unknown {
  return JSON.parse((result.content[0] as { text: string }).text)
}

function resultItem(overrides: Partial<JobSearchResultItem> = {}): JobSearchResultItem {
  return {
    title: 'Engineer',
    company: 'Acme',
    url: 'https://example.com/jobs/1',
    source: 'indeed',
    snippet: 'A great role.',
    ...overrides
  }
}

describe('searchJobsTool', () => {
  it('passes args through and returns the outcome as-is', async () => {
    const item = resultItem()
    searchJobs.mockResolvedValue({ results: [item], searchedSources: ['indeed'], warnings: [] })
    const result = await searchJobsTool({ query: 'engineer', location: undefined, remote: undefined, jobType: undefined, sources: undefined, limit: undefined })
    expect(parse(result)).toEqual({ results: [item], searchedSources: ['indeed'], warnings: [] })
    expect(searchJobs).toHaveBeenCalledWith({ query: 'engineer', location: undefined, sources: undefined, limit: 20 })
  })

  it('logs an activity entry summarizing the search', async () => {
    searchJobs.mockResolvedValue({
      results: [resultItem({ url: 'https://example.com/jobs/1' }), resultItem({ url: 'https://example.com/jobs/2' })],
      searchedSources: ['indeed', 'linkedin'],
      warnings: []
    })
    await searchJobsTool({ query: 'engineer', location: undefined, remote: undefined, jobType: undefined, sources: undefined, limit: undefined })
    const { entries } = listActivity({})
    expect(entries).toHaveLength(1)
    expect(entries[0]!.message).toContain('2 results')
  })

  it('indexes every result, regardless of whether it gets queued later', async () => {
    searchJobs.mockResolvedValue({
      results: [resultItem({ url: 'https://example.com/jobs/1' }), resultItem({ url: 'https://example.com/jobs/2' })],
      searchedSources: ['indeed'],
      warnings: []
    })
    await searchJobsTool({ query: 'engineer', location: 'Remote', remote: undefined, jobType: undefined, sources: undefined, limit: undefined })

    const { items, total } = listIndexedJobs({})
    expect(total).toBe(2)
    expect(items.map((i) => i.url).sort()).toEqual(['https://example.com/jobs/1', 'https://example.com/jobs/2'])
    expect(items[0]!.searchQuery).toBe('engineer')
    expect(items[0]!.searchLocation).toBe('Remote')
    expect(items.every((i) => i.matchedJobId === null)).toBe(true)
  })

  it('does not fail the whole tool call if a result is too malformed to index', async () => {
    // Missing url/title/company — violates indexed_jobs's NOT NULL columns,
    // simulating unexpectedly malformed scraper output.
    const malformed = {} as JobSearchResultItem
    searchJobs.mockResolvedValue({ results: [malformed], searchedSources: ['indeed'], warnings: [] })

    const result = await searchJobsTool({ query: 'engineer', location: undefined, remote: undefined, jobType: undefined, sources: undefined, limit: undefined })

    expect(result.isError).toBeUndefined()
    expect(parse(result)).toEqual({ results: [malformed], searchedSources: ['indeed'], warnings: [] })
  })

  it('returns a plain-text error if the search throws', async () => {
    searchJobs.mockRejectedValue(new Error('all sources down'))
    const result = await searchJobsTool({ query: 'engineer', location: undefined, remote: undefined, jobType: undefined, sources: undefined, limit: undefined })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('all sources down')
  })

  it('defaults limit to SEARCH_JOBS_DEFAULT_LIMIT when not given', async () => {
    searchJobs.mockResolvedValue({ results: [], searchedSources: [], warnings: [] })
    await searchJobsTool({ query: 'x', location: undefined, remote: undefined, jobType: undefined, sources: undefined, limit: undefined })
    expect(searchJobs).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }))
  })

  it('passes through an explicit limit', async () => {
    searchJobs.mockResolvedValue({ results: [], searchedSources: [], warnings: [] })
    await searchJobsTool({ query: 'x', location: undefined, remote: undefined, jobType: undefined, sources: undefined, limit: 5 })
    expect(searchJobs).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }))
  })
})
