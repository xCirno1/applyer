import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError } from '@shared/types/errorCodes'
import { listIndexedJobs, listIndexedJobDates, pruneIndexedJobs } from '../db/repositories/indexedJobsRepository'
import { getIndexedJobsRetentionDays, setIndexedJobsRetentionDays } from '../db/repositories/settingsRepository'
import { logActivity } from '../db/repositories/activityLogRepository'
import { INDEXED_JOBS_RETENTION_OPTIONS } from '@shared/constants'
import { listIndexedJobsQuerySchema, readListQuery } from './payloadSchemas'
import type { IndexedJobsRetention } from '@shared/types/indexedJob'

function isValidRetention(value: unknown): value is IndexedJobsRetention {
  return (INDEXED_JOBS_RETENTION_OPTIONS as readonly unknown[]).includes(value)
}

export function registerIndexedJobsIpc(): void {
  ipcMain.handle(IPC.indexedJobs.list, (_event, query: unknown) => {
    return listIndexedJobs(readListQuery(listIndexedJobsQuerySchema, query, IPC.indexedJobs.list))
  })

  ipcMain.handle(IPC.indexedJobs.listDates, () => listIndexedJobDates())

  ipcMain.handle(IPC.indexedJobs.getRetention, (): IndexedJobsRetention => getIndexedJobsRetentionDays())

  ipcMain.handle(IPC.indexedJobs.setRetention, (_event, payload: unknown) => {
    const value = (payload as { value?: unknown } | null | undefined)?.value
    if (!isValidRetention(value)) {
      return { ok: false, error: appError('invalidRetention') }
    }
    setIndexedJobsRetentionDays(value)
    const deletedCount = pruneIndexedJobs()
    logActivity(
      'info',
      `Indexed jobs retention set to ${value === 'unlimited' ? 'unlimited' : `${value} days`}`,
      deletedCount > 0 ? { deletedCount } : undefined
    )
    return { ok: true, deletedCount }
  })
}
