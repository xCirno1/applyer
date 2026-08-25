import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError, unexpectedError, type AppError } from '@shared/types/errorCodes'
import {
  listJobs,
  setSubmitted,
  retry,
  retryAllFailed,
  retryManyFailed,
  removeJob,
  getJob,
  IllegalTransitionError
} from '../db/repositories/jobsRepository'
import { broadcastJobUpdate } from './jobsBroadcast'
import { excludeJob, excludeJobsByIds, unqueueJob, unqueueJobsByIds } from '../jobActions'
import type { ListJobsQuery } from '@shared/types/job'

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

export function registerJobsIpc(): void {
  ipcMain.handle(IPC.jobs.list, (_event, query: ListJobsQuery) => {
    return listJobs(query ?? {})
  })

  ipcMain.handle(IPC.jobs.get, (_event, { jobId }: { jobId: string }) => {
    return { job: getJob(jobId) }
  })

  ipcMain.handle(IPC.jobs.markSubmitted, (_event, { jobId }: { jobId: string }) => {
    try {
      const job = setSubmitted(jobId)
      broadcastJobUpdate(job)
      return { ok: true, job }
    } catch (err) {
      return { ok: false, error: toJobError(err) }
    }
  })

  ipcMain.handle(IPC.jobs.retry, (_event, { jobId }: { jobId: string }) => {
    try {
      const job = retry(jobId)
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

  ipcMain.handle(IPC.jobs.retryMany, (_event, { jobIds }: { jobIds: string[] }) => {
    const updated = retryManyFailed(jobIds)
    for (const job of updated) broadcastJobUpdate(job)
    return { ok: true, jobs: updated }
  })

  ipcMain.handle(IPC.jobs.remove, (_event, { jobId }: { jobId: string }) => {
    removeJob(jobId)
    return { ok: true }
  })

  ipcMain.handle(IPC.jobs.exclude, (_event, { jobId, reason }: { jobId: string; reason?: string }) => {
    const job = getJob(jobId)
    if (!job) {
      return { ok: false, error: appError('jobNotFound') }
    }
    const { exclusion } = excludeJob({
      url: job.url,
      title: job.title,
      company: job.company,
      reason: reason?.trim() || null,
      excludedBy: 'user'
    })
    return { ok: true, exclusion }
  })

  ipcMain.handle(IPC.jobs.excludeMany, (_event, { jobIds }: { jobIds: string[] }) => {
    const excludedIds = excludeJobsByIds(jobIds)
    return { ok: true, excludedIds }
  })

  ipcMain.handle(IPC.jobs.unqueue, (_event, { jobId }: { jobId: string }) => {
    const job = unqueueJob(jobId)
    if (!job) {
      return { ok: false, error: appError('jobNotQueued') }
    }
    return { ok: true, job }
  })

  ipcMain.handle(IPC.jobs.unqueueMany, (_event, { jobIds }: { jobIds: string[] }) => {
    const unqueuedIds = unqueueJobsByIds(jobIds)
    return { ok: true, unqueuedIds }
  })
}
