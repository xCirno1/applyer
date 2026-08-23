import type { ExportBundle, ExportSelection, ImportSummary } from '@shared/types/dataTransfer'
import { importJobs } from '../db/repositories/jobsRepository'
import { importExclusions } from '../db/repositories/jobExclusionsRepository'
import { saveProfile } from '../db/repositories/profileRepository'
import { setAutoStartCommand, setIndexedJobsRetentionDays } from '../db/repositories/settingsRepository'

/** Applies only the domains that are both selected by the user and actually present in the bundle — a partial export file (e.g. jobs-only) selected in full is a no-op for the missing domains rather than an error. */
export function applyImport(bundle: ExportBundle, selection: ExportSelection): ImportSummary {
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
