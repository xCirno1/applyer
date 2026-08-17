import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
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
import { excludeJob, excludeJobsByIds } from '../jobActions'
import type { ListJobsQuery } from '@shared/types/job'

export function registerJobsIpc(): void {
  ipcMain.handle(IPC.jobs.list, (_event, query: ListJobsQuery) => {
    return listJobs(query ?? {})
  })

  ipcMain.handle(IPC.jobs.markSubmitted, (_event, { jobId }: { jobId: string }) => {
    try {
      const job = setSubmitted(jobId)
      broadcastJobUpdate(job)
      return { ok: true, job }
    } catch (err) {
      return { ok: false, error: err instanceof IllegalTransitionError ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.jobs.retry, (_event, { jobId }: { jobId: string }) => {
    try {
      const job = retry(jobId)
      broadcastJobUpdate(job)
      return { ok: true, job }
    } catch (err) {
      return { ok: false, error: err instanceof IllegalTransitionError ? err.message : String(err) }
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
      return { ok: false, error: 'Job not found.' }
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
}
