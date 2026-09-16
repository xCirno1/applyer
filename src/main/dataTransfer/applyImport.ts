import type { ExportBundle, ExportCompanyBoard, ExportSelection, ImportSummary } from '@shared/types/dataTransfer'
import { importJobs } from '../db/repositories/jobsRepository'
import { importExclusions } from '../db/repositories/jobExclusionsRepository'
import { importIndexedJobs } from '../db/repositories/indexedJobsRepository'
import { importCompanyBoards } from '../db/repositories/companyBoardsRepository'
import { boardKeyOf, isValidBoardDescriptor } from '../browser/ats/providers'
import { saveProfile } from '../db/repositories/profileRepository'
import { importResumes, linkVariantsByName } from '../db/repositories/resumeRepository'
import { importChatSessions } from '../db/repositories/chatRepository'
import { broadcastChatEvent } from '../ipc/chatBroadcast'
import { broadcastAgentModeChanged } from '../openrouter/broadcast'
import type { ExportJobRecord, ExportResumesData } from '@shared/types/dataTransfer'
import {
  setAgentMode,
  setAutoStartCommand,
  setIndexedJobsRetentionDays,
  setNotificationPreferences,
  setOpenRouterSettings,
  setResumeSettings,
  setSearchCountry
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

/** True unless a selected executable setting was acknowledged verbatim. */
export function requiresAutoStartReview(
  bundle: ExportBundle,
  selection: ExportSelection,
  reviewedCommand: unknown
): boolean {
  const command = selection.settings ? bundle.data.settings?.autoStartCommand : undefined
  return !!command && reviewedCommand !== command
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
  if (selection.resumes && bundle.data.resumes) {
    const resumes = bundle.data.resumes as ExportResumesData
    summary.resumes = importResumes(resumes)
    if (resumes.settings) {
      setResumeSettings(resumes.settings)
      summary.resumeSettings = true
    }
  }
  // After both: a job names its variant, and the name only resolves once the
  // variants (from this bundle, or already here) exist.
  if (selection.jobs && bundle.data.jobs) {
    const links = bundle.data.jobs
      .filter((job): job is ExportJobRecord & { resumeVariantName: string } => !!job.resumeVariantName)
      .map((job) => ({ jobUrl: job.url, variantName: job.resumeVariantName }))
    if (links.length > 0) summary.resumeAssignments = linkVariantsByName(links)
  }
  if (selection.settings && bundle.data.settings) {
    setAutoStartCommand(bundle.data.settings.autoStartCommand)
    setIndexedJobsRetentionDays(bundle.data.settings.indexedJobsRetentionDays)
    if (bundle.data.settings.notificationPreferences) {
      setNotificationPreferences(bundle.data.settings.notificationPreferences)
    }
    if (bundle.data.settings.searchCountry) setSearchCountry(bundle.data.settings.searchCountry)
    if (bundle.data.settings.agentMode) {
      setAgentMode(bundle.data.settings.agentMode)
      // The shell keeps the mode in its own store and only hears the IPC
      // handler's push (`settings:setAgentMode`); a direct repository write
      // has to push the same way or the dock stays on the old surface.
      broadcastAgentModeChanged(bundle.data.settings.agentMode)
    }
    if (bundle.data.settings.openrouter) setOpenRouterSettings(bundle.data.settings.openrouter)
    summary.settings = true
  }
  // Append-only: chats are never merged against or replace existing
  // sessions (unlike jobs/exclusions/boards, a chat has no natural key to
  // merge on), so every import just adds whatever the bundle carries.
  if (selection.chats && bundle.data.chats) {
    const imported = importChatSessions(bundle.data.chats)
    // The chat store loads its list once on subscribe; each new session is
    // pushed as `session_updated`, which it folds in as an insert.
    for (const session of imported) broadcastChatEvent({ type: 'session_updated', session: { ...session, busy: false } })
    summary.chats = { imported: imported.length, skipped: bundle.data.chats.length - imported.length }
  }
  return summary
}
