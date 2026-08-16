import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { listActivity } from '../db/repositories/activityLogRepository'
import type { ListActivityQuery } from '@shared/types/activity'

export function registerLogsIpc(): void {
  ipcMain.handle(IPC.logs.list, (_event, query: ListActivityQuery) => {
    return listActivity(query ?? {})
  })
}
