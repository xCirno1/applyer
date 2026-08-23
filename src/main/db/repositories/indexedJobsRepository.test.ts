import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../testDb'
import type * as schema from '../schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
})

import { upsertIndexedJobs, listIndexedJobs, pruneIndexedJobs } from './indexedJobsRepository'
import { queueJob } from './jobsRepository'
import { setIndexedJobsRetentionDays } from './settingsRepository'
import type { JobSearchResultItem } from '../../browser/types'

function item(overrides: Partial<JobSearchResultItem> = {}): JobSearchResultItem {
  return {
    title: 'Backend Engineer',
    company: 'Acme',
    url: 'https://example.com/jobs/1',
    source: 'indeed',
    snippet: 'A great role.',
    ...overrides
  }
}

describe('upsertIndexedJobs', () => {
  it('inserts every result, keyed by url', () => {
    upsertIndexedJobs(
      [item({ url: 'https://example.com/jobs/1' }), item({ url: 'https://example.com/jobs/2' })],
      'backend engineer',
      'Remote'
    )
    const { total } = listIndexedJobs({})
    expect(total).toBe(2)
  })

  it('is a no-op for an empty results array', () => {
    upsertIndexedJobs([], 'query', null)
    expect(listIndexedJobs({}).total).toBe(0)
  })

  it('re-searching the same url refreshes it instead of duplicating', () => {
    upsertIndexedJobs([item({ url: 'https://example.com/jobs/1', title: 'Old Title' })], 'query one', null)
    const first = listIndexedJobs({}).items[0]!

    upsertIndexedJobs([item({ url: 'https://example.com/jobs/1', title: 'New Title' })], 'query two', null)
    const { items, total } = listIndexedJobs({})

    expect(total).toBe(1)
    expect(items[0]!.title).toBe('New Title')
    expect(items[0]!.searchQuery).toBe('query two')
    expect(items[0]!.seenCount).toBe(2)
    expect(items[0]!.firstSeenAt).toBe(first.firstSeenAt)
  })
})

describe('listIndexedJobs', () => {
  it('derives matched status by joining against the jobs table on url, without a stored column', () => {
    upsertIndexedJobs(
      [item({ url: 'https://example.com/jobs/matched' }), item({ url: 'https://example.com/jobs/unmatched' })],
      'query',
      null
    )
    queueJob({ title: 'Backend Engineer', company: 'Acme', url: 'https://example.com/jobs/matched', matchScore: 92 })

    const { items } = listIndexedJobs({})
    const matched = items.find((i) => i.url === 'https://example.com/jobs/matched')!
    const unmatched = items.find((i) => i.url === 'https://example.com/jobs/unmatched')!

    expect(matched.matchedJobId).not.toBeNull()
    expect(matched.matchedStatus).toBe('queued')
    expect(matched.matchedScore).toBe(92)
    expect(unmatched.matchedJobId).toBeNull()
    expect(unmatched.matchedStatus).toBeNull()
    expect(unmatched.matchedScore).toBeNull()
  })

  it('filters by matched/unmatched', () => {
    upsertIndexedJobs(
      [item({ url: 'https://example.com/jobs/matched' }), item({ url: 'https://example.com/jobs/unmatched' })],
      'query',
      null
    )
    queueJob({ title: 'Backend Engineer', company: 'Acme', url: 'https://example.com/jobs/matched' })

    expect(listIndexedJobs({ matched: 'matched' }).items.map((i) => i.url)).toEqual([
      'https://example.com/jobs/matched'
    ])
    expect(listIndexedJobs({ matched: 'unmatched' }).items.map((i) => i.url)).toEqual([
      'https://example.com/jobs/unmatched'
    ])
    expect(listIndexedJobs({ matched: 'all' }).total).toBe(2)
  })

  it('filters by source', () => {
    upsertIndexedJobs([item({ url: 'https://example.com/jobs/1', source: 'indeed' })], 'query', null)
    upsertIndexedJobs([item({ url: 'https://example.com/jobs/2', source: 'linkedin' })], 'query', null)

    expect(listIndexedJobs({ source: 'linkedin' }).items.map((i) => i.url)).toEqual([
      'https://example.com/jobs/2'
    ])
  })

  it('searches by title or company', () => {
    upsertIndexedJobs([item({ url: 'https://example.com/jobs/1', title: 'Backend Engineer', company: 'Acme' })], 'q', null)
    upsertIndexedJobs([item({ url: 'https://example.com/jobs/2', title: 'Product Designer', company: 'Widgets' })], 'q', null)

    expect(listIndexedJobs({ search: 'backend' }).items.map((i) => i.url)).toEqual(['https://example.com/jobs/1'])
    expect(listIndexedJobs({ search: 'widgets' }).items.map((i) => i.url)).toEqual(['https://example.com/jobs/2'])
  })

  it('paginates with limit/offset, most recently seen first', () => {
    upsertIndexedJobs([item({ url: 'https://example.com/jobs/1' })], 'q', null)
    upsertIndexedJobs([item({ url: 'https://example.com/jobs/2' })], 'q', null)
    upsertIndexedJobs([item({ url: 'https://example.com/jobs/3' })], 'q', null)

    const page1 = listIndexedJobs({ limit: 2, offset: 0 })
    expect(page1.items).toHaveLength(2)
    expect(page1.total).toBe(3)

    const page2 = listIndexedJobs({ limit: 2, offset: 2 })
    expect(page2.items).toHaveLength(1)
  })
})

describe('pruneIndexedJobs', () => {
  it('does nothing when retention is unlimited', () => {
    setIndexedJobsRetentionDays('unlimited')
    upsertIndexedJobs([item()], 'q', null)

    const deleted = pruneIndexedJobs()

    expect(deleted).toBe(0)
    expect(listIndexedJobs({}).total).toBe(1)
  })

  it('deletes rows last seen before the retention window and reports how many', () => {
    setIndexedJobsRetentionDays(30)
    upsertIndexedJobs([item({ url: 'https://example.com/jobs/stale' })], 'q', null)
    // Backdate lastSeenAt past the 30-day window directly, since upsertIndexedJobs always stamps "now".
    const stale = listIndexedJobs({}).items[0]!
    testDb.run(sql`update indexed_jobs set last_seen_at = '2000-01-01T00:00:00.000Z' where id = ${stale.id}`)
    upsertIndexedJobs([item({ url: 'https://example.com/jobs/fresh' })], 'q', null)

    const deleted = pruneIndexedJobs()

    expect(deleted).toBe(1)
    const { items } = listIndexedJobs({})
    expect(items.map((i) => i.url)).toEqual(['https://example.com/jobs/fresh'])
  })
})
