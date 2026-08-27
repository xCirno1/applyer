import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../testDb'
import type * as schema from '../schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
let testSqlite: import('better-sqlite3').Database
vi.mock('../index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  const created = createTestDb()
  testDb = created.db
  testSqlite = created.sqlite
})

import { getCachedJobDetails, setCachedJobDetails } from './jobDetailsCacheRepository'
import { JOB_DETAILS_CACHE_PAYLOAD_VERSION } from '@shared/constants'
import type { JobDetailsData } from '../../browser/types'

function details(overrides: Partial<JobDetailsData> = {}): JobDetailsData {
  return {
    title: 'Engineer',
    company: 'Acme',
    description: '<p>desc</p>',
    descriptionText: 'desc',
    applicationUrl: 'https://acme.com/apply',
    requiresLogin: false,
    applyMethod: 'external_form',
    ...overrides
  }
}

describe('job details cache', () => {
  it('returns null for a URL never cached', () => {
    expect(getCachedJobDetails('https://example.com/1')).toBeNull()
  })

  it('round-trips a cached payload', () => {
    setCachedJobDetails('https://example.com/1', details({ title: 'Senior Engineer' }))
    const cached = getCachedJobDetails('https://example.com/1')
    expect(cached?.title).toBe('Senior Engineer')
    expect(cached?.applicationUrl).toBe('https://acme.com/apply')
  })

  it('keys entries by URL independently', () => {
    setCachedJobDetails('https://a.com/1', details({ title: 'A' }))
    setCachedJobDetails('https://b.com/1', details({ title: 'B' }))
    expect(getCachedJobDetails('https://a.com/1')?.title).toBe('A')
    expect(getCachedJobDetails('https://b.com/1')?.title).toBe('B')
  })

  it('overwrites the previous entry for the same URL', () => {
    setCachedJobDetails('https://example.com/1', details({ title: 'First' }))
    setCachedJobDetails('https://example.com/1', details({ title: 'Second' }))
    expect(getCachedJobDetails('https://example.com/1')?.title).toBe('Second')
  })

  describe('payload version', () => {
    it('stamps the current payload version on write', () => {
      setCachedJobDetails('https://example.com/1', details())
      const row = testSqlite.prepare('SELECT payload_version FROM job_details_cache').get() as {
        payload_version: number
      }
      expect(row.payload_version).toBe(JOB_DETAILS_CACHE_PAYLOAD_VERSION)
    })

    it('ignores an entry left behind by an older build, even within the TTL', () => {
      // Version 0 is what a row written before the column existed carries,
      // e.g. one holding a descriptionText with HTML entities left undecoded.
      setCachedJobDetails('https://example.com/1', details({ descriptionText: 'Sales &amp; Marketing' }))
      testSqlite.prepare('UPDATE job_details_cache SET payload_version = 0').run()

      expect(getCachedJobDetails('https://example.com/1')).toBeNull()
    })

    it('ignores an entry stamped with a newer version than this build writes', () => {
      // A downgrade, or a second install sharing the storage directory —
      // an unrecognised version is a miss in either direction rather than a
      // payload this build would misread.
      setCachedJobDetails('https://example.com/1', details())
      testSqlite
        .prepare('UPDATE job_details_cache SET payload_version = ?')
        .run(JOB_DETAILS_CACHE_PAYLOAD_VERSION + 1)

      expect(getCachedJobDetails('https://example.com/1')).toBeNull()
    })

    it('refetching overwrites the stale entry, so the miss does not repeat', () => {
      setCachedJobDetails('https://example.com/1', details({ title: 'Old' }))
      testSqlite.prepare('UPDATE job_details_cache SET payload_version = 0').run()
      expect(getCachedJobDetails('https://example.com/1')).toBeNull()

      setCachedJobDetails('https://example.com/1', details({ title: 'Refetched' }))
      expect(getCachedJobDetails('https://example.com/1')?.title).toBe('Refetched')
    })
  })

  describe('TTL expiry', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('is still returned just under the 24h TTL', () => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      setCachedJobDetails('https://example.com/1', details())
      vi.setSystemTime(new Date('2026-01-01T23:59:00.000Z'))
      expect(getCachedJobDetails('https://example.com/1')).not.toBeNull()
    })

    it('expires (returns null) once the 24h TTL has elapsed', () => {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      setCachedJobDetails('https://example.com/1', details())
      vi.setSystemTime(new Date('2026-01-02T00:00:01.000Z'))
      expect(getCachedJobDetails('https://example.com/1')).toBeNull()
    })
  })
})
