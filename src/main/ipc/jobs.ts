import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError, unexpectedError, type AppError } from '@shared/types/errorCodes'
import {
  listJobs,
  setSubmitted,
  retry,
  retryAllFailed,
  retryManyFailed,
  getJob,
  IllegalTransitionError
} from '../db/repositories/jobsRepository'
import { broadcastJobUpdate } from './jobsBroadcast'
import {
  excludeJob,
  excludeJobsByIds,
  removeCompletedJob,
  removeCompletedJobsByIds,
  unqueueJob,
  unqueueJobsByIds
} from '../jobActions'
import {
  excludeJobPayload,
  jobIdPayload,
  jobIdsPayload,
  listJobsQuerySchema,
  readListQuery
} from './payloadSchemas'

/**
 * A rejected state transition is a distinct, explainable failure ("this job
 * isn't Failed any more, so it can't be retried"); anything else thrown out
 * of the repository is a genuine surprise and keeps its raw message.
 */
function toJobError(err: unknown): AppError {
  return err instanceof IllegalTransitionError
    ? appError('illegalTransition', { from: err.from, to: err.to })
    : unexpectedError(err)
}

/**
 * Every mutation here addresses a row by id, so an unreadable payload is
 * answered with `jobNotFound` — the same thing the caller gets for an id that
 * doesn't exist, which is what an unreadable one amounts to.
 */
const jobNotFound = { ok: false, error: appError('jobNotFound') } as const

export function registerJobsIpc(): void {
  ipcMain.handle(IPC.jobs.list, (_event, query: unknown) => {
    return listJobs(readListQuery(listJobsQuerySchema, query, IPC.jobs.list))
  })

  ipcMain.handle(IPC.jobs.get, (_event, payload: unknown) => {
    const parsed = jobIdPayload.safeParse(payload)
    return { job: parsed.success ? getJob(parsed.data.jobId) : null }
  })

  ipcMain.handle(IPC.jobs.markSubmitted, (_event, payload: unknown) => {
    const parsed = jobIdPayload.safeParse(payload)
    if (!parsed.success) return jobNotFound
    try {
      const job = setSubmitted(parsed.data.jobId)
      broadcastJobUpdate(job)
      return { ok: true, job }
    } catch (err) {
      return { ok: false, error: toJobError(err) }
    }
  })

  ipcMain.handle(IPC.jobs.retry, (_event, payload: unknown) => {
    const parsed = jobIdPayload.safeParse(payload)
    if (!parsed.success) return jobNotFound
    try {
      const job = retry(parsed.data.jobId)
      broadcastJobUpdate(job)
      return { ok: true, job }
    } catch (err) {
      return { ok: false, error: toJobError(err) }
    }
  })

  ipcMain.handle(IPC.jobs.retryAll, () => {
    const updated = retryAllFailed()
    for (const job of updated) broadcastJobUpdate(job)
    return { ok: true, jobs: updated }
  })

  ipcMain.handle(IPC.jobs.retryMany, (_event, payload: unknown) => {
    const parsed = jobIdsPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, jobs: [] }
    const updated = retryManyFailed(parsed.data.jobIds)
    for (const job of updated) broadcastJobUpdate(job)
    return { ok: true, jobs: updated }
  })

  ipcMain.handle(IPC.jobs.remove, (_event, payload: unknown) => {
    const parsed = jobIdPayload.safeParse(payload)
    if (!parsed.success) return jobNotFound
    const job = removeCompletedJob(parsed.data.jobId)
    return job ? { ok: true, job } : { ok: false, error: appError('jobNotCompleted') }
  })

  ipcMain.handle(IPC.jobs.removeMany, (_event, payload: unknown) => {
    const parsed = jobIdsPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, removedIds: [] }
    return { ok: true, removedIds: removeCompletedJobsByIds(parsed.data.jobIds) }
  })

  ipcMain.handle(IPC.jobs.exclude, (_event, payload: unknown) => {
    const parsed = excludeJobPayload.safeParse(payload)
    if (!parsed.success) return jobNotFound

    const job = getJob(parsed.data.jobId)
    if (!job) {
      return jobNotFound
    }
    const { exclusion } = excludeJob({
      url: job.url,
      title: job.title,
      company: job.company,
      reason: parsed.data.reason?.trim() || null,
      excludedBy: 'user'
    })
    return { ok: true, exclusion }
  })

  ipcMain.handle(IPC.jobs.excludeMany, (_event, payload: unknown) => {
    const parsed = jobIdsPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, excludedIds: [] }
    return { ok: true, excludedIds: excludeJobsByIds(parsed.data.jobIds) }
  })

  ipcMain.handle(IPC.jobs.unqueue, (_event, payload: unknown) => {
    const parsed = jobIdPayload.safeParse(payload)
    if (!parsed.success) return jobNotFound

    const job = unqueueJob(parsed.data.jobId)
    if (!job) {
      return { ok: false, error: appError('jobNotQueued') }
    }
    return { ok: true, job }
  })

  ipcMain.handle(IPC.jobs.unqueueMany, (_event, payload: unknown) => {
    const parsed = jobIdsPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, unqueuedIds: [] }
    return { ok: true, unqueuedIds: unqueueJobsByIds(parsed.data.jobIds) }
  })
}
