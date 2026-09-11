import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError } from '@shared/types/errorCodes'
import { listExclusions, removeExclusion } from '../db/repositories/jobExclusionsRepository'
import { excludeJob } from '../jobActions'
import { broadcastExclusionsChanged } from './jobsBroadcast'
import { exclusionIdPayload, listExclusionsQuerySchema, readListQuery } from './payloadSchemas'

export function registerExclusionsIpc(): void {
  ipcMain.handle(IPC.exclusions.list, (_event, query: unknown) => {
    return listExclusions(readListQuery(listExclusionsQuerySchema, query, IPC.exclusions.list))
  })

  ipcMain.handle(IPC.exclusions.add, (_event, payload: unknown) => {
    const { url, reason } = (payload ?? {}) as { url?: unknown; reason?: unknown }
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

  ipcMain.handle(IPC.exclusions.remove, (_event, payload: unknown) => {
    const parsed = exclusionIdPayload.safeParse(payload)
    if (!parsed.success) return { ok: false }
    removeExclusion(parsed.data.id)
    broadcastExclusionsChanged()
    return { ok: true }
  })
}
