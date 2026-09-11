import type { JobRecord } from './job'
import type { ExclusionRecord } from './exclusion'
import type { ProfileFields } from './profile'
import type { AutoStartCommand } from './ipcEvents'
import type { IndexedJobsRetention } from './indexedJob'
import type { AtsProvider } from './companyBoard'
import type { AppError } from './errorCodes'
import type { NotificationPreferences } from './notification'
import type { ThemeState } from './theme'

/**
 * Bumped whenever the export bundle shape changes in a way older imports can't
 * read. Adding a domain isn't such a change in either direction: every key
 * under `data` is optional, so an older bundle simply has none of the new
 * domain, and an older build reading a newer bundle drops the key it doesn't
 * know rather than rejecting the file.
 */
export const EXPORT_SCHEMA_VERSION = 1

export type ExportDomain = 'jobs' | 'indexedJobs' | 'exclusions' | 'companyBoards' | 'profile' | 'settings' | 'theme'

export const ALL_EXPORT_DOMAINS: ExportDomain[] = [
  'jobs',
  'indexedJobs',
  'exclusions',
  'companyBoards',
  'profile',
  'settings',
  'theme'
]

export type ExportSelection = Record<ExportDomain, boolean>

export function allDomainsSelected(value = true): ExportSelection {
  return {
    jobs: value,
    indexedJobs: value,
    exclusions: value,
    companyBoards: value,
    profile: value,
    settings: value,
    theme: value
  }
}

export interface ExportSettingsData {
  autoStartCommand: AutoStartCommand
  indexedJobsRetentionDays: IndexedJobsRetention
  /** Optional so bundles written before notification settings existed remain valid. */
  notificationPreferences?: NotificationPreferences
}

/** The single JSON round-trip format — the only format `data:import` accepts. */
export interface ExportBundle {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION
  exportedAt: string
  appVersion: string
  data: {
    jobs?: JobRecord[]
    indexedJobs?: ExportIndexedJob[]
    exclusions?: ExclusionRecord[]
    companyBoards?: ExportCompanyBoard[]
    profile?: ProfileFields | null
    settings?: ExportSettingsData
    /**
     * Unlike every other domain, never read or written by the main process —
     * it lives in the renderer's localStorage (see renderer/src/theme/theme.ts),
     * so main only carries it through unread between the renderer's export
     * call and, on import, the renderer applying it back via
     * `ThemeContext.importTheme`.
     */
    theme?: ThemeState
  }
}

/**
 * A tracked board, reduced to what actually identifies it.
 *
 * The live columns — `lastCheckedAt`, `lastJobCount`, `lastError` — are
 * deliberately left out: they describe what *this* machine saw the last time
 * it fetched the board, and carrying "12 open roles" into another install
 * would present a stale reading as a current one. The importing side starts
 * every board unchecked and the first search fills them in.
 *
 * `boardKey` is left out too, since it is derived from the descriptor and is
 * recomputed on import — a hand-edited file must not be able to file a board
 * under a key that doesn't match its own provider and token.
 */
export interface ExportCompanyBoard {
  provider: AtsProvider
  token: string
  host: string | null
  site: string | null
  companyName: string
  addedBy: 'user' | 'agent'
  enabled: boolean
  /**
   * The one count that does travel, because it isn't a reading: it is what
   * the feed the board was imported from claimed, and it orders the
   * importing machine's first sweeps exactly as it ordered this one's.
   * Optional so a bundle written before this field parses unchanged.
   */
  seedJobCount?: number | null
  createdAt: string
}

/**
 * Every job a search has ever surfaced, matched or not — the record of what
 * job discovery actually saw, which `jobs` (only what the agent chose to
 * queue) does not contain. Without this domain, moving an install or
 * restoring a backup silently drops the entire search history, and re-running
 * the same searches would re-index every row as newly seen.
 *
 * `id` is left out and regenerated on import, for the same reason it is for
 * exclusions: the row's identity is its URL, which is what the merge is keyed
 * on. The match columns (`matchedJobId`/`matchedStatus`/`matchedScore`) are
 * left out because they are not stored at all — they are derived at read time
 * by joining the jobs table, so exporting them would ship a snapshot of a
 * join that the importing machine recomputes for itself.
 */
export interface ExportIndexedJob {
  url: string
  title: string
  company: string
  location: string | null
  source: string | null
  snippet: string | null
  salaryRange: string | null
  postedAt: string | null
  searchQuery: string
  searchLocation: string | null
  firstSeenAt: string
  lastSeenAt: string
  seenCount: number
}

/** CSV is export-only (a single flat table), never a round-trip import source. */
export type CsvTable = 'jobs' | 'indexedJobs' | 'exclusions' | 'companyBoards'

/**
 * Byte sizes for the Export modal's per-section preview, computed
 * independent of the current checkbox selection so toggling a checkbox
 * doesn't need a round trip. `csv` is only meaningful for the two tabular
 * domains — CSV export never bundles profile/settings.
 */
export interface ExportSizes {
  jobs: { json: number; csv: number }
  indexedJobs: { json: number; csv: number }
  exclusions: { json: number; csv: number }
  companyBoards: { json: number; csv: number }
  profile: { json: number }
  settings: { json: number }
  theme: { json: number }
  /** Fixed bytes of the bundle wrapper itself (schemaVersion/exportedAt/appVersion/`data: {}`) — present once whenever any domain is included in a JSON export, on top of the per-domain sizes above. */
  wrapperBytes: number
}

/**
 * Total bytes of a compact JSON export bundle containing exactly the
 * selected domains. Not simply `wrapperBytes + sum(domain sizes)` — compact
 * `JSON.stringify` inserts a `,` between each key present in `data`, so N
 * selected domains need N-1 extra separator bytes beyond their individually
 * measured marginal sizes.
 */
export function totalJsonBytes(sizes: ExportSizes, selection: ExportSelection): number {
  const domains = ALL_EXPORT_DOMAINS.filter((d) => selection[d])
  if (domains.length === 0) return 0
  const sum = domains.reduce((total, d) => total + sizes[d].json, 0)
  return sizes.wrapperBytes + sum + (domains.length - 1)
}

export interface ExportFileResult {
  ok: boolean
  canceled?: boolean
  filePath?: string
  error?: AppError
}

export interface ImportDomainCounts {
  jobs?: number
  indexedJobs?: number
  exclusions?: number
  companyBoards?: number
  profile?: number
  settings?: number
  theme?: number
}

export interface ImportPickResult {
  ok: boolean
  canceled?: boolean
  error?: AppError
  filePath?: string
  bundle?: ExportBundle
  counts?: ImportDomainCounts
}

export interface ImportSummary {
  jobs?: { imported: number; skipped: number }
  /** `skipped` is a URL already indexed here: the merge keeps this machine's own seen-counts rather than overwriting them. */
  indexedJobs?: { imported: number; skipped: number }
  exclusions?: { imported: number; skipped: number }
  /** `skipped` covers both an already-tracked board and one refused by the watchlist ceiling. */
  companyBoards?: { imported: number; skipped: number }
  profile?: boolean
  settings?: boolean
  // No `theme` here: `applyImport` (main process) never touches that domain
  // — it's the renderer that reads `bundle.data.theme` off the same
  // `ImportApplyResult` and applies it via `ThemeContext.importTheme` once
  // this summary comes back ok.
}

export interface ImportApplyResult {
  ok: boolean
  error?: AppError
  summary?: ImportSummary
}
