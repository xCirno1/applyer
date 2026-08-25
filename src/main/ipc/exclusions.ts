import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError } from '@shared/types/errorCodes'
import { listExclusions, removeExclusion } from '../db/repositories/jobExclusionsRepository'
import { excludeJob } from '../jobActions'
import { broadcastExclusionsChanged } from './jobsBroadcast'
import type { ListExclusionsQuery } from '@shared/types/exclusion'

export function registerExclusionsIpc(): void {
  ipcMain.handle(IPC.exclusions.list, (_event, query: ListExclusionsQuery) => {
    return listExclusions(query ?? {})
  })

  ipcMain.handle(IPC.exclusions.add, (_event, { url, reason }: { url: unknown; reason?: unknown }) => {
    if (typeof url !== 'string') {
      return { ok: false, error: appError('urlRequired') }
    }
    let normalized: string
    try {
      normalized = new URL(url.trim()).toString()
    } catch {
      return { ok: false, error: appError('invalidUrl') }
    }
    const { exclusion } = excludeJob({
      url: normalized,
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
      excludedBy: 'user'
    })
    return { ok: true, exclusion }
  })

  ipcMain.handle(IPC.exclusions.remove, (_event, { id }: { id: string }) => {
    removeExclusion(id)
    broadcastExclusionsChanged()
    return { ok: true }
  })
}
