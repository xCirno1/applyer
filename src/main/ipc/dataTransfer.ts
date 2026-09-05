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
import type { ThemeState } from '@shared/types/theme'
import { listAllJobs } from '../db/repositories/jobsRepository'
import { listAllExclusions } from '../db/repositories/jobExclusionsRepository'
import { listAllIndexedJobs } from '../db/repositories/indexedJobsRepository'
import { listAllCompanyBoards } from '../db/repositories/companyBoardsRepository'
import { logActivity } from '../db/repositories/activityLogRepository'
import { broadcastCompanyBoardsChanged, broadcastIndexedJobsChanged } from './jobsBroadcast'
import { jobsToCsv, indexedJobsToCsv, exclusionsToCsv, companyBoardsToCsv } from '../dataTransfer/csv'
import { validateExportBundle } from '../dataTransfer/importSchema'
import { buildExportBundle, computeExportSizes, filenameTimestamp } from '../dataTransfer/exportBundle'
import { applyImport } from '../dataTransfer/applyImport'

export function registerDataTransferIpc(): void {
  ipcMain.handle(IPC.data.exportJson, async (_event, { selection, labels, theme }: { selection: ExportSelection; labels: DialogLabels; theme: ThemeState }): Promise<ExportFileResult> => {
    const bundle = buildExportBundle(selection, theme)
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

  ipcMain.handle(IPC.data.exportCsv, async (_event, { table, labels }: { table: CsvTable; labels: DialogLabels }): Promise<ExportFileResult> => {
    const csvForTable: Record<CsvTable, () => string> = {
      jobs: () => jobsToCsv(listAllJobs()),
      exclusions: () => exclusionsToCsv(listAllExclusions()),
      companyBoards: () => companyBoardsToCsv(listAllCompanyBoards()),
      indexedJobs: () => indexedJobsToCsv(listAllIndexedJobs())
    }
    const build = Object.prototype.hasOwnProperty.call(csvForTable, table) ? csvForTable[table] : undefined
    if (!build) {
      return { ok: false, error: appError('invalidTable') }
    }
    const csv = build()
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

  ipcMain.handle(
    IPC.data.getExportSizes,
    (_event, { theme }: { theme: ThemeState }): ExportSizes => computeExportSizes(theme)
  )

  ipcMain.handle(IPC.data.pickImportFile, async (_event, { labels }: { labels: DialogLabels }): Promise<ImportPickResult> => {
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
    (_event, { bundle, selection }: { bundle: unknown; selection: ExportSelection }): ImportApplyResult => {
      // Re-validated here rather than trusted from the earlier pickImportFile
      // round trip — the renderer echoes back whatever it was given, and this
      // handler has no way to know that echo wasn't tampered with in between.
      const validation = validateExportBundle(bundle)
      if (!validation.ok) return { ok: false, error: validation.error }

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
