import { ipcMain, dialog, app } from 'electron'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '@shared/types/ipcEvents'
import { EXPORT_SCHEMA_VERSION } from '@shared/types/dataTransfer'
import type {
  ExportBundle,
  ExportSelection,
  ExportSizes,
  CsvTable,
  ImportSummary,
  ExportFileResult,
  ImportPickResult,
  ImportApplyResult
} from '@shared/types/dataTransfer'
import { listAllJobs, importJobs } from '../db/repositories/jobsRepository'
import { listAllExclusions, importExclusions } from '../db/repositories/jobExclusionsRepository'
import { getProfile, saveProfile } from '../db/repositories/profileRepository'
import {
  getAutoStartCommand,
  setAutoStartCommand,
  getIndexedJobsRetentionDays,
  setIndexedJobsRetentionDays
} from '../db/repositories/settingsRepository'
import { logActivity } from '../db/repositories/activityLogRepository'
import { jobsToCsv, exclusionsToCsv } from '../dataTransfer/csv'
import { validateExportBundle } from '../dataTransfer/importSchema'

function buildExportBundle(selection: ExportSelection): ExportBundle {
  const data: ExportBundle['data'] = {}
  if (selection.jobs) data.jobs = listAllJobs()
  if (selection.exclusions) data.exclusions = listAllExclusions()
  if (selection.profile) data.profile = getProfile()
  if (selection.settings) {
    data.settings = {
      autoStartCommand: getAutoStartCommand(),
      indexedJobsRetentionDays: getIndexedJobsRetentionDays()
    }
  }
  return { schemaVersion: EXPORT_SCHEMA_VERSION, exportedAt: new Date().toISOString(), appVersion: app.getVersion(), data }
}

/** Filesystem-safe timestamp for default export filenames, e.g. 2026-08-23-14-05-30. */
function filenameTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
}

/**
 * Bytes of `data` inside the real bundle wrapper, serialized exactly the way
 * `IPC.data.exportJson` writes it (compact — this format is round-trip-only,
 * never meant for a human to read or hand-edit, so indentation would only
 * cost disk space). Using the identical `JSON.stringify(bundle)` call here
 * as the real write means these sizes are exact, not an estimate.
 */
function bundleJsonBytes(data: ExportBundle['data']): number {
  const bundle: ExportBundle = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    data
  }
  return Buffer.byteLength(JSON.stringify(bundle), 'utf-8')
}

/**
 * Each domain's size is its *marginal* contribution to the bundle (with-domain
 * bytes minus the empty-bundle baseline) rather than a standalone
 * `JSON.stringify(value)` of the value, so the four sizes plus `wrapperBytes`
 * sum to exactly the bytes of the real exported file.
 */
function computeExportSizes(): ExportSizes {
  const jobs = listAllJobs()
  const exclusions = listAllExclusions()
  const profile = getProfile()
  const settings = {
    autoStartCommand: getAutoStartCommand(),
    indexedJobsRetentionDays: getIndexedJobsRetentionDays()
  }

  const empty = bundleJsonBytes({})
  return {
    jobs: { json: bundleJsonBytes({ jobs }) - empty, csv: Buffer.byteLength(jobsToCsv(jobs), 'utf-8') },
    exclusions: {
      json: bundleJsonBytes({ exclusions }) - empty,
      csv: Buffer.byteLength(exclusionsToCsv(exclusions), 'utf-8')
    },
    profile: { json: bundleJsonBytes({ profile }) - empty },
    settings: { json: bundleJsonBytes({ settings }) - empty },
    wrapperBytes: empty
  }
}

function applyImport(bundle: ExportBundle, selection: ExportSelection): ImportSummary {
  const summary: ImportSummary = {}
  if (selection.jobs && bundle.data.jobs) summary.jobs = importJobs(bundle.data.jobs)
  if (selection.exclusions && bundle.data.exclusions) summary.exclusions = importExclusions(bundle.data.exclusions)
  if (selection.profile && bundle.data.profile) {
    saveProfile(bundle.data.profile)
    summary.profile = true
  }
  if (selection.settings && bundle.data.settings) {
    setAutoStartCommand(bundle.data.settings.autoStartCommand)
    setIndexedJobsRetentionDays(bundle.data.settings.indexedJobsRetentionDays)
    summary.settings = true
  }
  return summary
}

export function registerDataTransferIpc(): void {
  ipcMain.handle(IPC.data.exportJson, async (_event, { selection }: { selection: ExportSelection }): Promise<ExportFileResult> => {
    const bundle = buildExportBundle(selection)
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Applyer data',
      defaultPath: join(app.getPath('documents'), `applyer-export-${filenameTimestamp()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    try {
      writeFileSync(filePath, JSON.stringify(bundle), 'utf-8')
      logActivity('info', `Exported data to ${filePath}`)
      return { ok: true, filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.data.exportCsv, async (_event, { table }: { table: CsvTable }): Promise<ExportFileResult> => {
    if (table !== 'jobs' && table !== 'exclusions') {
      return { ok: false, error: 'Invalid table.' }
    }
    const csv = table === 'jobs' ? jobsToCsv(listAllJobs()) : exclusionsToCsv(listAllExclusions())
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export as CSV',
      defaultPath: join(app.getPath('documents'), `applyer-${table}-${filenameTimestamp()}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    try {
      writeFileSync(filePath, csv, 'utf-8')
      logActivity('info', `Exported ${table} to ${filePath} (CSV)`)
      return { ok: true, filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.data.getExportSizes, (): ExportSizes => computeExportSizes())

  ipcMain.handle(IPC.data.pickImportFile, async (): Promise<ImportPickResult> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import Applyer data',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    const filePath = filePaths[0]
    if (canceled || !filePath) return { ok: false, canceled: true }

    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch {
      return { ok: false, error: 'That file is not valid JSON.' }
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
        exclusions: bundle.data.exclusions?.length,
        profile: bundle.data.profile ? 1 : undefined,
        settings: bundle.data.settings ? 1 : undefined
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
        return { ok: true, summary }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
