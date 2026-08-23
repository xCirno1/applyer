import { app } from 'electron'
import { EXPORT_SCHEMA_VERSION } from '@shared/types/dataTransfer'
import type { ExportBundle, ExportSelection, ExportSizes } from '@shared/types/dataTransfer'
import { listAllJobs } from '../db/repositories/jobsRepository'
import { listAllExclusions } from '../db/repositories/jobExclusionsRepository'
import { getProfile } from '../db/repositories/profileRepository'
import { getAutoStartCommand, getIndexedJobsRetentionDays } from '../db/repositories/settingsRepository'
import { jobsToCsv, exclusionsToCsv } from './csv'

export function buildExportBundle(selection: ExportSelection): ExportBundle {
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
export function computeExportSizes(): ExportSizes {
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
