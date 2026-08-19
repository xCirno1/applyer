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

function parse(result: Awaited<ReturnType<typeof searchJobsTool>>): unknown {
  return JSON.parse((result.content[0] as { text: string }).text)
}

describe('searchJobsTool', () => {
  it('passes args through and returns the outcome as-is', async () => {
    searchJobs.mockResolvedValue({ results: [{ title: 'Engineer' }], searchedSources: ['indeed'], warnings: [] })
    const result = await searchJobsTool({ query: 'engineer', location: undefined, remote: undefined, jobType: undefined, sources: undefined, limit: undefined })
    expect(parse(result)).toEqual({ results: [{ title: 'Engineer' }], searchedSources: ['indeed'], warnings: [] })
    expect(searchJobs).toHaveBeenCalledWith({ query: 'engineer', location: undefined, sources: undefined, limit: 20 })
  })

  it('logs an activity entry summarizing the search', async () => {
    searchJobs.mockResolvedValue({ results: [{}, {}], searchedSources: ['indeed', 'linkedin'], warnings: [] })
    await searchJobsTool({ query: 'engineer', location: undefined, remote: undefined, jobType: undefined, sources: undefined, limit: undefined })
    const { entries } = listActivity({})
    expect(entries).toHaveLength(1)
    expect(entries[0]!.message).toContain('2 results')
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
