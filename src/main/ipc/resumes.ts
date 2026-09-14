import { ipcMain, dialog, app } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '@shared/types/ipcEvents'
import type { DialogLabels } from '@shared/types/ipcEvents'
import { appError, unexpectedError, type AppError } from '@shared/types/errorCodes'
import type { JobRecord } from '@shared/types/job'
import type {
  MasterResume,
  ResumeContent,
  ResumePageSize,
  ResumeSettings,
  ResumeTemplateId,
  ResumeVariant,
  ResumeVariantSummary,
  ResumeStyle
} from '@shared/types/resume'
import { validateResumeContent } from '@shared/resume/resumeContentSchema'
import {
  ResumeVariantError,
  assignVariant,
  deleteMasterResume,
  deleteVariant,
  getMasterResume,
  getVariant,
  isVariantStale,
  listVariantSummaries,
  saveMasterResume,
  saveVariant
} from '../db/repositories/resumeRepository'
import { getResumeSettings, setResumeSettings } from '../db/repositories/settingsRepository'
import { logActivity } from '../db/repositories/activityLogRepository'
import { renderResumePdf, resumeFileName } from '../browser/resumeRenderer'
import { writeAgentInstructions } from '../config/agentInstructions'
import { broadcastJobUpdate, broadcastResumesChanged } from './jobsBroadcast'
import {
  assignResumeVariantPayload,
  dialogLabelsPayload,
  resumePdfTargetPayload,
  resumeSettingsPayload,
  resumeVariantIdPayload,
  saveMasterResumePayload,
  saveResumeVariantPayload
} from './payloadSchemas'

/*
 * Renderer-facing resume operations. Reads return the data (or `null`), writes
 * return `{ ok, error? }` with typed codes, same as `profile.ts`. Every write
 * broadcasts `resumes:changed` so the store refetches; the PDF export renders
 * through the same headless-browser path the fill uses, so what the user
 * saves to disk is byte-for-byte what an application would receive.
 */

export type ResumeWriteResult<T> = { ok: true; value: T } | { ok: false; error: AppError }

export interface ResumeVariantWithState extends ResumeVariant {
  stale: boolean
}

function validatedContent(raw: unknown): { ok: true; content: ResumeContent } | { ok: false; error: AppError } {
  const validation = validateResumeContent(raw)
  if (!validation.ok) {
    logActivity('warn', 'Rejected invalid resume content from renderer', { error: validation.message })
    return { ok: false, error: appError('invalidResumeData', { message: validation.message }) }
  }
  return { ok: true, content: validation.content }
}

function readLabels(payload: unknown): DialogLabels {
  const parsed = dialogLabelsPayload.safeParse(payload)
  return parsed.success ? parsed.data.labels : { title: '', filterName: '' }
}

function variantWithState(variant: ResumeVariant): ResumeVariantWithState {
  return { ...variant, stale: isVariantStale(variant) }
}

/** The repository's typed errors carry the code and, for a name clash, the name the message wants. */
function variantError(err: ResumeVariantError): AppError {
  return appError(err.code, err.params)
}

export function registerResumesIpc(): void {
  ipcMain.handle(IPC.resumes.getMaster, (): { master: MasterResume | null } => {
    return { master: getMasterResume() }
  })

  ipcMain.handle(IPC.resumes.saveMaster, (_event, payload: unknown): ResumeWriteResult<MasterResume> => {
    const parsed = saveMasterResumePayload.safeParse(payload)
    if (!parsed.success) {
      logActivity('warn', 'Rejected invalid master resume save from renderer', { error: parsed.error.message })
      return { ok: false, error: appError('invalidResumeData', { message: parsed.error.issues[0]?.message ?? '' }) }
    }
    const content = validatedContent(parsed.data.content)
    if (!content.ok) return content
    try {
      const master = saveMasterResume({
        content: content.content,
        templateId: parsed.data.templateId as ResumeTemplateId | undefined,
        pageSize: parsed.data.pageSize as ResumePageSize | undefined,
        style: parsed.data.style,
        sourceDocumentId: parsed.data.sourceDocumentId
      })
      logActivity('info', 'Master resume saved')
      broadcastResumesChanged()
      return { ok: true, value: master }
    } catch (err) {
      logActivity('error', 'Master resume save failed', { error: String(err) })
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.resumes.deleteMaster, (): ResumeWriteResult<null> => {
    try {
      deleteMasterResume()
      logActivity('info', 'Master resume deleted')
      broadcastResumesChanged()
      return { ok: true, value: null }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.resumes.listVariants, (): { variants: ResumeVariantSummary[] } => {
    return { variants: listVariantSummaries() }
  })

  ipcMain.handle(IPC.resumes.getVariant, (_event, payload: unknown): { variant: ResumeVariantWithState | null } => {
    const parsed = resumeVariantIdPayload.safeParse(payload)
    if (!parsed.success) return { variant: null }
    const variant = getVariant(parsed.data.id)
    return { variant: variant ? variantWithState(variant) : null }
  })

  ipcMain.handle(IPC.resumes.saveVariant, (_event, payload: unknown): ResumeWriteResult<ResumeVariantWithState> => {
    const parsed = saveResumeVariantPayload.safeParse(payload)
    if (!parsed.success) {
      logActivity('warn', 'Rejected invalid resume variant save from renderer', { error: parsed.error.message })
      return { ok: false, error: appError('invalidResumeData', { message: parsed.error.issues[0]?.message ?? '' }) }
    }
    let content: ResumeContent | undefined
    if (parsed.data.content !== undefined) {
      const validated = validatedContent(parsed.data.content)
      if (!validated.ok) return validated
      content = validated.content
    }
    try {
      // The renderer creates or updates, never replaces by name: that is the
      // agent's shortcut, and a user naming a new draft after an existing
      // variant should hear about it instead of overwriting it.
      const variant = saveVariant({
        id: parsed.data.id,
        name: parsed.data.name,
        content,
        templateId: parsed.data.templateId as ResumeTemplateId | undefined,
        onNameTaken: 'reject'
      })
      logActivity('info', `Resume variant "${variant.name}" saved`, { variantId: variant.id })
      broadcastResumesChanged()
      return { ok: true, value: variantWithState(variant) }
    } catch (err) {
      if (err instanceof ResumeVariantError) return { ok: false, error: variantError(err) }
      logActivity('error', 'Resume variant save failed', { error: String(err) })
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.resumes.deleteVariant, (_event, payload: unknown): ResumeWriteResult<{ unassignedJobs: number }> => {
    const parsed = resumeVariantIdPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, error: appError('invalidResumeData') }
    try {
      const result = deleteVariant(parsed.data.id)
      if (result.removed) {
        logActivity('info', 'Resume variant removed', { variantId: parsed.data.id, unassignedJobs: result.unassignedJobs })
        broadcastResumesChanged()
      }
      return { ok: true, value: { unassignedJobs: result.unassignedJobs } }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  // Both signals: the variant list carries the jobs using each variant, and
  // the job row itself changed (the board's card reads the assignment too).
  ipcMain.handle(IPC.resumes.assignVariant, (_event, payload: unknown): ResumeWriteResult<JobRecord> => {
    const parsed = assignResumeVariantPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, error: appError('invalidResumeData') }
    try {
      const job = assignVariant(parsed.data.jobId, parsed.data.variantId)
      logActivity(
        'info',
        parsed.data.variantId ? 'Resume variant assigned to job' : 'Resume variant unassigned from job',
        { jobId: job.id, variantId: parsed.data.variantId }
      )
      broadcastJobUpdate(job)
      broadcastResumesChanged()
      return { ok: true, value: job }
    } catch (err) {
      if (err instanceof ResumeVariantError) return { ok: false, error: variantError(err) }
      logActivity('error', 'Resume variant assignment failed', { jobId: parsed.data.jobId, error: String(err) })
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(
    IPC.resumes.exportPdf,
    async (_event, payload: unknown): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: AppError }> => {
      const parsed = resumePdfTargetPayload.safeParse(payload)
      if (!parsed.success) return { ok: false, error: appError('invalidResumeData') }
      const labels = readLabels(payload)

      let content: ResumeContent
      let templateId: ResumeTemplateId
      let pageSize: ResumePageSize
      let style: ResumeStyle
      try {
        const master = getMasterResume()
        if (!master) return { ok: false, error: appError('masterResumeMissing') }
        pageSize = master.pageSize
        style = master.style
        if (parsed.data.target.kind === 'master') {
          content = master.content
          templateId = master.templateId
        } else {
          const variant = getVariant(parsed.data.target.id)
          if (!variant) return { ok: false, error: appError('variantNotFound') }
          content = variant.content
          templateId = variant.templateId
        }
      } catch (err) {
        return { ok: false, error: unexpectedError(err) }
      }

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: labels.title,
        defaultPath: join(app.getPath('documents'), resumeFileName(content)),
        filters: [{ name: labels.filterName, extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return { ok: false, canceled: true }

      try {
        const bytes = await renderResumePdf(content, templateId, pageSize, style)
        writeFileSync(filePath, bytes)
        logActivity('info', `Exported a resume PDF to ${filePath}`)
        return { ok: true, filePath }
      } catch (err) {
        logActivity('error', 'Resume PDF export failed', { error: String(err) })
        return { ok: false, error: appError('resumeRenderFailed', { message: String(err) }) }
      }
    }
  )

  ipcMain.handle(IPC.resumes.getSettings, (): { settings: ResumeSettings } => {
    return { settings: getResumeSettings() }
  })

  ipcMain.handle(IPC.resumes.setSettings, (_event, payload: unknown): ResumeWriteResult<ResumeSettings> => {
    const parsed = resumeSettingsPayload.safeParse(payload)
    if (!parsed.success) return { ok: false, error: appError('invalidResumeData') }
    try {
      setResumeSettings(parsed.data)
      // The auto-tailor flag lives in the agent's instruction file, which is
      // otherwise only written at launch.
      writeAgentInstructions()
      broadcastResumesChanged()
      return { ok: true, value: parsed.data }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })
}
