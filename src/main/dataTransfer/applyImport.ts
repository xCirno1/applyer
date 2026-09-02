import type { ExportBundle, ExportCompanyBoard, ExportSelection, ImportSummary } from '@shared/types/dataTransfer'
import { importJobs } from '../db/repositories/jobsRepository'
import { importExclusions } from '../db/repositories/jobExclusionsRepository'
import { importCompanyBoards } from '../db/repositories/companyBoardsRepository'
import { boardKeyOf } from '../browser/ats/providers'
import { saveProfile } from '../db/repositories/profileRepository'
import { setAutoStartCommand, setIndexedJobsRetentionDays } from '../db/repositories/settingsRepository'

/**
 * A Workday board needs a host and a career-site id as well as a tenant, and
 * nothing else can address one. A row missing either is unusable rather than
 * merely incomplete — it would sit in the watchlist erroring on every search
 * — so it is dropped here and counted as skipped.
 */
function isAddressable(board: ExportCompanyBoard): boolean {
  return board.provider !== 'workday' || (board.host !== null && board.site !== null)
}

function importBoards(boards: ExportCompanyBoard[]): { imported: number; skipped: number } {
  const usable = boards.filter(isAddressable)
  // The key is derived here, never read from the file — see
  // `importCompanyBoards`.
  const result = importCompanyBoards(usable.map((board) => ({ ...board, boardKey: boardKeyOf(board) })))
  return { imported: result.imported, skipped: result.skipped + (boards.length - usable.length) }
}

/** Applies only the domains that are both selected by the user and actually present in the bundle — a partial export file (e.g. jobs-only) selected in full is a no-op for the missing domains rather than an error. */
export function applyImport(bundle: ExportBundle, selection: ExportSelection): ImportSummary {
  const summary: ImportSummary = {}
  if (selection.jobs && bundle.data.jobs) summary.jobs = importJobs(bundle.data.jobs)
  if (selection.exclusions && bundle.data.exclusions) summary.exclusions = importExclusions(bundle.data.exclusions)
  if (selection.companyBoards && bundle.data.companyBoards) {
    summary.companyBoards = importBoards(bundle.data.companyBoards)
  }
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
