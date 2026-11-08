import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipcEvents'
import { appError, unexpectedError, type AppError } from '@shared/types/errorCodes'
import type { ApplicationStage, StageCount } from '@shared/types/applicationStage'
import type { JobRecord } from '@shared/types/job'
import {
  StageError,
  countSubmittedByStage,
  createStage,
  deleteStage,
  listStages,
  renameStage,
  reorderStages,
  setJobsStage
} from '../db/repositories/applicationStagesRepository'
import { logActivity } from '../db/repositories/activityLogRepository'
import { broadcastJobUpdate, broadcastStagesChanged } from './jobsBroadcast'
import {
  createStagePayload,
  renameStagePayload,
  reorderStagesPayload,
  setJobStagePayload,
  stageIdPayload
} from './payloadSchemas'

/*
 * Renderer-facing stage operations. Reads return data (an empty list or no
 * counts when something goes wrong, logged, so the board still renders);
 * writes return `{ ok, error? }` with typed codes, the same shape as
 * `resumes.ts`. Every write broadcasts `stages:changed`, and any job whose
 * stage changed is pushed with `jobs:updated` so its card moves on the same
 * frame.
 */

export type StageWriteResult<T> = { ok: true; value: T } | { ok: false; error: AppError }

function stageError(err: StageError): AppError {
  return appError(err.code, err.params)
}

function writeFailure(context: string, err: unknown): { ok: false; error: AppError } {
  if (err instanceof StageError) return { ok: false, error: stageError(err) }
  logActivity('error', `${context} failed`, { error: String(err) })
  return { ok: false, error: unexpectedError(err) }
}

export function registerStagesIpc(): void {
  ipcMain.handle(IPC.stages.list, (): { stages: ApplicationStage[] } => {
    try {
      return { stages: listStages() }
    } catch (err) {
      logActivity('error', 'Listing application stages failed', { error: String(err) })
      return { stages: [] }
    }
  })

  ipcMain.handle(IPC.stages.counts, (): { counts: StageCount[] } => {
    try {
      return { counts: countSubmittedByStage() }
    } catch (err) {
      logActivity('error', 'Counting jobs per application stage failed', { error: String(err) })
      return { counts: [] }
    }
  })

  ipcMain.handle(IPC.stages.create, (_event, payload: unknown): StageWriteResult<ApplicationStage> => {
    const parsed = createStagePayload.safeParse(payload)
    if (!parsed.success) {
      logActivity('warn', 'Rejected an unreadable stage create from renderer', { error: parsed.error.message })
      return { ok: false, error: appError('invalidStageName', { problem: 'empty' }) }
    }
    try {
      const stage = createStage(parsed.data.label)
      logActivity('info', `Application stage "${stage.label}" created`, { stageId: stage.id })
      broadcastStagesChanged()
      return { ok: true, value: stage }
    } catch (err) {
      return writeFailure('Creating an application stage', err)
    }
  })

  ipcMain.handle(IPC.stages.rename, (_event, payload: unknown): StageWriteResult<ApplicationStage> => {
    const parsed = renameStagePayload.safeParse(payload)
    if (!parsed.success) {
      logActivity('warn', 'Rejected an unreadable stage rename from renderer', { error: parsed.error.message })
      return { ok: false, error: appError('stageNotFound') }
    }
    try {
      const stage = renameStage(parsed.data.stageId, parsed.data.label)
      logActivity('info', `Application stage renamed to "${stage.label}"`, { stageId: stage.id })
      broadcastStagesChanged()
      return { ok: true, value: stage }
    } catch (err) {
      return writeFailure('Renaming an application stage', err)
    }
  })

  ipcMain.handle(IPC.stages.reorder, (_event, payload: unknown): StageWriteResult<ApplicationStage[]> => {
    const parsed = reorderStagesPayload.safeParse(payload)
    if (!parsed.success) {
      logActivity('warn', 'Rejected an unreadable stage reorder from renderer', { error: parsed.error.message })
      return { ok: false, error: appError('stageNotFound') }
    }
    try {
      const stages = reorderStages(parsed.data.orderedIds)
      broadcastStagesChanged()
      return { ok: true, value: stages }
    } catch (err) {
      return writeFailure('Reordering application stages', err)
    }
  })

  ipcMain.handle(IPC.stages.remove, (_event, payload: unknown): StageWriteResult<{ clearedJobs: number }> => {
    const parsed = stageIdPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, error: appError('stageNotFound') }
    try {
      const result = deleteStage(parsed.data.stageId)
      if (result.removed) {
        logActivity('info', 'Application stage deleted', { stageId: parsed.data.stageId, clearedJobs: result.clearedJobs.length })
        for (const job of result.clearedJobs) broadcastJobUpdate(job)
        broadcastStagesChanged()
      }
      return { ok: true, value: { clearedJobs: result.clearedJobs.length } }
    } catch (err) {
      return writeFailure('Deleting an application stage', err)
    }
  })

  ipcMain.handle(
    IPC.stages.setJobStage,
    (_event, payload: unknown): StageWriteResult<{ jobs: JobRecord[]; skippedIds: string[] }> => {
      const parsed = setJobStagePayload.safeParse(payload)
      if (!parsed.success) {
        logActivity('warn', 'Rejected an unreadable job stage change from renderer', { error: parsed.error.message })
        return { ok: false, error: appError('jobNotFound') }
      }
      try {
        const result = setJobsStage(parsed.data.jobIds, parsed.data.stageId)
        for (const job of result.updated) broadcastJobUpdate(job)
        if (result.updated.length > 0) {
          logActivity('info', `Application stage set on ${result.updated.length} job(s)`, {
            stageId: parsed.data.stageId,
            jobIds: result.updated.map((job) => job.id)
          })
          broadcastStagesChanged()
        }
        if (result.skippedIds.length > 0) {
          logActivity('warn', 'Skipped a stage change for jobs that are missing or not Submitted', {
            jobIds: result.skippedIds
          })
        }
        return { ok: true, value: { jobs: result.updated, skippedIds: result.skippedIds } }
      } catch (err) {
        return writeFailure('Setting a job stage', err)
      }
    }
  )
}
