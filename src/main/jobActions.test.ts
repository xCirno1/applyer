import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from './db/testDb'
import type * as schema from './db/schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('./db/index', () => ({ getDb: () => testDb }))

const { broadcastExclusionsChanged } = vi.hoisted(() => ({ broadcastExclusionsChanged: vi.fn() }))
vi.mock('./ipc/jobsBroadcast', () => ({
  broadcastJobUpdate: vi.fn(),
  broadcastJobRemoved: vi.fn(),
  broadcastExclusionsChanged
}))

beforeEach(() => {
  testDb = createTestDb().db
  broadcastExclusionsChanged.mockClear()
})

import { failJob, reconcileOrphanedBlockedJobs, excludeJob, excludeJobsByIds, unqueueJob, unqueueJobsByIds } from './jobActions'
import { queueJob, getJob, setBlocking, setFilled, setSubmitted } from './db/repositories/jobsRepository'
import { listFailureTags } from './db/repositories/failureTagsRepository'
import { listActivity } from './db/repositories/activityLogRepository'
import { isUrlExcluded } from './db/repositories/jobExclusionsRepository'
import type { JobRecord } from '@shared/types/job'

function newJob(url = 'https://example.com/1'): JobRecord {
  return queueJob({ title: 'Engineer', company: 'Acme', url }).job
}

describe('failJob', () => {
  it('transitions the job to failed and auto-registers the failure tag', () => {
    const job = newJob()
    const updated = failJob(job.id, 'login_required', 'needs sign-in')
    expect(updated.status).toBe('failed')
    expect(updated.failureTag).toBe('login_required')
    expect(listFailureTags().map((t) => t.id)).toContain('login_required')
  })

  it('logs a warn-level activity entry referencing the job', () => {
    const job = newJob()
    failJob(job.id, 'other', 'boom')
    const { entries } = listActivity({ jobId: job.id })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ level: 'warn', jobId: job.id })
    expect(entries[0]!.message).toContain('other')
  })

  it('works without a message', () => {
    const job = newJob()
    const updated = failJob(job.id, 'other')
    expect(updated.failureMessage).toBeNull()
  })
})

describe('reconcileOrphanedBlockedJobs', () => {
  it('fails every job left in a blocking state with reason "interrupted"', () => {
    const a = newJob('https://x.com/a')
    const b = newJob('https://x.com/b')
    const c = newJob('https://x.com/c')
    setBlocking(a.id, 'captcha_verification', 'task-1')
    setBlocking(b.id, 'captcha_verification', 'task-2')

    reconcileOrphanedBlockedJobs()

    expect(getJob(a.id)?.status).toBe('failed')
    expect(getJob(a.id)?.failureTag).toBe('interrupted')
    expect(getJob(b.id)?.status).toBe('failed')
    expect(getJob(c.id)?.status).toBe('queued')
  })

  it('is a no-op when nothing is blocked', () => {
    expect(() => reconcileOrphanedBlockedJobs()).not.toThrow()
  })
})

describe('excludeJob', () => {
  it('adds the URL to the exclusion list', () => {
    const { wasExisting } = excludeJob({ url: 'https://example.com/1', excludedBy: 'user' })
    expect(wasExisting).toBe(false)
    expect(isUrlExcluded('https://example.com/1')).toBe(true)
  })

  it('removes the job from the board if it was tracked', () => {
    const job = newJob('https://example.com/1')
    excludeJob({ url: 'https://example.com/1', excludedBy: 'agent' })
    expect(getJob(job.id)).toBeNull()
  })

  it('does not error when the URL was never tracked as a job', () => {
    expect(() => excludeJob({ url: 'https://never-tracked.com/1', excludedBy: 'user' })).not.toThrow()
  })

  it('logs an activity entry only the first time a URL is excluded', () => {
    excludeJob({ url: 'https://example.com/1', excludedBy: 'user' })
    excludeJob({ url: 'https://example.com/1', excludedBy: 'user' })
    const { entries } = listActivity({})
    expect(entries.filter((e) => e.message.includes('Excluded job posting'))).toHaveLength(1)
  })

  it('broadcasts exclusions:changed only the first time a URL is excluded', () => {
    excludeJob({ url: 'https://example.com/1', excludedBy: 'user' })
    expect(broadcastExclusionsChanged).toHaveBeenCalledTimes(1)
    excludeJob({ url: 'https://example.com/1', excludedBy: 'user' })
    expect(broadcastExclusionsChanged).toHaveBeenCalledTimes(1)
  })
})

describe('excludeJobsByIds', () => {
  it('excludes eligible jobs and returns the ids actually excluded', () => {
    const queued = newJob('https://x.com/queued')
    const failed = newJob('https://x.com/failed')
    failJob(failed.id, 'other')

    const excludedIds = excludeJobsByIds([queued.id, failed.id])
    expect(excludedIds.sort()).toEqual([failed.id, queued.id].sort())
    expect(isUrlExcluded('https://x.com/queued')).toBe(true)
    expect(isUrlExcluded('https://x.com/failed')).toBe(true)
  })

  it('skips submitted jobs and unknown ids without throwing', () => {
    const filled = newJob('https://x.com/filled')
    setFilled(filled.id)
    setSubmitted(filled.id)

    const excludedIds = excludeJobsByIds([filled.id, 'does-not-exist'])
    expect(excludedIds).toEqual([])
    expect(isUrlExcluded('https://x.com/filled')).toBe(false)
  })
})

describe('unqueueJob', () => {
  it('removes a queued job from the board without blacklisting its URL', () => {
    const job = newJob('https://example.com/1')
    const result = unqueueJob(job.id)
    expect(result?.id).toBe(job.id)
    expect(getJob(job.id)).toBeNull()
    expect(isUrlExcluded('https://example.com/1')).toBe(false)
  })

  it('logs an activity entry referencing the job', () => {
    const job = newJob('https://example.com/1')
    unqueueJob(job.id)
    const { entries } = listActivity({})
    expect(entries.filter((e) => e.message.includes('Unqueued job'))).toHaveLength(1)
  })

  it('returns null and does nothing for a job that is not queued', () => {
    const job = newJob('https://example.com/1')
    failJob(job.id, 'other')
    const result = unqueueJob(job.id)
    expect(result).toBeNull()
    expect(getJob(job.id)?.status).toBe('failed')
  })

  it('returns null for an unknown job id', () => {
    expect(unqueueJob('does-not-exist')).toBeNull()
  })
})

describe('unqueueJobsByIds', () => {
  it('unqueues eligible jobs and returns the ids actually unqueued', () => {
    const a = newJob('https://x.com/a')
    const b = newJob('https://x.com/b')

    const unqueuedIds = unqueueJobsByIds([a.id, b.id])
    expect(unqueuedIds.sort()).toEqual([a.id, b.id].sort())
    expect(getJob(a.id)).toBeNull()
    expect(getJob(b.id)).toBeNull()
  })

  it('skips non-queued jobs and unknown ids without throwing', () => {
    const failed = newJob('https://x.com/failed')
    failJob(failed.id, 'other')

    const unqueuedIds = unqueueJobsByIds([failed.id, 'does-not-exist'])
    expect(unqueuedIds).toEqual([])
    expect(getJob(failed.id)?.status).toBe('failed')
  })
})
