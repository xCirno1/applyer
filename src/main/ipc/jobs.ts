import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { listJobs, setSubmitted, retry, removeJob, IllegalTransitionError } from '../db/repositories/jobsRepository'
import { broadcastJobUpdate } from './jobsBroadcast'
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

  ipcMain.handle(IPC.jobs.remove, (_event, { jobId }: { jobId: string }) => {
    removeJob(jobId)
    return { ok: true }
  })
}
