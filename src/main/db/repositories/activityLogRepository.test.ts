import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../testDb'
import type * as schema from '../schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
})

import { logActivity, listActivity } from './activityLogRepository'

describe('logActivity / listActivity', () => {
  it('records an entry with level, message, and no meta by default', () => {
    logActivity('info', 'Queued job: Engineer @ Acme')
    const { entries, total } = listActivity({})
    expect(total).toBe(1)
    expect(entries[0]).toMatchObject({ level: 'info', message: 'Queued job: Engineer @ Acme', jobId: null, meta: null })
  })

  it('separates jobId from the rest of meta', () => {
    logActivity('warn', 'Job failed', { jobId: 'job-1', reason: 'timeout' })
    const [entry] = listActivity({}).entries
    expect(entry!.jobId).toBe('job-1')
    expect(entry!.meta).toEqual({ reason: 'timeout' })
  })

  it('stores meta as null when only jobId was given', () => {
    logActivity('info', 'x', { jobId: 'job-1' })
    expect(listActivity({}).entries[0]!.meta).toBeNull()
  })

  it('filters by jobId', () => {
    logActivity('info', 'a', { jobId: 'job-1' })
    logActivity('info', 'b', { jobId: 'job-2' })
    const result = listActivity({ jobId: 'job-1' })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.message).toBe('a')
  })

  it('filters by level', () => {
    logActivity('debug', 'd')
    logActivity('error', 'e')
    expect(listActivity({ level: 'error' }).entries).toHaveLength(1)
  })

  it('orders newest first (by id descending)', () => {
    logActivity('info', 'first')
    logActivity('info', 'second')
    const entries = listActivity({}).entries
    expect(entries[0]!.message).toBe('second')
    expect(entries[1]!.message).toBe('first')
  })

  it('paginates with limit/offset and reports total', () => {
    for (let i = 0; i < 5; i++) logActivity('info', `entry ${i}`)
    const page = listActivity({ limit: 2, offset: 0 })
    expect(page.entries).toHaveLength(2)
    expect(page.total).toBe(5)
  })

  it('clamps limit to [1, 200]', () => {
    for (let i = 0; i < 3; i++) logActivity('info', `e${i}`)
    expect(listActivity({ limit: 100000 }).entries.length).toBeLessThanOrEqual(200)
    expect(listActivity({ limit: -1 }).entries.length).toBeGreaterThanOrEqual(1)
  })
})
