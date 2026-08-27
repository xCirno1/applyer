import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../testDb'
import type * as schema from '../schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
})

import {
  queueJob,
  getJob,
  getJobByUrl,
  listJobs,
  setFilled,
  setSubmitted,
  setFailed,
  retry,
  retryAllFailed,
  retryManyFailed,
  setBlocking,
  clearBlocking,
  removeJob,
  listBlockedJobs,
  listAllJobs,
  importJobs,
  IllegalTransitionError
} from './jobsRepository'
import type { JobRecord } from '@shared/types/job'

function baseInput(overrides: Partial<Parameters<typeof queueJob>[0]> = {}): Parameters<typeof queueJob>[0] {
  return { title: 'Backend Engineer', company: 'Acme', url: 'https://example.com/1', ...overrides }
}

describe('queueJob', () => {
  it('creates a new job in the queued status with generated id and timestamps', () => {
    const { job, wasExisting } = queueJob(baseInput())
    expect(wasExisting).toBe(false)
    expect(job.status).toBe('queued')
    expect(job.id).toBeTruthy()
    expect(job.queuedAt).toBeTruthy()
    expect(job.title).toBe('Backend Engineer')
  })

  it('is idempotent by URL: queuing the same URL twice returns the existing job', () => {
    const first = queueJob(baseInput())
    const second = queueJob(baseInput({ title: 'Different Title' }))
    expect(second.wasExisting).toBe(true)
    expect(second.job.id).toBe(first.job.id)
    expect(second.job.title).toBe('Backend Engineer') // not overwritten
  })

  it('defaults optional fields to null', () => {
    const { job } = queueJob(baseInput())
    expect(job.location).toBeNull()
    expect(job.matchScore).toBeNull()
    expect(job.matchReasons).toBeNull()
  })

  it('persists optional fields when given', () => {
    const { job } = queueJob(
      baseInput({ location: 'Remote', matchScore: 88, matchReasons: ['good fit'], source: 'linkedin' })
    )
    expect(job.location).toBe('Remote')
    expect(job.matchScore).toBe(88)
    expect(job.matchReasons).toEqual(['good fit'])
    expect(job.source).toBe('linkedin')
  })
})

describe('getJob / getJobByUrl', () => {
  it('returns null for an unknown id or url', () => {
    expect(getJob('nonexistent')).toBeNull()
    expect(getJobByUrl('https://nope.example.com')).toBeNull()
  })

  it('finds a job by id and by url', () => {
    const { job } = queueJob(baseInput())
    expect(getJob(job.id)?.id).toBe(job.id)
    expect(getJobByUrl(job.url)?.id).toBe(job.id)
  })
})

describe('listJobs', () => {
  beforeEach(() => {
    queueJob(baseInput({ title: 'Backend Engineer', company: 'Acme', url: 'https://x.com/1', matchScore: 50 }))
    queueJob(baseInput({ title: 'Frontend Engineer', company: 'Beta', url: 'https://x.com/2', matchScore: 90 }))
    queueJob(baseInput({ title: 'Designer', company: 'Acme', url: 'https://x.com/3', source: 'indeed' }))
  })

  it('filters by status', () => {
    const { job } = queueJob(baseInput({ url: 'https://x.com/4' }))
    setFailed(job.id, 'other')
    const result = listJobs({ status: 'failed' })
    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0]!.id).toBe(job.id)
  })

  it('filters by source', () => {
    const result = listJobs({ source: 'indeed' })
    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0]!.company).toBe('Acme')
    expect(result.jobs[0]!.title).toBe('Designer')
  })

  it('searches title and company (case-insensitive substring)', () => {
    const result = listJobs({ search: 'acme' })
    expect(result.jobs.map((j) => j.title).sort()).toEqual(['Backend Engineer', 'Designer'])
  })

  it('matches a literal "%" in the search term instead of treating it as a wildcard', () => {
    queueJob(baseInput({ title: '100% Remote', company: 'Wild', url: 'https://x.com/wild' }))
    queueJob(baseInput({ title: '100 Remote', company: 'Tame', url: 'https://x.com/tame' }))
    const result = listJobs({ search: '100%' })
    expect(result.jobs.map((j) => j.title)).toEqual(['100% Remote'])
  })

  it('matches a literal "_" in the search term instead of treating it as a single-character wildcard', () => {
    queueJob(baseInput({ title: 'Dev_Ops Engineer', company: 'Underscore', url: 'https://x.com/us' }))
    queueJob(baseInput({ title: 'DevXOps Engineer', company: 'Wildcard', url: 'https://x.com/wc' }))
    const result = listJobs({ search: 'Dev_Ops' })
    expect(result.jobs.map((j) => j.title)).toEqual(['Dev_Ops Engineer'])
  })

  it('matches a literal backslash in the search term', () => {
    // The escape character itself has to survive the round trip, otherwise a
    // backslash in the term would escape the character after it.
    queueJob(baseInput({ title: 'C:\\Windows Support', company: 'Redmond', url: 'https://x.com/win' }))
    const result = listJobs({ search: 'C:\\Windows' })
    expect(result.jobs.map((j) => j.title)).toEqual(['C:\\Windows Support'])
  })

  it('sorts by matchScore descending, nulls last, when requested', () => {
    const result = listJobs({ sortBy: 'matchScore' })
    const scores = result.jobs.map((j) => j.matchScore)
    expect(scores[0]).toBe(90)
    expect(scores[1]).toBe(50)
    expect(scores[scores.length - 1]).toBeNull()
  })

  it('paginates with limit/offset and reports total independent of the page', () => {
    const page1 = listJobs({ limit: 2, offset: 0 })
    const page2 = listJobs({ limit: 2, offset: 2 })
    expect(page1.jobs).toHaveLength(2)
    expect(page1.total).toBe(3)
    expect(page2.jobs).toHaveLength(1)
    expect(page2.total).toBe(3)
  })

  it('clamps limit to the max and floors it at 1', () => {
    expect(listJobs({ limit: 10000 }).jobs.length).toBeLessThanOrEqual(50)
    expect(listJobs({ limit: -5 }).jobs.length).toBeGreaterThanOrEqual(1)
  })
})

describe('job status transitions', () => {
  it('allows queued -> filled -> submitted', () => {
    const { job } = queueJob(baseInput())
    const filled = setFilled(job.id, { screenshotPath: '/tmp/shot.png' })
    expect(filled.status).toBe('filled')
    expect(filled.screenshotPath).toBe('/tmp/shot.png')
    expect(filled.filledAt).toBeTruthy()

    const submitted = setSubmitted(job.id)
    expect(submitted.status).toBe('submitted')
    expect(submitted.submittedAt).toBeTruthy()
  })

  it('allows queued -> failed -> queued (retry)', () => {
    const { job } = queueJob(baseInput())
    const failed = setFailed(job.id, 'login_required', 'needs sign-in')
    expect(failed.status).toBe('failed')
    expect(failed.failureTag).toBe('login_required')
    expect(failed.failureMessage).toBe('needs sign-in')

    const retried = retry(job.id)
    expect(retried.status).toBe('queued')
    expect(retried.failureTag).toBeNull()
    expect(retried.failureMessage).toBeNull()
  })

  it('rejects an illegal transition (e.g. queued -> submitted directly)', () => {
    const { job } = queueJob(baseInput())
    expect(() => setSubmitted(job.id)).toThrow(IllegalTransitionError)
  })

  it('rejects transitioning out of a terminal state (submitted -> anything)', () => {
    const { job } = queueJob(baseInput())
    setFilled(job.id)
    setSubmitted(job.id)
    expect(() => setFailed(job.id, 'other')).toThrow(IllegalTransitionError)
  })

  it('clears any pending blocking state when a job is filled or failed', () => {
    const { job } = queueJob(baseInput())
    setBlocking(job.id, 'captcha_verification', 'task-1')
    expect(getJob(job.id)?.blockingReason).toBe('captcha_verification')

    const filled = setFilled(job.id)
    expect(filled.blockingReason).toBeNull()
    expect(filled.blockingTaskId).toBeNull()
  })

  it('throws for an unknown job id on every transition', () => {
    expect(() => setFilled('nope')).toThrow('Job not found: nope')
    expect(() => setSubmitted('nope')).toThrow('Job not found: nope')
    expect(() => setFailed('nope', 'other')).toThrow('Job not found: nope')
    expect(() => retry('nope')).toThrow('Job not found: nope')
  })
})

describe('retryAllFailed', () => {
  it('requeues every failed job and leaves others untouched', () => {
    const a = queueJob(baseInput({ url: 'https://x.com/a' })).job
    const b = queueJob(baseInput({ url: 'https://x.com/b' })).job
    const c = queueJob(baseInput({ url: 'https://x.com/c' })).job
    setFailed(a.id, 'other')
    setFailed(b.id, 'other')

    const result = retryAllFailed()
    expect(result.map((j) => j.id).sort()).toEqual([a.id, b.id].sort())
    expect(result.every((j) => j.status === 'queued')).toBe(true)
    expect(getJob(c.id)?.status).toBe('queued')
  })

  it('returns an empty array when nothing is failed', () => {
    queueJob(baseInput())
    expect(retryAllFailed()).toEqual([])
  })
})

describe('retryManyFailed', () => {
  it('requeues only the given ids that are currently failed, silently skipping the rest', () => {
    const failed = queueJob(baseInput({ url: 'https://x.com/failed' })).job
    const stillQueued = queueJob(baseInput({ url: 'https://x.com/queued' })).job
    setFailed(failed.id, 'other')

    const result = retryManyFailed([failed.id, stillQueued.id, 'does-not-exist'])
    expect(result.map((j) => j.id)).toEqual([failed.id])
    expect(getJob(stillQueued.id)?.status).toBe('queued')
  })
})

describe('blocking state', () => {
  it('setBlocking/clearBlocking round-trip and listBlockedJobs finds them', () => {
    const { job } = queueJob(baseInput())
    setBlocking(job.id, 'captcha_verification', 'task-1')
    expect(listBlockedJobs().map((j) => j.id)).toEqual([job.id])

    clearBlocking(job.id)
    expect(listBlockedJobs()).toEqual([])
  })
})

describe('removeJob', () => {
  it('deletes the job so it is no longer retrievable', () => {
    const { job } = queueJob(baseInput())
    removeJob(job.id)
    expect(getJob(job.id)).toBeNull()
  })

  it('is a no-op for an unknown id', () => {
    expect(() => removeJob('does-not-exist')).not.toThrow()
  })
})

describe('listAllJobs', () => {
  it('returns every job regardless of status, unpaginated', () => {
    queueJob(baseInput({ url: 'https://x.com/1' }))
    queueJob(baseInput({ url: 'https://x.com/2' }))
    expect(listAllJobs()).toHaveLength(2)
  })
})

describe('importJobs', () => {
  function fixture(overrides: Partial<JobRecord> = {}): JobRecord {
    return {
      id: 'external-id',
      externalId: null,
      source: 'linkedin',
      title: 'Backend Engineer',
      company: 'Acme',
      location: null,
      url: 'https://example.com/imported',
      description: null,
      salaryRange: null,
      status: 'submitted',
      matchScore: 90,
      matchReasons: null,
      applicationUrl: null,
      applyMethod: null,
      screenshotPath: '/some/other/machine/path.png',
      failureTag: null,
      failureMessage: null,
      blockingReason: 'stale',
      blockingTaskId: 'task-1',
      queuedAt: '2020-01-01T00:00:00.000Z',
      filledAt: '2020-01-02T00:00:00.000Z',
      submittedAt: '2020-01-03T00:00:00.000Z',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-03T00:00:00.000Z',
      ...overrides
    }
  }

  it('inserts a new job, preserving status and dates but regenerating the id and dropping machine-local fields', () => {
    const result = importJobs([fixture()])
    expect(result).toEqual({ imported: 1, skipped: 0 })

    const job = getJobByUrl('https://example.com/imported')
    expect(job).not.toBeNull()
    expect(job!.id).not.toBe('external-id')
    expect(job!.status).toBe('submitted')
    expect(job!.queuedAt).toBe('2020-01-01T00:00:00.000Z')
    expect(job!.screenshotPath).toBeNull()
    expect(job!.blockingReason).toBeNull()
    expect(job!.blockingTaskId).toBeNull()
  })

  it('skips a job whose URL already exists, without touching the existing record', () => {
    queueJob(baseInput({ url: 'https://example.com/imported' }))
    const result = importJobs([fixture()])
    expect(result).toEqual({ imported: 0, skipped: 1 })
    expect(listAllJobs()).toHaveLength(1)
  })
})
