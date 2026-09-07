import { ipcMain, dialog, app } from 'electron'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '@shared/types/ipcEvents'
import type { DialogLabels } from '@shared/types/ipcEvents'
import { appError, unexpectedError } from '@shared/types/errorCodes'
import type {
  ExportSelection,
  ExportSizes,
  CsvTable,
  ExportFileResult,
  ImportPickResult,
  ImportApplyResult
} from '@shared/types/dataTransfer'
import { DEFAULT_THEME_STATE, type ThemeState } from '@shared/types/theme'
import { listAllJobs } from '../db/repositories/jobsRepository'
import { listAllExclusions } from '../db/repositories/jobExclusionsRepository'
import { listAllIndexedJobs } from '../db/repositories/indexedJobsRepository'
import { listAllCompanyBoards } from '../db/repositories/companyBoardsRepository'
import { logActivity } from '../db/repositories/activityLogRepository'
import { broadcastCompanyBoardsChanged, broadcastIndexedJobsChanged } from './jobsBroadcast'
import { jobsToCsv, indexedJobsToCsv, exclusionsToCsv, companyBoardsToCsv } from '../dataTransfer/csv'
import { themeStateSchema, validateExportBundle } from '../dataTransfer/importSchema'
import { buildExportBundle, computeExportSizes, filenameTimestamp } from '../dataTransfer/exportBundle'
import { applyImport } from '../dataTransfer/applyImport'
import { csvTablePayload, dialogLabelsPayload, exportSelectionSchema } from './payloadSchemas'
import { appLogger } from '../logger'

/**
 * Dialog titles are cosmetic — the renderer translates them and passes them
 * down because main has no locale — so an unreadable set is worth a blank
 * title, not a refused export.
 */
function readLabels(payload: unknown): DialogLabels {
  const parsed = dialogLabelsPayload.safeParse(payload)
  return parsed.success ? parsed.data.labels : { title: '', filterName: '' }
}

/**
 * The theme is renderer-owned state (localStorage), passed through this
 * process only to be written into the bundle. It is checked against the same
 * schema the import side applies, so a bundle this app writes is one it can
 * read back; a theme that fails is dropped from the export rather than
 * failing the whole thing, since the other six domains are unaffected.
 */
function readTheme(payload: unknown): ThemeState | null {
  const parsed = themeStateSchema.safeParse(payload)
  if (parsed.success) return parsed.data
  appLogger.warn('Export requested with an unreadable theme; exporting without the theme domain')
  return null
}

/** An unreadable selection exports nothing rather than guessing at everything. */
function readSelection(payload: unknown): ExportSelection | null {
  const parsed = exportSelectionSchema.safeParse(payload)
  return parsed.success ? (parsed.data as ExportSelection) : null
}

export function registerDataTransferIpc(): void {
  ipcMain.handle(IPC.data.exportJson, async (_event, payload: unknown): Promise<ExportFileResult> => {
    const { selection: rawSelection, theme: rawTheme } = (payload ?? {}) as Record<string, unknown>
    const selection = readSelection(rawSelection)
    if (!selection) return { ok: false, error: appError('invalidExport') }

    // An unreadable theme drops that one domain rather than failing the
    // export; the other six come from the database and are unaffected.
    const theme = readTheme(rawTheme)
    const bundle = buildExportBundle(
      theme === null ? { ...selection, theme: false } : selection,
      theme ?? DEFAULT_THEME_STATE
    )
    const labels = readLabels(payload)
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: labels.title,
      defaultPath: join(app.getPath('documents'), `applyer-export-${filenameTimestamp()}.json`),
      filters: [{ name: labels.filterName, extensions: ['json'] }]
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    try {
      writeFileSync(filePath, JSON.stringify(bundle), 'utf-8')
      logActivity('info', `Exported data to ${filePath}`)
      return { ok: true, filePath }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.data.exportCsv, async (_event, payload: unknown): Promise<ExportFileResult> => {
    const parsedTable = csvTablePayload.safeParse(payload)
    if (!parsedTable.success) {
      return { ok: false, error: appError('invalidTable') }
    }
    const table: CsvTable = parsedTable.data.table
    const labels = readLabels(payload)

    const csvForTable: Record<CsvTable, () => string> = {
      jobs: () => jobsToCsv(listAllJobs()),
      exclusions: () => exclusionsToCsv(listAllExclusions()),
      companyBoards: () => companyBoardsToCsv(listAllCompanyBoards()),
      indexedJobs: () => indexedJobsToCsv(listAllIndexedJobs())
    }
    const csv = csvForTable[table]()
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: labels.title,
      defaultPath: join(app.getPath('documents'), `applyer-${table}-${filenameTimestamp()}.csv`),
      filters: [{ name: labels.filterName, extensions: ['csv'] }]
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    try {
      writeFileSync(filePath, csv, 'utf-8')
      logActivity('info', `Exported ${table} to ${filePath} (CSV)`)
      return { ok: true, filePath }
    } catch (err) {
      return { ok: false, error: unexpectedError(err) }
    }
  })

  ipcMain.handle(IPC.data.getExportSizes, (_event, payload: unknown): ExportSizes => {
    const theme = readTheme((payload as { theme?: unknown } | null | undefined)?.theme)
    return computeExportSizes(theme ?? DEFAULT_THEME_STATE)
  })

  ipcMain.handle(IPC.data.pickImportFile, async (_event, payload: unknown): Promise<ImportPickResult> => {
    const labels = readLabels(payload)
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: labels.title,
      properties: ['openFile'],
      filters: [{ name: labels.filterName, extensions: ['json'] }]
    })
    const filePath = filePaths[0]
    if (canceled || !filePath) return { ok: false, canceled: true }

    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch {
      return { ok: false, error: appError('invalidJson') }
    }

    const validation = validateExportBundle(raw)
    if (!validation.ok) return { ok: false, error: validation.error }

    const { bundle } = validation
    return {
      ok: true,
      filePath,
      bundle,
      counts: {
        jobs: bundle.data.jobs?.length,
        indexedJobs: bundle.data.indexedJobs?.length,
        exclusions: bundle.data.exclusions?.length,
        companyBoards: bundle.data.companyBoards?.length,
        profile: bundle.data.profile ? 1 : undefined,
        settings: bundle.data.settings ? 1 : undefined,
        theme: bundle.data.theme ? 1 : undefined
      }
    }
  })

  ipcMain.handle(
    IPC.data.import,
    (_event, payload: unknown): ImportApplyResult => {
      const { bundle, selection: rawSelection } = (payload ?? {}) as Record<string, unknown>

      // Re-validated here rather than trusted from the earlier pickImportFile
      // round trip — the renderer echoes back whatever it was given, and this
      // handler has no way to know that echo wasn't tampered with in between.
      const validation = validateExportBundle(bundle)
      if (!validation.ok) return { ok: false, error: validation.error }

      // Which domains to write is as load-bearing as the data itself: an
      // unreadable selection would otherwise decide by accident which of the
      // user's tables get overwritten.
      const selection = readSelection(rawSelection)
      if (!selection) return { ok: false, error: appError('invalidExport') }

      try {
        const summary = applyImport(validation.bundle, selection)
        logActivity('info', 'Imported data from file', { summary })
        // The Company Boards panel reads its list on mount and then stays
        // mounted while another screen is showing, so imported boards would
        // otherwise not appear until the next restart.
        if (summary.companyBoards && summary.companyBoards.imported > 0) broadcastCompanyBoardsChanged()
        // Same reasoning for the Indexed tab, which is push-updated for
        // exactly this kind of write happening while it sits mounted-but-hidden.
        if (summary.indexedJobs && summary.indexedJobs.imported > 0) broadcastIndexedJobsChanged()
        return { ok: true, summary }
      } catch (err) {
        return { ok: false, error: unexpectedError(err) }
      }
    }
  )
}
