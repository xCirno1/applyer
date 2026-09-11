import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { listActivity } from '../db/repositories/activityLogRepository'
import { listActivityQuerySchema, readListQuery } from './payloadSchemas'

export function registerLogsIpc(): void {
  ipcMain.handle(IPC.logs.list, (_event, query: unknown) => {
    return listActivity(readListQuery(listActivityQuerySchema, query, IPC.logs.list))
  })
}
