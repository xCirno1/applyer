import { app } from 'electron'
import { EXPORT_SCHEMA_VERSION } from '@shared/types/dataTransfer'
import type { ExportBundle, ExportSelection, ExportSizes } from '@shared/types/dataTransfer'
import type { ThemeState } from '@shared/types/theme'
import { listAllJobs } from '../db/repositories/jobsRepository'
import { listAllExclusions } from '../db/repositories/jobExclusionsRepository'
import { listAllIndexedJobs } from '../db/repositories/indexedJobsRepository'
import { listAllCompanyBoards } from '../db/repositories/companyBoardsRepository'
import { getProfile } from '../db/repositories/profileRepository'
import {
  getAutoStartCommand,
  getIndexedJobsRetentionDays,
  getNotificationPreferences
} from '../db/repositories/settingsRepository'
import { jobsToCsv, indexedJobsToCsv, exclusionsToCsv, companyBoardsToCsv } from './csv'
import type { ExportCompanyBoard } from '@shared/types/dataTransfer'
import type { CompanyBoardRecord } from '@shared/types/companyBoard'

/**
 * Drops the per-install columns — see `ExportCompanyBoard` for why the last
 * fetch's result never travels with a board.
 */
function toExportBoard(board: CompanyBoardRecord): ExportCompanyBoard {
  return {
    provider: board.provider,
    token: board.token,
    host: board.host,
    site: board.site,
    companyName: board.companyName,
    addedBy: board.addedBy,
    enabled: board.enabled,
    seedJobCount: board.seedJobCount,
    createdAt: board.createdAt
  }
}

function exportableCompanyBoards(): ExportCompanyBoard[] {
  return listAllCompanyBoards().map(toExportBoard)
}

/**
 * `theme` is unlike every other ingredient here: it isn't read from this
 * process's DB, it's whatever the renderer's current localStorage theme
 * state was at the moment it asked for this export (see
 * `ipc/dataTransfer.ts`'s `exportJson` handler) — main only ever carries it
 * through, never reads or writes it itself.
 */
export function buildExportBundle(selection: ExportSelection, theme: ThemeState): ExportBundle {
  const data: ExportBundle['data'] = {}
  if (selection.jobs) data.jobs = listAllJobs()
  if (selection.indexedJobs) data.indexedJobs = listAllIndexedJobs()
  if (selection.exclusions) data.exclusions = listAllExclusions()
  if (selection.companyBoards) data.companyBoards = exportableCompanyBoards()
  if (selection.profile) data.profile = getProfile()
  if (selection.settings) {
    data.settings = {
      autoStartCommand: getAutoStartCommand(),
      indexedJobsRetentionDays: getIndexedJobsRetentionDays(),
      notificationPreferences: getNotificationPreferences()
    }
  }
  if (selection.theme) data.theme = theme
  return { schemaVersion: EXPORT_SCHEMA_VERSION, exportedAt: new Date().toISOString(), appVersion: app.getVersion(), data }
}

/** Filesystem-safe timestamp for default export filenames, e.g. 2026-08-23-14-05-30. */
export function filenameTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
}

/**
 * Bytes of `data` inside the real bundle wrapper, serialized exactly the way
 * `IPC.data.exportJson` writes it (compact — this format is round-trip-only,
 * never meant for a human to read or hand-edit, so indentation would only
 * cost disk space). Using the identical `JSON.stringify(bundle)` call here
 * as the real write means these sizes are exact, not an estimate.
 */
export function bundleJsonBytes(data: ExportBundle['data']): number {
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
/**
 * `theme` is sized from whatever the renderer's current theme state is
 * (passed in the same way `buildExportBundle` receives it) — see that
 * function's doc comment for why this is the one domain not read from the DB.
 */
export function computeExportSizes(theme: ThemeState): ExportSizes {
  const jobs = listAllJobs()
  const indexedJobs = listAllIndexedJobs()
  const exclusions = listAllExclusions()
  const companyBoards = exportableCompanyBoards()
  const profile = getProfile()
  const settings = {
    autoStartCommand: getAutoStartCommand(),
    indexedJobsRetentionDays: getIndexedJobsRetentionDays(),
    notificationPreferences: getNotificationPreferences()
  }

  const empty = bundleJsonBytes({})
  return {
    jobs: { json: bundleJsonBytes({ jobs }) - empty, csv: Buffer.byteLength(jobsToCsv(jobs), 'utf-8') },
    indexedJobs: {
      json: bundleJsonBytes({ indexedJobs }) - empty,
      csv: Buffer.byteLength(indexedJobsToCsv(indexedJobs), 'utf-8')
    },
    exclusions: {
      json: bundleJsonBytes({ exclusions }) - empty,
      csv: Buffer.byteLength(exclusionsToCsv(exclusions), 'utf-8')
    },
    companyBoards: {
      json: bundleJsonBytes({ companyBoards }) - empty,
      csv: Buffer.byteLength(companyBoardsToCsv(companyBoards), 'utf-8')
    },
    profile: { json: bundleJsonBytes({ profile }) - empty },
    settings: { json: bundleJsonBytes({ settings }) - empty },
    theme: { json: bundleJsonBytes({ theme }) - empty },
    wrapperBytes: empty
  }
}
