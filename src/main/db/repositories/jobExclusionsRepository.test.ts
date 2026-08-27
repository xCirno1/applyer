import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../testDb'
import type * as schema from '../schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
})

import { eq } from 'drizzle-orm'
import { jobExclusions } from '../schema'
import { isUrlExcluded, excludeUrl, listExclusions, removeExclusion, listAllExclusions, importExclusions } from './jobExclusionsRepository'
import type { ExclusionRecord } from '@shared/types/exclusion'

describe('isUrlExcluded', () => {
  it('is false for a URL never excluded', () => {
    expect(isUrlExcluded('https://example.com/1')).toBe(false)
  })

  it('is true once excludeUrl has been called for it', () => {
    excludeUrl({ url: 'https://example.com/1', excludedBy: 'user' })
    expect(isUrlExcluded('https://example.com/1')).toBe(true)
  })
})

describe('excludeUrl', () => {
  it('creates a new exclusion record', () => {
    const { exclusion, wasExisting } = excludeUrl({
      url: 'https://example.com/1',
      title: 'Bad Job',
      company: 'Acme',
      reason: 'not remote',
      excludedBy: 'agent'
    })
    expect(wasExisting).toBe(false)
    expect(exclusion).toMatchObject({
      url: 'https://example.com/1',
      title: 'Bad Job',
      company: 'Acme',
      reason: 'not remote',
      excludedBy: 'agent'
    })
    expect(exclusion.id).toBeTruthy()
  })

  it('is idempotent by URL and preserves the original entry', () => {
    const first = excludeUrl({ url: 'https://example.com/1', title: 'First', excludedBy: 'user' })
    const second = excludeUrl({ url: 'https://example.com/1', title: 'Second', excludedBy: 'agent' })
    expect(second.wasExisting).toBe(true)
    expect(second.exclusion.id).toBe(first.exclusion.id)
    expect(second.exclusion.title).toBe('First')
  })
})

describe('listExclusions', () => {
  beforeEach(() => {
    excludeUrl({ url: 'https://acme.com/1', excludedBy: 'user' })
    excludeUrl({ url: 'https://beta.com/1', excludedBy: 'user' })
  })

  it('searches by URL substring', () => {
    expect(listExclusions({ search: 'acme' }).exclusions).toHaveLength(1)
  })

  it('matches literal LIKE metacharacters in the search term instead of treating them as wildcards', () => {
    excludeUrl({ url: 'https://jobs.com/100%-remote', excludedBy: 'user' })
    excludeUrl({ url: 'https://jobs.com/100-remote', excludedBy: 'user' })
    const result = listExclusions({ search: '100%-' })
    expect(result.exclusions.map((e) => e.url)).toEqual(['https://jobs.com/100%-remote'])
  })

  it('paginates and reports total', () => {
    const page = listExclusions({ limit: 1, offset: 0 })
    expect(page.exclusions).toHaveLength(1)
    expect(page.total).toBe(2)
  })

  it('orders newest first', () => {
    // createdAt defaults from SQLite's own strftime('now'), not JS Date, so
    // it can't be controlled via vi.setSystemTime, and these inserts run
    // synchronously back-to-back fast enough to plausibly land in the same
    // millisecond — set explicit, distinct timestamps directly so ordering
    // is unambiguous instead of relying on real wall-clock time passing.
    const acmeId = listExclusions({ search: 'acme' }).exclusions[0]!.id
    const betaId = listExclusions({ search: 'beta' }).exclusions[0]!.id
    testDb.update(jobExclusions).set({ createdAt: '2020-01-01T00:00:00.000Z' }).where(eq(jobExclusions.id, acmeId)).run()
    testDb.update(jobExclusions).set({ createdAt: '2020-01-02T00:00:00.000Z' }).where(eq(jobExclusions.id, betaId)).run()

    const result = listExclusions({})
    expect(result.exclusions.map((e) => e.url)).toEqual(['https://beta.com/1', 'https://acme.com/1'])
  })
})

describe('removeExclusion', () => {
  it('deletes the record so isUrlExcluded goes back to false', () => {
    const { exclusion } = excludeUrl({ url: 'https://example.com/1', excludedBy: 'user' })
    removeExclusion(exclusion.id)
    expect(isUrlExcluded('https://example.com/1')).toBe(false)
  })
})

describe('listAllExclusions', () => {
  it('returns every exclusion, unpaginated', () => {
    excludeUrl({ url: 'https://acme.com/1', excludedBy: 'user' })
    excludeUrl({ url: 'https://beta.com/1', excludedBy: 'agent' })
    expect(listAllExclusions()).toHaveLength(2)
  })
})

describe('importExclusions', () => {
  function fixture(overrides: Partial<ExclusionRecord> = {}): ExclusionRecord {
    return {
      id: 'external-id',
      url: 'https://example.com/imported',
      title: 'Bad Job',
      company: 'Acme',
      reason: 'not remote',
      excludedBy: 'user',
      createdAt: '2020-01-01T00:00:00.000Z',
      ...overrides
    }
  }

  it('inserts a new exclusion, regenerating the id', () => {
    const result = importExclusions([fixture()])
    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(isUrlExcluded('https://example.com/imported')).toBe(true)
    expect(listAllExclusions()[0]!.id).not.toBe('external-id')
  })

  it('skips an exclusion whose URL already exists', () => {
    excludeUrl({ url: 'https://example.com/imported', excludedBy: 'agent' })
    const result = importExclusions([fixture()])
    expect(result).toEqual({ imported: 0, skipped: 1 })
    expect(listAllExclusions()).toHaveLength(1)
  })
})
