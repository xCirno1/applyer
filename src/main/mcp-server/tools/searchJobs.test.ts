import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../../db/testDb'
import type * as schema from '../../db/schema'
import * as schemaTables from '../../db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../../db/index', () => ({ getDb: () => testDb }))

const searchJobs = vi.fn()
vi.mock('../../browser/jobSearch', () => ({ searchJobs: (...args: unknown[]) => searchJobs(...args) }))

beforeEach(() => {
  testDb = createTestDb().db
  searchJobs.mockReset()
  __resetRunTracker()
})

import { searchJobsTool } from './searchJobs'
import { listActivity } from '../../db/repositories/activityLogRepository'
import { listIndexedJobs } from '../../db/repositories/indexedJobsRepository'
import { setSearchCountry } from '../../db/repositories/settingsRepository'
import { createRun, loadRunEvents } from '../../db/repositories/runsRepository'
import { __resetRunTracker } from '../../runs/runTracker'
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
    const result = await searchJobsTool({ query: 'engineer', location: undefined, remote: undefined, jobType: undefined, sources: undefined, country: undefined, limit: undefined })
    expect(parse(result)).toEqual({ results: [item], searchedSources: ['indeed'], warnings: [] })
    expect(searchJobs).toHaveBeenCalledWith({
      query: 'engineer',
      location: undefined,
      sources: undefined,
      limit: 20,
      country: 'us'
    })
  })

  it('searches the country from settings unless the call names one', async () => {
    setSearchCountry('au')
    searchJobs.mockResolvedValue({ results: [], searchedSources: [], warnings: [] })
    await searchJobsTool({ query: 'x', location: undefined, remote: undefined, jobType: undefined, sources: undefined, country: undefined, limit: undefined })
    expect(searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ country: 'au' }))
    await searchJobsTool({ query: 'x', location: undefined, remote: undefined, jobType: undefined, sources: undefined, country: 'nz', limit: undefined })
    expect(searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ country: 'nz' }))
  })

  it('logs an activity entry summarizing the search', async () => {
    searchJobs.mockResolvedValue({
      results: [resultItem({ url: 'https://example.com/jobs/1' }), resultItem({ url: 'https://example.com/jobs/2' })],
      searchedSources: ['indeed', 'linkedin'],
      warnings: []
    })
    await searchJobsTool({ query: 'engineer', location: undefined, remote: undefined, jobType: undefined, sources: undefined, country: undefined, limit: undefined })
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
    await searchJobsTool({ query: 'engineer', location: 'Remote', remote: undefined, jobType: undefined, sources: undefined, country: undefined, limit: undefined })

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

    const result = await searchJobsTool({ query: 'engineer', location: undefined, remote: undefined, jobType: undefined, sources: undefined, country: undefined, limit: undefined })

    expect(result.isError).toBeUndefined()
    expect(parse(result)).toEqual({ results: [malformed], searchedSources: ['indeed'], warnings: [] })
  })

  it('returns a plain-text error if the search throws', async () => {
    searchJobs.mockRejectedValue(new Error('all sources down'))
    const result = await searchJobsTool({ query: 'engineer', location: undefined, remote: undefined, jobType: undefined, sources: undefined, country: undefined, limit: undefined })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('all sources down')
  })

  it('defaults limit to SEARCH_JOBS_DEFAULT_LIMIT when not given', async () => {
    searchJobs.mockResolvedValue({ results: [], searchedSources: [], warnings: [] })
    await searchJobsTool({ query: 'x', location: undefined, remote: undefined, jobType: undefined, sources: undefined, country: undefined, limit: undefined })
    expect(searchJobs).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }))
  })

  it('passes through an explicit limit', async () => {
    searchJobs.mockResolvedValue({ results: [], searchedSources: [], warnings: [] })
    await searchJobsTool({ query: 'x', location: undefined, remote: undefined, jobType: undefined, sources: undefined, country: undefined, limit: 5 })
    expect(searchJobs).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }))
  })

  describe('run statistics', () => {
    it('records the search with its per-source outcomes on the run in progress', async () => {
      const run = createRun()
      searchJobs.mockResolvedValue({
        results: [resultItem()],
        searchedSources: ['indeed', 'seek'],
        warnings: ['seek: no listings matched'],
        sourceOutcomes: { indeed: { results: 1, blocked: false, warned: false }, seek: { results: 0, blocked: false, warned: true } }
      })
      await searchJobsTool({ query: 'engineer', location: 'Sydney', remote: undefined, jobType: undefined, sources: undefined, country: 'au', limit: undefined })
      const [event] = loadRunEvents(run.id)
      expect(event).toMatchObject({
        kind: 'search',
        meta: {
          query: 'engineer',
          location: 'Sydney',
          country: 'au',
          results: 1,
          failed: false,
          sources: { indeed: { results: 1 }, seek: { warned: true } },
          warnings: ['seek: no listings matched']
        }
      })
      expect((event?.meta as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0)
    })

    it('records a failed search as failed', async () => {
      const run = createRun()
      searchJobs.mockRejectedValue(new Error('boom'))
      await searchJobsTool({ query: 'x', location: undefined, remote: undefined, jobType: undefined, sources: undefined, country: undefined, limit: undefined })
      expect(loadRunEvents(run.id)[0]).toMatchObject({ kind: 'search', meta: { failed: true, results: 0, warnings: ['Error: boom'] } })
    })

    it('records nothing when no run is in progress', async () => {
      searchJobs.mockResolvedValue({ results: [], searchedSources: [], warnings: [], sourceOutcomes: {} })
      await searchJobsTool({ query: 'x', location: undefined, remote: undefined, jobType: undefined, sources: undefined, country: undefined, limit: undefined })
      expect(testDb.select().from(schemaTables.runEvents).all()).toHaveLength(0)
    })
  })
})
