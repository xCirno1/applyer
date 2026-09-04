import type { ExportBundle, ExportCompanyBoard, ExportSelection, ImportSummary } from '@shared/types/dataTransfer'
import { importJobs } from '../db/repositories/jobsRepository'
import { importExclusions } from '../db/repositories/jobExclusionsRepository'
import { importIndexedJobs } from '../db/repositories/indexedJobsRepository'
import { importCompanyBoards } from '../db/repositories/companyBoardsRepository'
import { boardKeyOf, isValidBoardDescriptor } from '../browser/ats/providers'
import { saveProfile } from '../db/repositories/profileRepository'
import {
  setAutoStartCommand,
  setIndexedJobsRetentionDays,
  setNotificationPreferences
} from '../db/repositories/settingsRepository'

/**
 * A row that cannot address a real board is dropped here and counted as
 * skipped rather than stored: a Workday board without its host and career
 * site, or a host that is not the provider's, would sit in the watchlist
 * failing every search — and in the host's case would aim those failures at
 * whatever the file named. The schema rejects a bundle containing one, so
 * this is the second of the two checks, not the only one.
 */
function isAddressable(board: ExportCompanyBoard): boolean {
  return isValidBoardDescriptor(board)
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
  if (selection.indexedJobs && bundle.data.indexedJobs) {
    summary.indexedJobs = importIndexedJobs(bundle.data.indexedJobs)
  }
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
    if (bundle.data.settings.notificationPreferences) {
      setNotificationPreferences(bundle.data.settings.notificationPreferences)
    }
    summary.settings = true
  }
  return summary
}
