import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../testDb'
import type * as schema from '../schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
})

import { jobs, indexedJobs, jobExclusions, companyBoards, activityLog } from '../schema'
import { getStorageRowCounts } from './storageStatsRepository'

describe('getStorageRowCounts', () => {
  it('reports zero for every table in a fresh database', () => {
    expect(getStorageRowCounts()).toEqual({
      jobs: 0,
      indexedJobs: 0,
      exclusions: 0,
      companyBoards: 0,
      documents: 0,
      activityLogEntries: 0
    })
  })

  it('counts rows independently per table', () => {
    testDb.insert(jobs).values({ id: 'j1', title: 'Engineer', company: 'Acme', url: 'https://acme.com/1' }).run()
    testDb.insert(jobs).values({ id: 'j2', title: 'Designer', company: 'Acme', url: 'https://acme.com/2' }).run()
    testDb
      .insert(indexedJobs)
      .values({ id: 'i1', url: 'https://acme.com/3', title: 'PM', company: 'Acme', searchQuery: 'pm' })
      .run()
    testDb.insert(jobExclusions).values({ id: 'e1', url: 'https://bad.com/1', excludedBy: 'user' }).run()
    testDb
      .insert(companyBoards)
      .values({
        id: 'b1',
        boardKey: 'greenhouse:acme',
        provider: 'greenhouse',
        token: 'acme',
        companyName: 'Acme',
        addedBy: 'user'
      })
      .run()
    testDb.insert(activityLog).values({ message: 'started' }).run()

    expect(getStorageRowCounts()).toEqual({
      jobs: 2,
      indexedJobs: 1,
      exclusions: 1,
      companyBoards: 1,
      documents: 0,
      activityLogEntries: 1
    })
  })
})
