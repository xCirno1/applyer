import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError, unexpectedError } from '@shared/types/errorCodes'
import { deleteRun, getRun, listRunEvents, listRuns, loadRunEvents, renameRun } from '../db/repositories/runsRepository'
import { computeRunStats } from '../runs/runStats'
import { getCurrentRun, startRun, stopRun } from '../runs/runTracker'
import { broadcastRunsChanged } from './jobsBroadcast'
import {
  listRunEventsQuerySchema,
  listRunsQuerySchema,
  readListQuery,
  renameRunPayload,
  runIdPayload,
  startRunPayload
} from './payloadSchemas'
import type { RunRecord, RunStats } from '@shared/types/run'

const runNotFound = { ok: false, error: appError('runNotFound') } as const

function statsFor(run: RunRecord): RunStats {
  return computeRunStats(run, loadRunEvents(run.id))
}

export function registerRunsIpc(): void {
  ipcMain.handle(IPC.runs.getActive, () => {
    const run = getCurrentRun()
    return { run, stats: run ? statsFor(run) : null }
  })

  ipcMain.handle(IPC.runs.start, (_event, payload: unknown) => {
    const parsed = startRunPayload.safeParse(payload ?? {})
    try {
      const run = startRun(parsed.success ? (parsed.data.label ?? null) : null)
      return { ok: true, run, stats: statsFor(run) }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.runs.stop, () => {
    try {
      const run = stopRun()
      if (!run) return { ok: false, error: appError('noActiveRun') }
      return { ok: true, run, stats: statsFor(run) }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.runs.list, (_event, query: unknown) => {
    return listRuns(readListQuery(listRunsQuerySchema, query, IPC.runs.list))
  })

  ipcMain.handle(IPC.runs.get, (_event, payload: unknown) => {
    const parsed = runIdPayload.safeParse(payload)
    if (!parsed.success) return runNotFound
    const run = getRun(parsed.data.runId)
    return run ? { ok: true, run } : runNotFound
  })

  ipcMain.handle(IPC.runs.getStats, (_event, payload: unknown) => {
    const parsed = runIdPayload.safeParse(payload)
    if (!parsed.success) return runNotFound
    const run = getRun(parsed.data.runId)
    if (!run) return runNotFound
    try {
      return { ok: true, stats: statsFor(run) }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.runs.listEvents, (_event, query: unknown) => {
    const parsed = listRunEventsQuerySchema.safeParse(query)
    if (!parsed.success) return { items: [], total: 0 }
    return listRunEvents(parsed.data)
  })

  ipcMain.handle(IPC.runs.rename, (_event, payload: unknown) => {
    const parsed = renameRunPayload.safeParse(payload)
    if (!parsed.success) return runNotFound
    const run = renameRun(parsed.data.runId, parsed.data.label)
    if (!run) return runNotFound
    broadcastRunsChanged()
    return { ok: true, run }
  })

  ipcMain.handle(IPC.runs.delete, (_event, payload: unknown) => {
    const parsed = runIdPayload.safeParse(payload)
    if (!parsed.success) return runNotFound
    // Deleting the run in progress would leave the tracker pointing at a
    // row that no longer exists, so it is stopped first to clear the cache.
    const current = getCurrentRun()
    if (current && current.id === parsed.data.runId) stopRun()
    if (!deleteRun(parsed.data.runId)) return runNotFound
    broadcastRunsChanged()
    return { ok: true }
  })
}
