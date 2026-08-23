import type { JobRecord } from './job'
import type { ExclusionRecord } from './exclusion'
import type { ProfileFields } from './profile'
import type { AutoStartCommand } from './ipcEvents'
import type { IndexedJobsRetention } from './indexedJob'

/** Bumped whenever the export bundle shape changes in a way older imports can't read. */
export const EXPORT_SCHEMA_VERSION = 1

export type ExportDomain = 'jobs' | 'exclusions' | 'profile' | 'settings'

export const ALL_EXPORT_DOMAINS: ExportDomain[] = ['jobs', 'exclusions', 'profile', 'settings']

export type ExportSelection = Record<ExportDomain, boolean>

export function allDomainsSelected(value = true): ExportSelection {
  return { jobs: value, exclusions: value, profile: value, settings: value }
}

export interface ExportSettingsData {
  autoStartCommand: AutoStartCommand
  indexedJobsRetentionDays: IndexedJobsRetention
}

/** The single JSON round-trip format — the only format `data:import` accepts. */
export interface ExportBundle {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION
  exportedAt: string
  appVersion: string
  data: {
    jobs?: JobRecord[]
    exclusions?: ExclusionRecord[]
    profile?: ProfileFields | null
    settings?: ExportSettingsData
  }
}

/** CSV is export-only (a single flat table), never a round-trip import source. */
export type CsvTable = 'jobs' | 'exclusions'

/**
 * Byte sizes for the Export modal's per-section preview, computed
 * independent of the current checkbox selection so toggling a checkbox
 * doesn't need a round trip. `csv` is only meaningful for the two tabular
 * domains — CSV export never bundles profile/settings.
 */
export interface ExportSizes {
  jobs: { json: number; csv: number }
  exclusions: { json: number; csv: number }
  profile: { json: number }
  settings: { json: number }
  /** Fixed bytes of the bundle wrapper itself (schemaVersion/exportedAt/appVersion/`data: {}`) — present once whenever any domain is included in a JSON export, on top of the per-domain sizes above. */
  wrapperBytes: number
}

export interface ExportFileResult {
  ok: boolean
  canceled?: boolean
  filePath?: string
  error?: string
}

export interface ImportDomainCounts {
  jobs?: number
  exclusions?: number
  profile?: number
  settings?: number
}

export interface ImportPickResult {
  ok: boolean
  canceled?: boolean
  error?: string
  filePath?: string
  bundle?: ExportBundle
  counts?: ImportDomainCounts
}

export interface ImportSummary {
  jobs?: { imported: number; skipped: number }
  exclusions?: { imported: number; skipped: number }
  profile?: boolean
  settings?: boolean
}

export interface ImportApplyResult {
  ok: boolean
  error?: string
  summary?: ImportSummary
}
