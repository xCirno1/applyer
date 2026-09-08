import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IPC } from '@shared/types/ipcEvents'
import { __invokeIpc, __resetIpcMock } from '../../../test/mocks/electron'
import type { JobRecord } from '@shared/types/job'

const job = (overrides: Partial<JobRecord> = {}): JobRecord =>
  ({
    id: 'job-1',
    externalId: null,
    source: 'greenhouse',
    title: 'Engineer',
    company: 'Acme',
    location: null,
    url: 'https://example.com/jobs/1',
    description: null,
    salaryRange: null,
    status: 'queued',
    matchScore: null,
    matchReasons: null,
    applicationUrl: null,
    applyMethod: null,
    screenshotPath: null,
    failureTag: null,
    failureMessage: null,
    blockingReason: null,
    blockingTaskId: null,
    queuedAt: '2026-01-01T00:00:00.000Z',
    filledAt: null,
    submittedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }) as JobRecord

const listJobs = vi.fn(() => ({ jobs: [], total: 0 }))
const getJob = vi.fn<(id: string) => JobRecord | null>(() => job())
const setSubmitted = vi.fn<(id: string) => JobRecord>(() => job({ status: 'submitted' }))
const retry = vi.fn<(id: string) => JobRecord>(() => job())
const retryAllFailed = vi.fn(() => [] as JobRecord[])
const retryManyFailed = vi.fn<(ids: string[]) => JobRecord[]>(() => [])

// Declared inside the factory, not above it: `vi.mock` is hoisted above every
// top-level binding, and a class referenced eagerly in the returned object
// would still be in its temporal dead zone when the factory runs.
vi.mock('../db/repositories/jobsRepository', () => {
  class IllegalTransitionError extends Error {
    constructor(
      readonly from: string,
      readonly to: string
    ) {
      super('illegal')
    }
  }
  return {
    listJobs: (...args: unknown[]) => listJobs(...(args as [])),
    getJob: (id: string) => getJob(id),
    setSubmitted: (id: string) => setSubmitted(id),
    retry: (id: string) => retry(id),
    retryAllFailed: () => retryAllFailed(),
    retryManyFailed: (ids: string[]) => retryManyFailed(ids),
    IllegalTransitionError
  }
})

const excludeJob = vi.fn(() => ({ exclusion: { id: 'exc-1' } }))
const excludeJobsByIds = vi.fn((ids: string[]) => ids)
const unqueueJob = vi.fn<(id: string) => JobRecord | null>(() => job())
const unqueueJobsByIds = vi.fn((ids: string[]) => ids)
const removeCompletedJob = vi.fn<(id: string) => JobRecord | null>(() => job({ status: 'filled' }))
const removeCompletedJobsByIds = vi.fn((ids: string[]) => ids)

vi.mock('../jobActions', () => ({
  excludeJob: (...args: unknown[]) => excludeJob(...(args as [])),
  excludeJobsByIds: (ids: string[]) => excludeJobsByIds(ids),
  unqueueJob: (id: string) => unqueueJob(id),
  unqueueJobsByIds: (ids: string[]) => unqueueJobsByIds(ids),
  removeCompletedJob: (id: string) => removeCompletedJob(id),
  removeCompletedJobsByIds: (ids: string[]) => removeCompletedJobsByIds(ids)
}))

vi.mock('./jobsBroadcast', () => ({ broadcastJobUpdate: vi.fn() }))

import { registerJobsIpc } from './jobs'
// Resolves to the mock above, so the handler's `instanceof` check sees the
// same class this test throws.
import { IllegalTransitionError } from '../db/repositories/jobsRepository'

beforeEach(() => {
  // Call history only — the factories above keep their default
  // implementations, which `resetMocks` would strip.
  vi.clearAllMocks()
  __resetIpcMock()
  registerJobsIpc()
})

/** The payload shapes a bug on the renderer side actually produces. */
const badPayloads: Array<[string, unknown]> = [
  ['undefined', undefined],
  ['null', null],
  ['an empty object', {}],
  ['a non-string id', { jobId: 42 }],
  ['a string instead of an object', 'job-1']
]

describe('jobs:list', () => {
  it('passes a valid query through to the repository', () => {
    __invokeIpc(IPC.jobs.list, { status: 'queued', limit: 10 })
    expect(listJobs).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued', limit: 10 }))
  })

  // A malformed filter must not cost the user their board: the list still
  // renders, unfiltered, rather than the call rejecting.
  it.each([
    ['a non-object query', 'everything'],
    ['a query with a bad field', { limit: 'twenty' }]
  ])('still lists for %s', (_label, query) => {
    expect(() => __invokeIpc(IPC.jobs.list, query)).not.toThrow()
    expect(listJobs).toHaveBeenCalled()
  })
})

describe('jobs:get', () => {
  it('returns the job for a valid id', () => {
    expect(__invokeIpc(IPC.jobs.get, { jobId: 'job-1' })).toEqual({ job: job() })
  })

  it.each(badPayloads)('answers null for %s without asking the repository', (_label, payload) => {
    expect(__invokeIpc(IPC.jobs.get, payload)).toEqual({ job: null })
    expect(getJob).not.toHaveBeenCalled()
  })
})

describe('mutations', () => {
  it('marks a job submitted', () => {
    expect(__invokeIpc(IPC.jobs.markSubmitted, { jobId: 'job-1' })).toMatchObject({ ok: true })
    expect(setSubmitted).toHaveBeenCalledWith('job-1')
  })

  it('reports a rejected transition as a typed error rather than a throw', () => {
    setSubmitted.mockImplementationOnce(() => {
      throw new IllegalTransitionError('submitted', 'submitted')
    })
    expect(__invokeIpc(IPC.jobs.markSubmitted, { jobId: 'job-1' })).toEqual({
      ok: false,
      error: { code: 'illegalTransition', params: { from: 'submitted', to: 'submitted' } }
    })
  })

  // Before validation, each of these threw a TypeError inside the handler,
  // which the renderer saw as a bare rejected promise with no error code.
  it.each(badPayloads)('refuses markSubmitted for %s', (_label, payload) => {
    expect(__invokeIpc(IPC.jobs.markSubmitted, payload)).toEqual({
      ok: false,
      error: { code: 'jobNotFound' }
    })
    expect(setSubmitted).not.toHaveBeenCalled()
  })

  it.each(badPayloads)('refuses retry for %s', (_label, payload) => {
    expect(__invokeIpc(IPC.jobs.retry, payload)).toMatchObject({ ok: false })
    expect(retry).not.toHaveBeenCalled()
  })

  it.each(badPayloads)('refuses remove for %s, deleting nothing', (_label, payload) => {
    expect(__invokeIpc(IPC.jobs.remove, payload)).toEqual({ ok: false, error: { code: 'jobNotFound' } })
    expect(removeCompletedJob).not.toHaveBeenCalled()
  })

  it('removes a completed job', () => {
    expect(__invokeIpc(IPC.jobs.remove, { jobId: 'job-1' })).toMatchObject({ ok: true })
    expect(removeCompletedJob).toHaveBeenCalledWith('job-1')
  })

  it('refuses a job that is no longer completed', () => {
    removeCompletedJob.mockReturnValueOnce(null)
    expect(__invokeIpc(IPC.jobs.remove, { jobId: 'job-1' })).toEqual({
      ok: false,
      error: { code: 'jobNotCompleted' }
    })
  })

  it.each(badPayloads)('refuses unqueue for %s', (_label, payload) => {
    expect(__invokeIpc(IPC.jobs.unqueue, payload)).toMatchObject({ ok: false })
    expect(unqueueJob).not.toHaveBeenCalled()
  })

  it.each(badPayloads)('refuses exclude for %s', (_label, payload) => {
    expect(__invokeIpc(IPC.jobs.exclude, payload)).toMatchObject({ ok: false })
    expect(excludeJob).not.toHaveBeenCalled()
  })

  it('excludes a job by id, carrying the reason through', () => {
    expect(__invokeIpc(IPC.jobs.exclude, { jobId: 'job-1', reason: '  not remote  ' })).toMatchObject({ ok: true })
    expect(excludeJob).toHaveBeenCalledWith(expect.objectContaining({ reason: 'not remote', excludedBy: 'user' }))
  })

  it('reports a job that no longer exists as jobNotFound', () => {
    getJob.mockReturnValueOnce(null)
    expect(__invokeIpc(IPC.jobs.exclude, { jobId: 'gone' })).toEqual({ ok: false, error: { code: 'jobNotFound' } })
  })
})

describe('bulk mutations', () => {
  const badLists: Array<[string, unknown]> = [
    ['a missing payload', undefined],
    ['a non-array', { jobIds: 'job-1' }],
    ['an array with a non-string member', { jobIds: ['job-1', 42] }]
  ]

  it('acts on a valid list', () => {
    expect(__invokeIpc(IPC.jobs.excludeMany, { jobIds: ['a', 'b'] })).toEqual({ ok: true, excludedIds: ['a', 'b'] })
    expect(__invokeIpc(IPC.jobs.unqueueMany, { jobIds: ['a'] })).toEqual({ ok: true, unqueuedIds: ['a'] })
    expect(__invokeIpc(IPC.jobs.removeMany, { jobIds: ['a'] })).toEqual({ ok: true, removedIds: ['a'] })
    expect(__invokeIpc(IPC.jobs.retryMany, { jobIds: ['a'] })).toEqual({ ok: true, jobs: [] })
  })

  it.each(badLists)('refuses excludeMany for %s', (_label, payload) => {
    expect(__invokeIpc(IPC.jobs.excludeMany, payload)).toEqual({ ok: false, excludedIds: [] })
    expect(excludeJobsByIds).not.toHaveBeenCalled()
  })

  it.each(badLists)('refuses unqueueMany for %s', (_label, payload) => {
    expect(__invokeIpc(IPC.jobs.unqueueMany, payload)).toEqual({ ok: false, unqueuedIds: [] })
    expect(unqueueJobsByIds).not.toHaveBeenCalled()
  })

  it.each(badLists)('refuses removeMany for %s', (_label, payload) => {
    expect(__invokeIpc(IPC.jobs.removeMany, payload)).toEqual({ ok: false, removedIds: [] })
    expect(removeCompletedJobsByIds).not.toHaveBeenCalled()
  })

  it.each(badLists)('refuses retryMany for %s', (_label, payload) => {
    expect(__invokeIpc(IPC.jobs.retryMany, payload)).toEqual({ ok: false, jobs: [] })
    expect(retryManyFailed).not.toHaveBeenCalled()
  })

  it('retries everything failed without needing a payload', () => {
    expect(__invokeIpc(IPC.jobs.retryAll)).toEqual({ ok: true, jobs: [] })
    expect(retryAllFailed).toHaveBeenCalled()
  })
})
