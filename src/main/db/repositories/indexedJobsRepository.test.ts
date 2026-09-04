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

import {
  upsertIndexedJobs,
  listIndexedJobs,
  listAllIndexedJobs,
  importIndexedJobs,
  pruneIndexedJobs
} from './indexedJobsRepository'
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

  it('matches literal LIKE metacharacters in the search term instead of treating them as wildcards', () => {
    upsertIndexedJobs([item({ url: 'https://example.com/jobs/1', title: '100% Remote', company: 'Acme' })], 'q', null)
    upsertIndexedJobs([item({ url: 'https://example.com/jobs/2', title: '100 Remote', company: 'Acme' })], 'q', null)

    expect(listIndexedJobs({ search: '100%' }).items.map((i) => i.url)).toEqual(['https://example.com/jobs/1'])
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

describe('listAllIndexedJobs', () => {
  it('reads the stored columns only, leaving the derived match fields out', () => {
    upsertIndexedJobs([item({ url: 'https://example.com/jobs/1' })], 'backend', 'Remote')
    queueJob({ title: 'Backend Engineer', company: 'Acme', url: 'https://example.com/jobs/1' })

    // The list view joins the jobs table to say whether a row was matched;
    // that is this machine's board, not something the row holds, so it must
    // not travel in a file.
    expect(listIndexedJobs({}).items[0]!.matchedJobId).not.toBeNull()

    const exported = listAllIndexedJobs()
    expect(exported).toHaveLength(1)
    expect(exported[0]).not.toHaveProperty('matchedJobId')
    expect(exported[0]).not.toHaveProperty('id')
    expect(exported[0]).toMatchObject({ url: 'https://example.com/jobs/1', searchQuery: 'backend', seenCount: 1 })
  })

  it('is empty rather than throwing when nothing has been indexed', () => {
    expect(listAllIndexedJobs()).toEqual([])
  })
})

describe('importIndexedJobs', () => {
  const row = (overrides: Record<string, unknown> = {}): ReturnType<typeof listAllIndexedJobs>[number] => ({
    url: 'https://example.com/jobs/9',
    title: 'Platform Engineer',
    company: 'Globex',
    location: 'Remote',
    source: 'greenhouse',
    snippet: 'Role',
    salaryRange: null,
    postedAt: null,
    searchQuery: 'platform',
    searchLocation: null,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-02T00:00:00.000Z',
    seenCount: 4,
    ...overrides
  })

  it('merges a file alongside what is already indexed', () => {
    upsertIndexedJobs([item({ url: 'https://example.com/jobs/1' })], 'backend', null)

    expect(importIndexedJobs([row()])).toEqual({ imported: 1, skipped: 0 })
    expect(listIndexedJobs({}).total).toBe(2)
  })

  it('keeps this machine\'s own row for a url it already has', () => {
    upsertIndexedJobs([item({ url: 'https://example.com/jobs/9', title: 'Local Title' })], 'local query', null)

    // The local row's seenCount and lastSeenAt describe searches this install
    // actually ran; the file's describe someone else's, so the local one wins.
    expect(importIndexedJobs([row({ title: 'File Title' })])).toEqual({ imported: 0, skipped: 1 })
    const stored = listIndexedJobs({}).items[0]!
    expect(stored.title).toBe('Local Title')
    expect(stored.seenCount).toBe(1)
  })

  it('refuses a seen count no row could have, rather than rendering it', () => {
    importIndexedJobs([row({ seenCount: -3 }), row({ url: 'https://example.com/jobs/10', seenCount: 2.7 })])

    const counts = listAllIndexedJobs().map((r) => r.seenCount)
    expect(counts).toContain(1)
    expect(counts).toContain(2)
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
